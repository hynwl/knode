"""사이클 검출 + 위상 정렬 (Spec §5.5, §6.5, §8.1 [2]/[4]).

`frontend/src/validation/rules.ts` 의 `wouldCreateCycle`/`findCycle`/`orderTasks`
를 그대로 미러링한다 — Task 실행 순서 판정은 프론트(순번 배지 표시)와 백엔드
(Crew.tasks 리스트 구성)가 반드시 같은 결과를 내야 한다.

대상은 `context` 타입 엣지(`targetHandle == "context"`)만이다.
"""

from __future__ import annotations

from app.compiler.graph import CanvasGraph
from app.schemas.graph import AcNode

CONTEXT_HANDLE = "context"


def _context_adjacency(graph: CanvasGraph) -> dict[str, list[str]]:
    adj: dict[str, list[str]] = {}
    for e in graph.edges:
        if e.target_handle == CONTEXT_HANDLE:
            adj.setdefault(e.source, []).append(e.target)
    return adj


def would_create_cycle(graph: CanvasGraph, source: str, target: str) -> bool:
    """`source -> target` context 엣지를 **추가하기 전에** 호출해서 거부 판정에 쓴다."""
    if source == target:
        return True
    adj = _context_adjacency(graph)
    seen: set[str] = set()
    stack = [target]
    while stack:
        cur = stack.pop()
        if cur == source:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur, []))
    return False


def find_cycle(graph: CanvasGraph) -> list[str] | None:
    """`context` 엣지 그래프에서 사이클을 찾아 노드 id 경로로 반환한다. 없으면 None."""
    adj = _context_adjacency(graph)
    state: dict[str, int] = {}  # 0=미방문(기본) 1=진행중 2=완료
    path: list[str] = []
    found: list[str] | None = None

    def dfs(node_id: str) -> bool:
        nonlocal found
        state[node_id] = 1
        path.append(node_id)
        for nxt in adj.get(node_id, []):
            s = state.get(nxt, 0)
            if s == 1:
                found = path[path.index(nxt):]
                return True
            if s == 0 and dfs(nxt):
                return True
        path.pop()
        state[node_id] = 2
        return False

    for n in graph.nodes:
        if state.get(n.id, 0) == 0 and dfs(n.id):
            break
    return found


def _by_position(n: AcNode) -> tuple[float, float]:
    return (n.position.x, n.position.y)


def order_tasks(graph: CanvasGraph) -> list[AcNode]:
    """Task 실행 순서 (Spec §5.5).

    1. `context` 엣지로 위상 정렬.
    2. 동순위는 캔버스 (x, y) 오름차순 — 사용자의 시각적 배치를 의도로 간주.
    3. 사이클이 있으면(정상적으로는 검증기가 먼저 AC-E105 로 막음) 남은 노드를
       좌표순으로 밀어 넣는 폴백으로 무한루프를 피한다.
    """
    tasks = graph.nodes_of_type("task")
    by_id = {t.id: t for t in tasks}
    deps: dict[str, list[str]] = {
        t.id: [d.id for d in graph.incoming(t.id, CONTEXT_HANDLE) if d.id in by_id]
        for t in tasks
    }
    remaining = {t.id for t in tasks}
    placed: list[AcNode] = []

    while remaining:
        ready = [tid for tid in remaining if all(d not in remaining for d in deps.get(tid, []))]
        if not ready:
            rest = sorted((by_id[tid] for tid in remaining), key=_by_position)
            for t in rest:
                placed.append(t)
                remaining.discard(t.id)
            break
        ready_nodes = sorted((by_id[tid] for tid in ready), key=_by_position)
        for t in ready_nodes:
            placed.append(t)
            remaining.discard(t.id)
    return placed


__all__ = ["CONTEXT_HANDLE", "would_create_cycle", "find_cycle", "order_tasks"]
