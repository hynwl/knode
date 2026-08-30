"""M2-T5 테스트: `compiler/{compiler,interpolate}.py` (Spec §8.1~§8.4).

`crewai.Agent/Task/Crew` 생성 자체는 네트워크 호출 없이 순수 객체 구성이므로
실제 클래스를 그대로 쓴다 (모킹 없음) — 이게 컴파일러가 실제로 CrewAI 를
문제없이 호출하는지 검증하는 유일한 방법이다.
"""

from __future__ import annotations

import pytest

from app.compiler.compiler import CanvasCompiler
from app.core.errors import CompilationError
from app.schemas.graph import CanvasDoc

BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_test",
    "name": "Compiler Test",
    "created_at": "2026-08-30T00:00:00Z",
    "updated_at": "2026-08-30T00:00:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


def _doc(nodes: list[dict], edges: list[dict] | None = None) -> CanvasDoc:
    return CanvasDoc.model_validate({**BASE, "nodes": nodes, "edges": edges or []})


def _n(node_id: str, node_type: str, data: dict | None = None, x: float = 0, y: float = 0) -> dict:
    return {"id": node_id, "type": node_type, "position": {"x": x, "y": y}, "data": data or {}}


def _e(edge_id: str, source: str, source_handle: str, target: str, target_handle: str) -> dict:
    return {"id": edge_id, "source": source, "sourceHandle": source_handle, "target": target, "targetHandle": target_handle}


def _agent(node_id: str, **overrides) -> dict:
    data = {"role": "r", "goal": "g", "backstory": "b", **overrides}
    return _n(node_id, "agent", data)


def _task(node_id: str, **overrides) -> dict:
    data = {"description": "d", "expected_output": "o", **overrides}
    return _n(node_id, "task", data)


def _llm(node_id: str, **overrides) -> dict:
    data = {"provider": "openai", "model": "gpt-4o-mini", **overrides}
    return _n(node_id, "llm", data)


def _two_agent_two_task_doc(extra_nodes=None, extra_edges=None) -> CanvasDoc:
    """agent_1 -> task_1 -> (context) -> task_2 <- agent_2, 둘 다 crew_1 에 연결."""
    nodes = [
        _n("crew_1", "crew", {"process": "sequential", "name": "My Crew"}),
        _agent("agent_1", role="Researcher"),
        _agent("agent_2", role="Writer"),
        _task("task_1", name="Research"),
        _task("task_2", name="Write"),
        *(extra_nodes or []),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "agent_2", "agent", "crew_1", "agent"),
        _e("e3", "task_1", "task", "crew_1", "task"),
        _e("e4", "task_2", "task", "crew_1", "task"),
        _e("e5", "agent_1", "agent", "task_1", "agent"),
        _e("e6", "agent_2", "agent", "task_2", "agent"),
        _e("e7", "task_1", "task", "task_2", "context"),
        *(extra_edges or []),
    ]
    return _doc(nodes, edges)


def test_compiles_two_agent_two_task_crew():
    doc = _two_agent_two_task_doc()
    result = CanvasCompiler(doc).compile()

    assert len(result.crew.agents) == 2
    assert len(result.crew.tasks) == 2
    assert result.task_order == ["task_1", "task_2"]
    # task_2 의 context 에 task_1 인스턴스가 실제로 들어갔다 (동일 객체, 재생성 아님).
    assert result.crew.tasks[1].context == [result.crew.tasks[0]]


def test_node_index_maps_crewai_ids_back_to_canvas_node_ids():
    doc = _two_agent_two_task_doc()
    result = CanvasCompiler(doc).compile()

    agent_ids = {str(a.id) for a in result.crew.agents}
    task_ids = {str(t.id) for t in result.crew.tasks}
    assert {result.node_index[i] for i in agent_ids} == {"agent_1", "agent_2"}
    assert {result.node_index[i] for i in task_ids} == {"task_1", "task_2"}


def test_shared_llm_node_instantiated_once():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_llm("llm_1")],
        extra_edges=[
            _e("e8", "llm_1", "llm", "agent_1", "llm"),
            _e("e9", "llm_1", "llm", "agent_2", "llm"),
        ],
    )
    result = CanvasCompiler(doc).compile()

    assert result.crew.agents[0].llm is result.crew.agents[1].llm


def test_structural_error_raises_compilation_error_before_instantiation():
    doc = _doc([_n("crew_1", "crew", {"process": "sequential"})])  # Task 없음 → AC-E107
    with pytest.raises(CompilationError) as exc_info:
        CanvasCompiler(doc).compile()
    assert {i.code for i in exc_info.value.issues} == {"AC-E107"}


