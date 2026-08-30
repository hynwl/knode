"""M2-T8/T9 테스트: `runtime/{bridge,callbacks}.py` (Spec §10.1, §10.4, §10.5).

`callbacks.py`는 `EventInfo`(이미 정규화된 CrewAI 이벤트) → SSE 이벤트 번역만
검증한다. `EventInfo`로의 정규화 자체는 `test_crewai_compat.py`가 이미 커버한다
(경계를 다시 겹쳐 테스트하지 않는다). `_dispatch`는 실제 이벤트 버스를 거치지
않고 직접 호출한다 — run 라우팅(`register_run`/`unregister_run`)만 실제 전역
싱글턴 레지스트리를 사용한다.
"""

from __future__ import annotations

import asyncio

import pytest

from app.core.crewai_compat import EventInfo
from app.runtime import callbacks
from app.runtime.bridge import HEARTBEAT, EventBridge
from app.runtime.callbacks import (
    RunEventContext,
    _dispatch,
    make_step_callback,
    register_run,
    unregister_run,
)
from app.schemas.events import EVENT_PAYLOAD_MODELS


@pytest.fixture(autouse=True)
def _clean_run_registry():
    """`callbacks._registry`는 프로세스 싱글턴 상태다 (RECON §6.3과 같은 이유).

    테스트마다 로컬 `_FakeCrew()`를 쓰고 등록만 하고 해제를 안 하면, 그 객체가
    가비지컬렉션된 뒤 다른 테스트가 만든 새 객체가 같은 `id()`를 받아 이전 run의
    컨텍스트로 잘못 라우팅될 수 있다. 매 테스트 뒤 강제로 비운다.
    """
    yield
    callbacks._registry.clear()


def _info(kind: str, *, agent_id=None, task_id=None, task_name=None, agent_role=None, **payload) -> EventInfo:
    return EventInfo(
        kind=kind, agent_id=agent_id, agent_role=agent_role,
        task_id=task_id, task_name=task_name, payload=payload,
    )


# --- EventBridge (M2-T8) -----------------------------------------------------


def test_emit_assigns_monotonic_seq_and_validates_payload():
    bridge = EventBridge("run_1")
    item1 = bridge.emit("log", level="info", message="hi")
    item2 = bridge.emit("log", level="info", message="bye")
    assert item1["id"] == 1 and item2["id"] == 2
    assert item1["data"]["run_id"] == "run_1"
    assert item1["data"]["message"] == "hi"
    assert "ts" in item1["data"]


def test_emit_rejects_payload_that_violates_schema():
    bridge = EventBridge("run_1")
    with pytest.raises(Exception):
        bridge.emit("task.started", node_id="t_1")  # task_name 누락 (required)


def test_buffer_caps_at_configured_size():
    bridge = EventBridge("run_1", buffer_size=5)
    for i in range(10):
        bridge.emit("log", level="info", message=str(i))
    assert len(bridge._buffer) == 5
    assert [item["data"]["message"] for item in bridge._buffer] == [str(i) for i in range(5, 10)]


@pytest.mark.asyncio
async def test_stream_replays_backlog_after_last_id():
    bridge = EventBridge("run_1")
    for i in range(3):
        bridge.emit("log", level="info", message=str(i))

    gen = bridge.stream(last_id=1)
    first = await gen.__anext__()
    assert first["id"] == 2
    second = await gen.__anext__()
    assert second["id"] == 3
    await gen.aclose()


@pytest.mark.asyncio
async def test_stream_yields_live_items_after_backlog():
    bridge = EventBridge("run_1")
    gen = bridge.stream(last_id=0)

    async def _produce():
        await asyncio.sleep(0.02)
        bridge.emit("log", level="info", message="live")

    task = asyncio.create_task(_produce())
    item = await gen.__anext__()
    assert item["data"]["message"] == "live"
    await task
    await gen.aclose()


