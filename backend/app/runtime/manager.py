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
import logging
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

import anyio

from app.compiler.compiler import (
    CanvasCompiler,
    CompileResult,
    DEFAULT_HUMAN_PROMPT,
    DEFAULT_HUMAN_TIMEOUT_S,
    HumanGate,
)
from app.compiler.graph import CanvasGraph
from app.core.crewai_compat import (
    HumanFeedbackRequest,
    install_human_input_provider,
    kickoff,
    normalize_crew_output,
    restore_human_input_provider,
)
from app.core.errors import AppError
from app.core.logging import traceback_digest as make_traceback_digest
from app.runtime.bridge import EventBridge
from app.runtime.callbacks import RunEventContext, make_step_callback, register_run, unregister_run
from app.runtime.cost import estimate_dry_run
from app.schemas.errors import ISSUE_CATALOG, Issue
from app.schemas.graph import CanvasDoc

logger = logging.getLogger(__name__)

RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
CancelReason = Literal["user", "timeout", "shutdown"]

#: Spec §11.2 — 런당 출력 텍스트 상한. 초과분은 truncate.
MAX_OUTPUT_CHARS = 1_000_000

#: Dry Run(Spec §11.3) 태스크당 가짜 진행 간격 — "애니메이션 리허설"이 보이려면
#: 즉시 끝나면 안 되지만, 검증 목적이니 실제 LLM 호출만큼 오래 걸릴 필요는 없다.
DRY_RUN_STEP_S = 0.5


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + "...(truncated)"


class CancelledByUser(Exception):
    """Spec §10.6 취소 전략: CrewAI 콜백 진입 시 raise해 실행 스택을 빠져나온다.
    `reason`으로 사용자 취소/타임아웃/셧다운을 구분한다."""

    def __init__(self, reason: CancelReason) -> None:
        self.reason = reason
        super().__init__(f"run cancelled ({reason})")


class HumanInputAborted(BaseException):
    """사람 검토 대기를 중단시키는 신호 (Spec §5.10, M3-T10).

    ⚠️ **`Exception` 이 아니라 `BaseException` 을 상속한다** (RECON F16-c).
       사람 검토 대기는 `Agent.execute_task()` **안쪽**에서 일어나는데, 그 함수는
       `except Exception` 으로 모든 예외를 삼켜 `_handle_execution_error()` →
       `max_retry_limit`(기본 2)만큼 태스크를 **통째로 재실행**한다. 즉 평범한
       `Exception` 으로 던지면 "타임아웃으로 중단"이 "사람에게 두 번 더 묻기"로
       둔갑한다(실측: `crewai/agent/core.py:916`). `BaseException` 은 그 그물을
       빠져나가 `kickoff()` 호출부까지 그대로 올라온다.

       `anyio.to_thread.run_sync` 는 워커 스레드에서 `except BaseException` 으로
       잡아 future 에 실어 주므로(`anyio/_backends/_asyncio.py:1034`) 이벤트 루프
       쪽 `_run()` 이 정상적으로 받아 처리한다 — 격리 원칙 위반이 아니다.
    """

    def __init__(self, kind: Literal["timeout", "cancelled"], node_id: str, timeout_s: int = 0) -> None:
        self.kind = kind
        self.node_id = node_id
        self.timeout_s = timeout_s
        super().__init__(f"human input aborted ({kind}) on {node_id}")


@dataclass
class PendingHumanRequest:
    """SSE `human.request` 를 내보낸 뒤 `POST /runs/{id}/human` 응답을 기다리는 1건.

    크루 실행 스레드가 `event` 를 기다리고, 라우터(이벤트 루프 스레드)가
    `response` 를 채운 뒤 `event.set()` 으로 깨운다.
    """

    node_id: str
    prompt: str
    timeout_s: int
    on_timeout: str
    round: int = 1
    event: threading.Event = field(default_factory=threading.Event, repr=False)
    response: str | None = None


#: 사람 검토 대기 중 취소 플래그를 다시 확인하는 간격. `threading.Event.wait()` 는
#: 한 번에 하나만 기다릴 수 있으므로, 응답 이벤트를 이 간격으로 쪼개 기다리면서
#: 사이사이 `cancel_event` 를 본다 — Stop 을 눌렀는데 스레드가 5분간 파킹된 채로
#: 남는 상황을 막는다 (Spec §11.2 격리 원칙).
HUMAN_WAIT_POLL_S = 0.25


