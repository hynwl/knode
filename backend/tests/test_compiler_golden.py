"""M2-T20: 컴파일러 골든 픽스처 스위트 (Spec §18 테스트 전략 표 — `MUST`).

> 컴파일러 (백엔드) | pytest | 골든 픽스처: `graph.json` → 예상 CrewAI 구조
> 스냅샷. **최소 20 케이스** (정상 5 + 에러 15)

`test_compiler_compile.py` 가 컴파일러 **동작**을 개별 assert 로 확인한다면,
이 파일은 그래프 → CrewAI 구조 **전체 스냅샷**을 테이블로 고정한다. 어떤
필드든 조용히 바뀌면 여기서 먼저 깨진다.

⚠️ 스냅샷에 넣는 필드는 `docs/CREWAI_RECON.md` 실측(F1~F14)에 존재가 확인된
것만이다 — `full_output`(F3), `Task.max_retries`(F4) 같은 "스펙에는 있으나
1.15.18 에 없는" 필드는 넣지 않는다. `Task.context` 는 비었을 때 인자 자체를
생략하므로(F12) 리스트가 아닌 센티널이 들어온다 → `_context_names()` 가 그
구분을 그대로 스냅샷한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import pytest

from app.compiler.compiler import CanvasCompiler, CompileResult
from app.core.errors import CompilationError
from app.schemas.graph import CanvasDoc

BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_golden",
    "name": "Golden Fixture",
    "created_at": "2026-08-31T00:00:00Z",
    "updated_at": "2026-08-31T00:00:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


# ---------------------------------------------------------------------------
# graph.json DSL
# ---------------------------------------------------------------------------

def _n(node_id: str, node_type: str, data: dict | None = None, x: float = 0, y: float = 0) -> dict:
    return {"id": node_id, "type": node_type, "position": {"x": x, "y": y}, "data": data or {}}


def _e(edge_id: str, source: str, source_handle: str, target: str, target_handle: str) -> dict:
    return {
        "id": edge_id, "source": source, "sourceHandle": source_handle,
        "target": target, "targetHandle": target_handle,
    }


def _doc(nodes: list[dict], edges: list[dict]) -> CanvasDoc:
    return CanvasDoc.model_validate({**BASE, "nodes": nodes, "edges": edges})


def _agent(node_id: str, role: str = "r", *, x: float = 0, y: float = 0, **overrides) -> dict:
    return _n(node_id, "agent", {"role": role, "goal": "g", "backstory": "b", **overrides}, x=x, y=y)


def _task(node_id: str, name: str | None = None, *, x: float = 0, y: float = 0, **overrides) -> dict:
    """`x`/`y` 는 노드 좌표다 — 동순위 Task 의 정렬 기준(Spec §5.5)이라 명시적으로 준다."""
    data: dict[str, Any] = {"description": "d", "expected_output": "o", **overrides}
    if name:
        data["name"] = name
    return _n(node_id, "task", data, x=x, y=y)


# ---------------------------------------------------------------------------
# 스냅샷
# ---------------------------------------------------------------------------

def _context_names(task: Any) -> list[str] | None:
    """`Task.context` 스냅샷. 비어 있으면 인자를 생략하므로(RECON F12) 리스트가
    아닌 센티널이 들어온다 — 그 경우 `None` 으로 표기해 "자동 컨텍스트" 상태와
    "명시적 빈 리스트"를 구분한다."""
    ctx = getattr(task, "context", None)
    if not isinstance(ctx, list):
        return None
    return [c.name for c in ctx]


def snapshot(result: CompileResult) -> dict[str, Any]:
    crew = result.crew
    process = crew.process
    return {
        "process": getattr(process, "value", str(process)),
        "agents": [a.role for a in crew.agents],
        "task_order": list(result.task_order),
        "tasks": [
            {
                "name": t.name,
                "agent": t.agent.role if t.agent is not None else None,
                "context": _context_names(t),
                "tools": sorted(type(x).__name__ for x in (t.tools or [])),
            }
            for t in crew.tasks
        ],
        "agent_tools": [sorted(type(x).__name__ for x in (a.tools or [])) for a in crew.agents],
        "manager_llm": None if crew.manager_llm is None else crew.manager_llm.model,
        "inputs": dict(result.inputs),
        "warning_codes": sorted({i.code for i in result.warnings}),
    }


# ---------------------------------------------------------------------------
# 정상 케이스 (Spec §18: 최소 5)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OkCase:
    name: str
    build: Callable[[Path], tuple[CanvasDoc, dict[str, Any]]]
    expected: dict[str, Any]


def _g_minimal(_ws: Path) -> tuple[CanvasDoc, dict[str, Any]]:
    nodes = [
        _n("crew_1", "crew", {"process": "sequential", "name": "Solo"}),
        _agent("agent_1", role="Researcher"),
        _task("task_1", name="Research"),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "task_1", "task", "crew_1", "task"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
    ]
    return _doc(nodes, edges), {}


def _g_chain(_ws: Path) -> tuple[CanvasDoc, dict[str, Any]]:
    nodes = [
        _n("crew_1", "crew", {"process": "sequential", "name": "Duo"}),
        _agent("agent_1", role="Researcher"),
        _agent("agent_2", role="Writer"),
        _task("task_1", name="Research", x=0),
        _task("task_2", name="Write", x=100),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "agent_2", "agent", "crew_1", "agent"),
        _e("e3", "task_1", "task", "crew_1", "task"),
        _e("e4", "task_2", "task", "crew_1", "task"),
        _e("e5", "agent_1", "agent", "task_1", "agent"),
        _e("e6", "agent_2", "agent", "task_2", "agent"),
        _e("e7", "task_1", "task", "task_2", "context"),
    ]
    return _doc(nodes, edges), {}


def _g_hierarchical(_ws: Path) -> tuple[CanvasDoc, dict[str, Any]]:
    nodes = [
        _n("crew_1", "crew", {"process": "hierarchical", "name": "Managed"}),
        _agent("agent_1", role="Worker"),
        _task("task_1", name="Do"),
        _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o-mini"}),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "task_1", "task", "crew_1", "task"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
        _e("e4", "llm_1", "llm", "crew_1", "llm"),
    ]
    return _doc(nodes, edges), {}


def _g_branch_merge(_ws: Path) -> tuple[CanvasDoc, dict[str, Any]]:
    """분기(task_1 → task_2, task_3) 후 병합(task_2, task_3 → task_4)."""
    nodes = [
        _n("crew_1", "crew", {"process": "sequential", "name": "Fanout"}),
        _agent("agent_1", role="Worker"),
        _task("task_1", name="Split", x=0),
        _task("task_2", name="BranchA", x=100),
        _task("task_3", name="BranchB", x=200),
        _task("task_4", name="Merge", x=300),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        *[_e(f"t{i}", f"task_{i}", "task", "crew_1", "task") for i in (1, 2, 3, 4)],
        *[_e(f"a{i}", "agent_1", "agent", f"task_{i}", "agent") for i in (1, 2, 3, 4)],
        _e("c1", "task_1", "task", "task_2", "context"),
        _e("c2", "task_1", "task", "task_3", "context"),
        _e("c3", "task_2", "task", "task_4", "context"),
        _e("c4", "task_3", "task", "task_4", "context"),
    ]
    return _doc(nodes, edges), {}


def _g_shared_llm_and_input(_ws: Path) -> tuple[CanvasDoc, dict[str, Any]]:
    nodes = [
        _n("crew_1", "crew", {"process": "sequential", "name": "Shared"}),
        _agent("agent_1", role="Researcher"),
        _agent("agent_2", role="Writer"),
        _task("task_1", name="Research", description="{topic} 를 조사하라"),
        _task("task_2", name="Write", x=100),
        _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o-mini"}),
        _n("input_1", "input", {"var_name": "topic", "label": "주제", "default_value": "AI"}),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "agent_2", "agent", "crew_1", "agent"),
        _e("e3", "task_1", "task", "crew_1", "task"),
        _e("e4", "task_2", "task", "crew_1", "task"),
        _e("e5", "agent_1", "agent", "task_1", "agent"),
        _e("e6", "agent_2", "agent", "task_2", "agent"),
        _e("e7", "llm_1", "llm", "agent_1", "llm"),
        _e("e8", "llm_1", "llm", "agent_2", "llm"),
    ]
    return _doc(nodes, edges), {}


def _g_with_tools(ws: Path) -> tuple[CanvasDoc, dict[str, Any]]:
    (ws / "notes.txt").write_text("hi")
    nodes = [
        _n("crew_1", "crew", {"process": "sequential", "name": "Tooled"}),
        _agent("agent_1", role="Researcher"),
        _task("task_1", name="Research"),
        _n("tool_1", "tool", {"tool_id": "file_read", "config": {"file_path": "notes.txt"}}),
        _n("tool_2", "tool", {"tool_id": "serper_search", "config": {"n_results": 5}}),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "task_1", "task", "crew_1", "task"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
        _e("e4", "tool_1", "tool", "task_1", "tool"),
        _e("e5", "tool_2", "tool", "agent_1", "tool"),
    ]
    return _doc(nodes, edges), {"secrets": {"SERPER_API_KEY": "serper-test-key"}}


GOLDEN_OK: list[OkCase] = [
    OkCase(
        "ok_minimal_sequential", _g_minimal,
        {
            "process": "sequential",
            "agents": ["Researcher"],
            "task_order": ["task_1"],
            "tasks": [{"name": "Research", "agent": "Researcher", "context": None, "tools": []}],
            "agent_tools": [[]],
            "manager_llm": None,
            "inputs": {},
            "warning_codes": [],
        },
    ),
    OkCase(
        "ok_two_agent_context_chain", _g_chain,
        {
            "process": "sequential",
            "agents": ["Researcher", "Writer"],
            "task_order": ["task_1", "task_2"],
            "tasks": [
                {"name": "Research", "agent": "Researcher", "context": None, "tools": []},
                {"name": "Write", "agent": "Writer", "context": ["Research"], "tools": []},
            ],
            "agent_tools": [[], []],
            "manager_llm": None,
            "inputs": {},
            "warning_codes": [],
        },
    ),
    OkCase(
        "ok_hierarchical_with_manager_llm", _g_hierarchical,
        {
            "process": "hierarchical",
            "agents": ["Worker"],
            "task_order": ["task_1"],
            "tasks": [{"name": "Do", "agent": "Worker", "context": None, "tools": []}],
            "agent_tools": [[]],
            "manager_llm": "gpt-4o-mini",
            "inputs": {},
            "warning_codes": [],
        },
    ),
    OkCase(
        "ok_branch_then_merge", _g_branch_merge,
        {
            "process": "sequential",
            "agents": ["Worker"],
            "task_order": ["task_1", "task_2", "task_3", "task_4"],
            "tasks": [
                {"name": "Split", "agent": "Worker", "context": None, "tools": []},
                {"name": "BranchA", "agent": "Worker", "context": ["Split"], "tools": []},
                {"name": "BranchB", "agent": "Worker", "context": ["Split"], "tools": []},
                {"name": "Merge", "agent": "Worker", "context": ["BranchA", "BranchB"], "tools": []},
            ],
            "agent_tools": [[]],
            "manager_llm": None,
            "inputs": {},
            "warning_codes": [],
        },
    ),
    OkCase(
        "ok_shared_llm_and_input_default", _g_shared_llm_and_input,
        {
            "process": "sequential",
            "agents": ["Researcher", "Writer"],
            "task_order": ["task_1", "task_2"],
            "tasks": [
                {"name": "Research", "agent": "Researcher", "context": None, "tools": []},
                {"name": "Write", "agent": "Writer", "context": None, "tools": []},
            ],
            "agent_tools": [[], []],
            "manager_llm": None,
            "inputs": {"topic": "AI"},
            "warning_codes": [],
        },
    ),
    OkCase(
        "ok_task_tool_and_agent_tool", _g_with_tools,
        {
            "process": "sequential",
            "agents": ["Researcher"],
            "task_order": ["task_1"],
            "tasks": [
                {"name": "Research", "agent": "Researcher", "context": None, "tools": ["FileReadTool"]},
            ],
            "agent_tools": [["SerperDevTool"]],
            "manager_llm": None,
            "inputs": {},
            "warning_codes": [],
        },
    ),
]


# ---------------------------------------------------------------------------
# 에러 케이스 (Spec §18: 최소 15)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ErrCase:
    name: str
    build: Callable[[Path], tuple[CanvasDoc, dict[str, Any]]]
    codes: set[str]
    env: dict[str, str] = field(default_factory=dict)


def _crew_with(nodes: list[dict], edges: list[dict]) -> tuple[CanvasDoc, dict[str, Any]]:
    return _doc(nodes, edges), {}


def _minimal_nodes_edges() -> tuple[list[dict], list[dict]]:
    nodes = [
        _n("crew_1", "crew", {"process": "sequential"}),
        _agent("agent_1"),
        _task("task_1"),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "task_1", "task", "crew_1", "task"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
    ]
    return nodes, edges


def _with_tool_node(config_node: dict, handle_target: str = "task_1") -> tuple[CanvasDoc, dict[str, Any]]:
    nodes, edges = _minimal_nodes_edges()
    nodes.append(config_node)
    edges.append(_e("e9", config_node["id"], "tool", handle_target, "tool"))
    return _crew_with(nodes, edges)


def _err_no_crew(_ws: Path):
    return _crew_with(
        [_agent("agent_1"), _task("task_1")],
        [_e("e3", "agent_1", "agent", "task_1", "agent")],
    )


def _err_two_crews(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes.append(_n("crew_2", "crew", {"process": "sequential"}))
    return _crew_with(nodes, edges)


def _err_hierarchical_no_manager(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes[0]["data"]["process"] = "hierarchical"
    return _crew_with(nodes, edges)


def _err_cycle(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes.append(_task("task_2", x=100))
    edges += [
        _e("e4", "task_2", "task", "crew_1", "task"),
        _e("e5", "agent_1", "agent", "task_2", "agent"),
        _e("e6", "task_1", "task", "task_2", "context"),
        _e("e7", "task_2", "task", "task_1", "context"),
    ]
    return _crew_with(nodes, edges)


def _err_crew_without_task(_ws: Path):
    return _crew_with(
        [_n("crew_1", "crew", {"process": "sequential"}), _agent("agent_1")],
        [_e("e1", "agent_1", "agent", "crew_1", "agent")],
    )


def _err_agent_missing_role(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes[1]["data"]["role"] = ""
    return _crew_with(nodes, edges)


def _err_task_without_agent(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    edges = [e for e in edges if e["id"] != "e3"]
    nodes[1]["data"]["allow_delegation"] = True  # W203 억제 (경고는 비교 대상 밖이지만 의도 명시)
    return _crew_with(nodes, edges)


def _err_task_missing_expected_output(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes[2]["data"]["expected_output"] = ""
    return _crew_with(nodes, edges)


def _err_unknown_tool(_ws: Path):
    return _with_tool_node(_n("tool_1", "tool", {"tool_id": "made_up_tool_xyz"}))


def _err_tool_config_schema(_ws: Path):
    doc, _ = _with_tool_node(
        _n("tool_1", "tool", {"tool_id": "serper_search", "config": {"n_results": "not-an-int"}})
    )
    return doc, {"secrets": {"SERPER_API_KEY": "serper-test-key"}}


def _err_missing_required_input(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes.append(_n("input_1", "input", {"var_name": "topic", "label": "주제", "required": True}))
    return _crew_with(nodes, edges)


def _err_invalid_var_name(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes.append(_n("input_1", "input", {"var_name": "1bad", "label": "L", "default_value": "x"}))
    return _crew_with(nodes, edges)


def _err_tool_missing_secret(_ws: Path):
    return _with_tool_node(_n("tool_1", "tool", {"tool_id": "serper_search"}))


def _err_ssrf_private_url(_ws: Path):
    return _with_tool_node(
        _n("tool_1", "tool", {"tool_id": "scrape_website", "config": {"website_url": "http://169.254.169.254/latest/meta-data/"}})
    )


def _err_path_traversal(_ws: Path):
    return _with_tool_node(
        _n("tool_1", "tool", {"tool_id": "file_read", "config": {"file_path": "../../etc/passwd"}})
    )


def _err_directory_traversal(_ws: Path):
    return _with_tool_node(
        _n("tool_1", "tool", {"tool_id": "directory_read", "config": {"directory": "/etc"}})
    )


def _err_code_interpreter_disabled(_ws: Path):
    nodes, edges = _minimal_nodes_edges()
    nodes[1]["data"]["allow_code_execution"] = True
    return _crew_with(nodes, edges)


GOLDEN_ERRORS: list[ErrCase] = [
    ErrCase("err_AC_E101_no_crew", _err_no_crew, {"AC-E101"}),
    ErrCase("err_AC_E102_two_crews", _err_two_crews, {"AC-E102"}),
    ErrCase("err_AC_E103_hierarchical_no_manager_llm", _err_hierarchical_no_manager, {"AC-E103"}),
    ErrCase("err_AC_E105_context_cycle", _err_cycle, {"AC-E105"}),
    ErrCase("err_AC_E107_crew_without_task", _err_crew_without_task, {"AC-E107"}),
    ErrCase("err_AC_E201_agent_missing_role", _err_agent_missing_role, {"AC-E201"}),
    ErrCase("err_AC_E202_task_without_agent", _err_task_without_agent, {"AC-E202"}),
    ErrCase("err_AC_E204_task_missing_expected_output", _err_task_missing_expected_output, {"AC-E204"}),
    ErrCase("err_AC_E205_unknown_tool_id", _err_unknown_tool, {"AC-E205"}),
    ErrCase("err_AC_E206_tool_config_schema_mismatch", _err_tool_config_schema, {"AC-E206"}),
    ErrCase("err_AC_E302_missing_required_input", _err_missing_required_input, {"AC-E302"}),
    ErrCase("err_AC_E303_invalid_var_name", _err_invalid_var_name, {"AC-E303"}),
    ErrCase("err_AC_E602_tool_missing_secret", _err_tool_missing_secret, {"AC-E602"}),
    ErrCase("err_AC_E801_ssrf_private_url", _err_ssrf_private_url, {"AC-E801"}),
    ErrCase("err_AC_E802_file_path_traversal", _err_path_traversal, {"AC-E802"}),
    ErrCase("err_AC_E802_directory_outside_workspace", _err_directory_traversal, {"AC-E802"}),
    ErrCase("err_AC_E803_code_interpreter_disabled", _err_code_interpreter_disabled, {"AC-E803"}),
]


# ---------------------------------------------------------------------------
# 테스트
# ---------------------------------------------------------------------------

@pytest.fixture()
def golden_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "workspace"
    ws.mkdir()
    monkeypatch.setenv("WORKSPACE_DIR", str(ws))
    monkeypatch.delenv("ENABLE_CODE_INTERPRETER", raising=False)
    return ws


@pytest.mark.parametrize("case", GOLDEN_OK, ids=lambda c: c.name)
def test_golden_ok_snapshot(case: OkCase, golden_workspace):
    doc, kwargs = case.build(golden_workspace)
    result = CanvasCompiler(doc, **kwargs).compile()
    assert snapshot(result) == case.expected


@pytest.mark.parametrize("case", GOLDEN_ERRORS, ids=lambda c: c.name)
def test_golden_error_codes(case: ErrCase, golden_workspace, monkeypatch):
    for key, value in case.env.items():
        monkeypatch.setenv(key, value)
    doc, kwargs = case.build(golden_workspace)

    with pytest.raises(CompilationError) as exc_info:
        CanvasCompiler(doc, **kwargs).compile()

    issues = exc_info.value.issues
    assert {i.code for i in issues if i.severity == "error"} == case.codes
    # Spec §17.5: 모든 에러는 코드를 갖고(1), 다음 행동을 제안한다(3).
    for i in issues:
        assert i.code
        assert i.docs_url and i.code in i.docs_url
        if i.severity == "error":
            assert i.hint, f"{i.code} 에 hint 가 없다 (Spec §17.5-3 MUST)"


def test_golden_suite_meets_spec_18_minimums():
    """Spec §18 표: 정상 5 + 에러 15 = 최소 20 케이스. 케이스를 지우면 여기서 막힌다."""
    assert len(GOLDEN_OK) >= 5, "정상 골든 케이스가 5개 미만이다 (Spec §18 MUST)"
    assert len(GOLDEN_ERRORS) >= 15, "에러 골든 케이스가 15개 미만이다 (Spec §18 MUST)"
    assert len(GOLDEN_OK) + len(GOLDEN_ERRORS) >= 20


def test_golden_case_names_are_unique():
    names = [c.name for c in GOLDEN_OK] + [c.name for c in GOLDEN_ERRORS]
    assert len(names) == len(set(names))