def test_unknown_tool_id_raises_ac_e205_by_default():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_n("tool_1", "tool", {"tool_id": "made_up_tool_xyz"})],
        extra_edges=[_e("e8", "tool_1", "tool", "task_1", "tool")],
    )
    with pytest.raises(CompilationError) as exc_info:
        CanvasCompiler(doc).compile()
    assert [i.code for i in exc_info.value.issues] == ["AC-E205"]


def test_known_tool_without_required_secret_raises_ac_e602_by_default():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_n("tool_1", "tool", {"tool_id": "serper_search"})],
        extra_edges=[_e("e8", "tool_1", "tool", "task_1", "tool")],
    )
    with pytest.raises(CompilationError) as exc_info:
        CanvasCompiler(doc).compile()
    assert [i.code for i in exc_info.value.issues] == ["AC-E602"]


def test_default_factory_builds_registry_tool_when_secret_present():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_n("tool_1", "tool", {"tool_id": "serper_search", "config": {"n_results": 5}})],
        extra_edges=[_e("e8", "tool_1", "tool", "task_1", "tool")],
    )
    result = CanvasCompiler(doc, secrets={"SERPER_API_KEY": "serper-test-key"}).compile()
    assert result.crew.tasks[0].tools[0].__class__.__name__ == "SerperDevTool"


def test_custom_tool_factory_is_used_and_cached():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_n("tool_1", "tool", {"tool_id": "serper_search"})],
        extra_edges=[
            _e("e8", "tool_1", "tool", "task_1", "tool"),
            _e("e9", "tool_1", "tool", "agent_1", "tool"),
        ],
    )
    calls: list[str] = []

    def factory(node):
        from crewai.tools import tool as crewai_tool

        calls.append(node.id)

        @crewai_tool("stub_tool")
        def _stub(x: str) -> str:
            """Stub tool for tests."""
            return x

        return _stub

    result = CanvasCompiler(doc, tool_factory=factory).compile()

    assert calls == ["tool_1"]  # 캐시 경유 → 두 번 호출되지 않음
    assert result.crew.tasks[0].tools[0] is result.crew.agents[0].tools[0]


def test_hierarchical_without_manager_llm_input_leaves_manager_llm_none():
    # process=hierarchical 이지만 manager llm 미연결 → 검증기가 AC-E103 로 이미 막는다.
    doc = _two_agent_two_task_doc()
    doc.nodes[0].data["process"] = "hierarchical"
    with pytest.raises(CompilationError) as exc_info:
        CanvasCompiler(doc).compile()
    assert "AC-E103" in {i.code for i in exc_info.value.issues}


def test_hierarchical_with_manager_llm_sets_manager_llm():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_llm("llm_1")],
        extra_edges=[_e("e8", "llm_1", "llm", "crew_1", "llm")],
    )
    doc.nodes[0].data["process"] = "hierarchical"
    result = CanvasCompiler(doc).compile()
    assert result.crew.manager_llm is not None


def test_required_input_without_value_or_default_raises_ac_e302():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_n("input_1", "input", {"var_name": "topic", "label": "주제", "required": True, "default_value": ""})],
    )
    with pytest.raises(CompilationError) as exc_info:
        CanvasCompiler(doc).compile()
    assert [i.code for i in exc_info.value.issues] == ["AC-E302"]


def test_provided_input_value_used_over_default():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_n("input_1", "input", {"var_name": "topic", "label": "주제", "default_value": "fallback"})],
    )
    result = CanvasCompiler(doc, inputs={"topic": "AI agents"}).compile()
    assert result.inputs == {"topic": "AI agents"}


def test_default_input_value_used_when_not_provided():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_n("input_1", "input", {"var_name": "topic", "label": "주제", "default_value": "fallback"})],
    )
    result = CanvasCompiler(doc).compile()
    assert result.inputs == {"topic": "fallback"}


def test_secrets_resolve_api_key_for_llm_node():
    doc = _two_agent_two_task_doc(
        extra_nodes=[_llm("llm_1")],
        extra_edges=[_e("e8", "llm_1", "llm", "agent_1", "llm")],
    )
    result = CanvasCompiler(doc, secrets={"OPENAI_API_KEY": "sk-test123"}).compile()
    assert result.crew.agents[0].llm.api_key == "sk-test123"
