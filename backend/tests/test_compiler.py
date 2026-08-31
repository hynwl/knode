"""M2-T3 테스트: `compiler/graph.py` + `compiler/topology.py`.

`frontend/src/validation/rules.ts` 의 그래프 헬퍼/사이클 검출/위상 정렬과
같은 규칙을 검증한다. 노드는 필요한 필드(id/type/position)만 최소로 구성한다.
"""

from __future__ import annotations

from app.compiler.graph import NON_COMPILABLE_NODE_TYPES, CanvasGraph
from app.compiler.topology import find_cycle, order_tasks, would_create_cycle
from app.schemas.graph import AcEdge, AcNode, NodeUiState, XYPosition


def _node(node_id: str, node_type: str, x: float = 0, y: float = 0, bypassed: bool = False) -> AcNode:
    return AcNode(
        id=node_id, type=node_type, position=XYPosition(x=x, y=y),
        ui=NodeUiState(bypassed=bypassed),
    )


def _edge(edge_id: str, source: str, source_handle: str, target: str, target_handle: str) -> AcEdge:
    return AcEdge(id=edge_id, source=source, sourceHandle=source_handle, target=target, targetHandle=target_handle)


# ---------------------------------------------------------------------------
# graph.py — 조회 헬퍼
# ---------------------------------------------------------------------------

def test_node_looks_up_by_id_or_returns_none():
    g = CanvasGraph(nodes=[_node("a", "task")], edges=[])
    assert g.node("a") is not None
    assert g.node("missing") is None


def test_nodes_of_type_excludes_bypassed():
    g = CanvasGraph(nodes=[_node("a", "task"), _node("b", "task", bypassed=True)], edges=[])
    assert [n.id for n in g.nodes_of_type("task")] == ["a"]


def test_single_returns_first_match_or_none():
    g = CanvasGraph(nodes=[_node("c1", "crew"), _node("c2", "crew")], edges=[])
    assert g.single("crew").id == "c1"
    assert g.single("llm") is None


def test_incoming_and_outgoing_filter_by_handle():
    g = CanvasGraph(
        nodes=[_node("agent_1", "agent"), _node("task_1", "task"), _node("tool_1", "tool")],
        edges=[
            _edge("e1", "agent_1", "agent", "task_1", "agent"),
            _edge("e2", "tool_1", "tool", "task_1", "tool"),
        ],
    )
    assert [n.id for n in g.incoming("task_1", "agent")] == ["agent_1"]
    assert [n.id for n in g.incoming("task_1", "tool")] == ["tool_1"]
    assert g.incoming("task_1", "context") == []
    assert [n.id for n in g.outgoing("agent_1", "agent")] == ["task_1"]


def test_normalize_drops_bypassed_and_non_compilable_nodes_and_orphan_edges():
    assert NON_COMPILABLE_NODE_TYPES == frozenset({"note", "group"})
    g = CanvasGraph(
        nodes=[
            _node("a", "task"),
            _node("b", "task", bypassed=True),
            _node("note_1", "note"),
        ],
        edges=[
            _edge("e1", "a", "task", "note_1", "text"),  # note_1 사라지면 고아가 됨
            _edge("e2", "a", "task", "b", "context"),  # b 사라지면 고아가 됨
        ],
    )
    normalized = g.normalize()
    assert {n.id for n in normalized.nodes} == {"a"}
    assert normalized.edges == []


# ---------------------------------------------------------------------------
# topology.py — 사이클 검출
# ---------------------------------------------------------------------------

def test_would_create_cycle_detects_self_loop():
    g = CanvasGraph(nodes=[_node("a", "task")], edges=[])
    assert would_create_cycle(g, "a", "a") is True


def test_would_create_cycle_detects_back_edge_via_context_chain():
    # task_a -> task_b -> task_c (context). c -> a 를 추가하면 사이클.
    g = CanvasGraph(
        nodes=[_node("a", "task"), _node("b", "task"), _node("c", "task")],
        edges=[
            _edge("e1", "a", "task", "b", "context"),
            _edge("e2", "b", "task", "c", "context"),
        ],
    )
    assert would_create_cycle(g, "c", "a") is True
    assert would_create_cycle(g, "a", "c") is False


def test_would_create_cycle_ignores_non_context_edges():
    g = CanvasGraph(
        nodes=[_node("agent_1", "agent"), _node("task_1", "task")],
        edges=[_edge("e1", "agent_1", "agent", "task_1", "agent")],
    )
    # agent 핸들 엣지는 context 그래프에 포함되지 않으므로 역방향도 사이클 아님.
    assert would_create_cycle(g, "task_1", "agent_1") is False


def test_find_cycle_returns_none_on_acyclic_graph():
    g = CanvasGraph(
        nodes=[_node("a", "task"), _node("b", "task")],
        edges=[_edge("e1", "a", "task", "b", "context")],
    )
    assert find_cycle(g) is None


def test_find_cycle_returns_path_when_cyclic():
    g = CanvasGraph(
        nodes=[_node("a", "task"), _node("b", "task"), _node("c", "task")],
        edges=[
            _edge("e1", "a", "task", "b", "context"),
            _edge("e2", "b", "task", "c", "context"),
            _edge("e3", "c", "task", "a", "context"),
        ],
    )
    cycle = find_cycle(g)
    assert cycle is not None
    assert set(cycle) == {"a", "b", "c"}


