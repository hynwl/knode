"""M2-T4 테스트: `compiler/validators.py` (AC-Exxx 구조/의미 검증).

`frontend/src/validation/rules.ts` 의 `validateGraph()` 와 같은 판정을 내야 한다
(Spec §9.4 MUST). 시나리오별로 정확히 그 코드가 나오는지만 확인한다 — 카탈로그
문구 자체의 정확성은 `test_schemas.py::test_issue_catalog_matches_frontend` 가
이미 프론트와 대조한다.
"""

from __future__ import annotations

from app.compiler.validators import DISABLED_IN_V1, REQUIRED_FIELDS, validate_graph
from app.schemas.graph import CanvasDoc

BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_test",
    "name": "Validator Test",
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


def _codes(doc: CanvasDoc) -> set[str]:
    return {i.code for i in validate_graph(doc)}


# ---------------------------------------------------------------------------
# E1xx — 그래프 구조
# ---------------------------------------------------------------------------

def test_missing_crew_emits_e101():
    doc = _doc([_n("task_1", "task", {"description": "d", "expected_output": "o"})])
    assert "AC-E101" in _codes(doc)


def test_duplicate_crew_emits_e102_for_extras_only():
    doc = _doc([
        _n("crew_1", "crew", {"process": "sequential"}),
        _n("crew_2", "crew", {"process": "sequential"}),
    ])
    issues = validate_graph(doc)
    e102 = [i for i in issues if i.code == "AC-E102"]
    assert [i.node_id for i in e102] == ["crew_2"]


def test_crew_without_tasks_emits_e107():
    doc = _doc([_n("crew_1", "crew", {"process": "sequential"})])
    assert "AC-E107" in _codes(doc)


def test_hierarchical_without_manager_llm_emits_e103():
    doc = _doc([
        _n("crew_1", "crew", {"process": "hierarchical"}),
        _n("task_1", "task", {"description": "d", "expected_output": "o"}),
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
    ], edges=[
        _e("e1", "task_1", "task", "crew_1", "task"),
        _e("e2", "agent_1", "agent", "task_1", "agent"),
    ])
    assert "AC-E103" in _codes(doc)


