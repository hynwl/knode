"""라우터: `/validate`, `/runs`, `/runs/{id}`, `/runs/{id}/cancel`,
`/runs/{id}/events` (Spec §9.2~§9.4, §10.1, M2-T11/T12).

`RunManager` 싱글턴은 `app.state.run_manager`에 있다(`main.py` lifespan이
만든다) — 여기서는 `get_run_manager` 의존성으로만 접근한다.

**BYOK 헤더는 `/validate`에도 적용한다.** `/validate`가 `/runs`와 동일 바디를
받는 이유(Spec §9.4 "runs 와 동일 바디")는 그래프 구조뿐 아니라 "필요한 키가
설정되어 있는가"(AC-E602, `tools/registry.build_tool`이 이미 던진다)까지 실시간
오버레이로 보여주기 위함이다. 프론트가 이 호출에 헤더를 실어 보낼지는 T15/T18
몫이고, 안 보내면 서버 폴백 키(있으면)만으로 검증된다 — `parse_secret_header`가
이미 그 우선순위를 처리한다.

**Dry Run(`options.dry_run`, Spec §11.3, M3-T9)**은 `RunManager.submit()`에
그대로 전달만 한다 — 컴파일/검증/`task_order` 산출은 실제 실행과 동일한 경로를
거치고, LLM 호출 없이 가짜 이벤트만 재생하는 분기(`RunManager._run_dry`)는
Run Manager 내부 몫이다. 라우터 응답 스키마(`RunResponse`)는 실제 실행과
동일하다 — 프론트는 자신이 보낸 `dry_run` 요청을 기억해두고 UI를 구분한다.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.compiler.compiler import CanvasCompiler
from app.config import get_settings
from app.core.errors import AppError, CompilationError
from app.core.secrets import HEADER_NAME, parse_secret_header
from app.runtime.bridge import HEARTBEAT
from app.runtime.manager import RunHandle, RunManager
from app.schemas.run import (
    HumanResponseRequest,
    NodeRunState,
    NodeUsage,
    RunRequest,
    RunResponse,
    RunSnapshot,
    RunWarning,
    ValidateResponse,
)

router = APIRouter(tags=["runs"])

_TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled"})


def get_run_manager(request: Request) -> RunManager:
    return request.app.state.run_manager


def _run_not_found() -> AppError:
    return AppError("AC-E506", "실행을 찾을 수 없습니다.", status_code=404)


@router.post("/validate", response_model=ValidateResponse)
async def validate_graph(request: Request, body: RunRequest) -> ValidateResponse:
    settings = get_settings()
    secrets = parse_secret_header(request.headers.get(HEADER_NAME), settings)
    compiler = CanvasCompiler(body.graph, secrets=secrets, inputs=body.inputs)
    try:
        result = compiler.compile()
    except CompilationError as exc:
        return ValidateResponse(valid=False, issues=exc.issues, task_order=None)
    return ValidateResponse(valid=True, issues=result.warnings, task_order=result.task_order)


@router.post("/runs", status_code=202, response_model=RunResponse)
async def create_run(
    request: Request, body: RunRequest, manager: RunManager = Depends(get_run_manager)
) -> RunResponse:
    settings = get_settings()
    secrets = parse_secret_header(request.headers.get(HEADER_NAME), settings)
    max_duration_s = body.options.max_duration_s or settings.max_run_duration_s

    handle = await manager.submit(
        body.graph,
        inputs=body.inputs,
        secrets=secrets,
        max_duration_s=max_duration_s,
        dry_run=body.options.dry_run,
    )
    return RunResponse(
        run_id=handle.run_id,
        task_order=handle.task_order,
        warnings=[
            RunWarning(code=i.code, node_id=i.node_id, message=i.message) for i in handle.warnings
        ],
        events_url=f"/api/v1/runs/{handle.run_id}/events",
    )


def _build_snapshot(handle: RunHandle) -> RunSnapshot:
    """`GET /runs/{id}` 스냅샷 — bridge 링버퍼(최근 500개)를 재생해 조립한다.

    `RunHandle.started_at`/`finished_at`은 `time.monotonic()`(duration 계산용,
    §8.4 인스턴스 캐시와 무관)이라 벽시계 ISO 문자열이 아니다 — 대신 이벤트
    자체의 `ts`(Spec §10.1 SSE 포맷)를 쓴다.
    """
    events = handle.bridge.buffered()
    node_states: dict[str, NodeRunState] = {}
    usage_acc: dict[str, dict[str, float]] = {}

    for item in events:
        data = item["data"]
        node_id = data.get("node_id")
        if not node_id:
            continue

        if item["event"] == "node.status":
            node_states.setdefault(node_id, NodeRunState(status=data["status"])).status = data["status"]
        elif item["event"] == "task.completed":
            node_states.setdefault(node_id, NodeRunState(status="succeeded")).output = data.get("output")
        elif item["event"] == "log" and data.get("level") == "error":
            node_states.setdefault(node_id, NodeRunState(status="failed")).error = data.get("message")
        elif item["event"] == "token.usage":
            acc = usage_acc.setdefault(node_id, {"prompt": 0.0, "completion": 0.0, "cost_usd": 0.0})
            acc["prompt"] += data.get("prompt_tokens", 0)
            acc["completion"] += data.get("completion_tokens", 0)
            acc["cost_usd"] += data.get("cost_usd", 0.0)

    for node_id, acc in usage_acc.items():
        state = node_states.setdefault(node_id, NodeRunState(status="running"))
        state.usage = NodeUsage(
            prompt=int(acc["prompt"]), completion=int(acc["completion"]), cost_usd=acc["cost_usd"]
        )

    is_terminal = handle.status in _TERMINAL_STATUSES
    return RunSnapshot(
        run_id=handle.run_id,
        status=handle.status,
        task_order=handle.task_order,
        started_at=events[0]["data"]["ts"] if events else None,
        finished_at=events[-1]["data"]["ts"] if events and is_terminal else None,
        node_states=node_states,
    )


@router.get("/runs/{run_id}", response_model=RunSnapshot)
async def get_run(run_id: str, manager: RunManager = Depends(get_run_manager)) -> RunSnapshot:
    handle = manager.get(run_id)
    if handle is None:
        raise _run_not_found()
    return _build_snapshot(handle)


@router.post("/runs/{run_id}/cancel", status_code=202)
async def cancel_run(run_id: str, manager: RunManager = Depends(get_run_manager)) -> dict:
    handle = manager.get(run_id)
    if handle is None:
        raise _run_not_found()
    manager.cancel(run_id)
    return {"run_id": run_id, "status": handle.status}


@router.post("/runs/{run_id}/human", status_code=202)
async def submit_human_response(
    run_id: str, body: HumanResponseRequest, manager: RunManager = Depends(get_run_manager)
) -> dict:
    """Human-in-the-loop 응답 제출 (Spec §5.10, §9.2 SHOULD, M3-T10).

    `response` 의 의미는 CrewAI 계약 그대로다(RECON F16-b) — **빈 문자열이면 승인**
    (검토 종료, 다음 태스크로), 비어 있지 않으면 수정 요청(그 텍스트를 대화에 덧붙여
    에이전트를 다시 실행한 뒤 같은 노드로 `human.request` 를 한 번 더 보낸다).

    이미 타임아웃되었거나 응답이 들어온 요청에는 `AC-E508` 로 409 를 준다 — 조용히
    성공을 돌려주면 프론트가 모달을 닫아 놓고 "반영됐다"고 거짓말하게 된다.
    """
    handle = manager.get(run_id)
    if handle is None:
        raise _run_not_found()
    if not manager.submit_human_response(run_id, body.node_id, body.response):
        raise AppError(
            "AC-E508",
            "대기 중인 사람 검토 요청이 없습니다 (이미 응답했거나 시간이 초과되었습니다).",
            status_code=409,
            node_id=body.node_id,
        )
    return {"run_id": run_id, "node_id": body.node_id, "status": "accepted"}


@router.get("/runs/{run_id}/events")
async def stream_events(
    request: Request, run_id: str, manager: RunManager = Depends(get_run_manager)
) -> StreamingResponse:
    handle = manager.get(run_id)
    if handle is None:
        raise _run_not_found()

    last_id_raw = request.headers.get("Last-Event-ID") or request.headers.get("X-Last-Event-Id") or "0"
    try:
        last_id = int(last_id_raw)
    except ValueError:
        last_id = 0

    async def _generate():
        async for item in handle.bridge.stream(last_id):
            if await request.is_disconnected():
                break
            if item is HEARTBEAT:
                yield ": heartbeat\n\n"
            else:
                data = json.dumps(item["data"], ensure_ascii=False)
                yield f"id: {item['id']}\nevent: {item['event']}\ndata: {data}\n\n"

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


__all__ = ["router", "get_run_manager"]