# ---------------------------------------------------------------------------
# topology.py — 위상 정렬 (Spec §5.5)
# ---------------------------------------------------------------------------

def test_order_tasks_follows_context_dependency_chain():
    # b 는 a 에 의존, c 는 b 에 의존. 좌표는 일부러 역순으로 배치.
    g = CanvasGraph(
        nodes=[
            _node("c", "task", x=0, y=0),
            _node("b", "task", x=100, y=0),
            _node("a", "task", x=200, y=0),
        ],
        edges=[
            _edge("e1", "a", "task", "b", "context"),
            _edge("e2", "b", "task", "c", "context"),
        ],
    )
    assert [t.id for t in order_tasks(g)] == ["a", "b", "c"]


def test_order_tasks_breaks_ties_by_x_then_y():
    g = CanvasGraph(
        nodes=[
            _node("right", "task", x=200, y=0),
            _node("bottom_left", "task", x=0, y=100),
            _node("top_left", "task", x=0, y=0),
        ],
        edges=[],
    )
    assert [t.id for t in order_tasks(g)] == ["top_left", "bottom_left", "right"]


def test_order_tasks_ignores_dependency_on_node_outside_task_set():
    # depends on 소스가 task 가 아니면(예: agent 오연결) 위상 정렬에서 무시된다.
    g = CanvasGraph(
        nodes=[_node("agent_1", "agent"), _node("task_1", "task")],
        edges=[_edge("e1", "agent_1", "agent", "task_1", "context")],
    )
    assert [t.id for t in order_tasks(g)] == ["task_1"]


def test_order_tasks_branch_places_both_successors_after_shared_dependency():
    # 분기: root -> left, root -> right. 좌표를 역순으로 둬 위상 제약이
    # 좌표 정렬보다 우선한다는 것까지 확인한다.
    g = CanvasGraph(
        nodes=[
            _node("left", "task", x=0, y=0),
            _node("right", "task", x=100, y=0),
            _node("root", "task", x=200, y=0),
        ],
        edges=[
            _edge("e1", "root", "task", "left", "context"),
            _edge("e2", "root", "task", "right", "context"),
        ],
    )
    assert [t.id for t in order_tasks(g)] == ["root", "left", "right"]


def test_order_tasks_merge_waits_for_every_incoming_context_dependency():
    # 병합: a -> merge, b -> merge. merge 는 좌표상 맨 앞이어도 마지막에 온다.
    g = CanvasGraph(
        nodes=[
            _node("merge", "task", x=0, y=0),
            _node("a", "task", x=100, y=0),
            _node("b", "task", x=200, y=0),
        ],
        edges=[
            _edge("e1", "a", "task", "merge", "context"),
            _edge("e2", "b", "task", "merge", "context"),
        ],
    )
    assert [t.id for t in order_tasks(g)] == ["a", "b", "merge"]


def test_order_tasks_diamond_branch_then_merge():
    # 다이아몬드: root -> (left, right) -> merge.
    g = CanvasGraph(
        nodes=[
            _node("root", "task", x=0, y=0),
            _node("left", "task", x=100, y=0),
            _node("right", "task", x=100, y=100),
            _node("merge", "task", x=200, y=0),
        ],
        edges=[
            _edge("e1", "root", "task", "left", "context"),
            _edge("e2", "root", "task", "right", "context"),
            _edge("e3", "left", "task", "merge", "context"),
            _edge("e4", "right", "task", "merge", "context"),
        ],
    )
    assert [t.id for t in order_tasks(g)] == ["root", "left", "right", "merge"]


def test_order_tasks_includes_orphan_task_with_no_context_edges():
    # 고아 Task(의존도 피의존도 없음)는 같은 순위로 취급되어 좌표순으로 들어간다.
    g = CanvasGraph(
        nodes=[
            _node("orphan", "task", x=0, y=0),
            _node("a", "task", x=100, y=0),
            _node("b", "task", x=200, y=0),
        ],
        edges=[_edge("e1", "a", "task", "b", "context")],
    )
    assert [t.id for t in order_tasks(g)] == ["orphan", "a", "b"]


def test_order_tasks_returns_empty_list_when_graph_has_no_tasks():
    g = CanvasGraph(nodes=[_node("crew_1", "crew"), _node("agent_1", "agent")], edges=[])
    assert order_tasks(g) == []


def test_find_cycle_detects_self_referencing_context_edge():
    g = CanvasGraph(
        nodes=[_node("a", "task")],
        edges=[_edge("e1", "a", "task", "a", "context")],
    )
    assert find_cycle(g) == ["a"]


def test_order_tasks_cycle_fallback_places_remaining_by_position_without_hanging():
    g = CanvasGraph(
        nodes=[
            _node("b", "task", x=100, y=0),
            _node("a", "task", x=0, y=0),
        ],
        edges=[
            _edge("e1", "a", "task", "b", "context"),
            _edge("e2", "b", "task", "a", "context"),
        ],
    )
    result = order_tasks(g)
    assert {t.id for t in result} == {"a", "b"}
    assert [t.id for t in result] == ["a", "b"]  # 사이클 폴백도 좌표순