#: 취소 요청을 받았을 때 사용자에게 보여줄 안내. RECON F15 — CrewAI 1.15.18 은
#: 진행 중인 LLM 호출을 중간에 끊는 공개 API가 없다. 태스크 경계에서만 끊긴다.
_CANCEL_NOTICE: dict[CancelReason, str] = {
    "user": "취소를 요청했습니다 — 진행 중인 태스크가 끝나는 즉시 중단됩니다.",
    "timeout": "최대 실행 시간을 초과했습니다 — 진행 중인 태스크가 끝나는 즉시 중단됩니다.",
    "shutdown": "서버가 종료 중입니다 — 진행 중인 태스크가 끝나는 즉시 중단됩니다.",
}


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
    #: task node id → 대기 중인 사람 검토 요청 (Spec §5.10). 크루 스레드가 넣고
    #: 라우터가 꺼내 채운다 — 두 스레드가 만나는 지점이라 락으로 감싼다.
    pending_human: dict[str, PendingHumanRequest] = field(default_factory=dict, repr=False)
    human_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def open_human_request(self, pending: PendingHumanRequest) -> None:
        with self.human_lock:
            self.pending_human[pending.node_id] = pending

    def close_human_request(self, node_id: str) -> None:
        with self.human_lock:
            self.pending_human.pop(node_id, None)

    def pending_human_nodes(self) -> list[str]:
        with self.human_lock:
            return list(self.pending_human)

    def submit_human_response(self, node_id: str, response: str) -> bool:
        """`POST /runs/{id}/human` 진입점. 대기 중인 요청이 없으면 `False`.

        빈 문자열 = 승인(검토 종료), 비어 있지 않으면 = 수정 요청(에이전트 재실행 후
        다시 물어본다) — CrewAI 기본 프로바이더의 계약을 그대로 노출한 것이다
        (RECON F16-b).
        """
        with self.human_lock:
            pending = self.pending_human.get(node_id)
            if pending is None or pending.event.is_set():
                return False
            pending.response = response
            pending.event.set()
        return True

    def request_cancel(self, reason: CancelReason = "user") -> bool:
        """이미 끝난 run이면 무시한다. 먼저 요청된 reason이 우선한다(예: timeout이
        먼저 걸렸으면 뒤이은 user 취소 요청도 timeout으로 보고된다).

        첫 요청에서만 안내 로그를 한 번 발행한다 — 취소가 **즉시** 걸리지 않고
        태스크 경계에서 걸린다는 사실을 사용자에게 정직하게 알려야 한다
        (그러지 않으면 "멈추지 않는다"고 오해해 Stop을 반복해서 누른다).
        """
        if self.status not in ("queued", "running"):
            return False
        first_request = self.cancel_reason is None
        if first_request:
            self.cancel_reason = reason
        self.cancel_event.set()
        if first_request:
            try:
                self.bridge.emit(
                    "log", level="warn", node_id=None, message=_CANCEL_NOTICE[reason]
                )
            except Exception:  # noqa: BLE001 — 안내 실패가 취소 자체를 막으면 안 된다
                pass
        return True


class _StepCallbackProxy:
    """`CanvasCompiler`는 생성 시점(=Agent 인스턴스화 시점)에 `step_callback`
    콜러블을 요구하지만, 그 콜러블이 실제로 *호출*되는 시점은 `kickoff()`가 도는
    한참 뒤다. `RunHandle`을 캡처해두면 순서 문제 없이 매 스텝마다 최신
    취소 상태를 볼 수 있다(§10.6: step_callback 진입 시 cancel 확인).

    ⚠️ RECON F15: 이 콜백은 **호출이 보장되지 않는다.** crewai 1.15.18 의 기본
    `executor_class` 는 `experimental.agent_executor.AgentExecutor` 이고, 툴이
    없는 에이전트 경로에서는 `_invoke_step_callback` 을 한 번도 부르지 않는다
    (실측: 3태스크 실행에 step_callback 0회). 그래서 취소의 **주 검문소는
    `_TaskCallbackProxy`**(태스크 경계, 호출 보장됨)이고 이쪽은 보조 검문소다 —
    툴을 쓰는 에이전트에서는 태스크 중간에도 걸린다.
    """

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


