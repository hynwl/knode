"""Run Manager — 동시성 제한 / 취소 / 타임아웃 / GC (Spec §11.1~§11.4).

`POST /runs` 라우터(M2-T11)의 유일한 소비자가 될 예정이지만, 이 파일은 라우터
없이도 완결적으로 테스트 가능하도록 설계했다 — `submit()`이 반환하는
`RunHandle`과 `EventBridge.stream()`만으로 SSE 프레이밍을 뺀 전체 실행 흐름을
검증할 수 있다.

**격리 원칙(Spec §11.2 MUST)**: 런 하나의 예외가 다른 런/서버 프로세스를 죽이면
안 된다. `_run()`은 컴파일 이후 전체를 자체 try/except로 감싸고, 실패는
`run.failed` 이벤트 + 상태 전이로만 표현한다 — 컴파일 실패(`CompilationError`)
와 동시성 초과(`AppError`/429)만 예외로 `submit()` 호출부까지 전파한다(이 시점엔
아직 run이 시작되지 않았으므로 격리 원칙 대상이 아니다).

**이 세션에서 의도적으로 비운 범위**
- 라우터 배선(`POST /runs`, `GET /runs/{id}`, SSE 엔드포인트) — M2-T11/T12 몫.
  `submit`/`get`/`cancel`/`gc`/`shutdown` 다섯 메서드만 공개 계약으로 제공한다.
- FastAPI lifespan에 `gc()` 주기 실행과 `shutdown()` SIGTERM 훅을 거는 것 —
  M2-T11이 앱 부트스트랩에서 싱글턴 `RunManager`를 만들 때 같이 배선한다.
- litellm 429/5xx 지수 백오프 재시도(§11.4) — litellm이 자체 재시도 설정
  (`num_retries`)을 지원하지만 `crewai_compat.make_llm`에 아직 파라미터가 없다.
  지금은 재시도 없이 1회 실행하고, 401/403(키 문제)/429/모델 미존재만 구분해
  각각 `AC-E601`/`AC-E603`/`AC-E604`로 안내한다. 실제 백오프 재시도는 비용
  추정기(M2-T14) 세션에서 `make_llm`에 `num_retries`를 추가할 때 같이 한다
  (과설계 금지 — 지금 필요하지 않은 재시도 설정 파이프라인을 미리 만들지 않는다).
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

import anyio

from app.compiler.compiler import CanvasCompiler, CompileResult
from app.core.crewai_compat import kickoff, normalize_crew_output
from app.core.errors import AppError
from app.core.logging import traceback_digest as make_traceback_digest
from app.runtime.bridge import EventBridge
from app.runtime.callbacks import RunEventContext, make_step_callback, register_run, unregister_run
from app.schemas.errors import Issue
from app.schemas.graph import CanvasDoc

RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
CancelReason = Literal["user", "timeout", "shutdown"]

#: Spec §11.2 — 런당 출력 텍스트 상한. 초과분은 truncate.
MAX_OUTPUT_CHARS = 1_000_000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + "...(truncated)"


class CancelledByUser(Exception):
    """Spec §10.6 취소 전략: `step_callback` 진입 시 raise해 CrewAI 실행
    스택을 빠져나온다. `reason`으로 사용자 취소/타임아웃/셧다운을 구분한다."""

    def __init__(self, reason: CancelReason) -> None:
        self.reason = reason
        super().__init__(f"run cancelled ({reason})")


@dataclass
class RunHandle:
    """`submit()`이 반환. 라우터가 `POST /runs` 응답(Spec §9.3)을 구성하는 데 쓴다."""

    run_id: str
    bridge: EventBridge
    task_order: list[str] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    status: RunStatus = "queued"
    started_at: float | None = None
    finished_at: float | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)
    cancel_reason: CancelReason | None = field(default=None, init=False)
    asyncio_task: "asyncio.Task[None] | None" = field(default=None, repr=False, init=False)

    def request_cancel(self, reason: CancelReason = "user") -> bool:
        """이미 끝난 run이면 무시한다. 먼저 요청된 reason이 우선한다(예: timeout이
        먼저 걸렸으면 뒤이은 user 취소 요청도 timeout으로 보고된다)."""
        if self.status not in ("queued", "running"):
            return False
        if self.cancel_reason is None:
            self.cancel_reason = reason
        self.cancel_event.set()
        return True


class _StepCallbackProxy:
    """`CanvasCompiler`는 생성 시점(=Agent 인스턴스화 시점)에 `step_callback`
    콜러블을 요구하지만, 그 콜러블이 실제로 *호출*되는 시점은 `kickoff()`가 도는
    한참 뒤다. `RunHandle`을 캡처해두면 순서 문제 없이 매 스텝마다 최신
    취소 상태를 볼 수 있다(§10.6: step_callback 진입 시 cancel 확인)."""

    def __init__(self, handle: RunHandle) -> None:
        self._handle = handle
        self._inner: Any = None

    def bind(self, ctx: RunEventContext) -> None:
        self._inner = make_step_callback(ctx)

    def __call__(self, payload: Any) -> None:
        if self._handle.cancel_event.is_set():
            raise CancelledByUser(self._handle.cancel_reason or "user")
        if self._inner is not None:
            self._inner(payload)


def _completed_task_node_ids(handle: RunHandle) -> list[str]:
    return [
        item["data"]["node_id"]
        for item in handle.bridge.buffered()
        if item["event"] == "task.completed" and item["data"].get("node_id")
    ]


def _classify_exception(exc: Exception) -> tuple[str, str]:
    """litellm이 실어 보내는 예외를 AC-Exxx로 분류한다(Spec §11.4).

    litellm은 최상위 앱 의존성이다(RECON F1/F2, `requirements.txt`에 명시 고정) —
    `crewai_compat.py`의 "CrewAI API 유일 통로" 원칙은 `from crewai import`에만
    적용되고 litellm에는 적용되지 않는다. 분류 실패(litellm 미설치/타입 변경) 시
    조용히 일반 실패로 폴백한다 — 여기서 죽으면 원래 예외 정보까지 잃는다.
    """
    try:
        from litellm.exceptions import (  # noqa: PLC0415
            AuthenticationError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
        )
    except Exception:  # pragma: no cover — litellm 미설치 환경 방어
        return "AC-E501", str(exc) or "실행 중 오류가 발생했습니다."

    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return "AC-E601", "API 키가 유효하지 않습니다 (401/403)."
    if isinstance(exc, RateLimitError):
        return "AC-E603", "요청 한도(rate limit)에 도달했습니다."
    if isinstance(exc, NotFoundError):
        return "AC-E604", "모델을 찾을 수 없습니다."
    return "AC-E501", str(exc) or "실행 중 오류가 발생했습니다."


class RunManager:
    """앱 생애주기 동안 싱글턴 하나로 존재한다(Spec §11.2 워커 모델:
    `uvicorn --workers 1`). 멀티워커가 필요해지면 `_runs` 인메모리 딕셔너리를
    Redis로 바꾸는 지점이 여기다 — 그 분리를 지금 미리 만들지는 않는다.
    """

    def __init__(self, *, max_concurrent: int, ttl_seconds: int) -> None:
        self._max_concurrent = max_concurrent
        self._ttl_seconds = ttl_seconds
        self._runs: dict[str, RunHandle] = {}
        self._lock = threading.Lock()

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for r in self._runs.values() if r.status in ("queued", "running"))

    def get(self, run_id: str) -> RunHandle | None:
        with self._lock:
            return self._runs.get(run_id)

    def cancel(self, run_id: str) -> bool:
        handle = self.get(run_id)
        return handle.request_cancel("user") if handle else False

    async def submit(
        self,
        doc: CanvasDoc,
        *,
        inputs: dict[str, Any],
        secrets: Any,
        max_duration_s: int | None,
    ) -> RunHandle:
        """검증/컴파일까지 동기적으로 끝낸다 — 실패하면 `CompilationError`가 그대로
        전파되어 라우터가 422로 변환한다(이 시점엔 run이 등록되지 않는다). 성공하면
        `RunHandle`을 등록하고 백그라운드 실행을 스케줄한다.

        Spec §11.2: 동시 실행 한도 초과 시 429 + `AC-E503`.
        """
        if self.active_count() >= self._max_concurrent:
            raise AppError(
                "AC-E503",
                "동시 실행 한도를 초과했습니다.",
                status_code=429,
            )

        run_id = f"run_{uuid.uuid4().hex[:20]}"
        handle = RunHandle(run_id=run_id, bridge=EventBridge(run_id))
        step_proxy = _StepCallbackProxy(handle)

        compiler = CanvasCompiler(doc, secrets=secrets, inputs=inputs, step_callback=step_proxy)
        result = compiler.compile()  # CompilationError는 그대로 전파 (라우터가 422 처리)

        handle.task_order = result.task_order
        handle.warnings = result.warnings
        with self._lock:
            self._runs[run_id] = handle

        handle.asyncio_task = asyncio.ensure_future(
            self._run(handle, result, step_proxy, secrets, max_duration_s)
        )
        return handle

    async def _run(
        self,
        handle: RunHandle,
        result: CompileResult,
        step_proxy: _StepCallbackProxy,
        secrets: Any,
        max_duration_s: int | None,
    ) -> None:
        handle.status = "running"
        handle.started_at = time.monotonic()
        ctx = RunEventContext(bridge=handle.bridge, node_index=result.node_index)
        step_proxy.bind(ctx)
        register_run(result.crew, ctx)

        handle.bridge.emit(
            "run.started",
            task_order=handle.task_order,
            agent_count=len(result.crew.agents),
            started_at=_now_iso(),
        )

        watchdog: asyncio.Task[None] | None = None
        if max_duration_s is not None:
            watchdog = asyncio.ensure_future(self._timeout_watchdog(handle, max_duration_s))

        try:
            crew_output = await anyio.to_thread.run_sync(
                lambda: kickoff(result.crew, result.inputs)
            )
        except CancelledByUser as exc:
            if exc.reason == "timeout":
                self._finish_failed(handle, "AC-E502", "최대 실행 시간을 초과했습니다.")
            else:
                self._finish_cancelled(handle)
        except Exception as exc:  # noqa: BLE001 — 격리 원칙: 여기서 절대 재전파하지 않는다
            code, message = _classify_exception(exc)
            self._finish_failed(handle, code, message, tb_digest=make_traceback_digest(exc))
        else:
            self._finish_succeeded(handle, crew_output)
        finally:
            if watchdog is not None:
                watchdog.cancel()
            unregister_run(result.crew)
            if secrets is not None and hasattr(secrets, "clear"):
                secrets.clear()  # Spec §12.2 MUST

    async def _timeout_watchdog(self, handle: RunHandle, timeout_s: int) -> None:
        try:
            await asyncio.sleep(timeout_s)
        except asyncio.CancelledError:
            return
        if handle.status == "running":
            handle.request_cancel("timeout")

    def _duration_ms(self, handle: RunHandle) -> int:
        if handle.started_at is None:
            return 0
        return int((time.monotonic() - handle.started_at) * 1000)

    def _finish_succeeded(self, handle: RunHandle, crew_output: Any) -> None:
        result = normalize_crew_output(crew_output)
        handle.bridge.emit(
            "run.completed",
            duration_ms=self._duration_ms(handle),
            final_output=_truncate(result.raw),
            usage=result.usage,
        )
        handle.status = "succeeded"
        handle.finished_at = time.monotonic()

    def _finish_failed(
        self, handle: RunHandle, code: str, message: str, *, tb_digest: str | None = None
    ) -> None:
        handle.bridge.emit(
            "run.failed",
            error={"code": code, "message": _truncate(message)},
            traceback_digest=tb_digest,
        )
        handle.status = "failed"
        handle.finished_at = time.monotonic()

    def _finish_cancelled(self, handle: RunHandle) -> None:
        handle.bridge.emit(
            "run.cancelled",
            cancelled_at=_now_iso(),
            completed_tasks=_completed_task_node_ids(handle),
        )
        handle.status = "cancelled"
        handle.finished_at = time.monotonic()

    def gc(self) -> int:
        """완료된 런 중 TTL(기본 30분) 초과분을 제거한다(Spec §11.2). 순수 함수로만
        제공 — 주기 실행 스케줄링은 M2-T11이 앱 lifespan에 배선한다."""
        now = time.monotonic()
        removed = 0
        with self._lock:
            for run_id in list(self._runs):
                handle = self._runs[run_id]
                if handle.status in ("succeeded", "failed", "cancelled") and handle.finished_at is not None:
                    if now - handle.finished_at > self._ttl_seconds:
                        del self._runs[run_id]
                        removed += 1
        return removed

    def shutdown(self) -> None:
        """SIGTERM 등 앱 종료 시 호출(Spec §11.2 MUST 그레이스풀 셧다운). 진행 중인
        런에 취소를 요청한다 — 이미 도는 스레드를 강제 종료하지는 않는다(§10.6과
        동일한 현실적 한계). lifespan 훅 배선은 M2-T11 몫."""
        with self._lock:
            running = [h for h in self._runs.values() if h.status in ("queued", "running")]
        for handle in running:
            handle.request_cancel("shutdown")


__all__ = ["RunManager", "RunHandle", "CancelledByUser", "MAX_OUTPUT_CHARS"]
