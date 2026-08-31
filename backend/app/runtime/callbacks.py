"""CrewAI 이벤트 버스 → SSE 이벤트 번역 + 노드 역매핑 (Spec §10.4, §10.5).

⚠️ `crewai_event_bus`는 프로세스 싱글턴이다 (RECON §6.3 MUST). 핸들러는 앱
   생애주기 동안 **단 한 번만** 등록하고(`_ensure_handlers_registered`), run별
   라우팅은 이벤트 `source` 객체의 `id()` → `RunEventContext` 조회로 한다.
   `scoped_handlers()`는 쓰지 않는다 — 다른 run의 핸들러가 사라진다.

⚠️ RECON F15 (2026-08-31 실측으로 정정): `source` 는 **이벤트를 발행한 객체 자신**
   이지 `Crew` 가 아니다(`Task` 는 자기 자신을, `Agent` 는 자기 자신을, LLM 호출은
   `LLM` 인스턴스를 넘긴다). 그래서 `register_run` 은 크루뿐 아니라
   `collect_run_objects()` 가 모아 주는 **run 소속 객체 전량**을 등록하고,
   그래도 못 잡는 source(예: 내부 `ToolUsage` 객체)는 이벤트가 실어 주는
   `task_id`/`agent_id` 로 2차 라우팅한다.

노드 역매핑은 `id(agent_object)`가 아니라 이벤트가 실어 주는 `agent_id`/`task_id`
문자열(UUID)을 키로 쓴다 (RECON F6/F7) — `compiler.py`가 만드는
`CompileResult.node_index`(`agent_key`/`task_key` → canvas node id)와 그대로
맞아떨어진다.

**이 세션에서 의도적으로 비운 범위**
- `run.*`(started/completed/failed/cancelled) SSE 이벤트 — `crew_started` 등 버스
  이벤트로는 `task_order`/`agent_count`/`duration_ms`를 채울 수 없다(EventInfo
  payload에 없음). Run Manager(M2-T10)가 `kickoff()` 호출을 직접 감싸고 있어
  그 정보를 이미 갖고 있으므로, run 레벨 생명주기 이벤트는 거기서 직접 `bridge.emit()`
  한다. 이 파일은 crew_started/completed/failed 이벤트를 구독은 하되 번역하지 않는다
  (중복/경합 방지).
- `edge.active` — 어느 엣지가 활성인지 판정하려면 그래프 위상(어느 노드가 어느
  엣지로 이어지는지)이 필요한데 `RunEventContext`엔 아직 없다. Run Manager가
  `CompileResult`/`CanvasGraph`를 이 컨텍스트에 실어줄 때 같이 추가한다.
- 취소(cancel_event 체크) — Spec §10.6은 Run Manager(M2-T10) 몫. `make_step_callback`은
  지금은 사고(thought) 이벤트만 내보낸다.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from app.core.crewai_compat import (
    EventInfo,
    collect_run_objects,
    instance_key,
    normalize_step,
    register_event_handlers,
)

from app.runtime.bridge import EventBridge
from app.runtime.cost import estimate_token_cost

logger = logging.getLogger(__name__)


@dataclass
class RunEventContext:
    """run 하나에 대응하는 이벤트 라우팅 상태. `register_run()`에 넘긴다."""

    bridge: EventBridge
    node_index: dict[str, str]  # agent_key/task_key(UUID str) → canvas node id (compiler.py 산출)
    #: Run Manager의 취소 플래그. 취소로 인해 태스크/에이전트가 죽은 것을
    #: `failed`(빨간 실패)가 아니라 `cancelled`로 표시하기 위해 참조한다.
    cancel_event: threading.Event | None = None
    current_agent_node_id: str | None = field(default=None, init=False)
    _task_started_at: dict[str, float] = field(default_factory=dict, init=False)
    _thought_iteration: dict[str, int] = field(default_factory=dict, init=False)
    _tool_calls: dict[str, list[str]] = field(default_factory=dict, init=False)


#: `id(source 객체)` → run 컨텍스트. 크루뿐 아니라 agent/task/llm/tool 전부 등록한다.
_registry: dict[int, RunEventContext] = {}
#: CrewAI UUID 문자열(agent.id/task.id) → run 컨텍스트. `_registry` 가 못 잡는
#: source(내부 `ToolUsage` 등)를 위한 2차 라우팅 인덱스.
_key_registry: dict[str, RunEventContext] = {}
_registry_lock = threading.Lock()
_handlers_registered = False
_handlers_lock = threading.Lock()


def register_run(crew: Any, ctx: RunEventContext) -> None:
    """이 run에 속한 CrewAI 객체 전량을 이벤트 라우팅 테이블에 등록하고, 핸들러가
    아직 없다면 (앱 통틀어 한 번만) 등록한다.

    RECON F15: `Crew` 하나만 등록하면 `crew_*` 이벤트 말고는 아무것도 라우팅되지
    않는다 — 이벤트 버스의 `source` 는 발행 주체(Task/Agent/LLM)다.
    """
    with _registry_lock:
        for obj in collect_run_objects(crew):
            _registry[id(obj)] = ctx
        for key in ctx.node_index:
            _key_registry[key] = ctx
    _ensure_handlers_registered()


def unregister_run(crew: Any) -> None:
    """run 종료 후 호출. 등록 안 남기면 `_registry`가 계속 자란다.

    `register_run` 이 여러 객체를 등록했으므로 크루 하나만 지우면 새는 게 남는다 —
    같은 컨텍스트를 가리키는 항목을 전부 지운다.
    """
    with _registry_lock:
        ctx = _registry.get(id(crew))
        if ctx is None:
            return
        for key in [k for k, v in _registry.items() if v is ctx]:
            del _registry[key]
        for key in [k for k, v in _key_registry.items() if v is ctx]:
            del _key_registry[key]


def _ensure_handlers_registered() -> None:
    global _handlers_registered
    if _handlers_registered:
        return
    with _handlers_lock:
        if _handlers_registered:
            return
        register_event_handlers(_dispatch)
        _handlers_registered = True


def _dispatch(info: EventInfo, source: Any) -> None:
    """`crewai_compat.register_event_handlers`의 콜백. 예외를 여기서 흡수해야
    CrewAI 실행 스레드가 죽지 않는다(Spec §10.4 MUST) — 상위(compat 레이어)도
    한 번 더 감싸지만, 번역 로직 자체의 실수까지 커버하도록 여기서도 감싼다."""
    ctx = _lookup_run(info, source)
    if ctx is None:
        # 등록되지 않은 run(예: 우리가 추적하지 않는 잔여 이벤트) — 라우팅 불가.
        return
    try:
        for event_name, extra_fields in _translate(info, ctx, source):
            ctx.bridge.emit(event_name, **extra_fields)
    except Exception:  # noqa: BLE001
        logger.exception("이벤트 번역/emit 실패: %s", info.kind)


def _lookup_run(info: EventInfo, source: Any) -> RunEventContext | None:
    """1차: source 객체 identity. 2차: 이벤트가 실어 준 task_id/agent_id.

    2차가 필요한 이유는 CrewAI 내부 헬퍼 객체(`ToolUsage` 등)가 자기 자신을
    source 로 넘기기 때문이다 — 그런 객체는 컴파일 산출물이 아니라서
    `collect_run_objects()` 로는 잡히지 않는다.
    """
    with _registry_lock:
        ctx = _registry.get(id(source))
        if ctx is not None:
            return ctx
        for key in (info.task_id, info.agent_id):
            if key and key in _key_registry:
                return _key_registry[key]
    return None


def _resolve_node_id(ctx: RunEventContext, info: EventInfo, source: Any = None) -> str | None:
    """RECON F7: 1차 키는 `task_id`, 폴백은 `agent_id`.

    RECON F15: 두 필드가 **비어 있는 이벤트가 실제로 존재한다**
    (`AgentExecutionStartedEvent` 등은 `from_agent`/`from_task` 를 안 넘겨서
    `BaseEvent` 가 식별자를 못 채운다). 그 경우 이벤트를 발행한 source 객체
    자체의 `id` 로 한 번 더 시도한다 — agent/task 이벤트의 source 는 바로
    그 Agent/Task 인스턴스다.

    셋 다 실패하면 `None` (Spec §10.5: 매핑 실패해도 이벤트 자체는 버리지 않는다 —
    `log`/`node.status`로 node_id=null 채로 내보낸다).
    """
    if info.task_id and info.task_id in ctx.node_index:
        return ctx.node_index[info.task_id]
    if info.agent_id and info.agent_id in ctx.node_index:
        return ctx.node_index[info.agent_id]
    source_key = instance_key(source) if source is not None else None
    if source_key and source_key in ctx.node_index:
        return ctx.node_index[source_key]
    return None


def _is_cancelling(ctx: RunEventContext) -> bool:
    return ctx.cancel_event is not None and ctx.cancel_event.is_set()


def _usage_int(usage: Any, key: str) -> int:
    if not isinstance(usage, dict):
        return 0
    value = usage.get(key)
    return int(value) if isinstance(value, (int, float)) else 0


def _translate(
    info: EventInfo, ctx: RunEventContext, source: Any = None
) -> list[tuple[str, dict[str, Any]]]:
    node_id = _resolve_node_id(ctx, info, source)
    out: list[tuple[str, dict[str, Any]]] = []

    if info.kind == "task_started":
        if info.task_id:
            ctx._task_started_at[info.task_id] = time.monotonic()
        out.append(("node.status", {"node_id": node_id, "status": "running"}))
        if node_id is None:
            out.append(("log", {"level": "warn", "node_id": None,
                                 "message": f"노드 역매핑 실패(task_started): task_id={info.task_id}"}))
        else:
            # RECON F15: `TaskStartedEvent` 는 `agent_id` 를 안 싣는다. 순차 실행에서
            # 직전 `agent_started` 가 갱신한 현재 에이전트가 곧 이 태스크의 담당이다.
            agent_node_id = (
                ctx.node_index.get(info.agent_id) if info.agent_id else None
            ) or ctx.current_agent_node_id
            out.append(("task.started", {
                "node_id": node_id,
                "task_name": info.task_name or "",
                "agent_node_id": agent_node_id,
            }))

    elif info.kind == "task_completed":
        started = ctx._task_started_at.pop(info.task_id, None) if info.task_id else None
        duration_ms = int((time.monotonic() - started) * 1000) if started is not None else 0
        out.append(("node.status", {"node_id": node_id, "status": "succeeded"}))
        if node_id is None:
            out.append(("log", {"level": "warn", "node_id": None,
                                 "message": f"노드 역매핑 실패(task_completed): task_id={info.task_id}"}))
        else:
            out.append(("task.completed", {
                "node_id": node_id,
                "output": info.payload.get("output") or "",
                "duration_ms": duration_ms,
            }))

    elif info.kind == "task_failed":
        if info.task_id:
            ctx._task_started_at.pop(info.task_id, None)
        if _is_cancelling(ctx):
            # 취소로 끊긴 태스크를 빨간 '실패'로 칠하면 거짓말이 된다.
            out.append(("node.status", {"node_id": node_id, "status": "cancelled"}))
            out.append(("log", {"level": "warn", "node_id": node_id,
                                 "message": "사용자 취소로 태스크가 중단되었습니다."}))
        else:
            out.append(("node.status", {"node_id": node_id, "status": "failed"}))
            out.append(("log", {"level": "error", "node_id": node_id,
                                 "message": info.payload.get("error") or "task failed"}))

    elif info.kind == "agent_started":
        if node_id:
            ctx.current_agent_node_id = node_id
        out.append(("node.status", {"node_id": node_id, "status": "running"}))

    elif info.kind == "agent_completed":
        out.append(("node.status", {"node_id": node_id, "status": "succeeded"}))

    elif info.kind == "agent_failed":
        if _is_cancelling(ctx):
            out.append(("node.status", {"node_id": node_id, "status": "cancelled"}))
        else:
            out.append(("node.status", {"node_id": node_id, "status": "failed"}))
            out.append(("log", {"level": "error", "node_id": node_id,
                                 "message": info.payload.get("error") or "agent failed"}))

    elif info.kind == "tool_started":
        call_id = uuid.uuid4().hex
        ctx._tool_calls.setdefault(info.agent_id or "", []).append(call_id)
        out.append(("agent.tool_use", {
            "agent_node_id": node_id,
            "tool_id": info.payload.get("tool_name") or "",
            "input": info.payload.get("tool_args"),
            "call_id": call_id,
        }))

    elif info.kind in ("tool_finished", "tool_error"):
        stack = ctx._tool_calls.get(info.agent_id or "")
        call_id = stack.pop() if stack else uuid.uuid4().hex
        out.append(("agent.tool_result", {
            "call_id": call_id,
            "output_preview": info.payload.get("output"),
            "duration_ms": info.payload.get("duration_ms"),
            "is_error": info.kind == "tool_error",
        }))
        if info.kind == "tool_error":
            out.append(("log", {"level": "error", "node_id": node_id,
                                 "message": info.payload.get("error") or "tool failed"}))

    elif info.kind == "llm_completed":
        usage = info.payload.get("usage")
        prompt_tokens = _usage_int(usage, "prompt_tokens")
        completion_tokens = _usage_int(usage, "completion_tokens")
        out.append(("token.usage", {
            "node_id": node_id,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost_usd": estimate_token_cost(info.payload.get("model"), prompt_tokens, completion_tokens),
        }))

    elif info.kind == "llm_failed":
        out.append(("log", {"level": "error", "node_id": node_id,
                             "message": info.payload.get("error") or "llm call failed"}))

    # crew_started / crew_completed / crew_failed: 의도적으로 미번역 (모듈 docstring 참조)

    return out


def make_step_callback(ctx: RunEventContext) -> Callable[[Any], None]:
    """`Agent.step_callback`용. `AgentAction`은 에이전트 식별자가 없으므로(RECON F6)
    가장 최근 `agent_started` 이벤트가 채운 `ctx.current_agent_node_id`에 귀속시킨다
    (sequential 프로세스에서는 한 번에 에이전트 하나만 도는 전제).
    """

    def _step_callback(payload: Any) -> None:
        try:
            info = normalize_step(payload)
            if info.kind != "action" or not info.thought:
                return
            key = ctx.current_agent_node_id or ""
            iteration = ctx._thought_iteration.get(key, 0) + 1
            ctx._thought_iteration[key] = iteration
            ctx.bridge.emit(
                "agent.thought",
                agent_node_id=ctx.current_agent_node_id,
                text=info.thought,
                iteration=iteration,
            )
        except Exception:  # noqa: BLE001 — Spec §10.4 MUST: 콜백 예외가 실행을 죽이면 안 된다
            logger.exception("step_callback 처리 실패")

    return _step_callback


__all__ = [
    "RunEventContext",
    "register_run",
    "unregister_run",
    "make_step_callback",
]