class _TaskCallbackProxy:
    """태스크 경계 취소 검문소 (Spec §10.6).

    실측(2026-08-31): `Crew.task_callback` 은 `Task._execute_core` 가 태스크
    산출물을 확정한 **직후**, 다음 태스크로 넘어가기 전에 크루 실행 스레드에서
    호출된다. 여기서 raise 하면 예외가 `Task._execute_core` → `Crew._execute_tasks`
    → `kickoff()` 로 **가공 없이 그대로** 전파된다 (`crewai/task.py` 는 예외를
    `TaskFailedEvent` 로 알리고 `raise e` 만 한다).

    `Agent.step_callback` 에서 raise 하는 것과 결정적으로 다른 점: 그쪽은
    `Agent._handle_execution_error` 의 재시도 루프(`max_retry_limit`, 기본 2)
    안이라 취소가 태스크를 **두 번 더 실행시킨 뒤에야** 밖으로 나온다. 태스크
    콜백은 그 루프 바깥이라 재실행이 없다.
    """

    def __init__(self, handle: RunHandle) -> None:
        self._handle = handle

    def __call__(self, _output: Any) -> None:
        if self._handle.cancel_event.is_set():
            raise CancelledByUser(self._handle.cancel_reason or "user")


def _completed_task_node_ids(handle: RunHandle) -> list[str]:
    return [
        item["data"]["node_id"]
        for item in handle.bridge.buffered()
        if item["event"] == "task.completed" and item["data"].get("node_id")
    ]


#: `node.status` 상 더 이상 변하지 않는 상태.
_TERMINAL_NODE_STATUSES = frozenset({"succeeded", "failed", "cancelled", "skipped"})


def _last_node_statuses(handle: RunHandle) -> dict[str, str]:
    """지금까지 발행된 `node.status` 이벤트에서 노드별 최종 상태를 재생한다."""
    statuses: dict[str, str] = {}
    for item in handle.bridge.buffered():
        if item["event"] != "node.status":
            continue
        node_id = item["data"].get("node_id")
        if node_id:
            statuses[node_id] = item["data"]["status"]
    return statuses


def _settle_pending_nodes(handle: RunHandle, status: str) -> None:
    """실행이 끝났는데 `running`/`queued`로 남아 있는 태스크 노드를 정리한다.

    이걸 안 하면 취소/실패 후에도 노드가 영원히 "실행 중"으로 빛난다 —
    UI가 일어나지 않은 일을 주장하게 된다.
    """
    seen = _last_node_statuses(handle)
    for node_id in handle.task_order:
        if seen.get(node_id) not in _TERMINAL_NODE_STATUSES:
            handle.bridge.emit("node.status", node_id=node_id, status=status)


#: 429 인데 "기다리면 풀리는 한도"가 아니라 **잔액이 바닥난** 경우를 구분하는 표식.
#: OpenAI 는 `insufficient_quota`/`credit_balance_exhausted` 를 쓴다. 이걸 AC-E603
#: (rate limit)으로 뭉뚱그리면 힌트가 "잠시 후 다시 시도하세요"가 되는데, 크레딧이
#: 없는 사용자에게는 **틀린 안내**다 — 기다려도 영원히 안 풀린다.
_QUOTA_MARKERS = ("insufficient_quota", "credit_balance_exhausted", "billing_hard_limit")

#: "키를 안 넣었다"의 문구들. openai SDK 는 `Missing credentials …`,
#: CrewAI 는 `OPENAI_API_KEY is required` 처럼 프로바이더별 변수명을 그대로 쓴다.
#: 둘 다 **HTTP 응답이 없는** 예외라 상태코드 기반 분기로는 못 잡는다.
_MISSING_CREDENTIAL_RE = re.compile(
    r"(missing credentials|[A-Z][A-Z0-9_]*_API_KEY\s+is\s+required|api[_ ]key.{0,20}not\s+(?:set|provided))",
    re.IGNORECASE,
)

#: "그런 모델 없다"의 문구들. CrewAI 1.15 는 openai SDK 의 `NotFoundError` 를 **평범한
#: `ValueError` 로 다시 감싸서** 던진다(실측: Ollama base_url 로 없는 모델을 부르면
#: `ValueError: Model gpt-4o-mini not found: Error code: 404 - {...}`). 그래서 아래
#: isinstance 분기에 안 걸리고 AC-E501 + 영어 원문 덤프로 떨어졌다 — 로컬 모델 이름을
#: 잘못 적는 건 Ollama 경로에서 가장 흔한 실패라 코드가 반드시 잡아야 한다.
#: `model` 과 `not found` 가 붙어 있을 때만 매칭해, 툴이 낸 평범한 404 는 건드리지 않는다.
_MODEL_NOT_FOUND_RE = re.compile(r"model[^\n]{0,80}not[_ ]found", re.IGNORECASE)