@pytest.mark.asyncio
async def test_stream_does_not_duplicate_already_emitted_items_on_fresh_connect():
    """`emit()`은 `_buffer`와 `_q` 양쪽에 동시에 쌓는다. 아무도 `_q`를 드레인하기
    전에(=run이 이미 끝난 뒤 처음 연결하는 경우) `stream()`을 새로 열면, backlog가
    이미 내준 항목이 `_q`에도 그대로 남아 있어 다시 나올 수 있었다(재연결
    replay가 아니라 최초 연결 시나리오라 `last_id=0`이라 특히 잘 드러난다).
    """
    bridge = EventBridge("run_1", heartbeat_s=0.05)
    for i in range(3):
        bridge.emit("log", level="info", message=str(i))

    gen = bridge.stream(last_id=0)
    seen_ids = []
    for _ in range(3):
        item = await asyncio.wait_for(gen.__anext__(), timeout=1.0)
        seen_ids.append(item["id"])
    assert seen_ids == [1, 2, 3]

    # 뒤이어 나오는 항목이 하트비트뿐이어야 한다 — id 1/2/3이 다시 나오면 버그.
    next_item = await asyncio.wait_for(gen.__anext__(), timeout=1.0)
    assert next_item is HEARTBEAT
    await gen.aclose()


@pytest.mark.asyncio
async def test_stream_emits_heartbeat_when_idle():
    bridge = EventBridge("run_1", heartbeat_s=0.05)
    gen = bridge.stream(last_id=0)
    item = await asyncio.wait_for(gen.__anext__(), timeout=1.0)
    assert item is HEARTBEAT
    await gen.aclose()


def test_all_event_names_are_registered_in_payload_models():
    # bridge.emit()는 EVENT_PAYLOAD_MODELS 룩업에 의존한다 — 카탈로그가 비어있지 않은지 가드.
    assert set(EVENT_PAYLOAD_MODELS) >= {"node.status", "task.started", "task.completed", "log"}


# --- callbacks (M2-T9) -------------------------------------------------------


@pytest.fixture
def ctx():
    bridge = EventBridge("run_1")
    context = RunEventContext(bridge=bridge, node_index={"task-uuid-1": "task_1", "agent-uuid-1": "agent_1"})
    yield context


class _FakeCrew:
    """실제 `Crew` 대신 id() 라우팅만 검증하면 되는 최소 더미."""


def test_register_and_unregister_run_routes_by_source_identity():
    bridge = EventBridge("run_1")
    context = RunEventContext(bridge=bridge, node_index={})
    crew = _FakeCrew()
    other_crew = _FakeCrew()
    register_run(crew, context)
    try:
        _dispatch(_info("task_started", task_id="unknown", task_name="x"), crew)
        assert len(bridge._buffer) == 2  # node.status + log(역매핑 실패)

        _dispatch(_info("task_started", task_id="unknown", task_name="x"), other_crew)
        assert len(bridge._buffer) == 2  # 다른 source는 라우팅되지 않음
    finally:
        unregister_run(crew)


def test_task_started_emits_node_status_and_task_started(ctx):
    _dispatch(_info("task_started", task_id="task-uuid-1", agent_id="agent-uuid-1", task_name="Research"),
              _register(ctx))
    events = [item["event"] for item in ctx.bridge._buffer]
    assert events == ["node.status", "task.started"]
    node_status, task_started = ctx.bridge._buffer
    assert node_status["data"]["node_id"] == "task_1" and node_status["data"]["status"] == "running"
    assert task_started["data"]["node_id"] == "task_1"
    assert task_started["data"]["agent_node_id"] == "agent_1"


def test_task_started_with_unmapped_task_id_falls_back_to_log(ctx):
    _dispatch(_info("task_started", task_id="does-not-exist", task_name="Research"), _register(ctx))
    events = [item["event"] for item in ctx.bridge._buffer]
    assert events == ["node.status", "log"]
    assert ctx.bridge._buffer[0]["data"]["node_id"] is None
    assert "does-not-exist" in ctx.bridge._buffer[1]["data"]["message"]


def test_task_completed_computes_duration_from_started_at(ctx):
    crew = _register(ctx)
    _dispatch(_info("task_started", task_id="task-uuid-1", task_name="Research"), crew)
    _dispatch(_info("task_completed", task_id="task-uuid-1", output="done"), crew)
    completed = ctx.bridge._buffer[-1]
    assert completed["event"] == "task.completed"
    assert completed["data"]["output"] == "done"
    assert completed["data"]["duration_ms"] >= 0
    assert "task-uuid-1" not in ctx._task_started_at


def test_task_failed_emits_failed_status_and_error_log(ctx):
    _dispatch(_info("task_failed", task_id="task-uuid-1", error="boom"), _register(ctx))
    status, log = ctx.bridge._buffer
    assert status["data"]["status"] == "failed"
    assert log["event"] == "log" and log["data"]["message"] == "boom"