def test_hierarchical_with_manager_llm_has_no_e103():
    doc = _doc([
        _n("crew_1", "crew", {"process": "hierarchical"}),
        _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o-mini"}),
        _n("task_1", "task", {"description": "d", "expected_output": "o"}),
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
    ], edges=[
        _e("e1", "task_1", "task", "crew_1", "task"),
        _e("e2", "llm_1", "llm", "crew_1", "llm"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
    ])
    assert "AC-E103" not in _codes(doc)


def test_agent_and_task_not_linked_to_crew_emit_w104():
    doc = _doc([
        _n("crew_1", "crew", {"process": "sequential"}),
        _n("task_1", "task", {"description": "d", "expected_output": "o"}),
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b", "allow_delegation": True}),
    ])
    # crew_1 은 task_1/agent_1 어느 쪽과도 연결되지 않음 → 둘 다 W104, 게다가 E107(태스크 없음)도.
    issues = validate_graph(doc)
    codes_by_node = {i.node_id: i.code for i in issues if i.code == "AC-W104"}
    assert codes_by_node.get("task_1") == "AC-W104"
    assert codes_by_node.get("agent_1") == "AC-W104"


def test_cycle_emits_e105_for_every_node_in_cycle():
    doc = _doc([
        _n("crew_1", "crew", {"process": "sequential"}),
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
        _n("a", "task", {"description": "d", "expected_output": "o"}),
        _n("b", "task", {"description": "d", "expected_output": "o"}),
    ], edges=[
        _e("e1", "agent_1", "agent", "a", "agent"),
        _e("e2", "agent_1", "agent", "b", "agent"),
        _e("e3", "a", "task", "b", "context"),
        _e("e4", "b", "task", "a", "context"),
    ])
    issues = validate_graph(doc)
    e105_nodes = {i.node_id for i in issues if i.code == "AC-E105"}
    assert e105_nodes == {"a", "b"}


# ---------------------------------------------------------------------------
# E2xx — 노드 설정
# ---------------------------------------------------------------------------

def test_required_fields_mirror_has_all_expected_types():
    assert set(REQUIRED_FIELDS) == {"llm", "agent", "task", "tool", "crew", "input"}


def test_empty_required_field_emits_e201_with_field_name():
    doc = _doc([_n("llm_1", "llm", {"provider": "", "model": "gpt-4o-mini"})])
    issues = validate_graph(doc)
    e201 = [i for i in issues if i.code == "AC-E201" and i.node_id == "llm_1"]
    assert any(i.field == "provider" for i in e201)


def test_task_missing_description_emits_e204_not_e201():
    doc = _doc([_n("task_1", "task", {"description": "", "expected_output": "o"})])
    issues = validate_graph(doc)
    matching = [i for i in issues if i.node_id == "task_1" and i.field == "description"]
    assert [i.code for i in matching] == ["AC-E204"]


def test_task_without_agent_emits_e202():
    doc = _doc([_n("task_1", "task", {"description": "d", "expected_output": "o"})])
    assert "AC-E202" in _codes(doc)


def test_task_with_agent_has_no_e202():
    doc = _doc([
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
        _n("task_1", "task", {"description": "d", "expected_output": "o"}),
    ], edges=[_e("e1", "agent_1", "agent", "task_1", "agent")])
    assert "AC-E202" not in _codes(doc)


def test_agent_without_task_or_delegation_emits_w203():
    doc = _doc([_n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"})])
    assert "AC-W203" in _codes(doc)


def test_agent_with_allow_delegation_suppresses_w203():
    doc = _doc([_n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b", "allow_delegation": True})])
    assert "AC-W203" not in _codes(doc)


def test_agent_with_task_suppresses_w203():
    doc = _doc([
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
        _n("task_1", "task", {"description": "d", "expected_output": "o"}),
    ], edges=[_e("e1", "agent_1", "agent", "task_1", "agent")])
    assert "AC-W203" not in _codes(doc)


def test_agent_with_ollama_llm_and_tool_emits_w701():
    doc = _doc([
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b", "allow_delegation": True}),
        _n("llm_1", "llm", {"provider": "ollama", "model": "llama3.1"}),
        _n("tool_1", "tool", {"tool_id": "serper_search"}),
    ], edges=[
        _e("e1", "llm_1", "llm", "agent_1", "llm"),
        _e("e2", "tool_1", "tool", "agent_1", "tool"),
    ])
    assert "AC-W701" in _codes(doc)


def test_agent_with_ollama_llm_and_no_tool_suppresses_w701():
    doc = _doc([
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b", "allow_delegation": True}),
        _n("llm_1", "llm", {"provider": "ollama", "model": "llama3.1"}),
    ], edges=[_e("e1", "llm_1", "llm", "agent_1", "llm")])
    assert "AC-W701" not in _codes(doc)


def test_agent_with_tool_and_non_ollama_llm_suppresses_w701():
    doc = _doc([
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b", "allow_delegation": True}),
        _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o-mini"}),
        _n("tool_1", "tool", {"tool_id": "serper_search"}),
    ], edges=[
        _e("e1", "llm_1", "llm", "agent_1", "llm"),
        _e("e2", "tool_1", "tool", "agent_1", "tool"),
    ])
    assert "AC-W701" not in _codes(doc)


def test_invalid_var_name_emits_e303():
    doc = _doc([_n("input_1", "input", {"var_name": "123-bad", "label": "x"})])
    assert "AC-E303" in _codes(doc)


def test_valid_var_name_has_no_e303():
    doc = _doc([_n("input_1", "input", {"var_name": "topic", "label": "x"})])
    assert "AC-E303" not in _codes(doc)


def test_router_and_guardrail_are_disabled_in_v1():
    assert DISABLED_IN_V1 == frozenset({"router", "guardrail"})
    doc = _doc([_n("router_1", "router", {"name": "R"})])
    issues = validate_graph(doc)
    matching = [i for i in issues if i.node_id == "router_1" and i.code == "AC-W104"]
    assert len(matching) == 1
    assert "v1.0" in matching[0].message


# ---------------------------------------------------------------------------
# E3xx — 변수 보간
# ---------------------------------------------------------------------------

def test_undefined_variable_in_task_description_emits_w301():
    doc = _doc([_n("task_1", "task", {"description": "{topic} 조사", "expected_output": "o"})])
    issues = validate_graph(doc)
    assert any(i.code == "AC-W301" and i.node_id == "task_1" for i in issues)


def test_declared_input_variable_suppresses_w301():
    doc = _doc([
        _n("input_1", "input", {"var_name": "topic", "label": "x"}),
        _n("task_1", "task", {"description": "{topic} 조사", "expected_output": "o"}),
    ])
    assert "AC-W301" not in _codes(doc)


def test_undefined_variable_in_agent_goal_emits_w301():
    doc = _doc([_n("agent_1", "agent", {"role": "r", "goal": "{missing} 목표", "backstory": "b"})])
    issues = validate_graph(doc)
    assert any(i.code == "AC-W301" and i.node_id == "agent_1" and i.field == "goal" for i in issues)


def test_escaped_braces_are_not_treated_as_variables():
    doc = _doc([_n("task_1", "task", {"description": "{{literal}} 만 있음", "expected_output": "o"})])
    assert "AC-W301" not in _codes(doc)


# ---------------------------------------------------------------------------
# 정규화 — bypass/note 제외
# ---------------------------------------------------------------------------

def test_bypassed_crew_is_ignored_like_no_crew_at_all():
    doc = _doc([
        {**_n("crew_1", "crew", {"process": "sequential"}), "ui": {"bypassed": True}},
    ])
    assert "AC-E101" in _codes(doc)


def test_note_node_never_triggers_required_field_check():
    doc = _doc([_n("note_1", "note", {"text": ""})])
    issues = validate_graph(doc)
    assert not any(i.node_id == "note_1" for i in issues)
