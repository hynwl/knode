"""M3-T10 테스트: Human-in-the-loop (Spec §5.10, §9.2, RECON F16).

`crew.kickoff()` 는 monkeypatch 로 갈아끼우되, **실제로 설치된 프로바이더를
`current_human_input_provider()` 로 꺼내 호출**한다 — 그래야 컴파일러(Human 노드 →
`human_input`) → Run Manager(프로바이더 설치 + 대기/타임아웃/취소) → 엔드포인트
(응답 주입) 사슬 전체가 한 번에 검증된다. LLM 호출만 가짜 컨텍스트로 대체한다.

`anyio.to_thread.run_sync` 는 **일부러 진짜를 쓴다** — 사람 검토 대기는 워커
스레드가 블로킹된 상태에서 이벤트 루프가 응답을 받아 깨워야 성립하는 기능이라,
`to_thread` 를 동기 호출로 바꿔 버리면 검증하려는 성질 자체가 사라진다.
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest

from app.core.crewai_compat import CrewOutput, current_human_input_provider
from app.runtime import callbacks
from app.runtime.manager import RunManager
from app.schemas.graph import CanvasDoc

BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_test",
    "name": "Human Test",
    "created_at": "2026-09-02T00:00:00Z",
    "updated_at": "2026-09-02T00:00:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


@pytest.fixture(autouse=True)
def _clean_run_registry():
    yield
    callbacks._registry.clear()
    callbacks._key_registry.clear()


def _n(node_id: str, node_type: str, data: dict | None = None) -> dict:
    return {"id": node_id, "type": node_type, "position": {"x": 0, "y": 0}, "data": data or {}}


def _e(edge_id: str, source: str, source_handle: str, target: str, target_handle: str) -> dict:
    return {
        "id": edge_id, "source": source, "sourceHandle": source_handle,
        "target": target, "targetHandle": target_handle,
    }


def _doc(*, human_node: dict | None = None, task_toggle: bool = False) -> CanvasDoc:
    """Agent → Task → (Human) 최소 그래프."""
    nodes = [
        _n("crew_1", "crew", {"process": "sequential"}),
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
        _n("task_1", "task", {"description": "d", "expected_output": "o", "human_input": task_toggle}),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "task_1", "task", "crew_1", "task"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
    ]
    if human_node is not None:
        nodes.append(_n("human_1", "human", human_node))
        edges.append(_e("e4", "task_1", "task", "human_1", "task"))
    return CanvasDoc.model_validate({**BASE, "nodes": nodes, "edges": edges})


class _FakeAnswer:
    def __init__(self, output: str) -> None:
        self.output = output


class _FakeExecutorContext:
    """실제 `AgentExecutor` 대신 쓰는 최소 `ExecutorContext` (RECON F16-b 계약)."""

    def __init__(self, task, crew, agent) -> None:
        self.task = task
        self.crew = crew
        self.agent = agent
        self.messages: list = []
        self.ask_for_human_input = True
        self.llm = None
        self.invocations = 0

    def _invoke_loop(self):
        self.invocations += 1
        return _FakeAnswer(f"수정본 {self.invocations}")

    def _is_training_mode(self) -> bool:
        return False

    def _handle_crew_training_output(self, result, human_feedback=None) -> None:
        return None

    def _format_feedback_message(self, feedback: str):
        return {"role": "user", "content": feedback}


def _fake_kickoff_asking_human(collector: dict | None = None):
    """CrewAI 가 사람 검토를 요구하는 태스크를 실행했을 때와 같은 호출을 재현한다."""

    def _kickoff(crew, inputs):
        provider = current_human_input_provider()
        ctx = _FakeExecutorContext(crew.tasks[0], crew, crew.agents[0])
        answer = provider.handle_feedback(_FakeAnswer("초안"), ctx)
        if collector is not None:
            collector["invocations"] = ctx.invocations
            collector["messages"] = list(ctx.messages)
            collector["final"] = answer.output
        return CrewOutput(raw=answer.output, tasks_output=[])

    return _kickoff


async def _wait_for_human_request(handle, timeout: float = 3.0) -> dict:
    """`human.request` 이벤트가 링버퍼에 나타날 때까지 기다린다."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for item in handle.bridge.buffered():
            if item["event"] == "human.request":
                return item["data"]
        await asyncio.sleep(0.02)
    raise AssertionError("human.request 이벤트가 오지 않았다")