def test_agent_started_sets_current_agent_node_id(ctx):
    _dispatch(_info("agent_started", agent_id="agent-uuid-1"), _register(ctx))
    assert ctx.current_agent_node_id == "agent_1"


def test_tool_started_then_finished_share_call_id(ctx):
    crew = _register(ctx)
    _dispatch(_info("tool_started", agent_id="agent-uuid-1", tool_name="search", tool_args="{}"), crew)
    _dispatch(_info("tool_finished", agent_id="agent-uuid-1", output="result", duration_ms=12), crew)
    start_evt, finish_evt = ctx.bridge._buffer
    assert start_evt["event"] == "agent.tool_use"
    assert finish_evt["event"] == "agent.tool_result"
    assert start_evt["data"]["call_id"] == finish_evt["data"]["call_id"]
    assert finish_evt["data"]["is_error"] is False


def test_tool_error_emits_result_and_log(ctx):
    crew = _register(ctx)
    _dispatch(_info("tool_started", agent_id="agent-uuid-1", tool_name="search", tool_args="{}"), crew)
    _dispatch(_info("tool_error", agent_id="agent-uuid-1", error="rate limited"), crew)
    events = [item["event"] for item in ctx.bridge._buffer]
    assert events == ["agent.tool_use", "agent.tool_result", "log"]
    assert ctx.bridge._buffer[1]["data"]["is_error"] is True


def test_llm_completed_emits_token_usage_with_zero_cost_when_model_unknown(ctx):
    _dispatch(_info("llm_completed", agent_id="agent-uuid-1",
                     usage={"prompt_tokens": 100, "completion_tokens": 20}), _register(ctx))
    evt = ctx.bridge._buffer[-1]
    assert evt["event"] == "token.usage"
    assert evt["data"]["prompt_tokens"] == 100
    assert evt["data"]["completion_tokens"] == 20
    assert evt["data"]["cost_usd"] == 0.0


def test_llm_completed_computes_real_cost_from_model(ctx):
    _dispatch(_info("llm_completed", agent_id="agent-uuid-1", model="gpt-4o",
                     usage={"prompt_tokens": 1000, "completion_tokens": 500}), _register(ctx))
    evt = ctx.bridge._buffer[-1]
    assert evt["data"]["cost_usd"] > 0.0


def test_crew_lifecycle_events_are_not_translated(ctx):
    _dispatch(_info("crew_started", crew_name="c"), _register(ctx))
    _dispatch(_info("crew_completed"), _register(ctx))
    _dispatch(_info("crew_failed", error="x"), _register(ctx))
    assert ctx.bridge._buffer == []


def test_step_callback_emits_agent_thought_attributed_to_current_agent(ctx):
    from crewai.agents.parser import AgentAction

    _dispatch(_info("agent_started", agent_id="agent-uuid-1"), _register(ctx))
    step_cb = make_step_callback(ctx)
    step_cb(AgentAction(thought="I should search", tool="search", tool_input="q", text="..."))

    events = [item for item in ctx.bridge._buffer if item["event"] == "agent.thought"]
    assert len(events) == 1
    assert events[0]["data"]["agent_node_id"] == "agent_1"
    assert events[0]["data"]["text"] == "I should search"
    assert events[0]["data"]["iteration"] == 1


def test_step_callback_ignores_finish_and_actions_without_thought(ctx):
    from crewai.agents.parser import AgentAction, AgentFinish

    step_cb = make_step_callback(ctx)
    step_cb(AgentFinish(thought=None, output="done", text="done"))
    step_cb(AgentAction(thought="", tool="t", tool_input="i", text="x"))
    assert ctx.bridge._buffer == []


def test_step_callback_swallows_exceptions():
    bridge = EventBridge("run_1")
    context = RunEventContext(bridge=bridge, node_index={})
    step_cb = make_step_callback(context)
    step_cb(object())  # normalize_step 은 알 수 없는 타입도 죽지 않지만, 방어 확인
    assert bridge._buffer == []  # thought 없음 → 조용히 무시


def _register(ctx: RunEventContext) -> _FakeCrew:
    crew = _FakeCrew()
    register_run(crew, ctx)
    return crew