def _classify_exception(exc: Exception) -> tuple[str, str]:
    """LLM 프로바이더 예외를 AC-Exxx로 분류한다(Spec §11.4).

    ⚠️ **RECON F17 (M4-T10)** — 예전 구현은 `litellm.exceptions.*` 로 isinstance 를
    했는데, litellm 의 예외 클래스는 **openai SDK 예외의 서브클래스**다
    (`litellm.RateLimitError` → `openai.RateLimitError`). 상속 방향이 그러하므로
    openai SDK 가 직접 던진 예외는 `isinstance(exc, litellm.RateLimitError)` 가
    **False** 다. 그런데 실제 실행에서 올라오는 건 openai SDK 예외였다 — 결과적으로
    AC-E601/E603/E604 세 코드가 **한 번도 발생하지 않고** 전부 AC-E501 + 파이썬
    repr 원문으로 떨어졌다(사용자가 가장 먼저 만나는 실패 3종이 전부 여기다).
    유닛테스트가 litellm 예외만 만들어 넣고 있어서 초록인 채로 살아남았다.

    그래서 지금은 **openai SDK 의 베이스 클래스**로 매칭한다 — litellm 예외도 그
    서브클래스라 두 경로가 한 번에 잡힌다. openai 가 없는 환경을 대비해 litellm 으로
    폴백하고, 둘 다 없으면 조용히 일반 실패로 떨어뜨린다(여기서 죽으면 원래 예외
    정보까지 잃는다).
    """
    try:
        from openai import (  # noqa: PLC0415
            AuthenticationError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
        )
    except Exception:  # pragma: no cover — openai 미설치 환경 방어
        try:
            from litellm.exceptions import (  # noqa: PLC0415
                AuthenticationError,
                NotFoundError,
                PermissionDeniedError,
                RateLimitError,
            )
        except Exception:
            return "AC-E501", str(exc) or "실행 중 오류가 발생했습니다."

    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return "AC-E601", "API 키가 유효하지 않습니다 (401/403)."
    if isinstance(exc, RateLimitError):
        haystack = f"{exc} {getattr(exc, 'body', '') or ''}"
        if any(m in haystack for m in _QUOTA_MARKERS):
            return "AC-E605", "API 크레딧/쿼터가 소진되었습니다."
        return "AC-E603", "요청 한도(rate limit)에 도달했습니다."
    if isinstance(exc, NotFoundError):
        return "AC-E604", "모델을 찾을 수 없습니다."

    # 키를 **아예 안 넣은** 경우. 신규 사용자가 가장 먼저 만나는 실패인데도
    # AC-E501 + 영문 원문("OPENAI_API_KEY is required")으로 떨어지고 있었다
    # (M4-T10 감사, F17 과 같은 뿌리). 이건 HTTP 상태가 없는 예외라 위 분기에
    # 안 걸린다 — openai SDK 는 `OpenAIError` 베이스로, CrewAI 는 자체 문구로 던진다.
    # 컴파일 시점에 막지 않는 건 의도적이다: BYOK 없이 **서버 환경변수**로 키를
    # 주는 셀프호스팅 경로가 정상 사용법이라(`compiler.py::_build_llm` 참조),
    # 여기서 하드 실패시키면 그 배포가 통째로 깨진다.
    text = str(exc)
    if _MISSING_CREDENTIAL_RE.search(text):
        return "AC-E602", "필요한 API 키가 설정되지 않았습니다."
    if _MODEL_NOT_FOUND_RE.search(text):
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

    def submit_human_response(self, run_id: str, node_id: str, response: str) -> bool:
        """Spec §9.2 `POST /runs/{id}/human`. 대기 중인 요청이 없으면 `False`."""
        handle = self.get(run_id)
        return handle.submit_human_response(node_id, response) if handle else False

    async def submit(
        self,
        doc: CanvasDoc,
        *,
        inputs: dict[str, Any],
        secrets: Any,
        max_duration_s: int | None,
        dry_run: bool = False,
    ) -> RunHandle:
        """검증/컴파일까지 동기적으로 끝낸다 — 실패하면 `CompilationError`가 그대로
        전파되어 라우터가 422로 변환한다(이 시점엔 run이 등록되지 않는다). 성공하면
        `RunHandle`을 등록하고 백그라운드 실행을 스케줄한다.

        Spec §11.2: 동시 실행 한도 초과 시 429 + `AC-E503`.
        `dry_run=True`(Spec §11.3)면 컴파일까지는 동일하게 거치되(구조 검증 +
        `task_order` 확보), `_run()`이 `kickoff()` 대신 `_run_dry()`로 분기한다 —
        LLM/네트워크 호출이 전혀 없다.
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

        compiler = CanvasCompiler(
            doc,
            secrets=secrets,
            inputs=inputs,
            step_callback=step_proxy,
            task_callback=_TaskCallbackProxy(handle),
            dry_run=dry_run,
        )
        result = compiler.compile()  # CompilationError는 그대로 전파 (라우터가 422 처리)

        handle.task_order = result.task_order
        handle.warnings = result.warnings
        with self._lock:
            self._runs[run_id] = handle

        handle.asyncio_task = asyncio.ensure_future(
            self._run(handle, result, step_proxy, secrets, max_duration_s, dry_run=dry_run, doc=doc)
        )
        return handle

    async def _run(
        self,
        handle: RunHandle,
        result: CompileResult,
        step_proxy: _StepCallbackProxy,
        secrets: Any,
        max_duration_s: int | None,
        *,
        dry_run: bool,
        doc: CanvasDoc,
    ) -> None:
        if dry_run:
            try:
                await self._run_dry(handle, result, doc)
            finally:
                if secrets is not None and hasattr(secrets, "clear"):
                    secrets.clear()  # Spec §12.2 MUST
            return

        handle.status = "running"
        handle.started_at = time.monotonic()
        ctx = RunEventContext(
            bridge=handle.bridge,
            node_index=result.node_index,
            cancel_event=handle.cancel_event,
        )
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

        handler = self._make_human_handler(handle, ctx, result.human_gates)

        def _kickoff_with_human_gate() -> Any:
            """워커 스레드 본체. 사람 검토 프로바이더는 **여기서** 설치한다 —
            `ContextVar` 는 설정한 컨텍스트에서만 보이는데, `to_thread.run_sync`
            가 복사해 준 이 컨텍스트가 곧 `get_provider()` 가 불릴 컨텍스트다
            (`crewai_compat.install_human_input_provider` 주석 참조).

            `human_gates` 가 비어 있어도 항상 설치한다 — Task 의 `human_input`
            토글만 켠 그래프도(Human 노드 없이) 여기로 들어오고, 설치하지 않으면
            CrewAI 기본 프로바이더가 **stdin `input()`** 을 불러 서버 스레드가
            영원히 멈춘다 (RECON F16-a).
            """
            token = install_human_input_provider(handler)
            try:
                return kickoff(result.crew, result.inputs)
            finally:
                restore_human_input_provider(token)

        try:
            crew_output = await anyio.to_thread.run_sync(_kickoff_with_human_gate)
        except HumanInputAborted as exc:
            if exc.kind == "timeout":
                self._finish_failed(
                    handle, "AC-E507",
                    f"사람 검토 응답을 {exc.timeout_s}초 동안 받지 못해 실행을 중단했습니다.",
                    pending_status="cancelled",
                )
            else:
                self._finish_cancelled(handle)
        except CancelledByUser as exc:
            if exc.reason == "timeout":
                self._finish_failed(
                    handle, "AC-E502", "최대 실행 시간을 초과했습니다.",
                    pending_status="cancelled",
                )
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
            with handle.human_lock:
                handle.pending_human.clear()
            unregister_run(result.crew)
            if secrets is not None and hasattr(secrets, "clear"):
                secrets.clear()  # Spec §12.2 MUST

    # --- Human-in-the-loop (Spec §5.10, §9.2, M3-T10) ---

    def _make_human_handler(
        self, handle: RunHandle, ctx: RunEventContext, gates: dict[str, HumanGate]
    ):
        """`crewai_compat.DelegatingHumanInputProvider` 가 부를 콜백을 만든다.

        **크루 실행 스레드에서** 호출된다. 반환값의 의미는 CrewAI 계약 그대로:
        빈 문자열 = 승인(검토 종료), 비어 있지 않으면 = 수정 요청(재실행 후 재질문).
        """

        def _handler(request: HumanFeedbackRequest) -> str:
            try:
                return self._await_human_response(handle, ctx, gates, request)
            except HumanInputAborted:
                raise
            except Exception:  # noqa: BLE001 — 격리 원칙: 검토 로직 버그로 run 을 죽이지 않는다
                logger.exception("사람 검토 대기 처리 실패 — 승인으로 간주하고 계속합니다")
                return ""

        return _handler

    def _await_human_response(
        self,
        handle: RunHandle,
        ctx: RunEventContext,
        gates: dict[str, HumanGate],
        request: HumanFeedbackRequest,
    ) -> str:
        node_id = ctx.node_index.get(request.task_key or "")
        if node_id is None:
            # 역매핑 실패 → 어느 노드에 물어야 할지 UI 가 알 수 없다. 여기서 막연히
            # 기다리면 스레드만 5분 파킹된다 — 정직하게 경고하고 승인 처리한다.
            handle.bridge.emit(
                "log", level="warn", node_id=None,
                message="사람 검토 요청의 노드를 역매핑하지 못해 자동 승인했습니다.",
                message_key="runEvent.humanUnmapped",
            )
            return ""

        gate = gates.get(node_id) or HumanGate(
            task_node_id=node_id, human_node_id=None,
            prompt=DEFAULT_HUMAN_PROMPT, timeout_s=DEFAULT_HUMAN_TIMEOUT_S, on_timeout="abort",
        )
        # ⚠️ 회차 표시("2차 검토")를 문자열로 **붙이지 않는다.** 프롬프트는 사용자가
        # 쓴 글이고 접두어는 서버가 지은 말이라, 합쳐 보내면 UI 언어와 어긋난다.
        # `round` 를 그대로 실어 보내고 표기는 프론트가 만든다 (§17.3).
        prompt = gate.prompt

        pending = PendingHumanRequest(
            node_id=node_id, prompt=prompt, timeout_s=gate.timeout_s,
            on_timeout=gate.on_timeout, round=request.round,
        )
        handle.open_human_request(pending)
        handle.bridge.emit(
            "human.request", node_id=node_id, prompt=prompt, timeout_s=gate.timeout_s,
            round=request.round,
        )

        try:
            deadline = time.monotonic() + gate.timeout_s
            while True:
                if handle.cancel_event.is_set():
                    # Stop 을 누른 사용자를 5분간 기다리게 하지 않는다.
                    raise HumanInputAborted("cancelled", node_id)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                if pending.event.wait(min(HUMAN_WAIT_POLL_S, remaining)):
                    answer = pending.response or ""
                    approved = answer.strip() == ""
                    handle.bridge.emit(
                        "log", level="info", node_id=node_id,
                        message=("✅ 검토 승인 — 다음 단계로 진행합니다."
                                 if approved
                                 else "✍️ 수정 요청을 받았습니다 — 에이전트가 다시 실행됩니다."),
                        message_key=("runEvent.humanApproved" if approved
                                     else "runEvent.humanRevision"),
                    )
                    return answer
        finally:
            handle.close_human_request(node_id)

        if gate.on_timeout == "continue":
            handle.bridge.emit(
                "log", level="warn", node_id=node_id,
                message=f"⏱️ {gate.timeout_s}초 안에 응답이 없어 승인으로 간주하고 계속합니다.",
                message_key="runEvent.humanTimeoutContinue",
                params={"seconds": gate.timeout_s},
            )
            return ""
        handle.bridge.emit(
            "log", level="error", node_id=node_id,
            message=f"⏱️ {gate.timeout_s}초 안에 응답이 없어 실행을 중단합니다.",
            message_key="runEvent.humanTimeoutAbort",
            params={"seconds": gate.timeout_s},
        )
        raise HumanInputAborted("timeout", node_id, gate.timeout_s)

    async def _run_dry(self, handle: RunHandle, result: CompileResult, doc: CanvasDoc) -> None:
        """Dry Run(Spec §11.3) — LLM/네트워크 호출 없이 `task_order`를 순차 리허설한다.

        CrewAI 이벤트 버스에 전혀 관여하지 않는다(`register_run`/`kickoff` 미호출) —
        이 경로는 그래프 텍스트만으로 만든 가짜 이벤트 시퀀스다. 실제 실행과 동일한
        이벤트 카탈로그(§10.2)를 그대로 쓰므로 프론트는 dry run 전용 분기 없이
        기존 SSE 반영 로직(§10.3)으로 애니메이션 리허설을 그린다.
        """
        handle.status = "running"
        handle.started_at = time.monotonic()

        handle.bridge.emit(
            "run.started",
            task_order=handle.task_order,
            agent_count=len(result.crew.agents),
            started_at=_now_iso(),
        )
        handle.bridge.emit(
            "log", level="info", node_id=None,
            message="🧪 Dry Run — 실제 LLM 호출 없이 실행 순서와 예상 비용만 보여줍니다.",
            message_key="runEvent.dryRunBanner",
        )

        graph = CanvasGraph.from_doc(doc).normalize()
        estimates = estimate_dry_run(graph, handle.task_order)
        total_prompt = 0
        total_completion = 0
        total_cost = 0.0

        try:
            for est in estimates:
                if handle.cancel_event.is_set():
                    self._finish_cancelled(handle)
                    return

                task_node = graph.node(est.node_id)
                task_name = str((task_node.data.get("name") if task_node else None) or est.node_id)

                if est.agent_node_id:
                    handle.bridge.emit("node.status", node_id=est.agent_node_id, status="running")
                handle.bridge.emit("node.status", node_id=est.node_id, status="running")
                handle.bridge.emit("task.started", node_id=est.node_id, task_name=task_name,
                                    agent_node_id=est.agent_node_id)

                await asyncio.sleep(DRY_RUN_STEP_S)
                if handle.cancel_event.is_set():
                    self._finish_cancelled(handle)
                    return

                handle.bridge.emit(
                    "token.usage", node_id=est.node_id,
                    prompt_tokens=est.prompt_tokens, completion_tokens=est.completion_tokens,
                    cost_usd=est.cost_usd,
                )
                handle.bridge.emit(
                    "task.completed", node_id=est.node_id,
                    output="[Dry Run] 실제 호출 없이 리허설된 태스크입니다 — 출력이 생성되지 않았습니다.",
                    output_key="runEvent.dryRunTaskOutput",
                    duration_ms=int(DRY_RUN_STEP_S * 1000),
                )
                handle.bridge.emit("node.status", node_id=est.node_id, status="succeeded")
                if est.agent_node_id:
                    handle.bridge.emit("node.status", node_id=est.agent_node_id, status="succeeded")

                total_prompt += est.prompt_tokens
                total_completion += est.completion_tokens
                total_cost += est.cost_usd
        except Exception as exc:  # noqa: BLE001 — 격리 원칙: dry run도 서버를 죽이면 안 된다
            # 예외 문구가 없으면 **카탈로그 원문 그대로** 떨어뜨린다. 프론트
            # `issueText()` 는 메시지가 카탈로그와 일치할 때만 로케일로 바꿔치므로,
            # 여기서 따로 지어낸 문장을 쓰면 그 문장만 번역되지 않는다.
            self._finish_failed(
                handle, "AC-E501", str(exc) or ISSUE_CATALOG["AC-E501"].message,
                tb_digest=make_traceback_digest(exc),
            )
            return

        handle.bridge.emit(
            "run.completed",
            duration_ms=self._duration_ms(handle),
            final_output=f"[Dry Run] 예상 비용 ~${total_cost:.4f} (실제 LLM 호출 없음)",
            final_output_key="runEvent.dryRunFinal",
            final_output_params={"cost": f"{total_cost:.4f}"},
            usage={"prompt_tokens": total_prompt, "completion_tokens": total_completion},
        )
        handle.status = "succeeded"
        handle.finished_at = time.monotonic()

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
        self,
        handle: RunHandle,
        code: str,
        message: str,
        *,
        tb_digest: str | None = None,
        pending_status: str = "skipped",
    ) -> None:
        _settle_pending_nodes(handle, pending_status)
        handle.bridge.emit(
            "run.failed",
            error={"code": code, "message": _truncate(message)},
            traceback_digest=tb_digest,
        )
        handle.status = "failed"
        handle.finished_at = time.monotonic()

    def _finish_cancelled(self, handle: RunHandle) -> None:
        _settle_pending_nodes(handle, "cancelled")
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


__all__ = [
    "RunManager", "RunHandle", "CancelledByUser", "MAX_OUTPUT_CHARS",
    "HumanInputAborted", "PendingHumanRequest", "HUMAN_WAIT_POLL_S",
]