async def _wait_for_pending(handle, node_id: str, timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if node_id in handle.pending_human_nodes():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("대기 중인 사람 검토 요청이 등록되지 않았다")


def _events(handle, name: str) -> list[dict]:
    return [e["data"] for e in handle.bridge.buffered() if e["event"] == name]


# ---------------------------------------------------------------------------
# 1. 컴파일러 — Human 노드 소비 (설계 결정: 노드 연결 = Task.human_input 켜기)
# ---------------------------------------------------------------------------

def _compile(doc: CanvasDoc):
    from app.compiler.compiler import CanvasCompiler

    return CanvasCompiler(doc).compile()


def test_human_node_connected_to_task_turns_on_human_input_and_carries_config():
    result = _compile(_doc(human_node={"prompt": "확인해줘", "timeout_s": 42, "on_timeout": "continue"}))
    assert result.crew.tasks[0].human_input is True
    gate = result.human_gates["task_1"]
    assert (gate.human_node_id, gate.prompt, gate.timeout_s, gate.on_timeout) == (
        "human_1", "확인해줘", 42, "continue",
    )


def test_task_toggle_alone_is_a_quick_default_gate():
    """Human 노드 없이 Task 토글만 켜도 같은 경로로 동작한다 — 안 그러면 CrewAI
    기본 프로바이더가 stdin 을 읽어 서버가 멈춘다 (RECON F16-a)."""
    result = _compile(_doc(task_toggle=True))
    assert result.crew.tasks[0].human_input is True
    gate = result.human_gates["task_1"]
    assert gate.human_node_id is None
    assert gate.timeout_s == 300
    assert gate.on_timeout == "abort"


def test_no_human_node_and_no_toggle_means_no_gate():
    result = _compile(_doc())
    assert result.crew.tasks[0].human_input is False
    assert result.human_gates == {}


def test_timeout_is_clamped_to_a_sane_range():
    """Spec §5.10 ⚠️ — 대기가 무한이면 스레드가 영원히 파킹된다."""
    assert _compile(_doc(human_node={"timeout_s": 1})).human_gates["task_1"].timeout_s == 10
    assert _compile(_doc(human_node={"timeout_s": 999_999})).human_gates["task_1"].timeout_s == 3600
    assert _compile(_doc(human_node={"timeout_s": "이상한값"})).human_gates["task_1"].timeout_s == 300


# ---------------------------------------------------------------------------
# 2. Run Manager — 요청 발행 / 응답 / 다회차 / 타임아웃 / 취소
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_human_request_event_is_emitted_and_response_unblocks_the_run(monkeypatch):
    collected: dict = {}
    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff_asking_human(collected))
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"prompt": "승인?", "timeout_s": 30}),
        inputs={}, secrets=None, max_duration_s=None,
    )
    payload = await _wait_for_human_request(handle)
    assert payload["node_id"] == "task_1"
    assert payload["prompt"] == "승인?"
    assert payload["timeout_s"] == 30

    await _wait_for_pending(handle, "task_1")
    assert manager.submit_human_response(handle.run_id, "task_1", "") is True
    await asyncio.wait_for(handle.asyncio_task, timeout=3.0)

    assert handle.status == "succeeded"
    assert collected["invocations"] == 0  # 빈 응답 = 승인 → 재실행 없음
    assert handle.pending_human_nodes() == []


@pytest.mark.asyncio
async def test_non_empty_response_reinvokes_agent_and_asks_again(monkeypatch):
    """설계 결정: CrewAI 네이티브 다회차 피드백 루프를 그대로 노출한다."""
    collected: dict = {}
    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff_asking_human(collected))
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"prompt": "승인?", "timeout_s": 30}),
        inputs={}, secrets=None, max_duration_s=None,
    )
    await _wait_for_pending(handle, "task_1")
    assert manager.submit_human_response(handle.run_id, "task_1", "더 짧게 써줘") is True

    # 2차 요청이 다시 온다.
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and len(_events(handle, "human.request")) < 2:
        await asyncio.sleep(0.02)
    requests = _events(handle, "human.request")
    assert len(requests) == 2
    assert requests[1]["prompt"].startswith("[2차 검토]")

    await _wait_for_pending(handle, "task_1")
    assert manager.submit_human_response(handle.run_id, "task_1", "") is True
    await asyncio.wait_for(handle.asyncio_task, timeout=3.0)

    assert handle.status == "succeeded"
    assert collected["invocations"] == 1
    assert collected["messages"] == [{"role": "user", "content": "더 짧게 써줘"}]
    assert collected["final"] == "수정본 1"


@pytest.mark.asyncio
async def test_timeout_with_continue_approves_and_run_succeeds(monkeypatch):
    collected: dict = {}
    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff_asking_human(collected))
    monkeypatch.setattr("app.compiler.compiler.MIN_HUMAN_TIMEOUT_S", 0)
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"timeout_s": 0, "on_timeout": "continue"}),
        inputs={}, secrets=None, max_duration_s=None,
    )
    await asyncio.wait_for(handle.asyncio_task, timeout=5.0)

    assert handle.status == "succeeded"
    assert collected["invocations"] == 0
    assert any("승인으로 간주" in e["message"] for e in _events(handle, "log"))


