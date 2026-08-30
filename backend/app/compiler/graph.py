"""그래프 조회 헬퍼 (Spec §8.1 [1] Normalize).

`frontend/src/validation/rules.ts` 의 그래프 헬퍼(`nodeById`/`incoming`/`outgoing`/
`nodesOfType`/`normalize`)를 백엔드에서 그대로 미러링한다 — 프론트가 백엔드 없이도
같은 판정을 내려야 하므로(Spec §9.4 MUST) 로직이 갈라지면 안 된다.

`normalize()`가 제외하는 "non-compilable" 타입은 `frontend/src/nodes/registry.ts`
에서 `compilable: false` 인 노드 종류(Note/Group)뿐이다. 그 외 노드별 세부 검증
(필수 필드, 카디널리티 등)은 M2-T4 `compiler/validators.py` 몫이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.graph import AcEdge, AcNode, CanvasDoc, NodeType

#: frontend/src/nodes/registry.ts 에서 compilable: false 인 노드 타입.
NON_COMPILABLE_NODE_TYPES: frozenset[str] = frozenset({"note", "group"})


@dataclass
class CanvasGraph:
    nodes: list[AcNode] = field(default_factory=list)
    edges: list[AcEdge] = field(default_factory=list)

    @classmethod
    def from_doc(cls, doc: CanvasDoc) -> CanvasGraph:
        return cls(nodes=list(doc.nodes), edges=list(doc.edges))

    def node(self, node_id: str) -> AcNode | None:
        for n in self.nodes:
            if n.id == node_id:
                return n
        return None

    def nodes_of_type(self, node_type: NodeType) -> list[AcNode]:
        """`ui.bypassed` 인 노드는 제외한다 (frontend `nodesOfType` 과 동일)."""
        return [n for n in self.nodes if n.type == node_type and not n.ui.bypassed]

    def single(self, node_type: NodeType) -> AcNode | None:
        """해당 타입의 첫 노드. 유일성 검증(0개/2개 이상)은 M2-T4 몫."""
        matches = self.nodes_of_type(node_type)
        return matches[0] if matches else None

    def incoming(self, node_id: str, handle: str) -> list[AcNode]:
        """특정 입력 포트로 들어오는 소스 노드들."""
        result = []
        for e in self.edges:
            if e.target == node_id and e.target_handle == handle:
                src = self.node(e.source)
                if src is not None:
                    result.append(src)
        return result

    def outgoing(self, node_id: str, handle: str) -> list[AcNode]:
        """특정 출력 포트에서 나가는 타깃 노드들."""
        result = []
        for e in self.edges:
            if e.source == node_id and e.source_handle == handle:
                tgt = self.node(e.target)
                if tgt is not None:
                    result.append(tgt)
        return result

    def normalize(self) -> CanvasGraph:
        """실행 대상 그래프 뷰 — bypass/비컴파일 노드 제거 + 고아 엣지 정리."""
        keep = {
            n.id for n in self.nodes
            if not n.ui.bypassed and n.type not in NON_COMPILABLE_NODE_TYPES
        }
        return CanvasGraph(
            nodes=[n for n in self.nodes if n.id in keep],
            edges=[e for e in self.edges if e.source in keep and e.target in keep],
        )


__all__ = ["NON_COMPILABLE_NODE_TYPES", "CanvasGraph"]