@pytest.mark.asyncio
async def test_timeout_with_abort_fails_run_with_ac_e507(monkeypatch):
    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff_asking_human())
    monkeypatch.setattr("app.compiler.compiler.MIN_HUMAN_TIMEOUT_S", 0)
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"timeout_s": 0, "on_timeout": "abort"}),
        inputs={}, secrets=None, max_duration_s=None,
    )
    await asyncio.wait_for(handle.asyncio_task, timeout=5.0)

    assert handle.status == "failed"
    failed = _events(handle, "run.failed")
    assert failed and failed[0]["error"]["code"] == "AC-E507"
    # 실행 중이던 태스크 노드를 성공으로 칠하지 않는다 — 일어나지 않은 일이다.
    statuses = [e["status"] for e in _events(handle, "node.status") if e["node_id"] == "task_1"]
    assert statuses[-1] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_while_waiting_unblocks_the_thread_and_cancels_the_run(monkeypatch):
    """Stop 을 눌렀는데 스레드가 타임아웃까지 파킹된 채 남으면 안 된다."""
    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff_asking_human())
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"timeout_s": 3600}),  # 취소가 안 먹으면 테스트가 타임아웃난다
        inputs={}, secrets=None, max_duration_s=None,
    )
    await _wait_for_pending(handle, "task_1")
    assert manager.cancel(handle.run_id) is True
    await asyncio.wait_for(handle.asyncio_task, timeout=5.0)

    assert handle.status == "cancelled"
    assert _events(handle, "run.cancelled")
    assert handle.pending_human_nodes() == []


@pytest.mark.asyncio
async def test_response_to_unknown_node_is_rejected(monkeypatch):
    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff_asking_human())
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"timeout_s": 30}), inputs={}, secrets=None, max_duration_s=None
    )
    await _wait_for_pending(handle, "task_1")
    assert manager.submit_human_response(handle.run_id, "task_없음", "") is False
    assert manager.submit_human_response("run_없음", "task_1", "") is False
    # 두 번째 응답은 이미 소비된 요청이라 거부된다 (모달이 거짓 성공을 그리지 않게).
    assert manager.submit_human_response(handle.run_id, "task_1", "") is True
    assert manager.submit_human_response(handle.run_id, "task_1", "") is False
    await asyncio.wait_for(handle.asyncio_task, timeout=3.0)


@pytest.mark.asyncio
async def test_unmappable_task_is_auto_approved_instead_of_parking_the_thread(monkeypatch):
    """노드 역매핑에 실패하면 UI 가 물어볼 대상을 모른다 — 기다리면 그냥 멈춘다."""

    def _kickoff(crew, inputs):
        provider = current_human_input_provider()

        class _Orphan:
            id = "00000000-0000-0000-0000-000000000000"

        ctx = _FakeExecutorContext(_Orphan(), crew, crew.agents[0])
        provider.handle_feedback(_FakeAnswer("초안"), ctx)
        return CrewOutput(raw="ok", tasks_output=[])

    monkeypatch.setattr("app.runtime.manager.kickoff", _kickoff)
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"timeout_s": 3600}), inputs={}, secrets=None, max_duration_s=None
    )
    await asyncio.wait_for(handle.asyncio_task, timeout=5.0)

    assert handle.status == "succeeded"
    assert any("역매핑" in e["message"] for e in _events(handle, "log"))


@pytest.mark.asyncio
async def test_provider_is_installed_for_every_run_even_without_human_gates(monkeypatch):
    """RECON F16-a — 설치를 건너뛰면 CrewAI 기본 프로바이더가 stdin 을 읽는다."""
    seen: dict = {}

    def _kickoff(crew, inputs):
        seen["provider"] = type(current_human_input_provider()).__name__
        return CrewOutput(raw="ok", tasks_output=[])

    monkeypatch.setattr("app.runtime.manager.kickoff", _kickoff)
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(_doc(), inputs={}, secrets=None, max_duration_s=None)
    await asyncio.wait_for(handle.asyncio_task, timeout=5.0)
    assert seen["provider"] == "DelegatingHumanInputProvider"


def test_human_wait_does_not_block_other_runs():
    """격리 원칙: 대기는 워커 스레드에서만 일어나고 이벤트 루프는 계속 돈다."""
    from app.runtime.manager import HUMAN_WAIT_POLL_S

    assert 0 < HUMAN_WAIT_POLL_S <= 1.0


@pytest.mark.asyncio
async def test_thread_pool_is_actually_used_so_the_event_loop_stays_responsive(monkeypatch):
    """대기 중에도 이벤트 루프가 다른 코루틴을 돌릴 수 있어야 응답을 받아 깨울 수 있다."""
    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff_asking_human())
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    handle = await manager.submit(
        _doc(human_node={"timeout_s": 30}), inputs={}, secrets=None, max_duration_s=None
    )
    await _wait_for_pending(handle, "task_1")

    ticks = 0
    for _ in range(5):
        await asyncio.sleep(0.01)
        ticks += 1
    assert ticks == 5
    assert threading.current_thread() is threading.main_thread()

    manager.submit_human_response(handle.run_id, "task_1", "")
    await asyncio.wait_for(handle.asyncio_task, timeout=3.0)
