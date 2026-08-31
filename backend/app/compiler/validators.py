"""구조/의미 검증기 — AC-Exxx 전량 (Spec §22.1, §8.1 [2] Structural + [3] Semantic).

`frontend/src/validation/rules.ts` 의 `validateGraph()` 를 그대로 미러링한다.
백엔드가 꺼져 있어도 프론트 자체 검증은 항상 동작해야 하므로(Spec §9.4 MUST),
같은 그래프에 대해 두 구현이 같은 이슈를 내야 한다 — 로직을 분기하지 말 것.

Structural([2])과 Semantic([3])을 프론트처럼 한 함수(`validate_graph`)로 합친다.
"""

from __future__ import annotations

import re

from app.compiler.graph import CanvasGraph
from app.compiler.topology import find_cycle
from app.schemas.errors import Issue, issue
from app.schemas.graph import CanvasDoc

#: frontend/src/nodes/registry.ts NODE_DEFINITIONS 에서 required: true 인 필드만 추린
#: 최소 미러 — 검증기가 실제로 쓰는 정보(필드 키 + 표시 라벨)만 옮기고, kind/options 등
#: UI 전용 메타데이터는 옮기지 않는다 (Spec §5.1-1 과설계 금지 정신).
REQUIRED_FIELDS: dict[str, list[tuple[str, str]]] = {
    "llm": [("provider", "프로바이더"), ("model", "모델")],
    "agent": [("role", "역할 (Role)"), ("goal", "목표 (Goal)"), ("backstory", "배경 (Backstory)")],
    "task": [("description", "작업 설명"), ("expected_output", "기대 산출물")],
    "tool": [("tool_id", "툴 종류")],
    "crew": [("process", "실행 방식")],
    "input": [("var_name", "변수명"), ("label", "표시 라벨")],
}

#: frontend/src/nodes/registry.ts NODE_DEFINITIONS[type].label
NODE_LABEL: dict[str, str] = {
    "llm": "LLM", "agent": "Agent", "task": "Task", "tool": "Tool", "crew": "Crew",
    "input": "Input", "output": "Output", "knowledge": "Knowledge", "memory": "Memory",
    "human": "Human Input", "router": "Router", "guardrail": "Guardrail",
    "note": "Note", "group": "Group",
}

#: frontend/src/nodes/registry.ts 에서 disabledInV1: true
DISABLED_IN_V1: frozenset[str] = frozenset({"router", "guardrail"})

#: Spec §8.4. `{var}` 는 잡고 `{{var}}` 는 무시한다.
VAR_PATTERN = re.compile(r"(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})")
VAR_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def extract_vars(text: str) -> list[str]:
    return VAR_PATTERN.findall(text or "")


def validate_graph(doc: CanvasDoc) -> list[Issue]:
    issues: list[Issue] = []
    g = CanvasGraph.from_doc(doc).normalize()

    # --- E1xx 그래프 구조 ---
    crews = g.nodes_of_type("crew")
    if not crews:
        issues.append(issue("AC-E101"))
    for extra in crews[1:]:
        issues.append(issue("AC-E102", node_id=extra.id))

    crew = crews[0] if crews else None
    if crew is not None:
        crew_tasks = g.incoming(crew.id, "task")
        if not crew_tasks:
            issues.append(issue("AC-E107", node_id=crew.id))
        if crew.data.get("process") == "hierarchical" and not g.incoming(crew.id, "llm"):
            issues.append(issue("AC-E103", node_id=crew.id, field="process"))

        linked_agents = {n.id for n in g.incoming(crew.id, "agent")}
        linked_tasks = {n.id for n in crew_tasks}
        for n in g.nodes:
            if n.type == "agent" and n.id not in linked_agents:
                issues.append(issue("AC-W104", node_id=n.id))
            if n.type == "task" and n.id not in linked_tasks:
                issues.append(issue("AC-W104", node_id=n.id))

    cycle = find_cycle(g)
    if cycle:
        for node_id in cycle:
            issues.append(issue("AC-E105", node_id=node_id))

    # --- E2xx 노드 설정 ---
    for n in g.nodes:
        label = NODE_LABEL.get(n.type, n.type)
        for field_key, field_label in REQUIRED_FIELDS.get(n.type, []):
            value = n.data.get(field_key)
            if value is None or str(value).strip() == "":
                code = (
                    "AC-E204"
                    if n.type == "task" and field_key in ("description", "expected_output")
                    else "AC-E201"
                )
                issues.append(issue(
                    code, node_id=n.id, field=field_key,
                    message=f'{label}: "{field_label}" 이(가) 비어 있습니다',
                ))

        if n.type == "task" and not g.incoming(n.id, "agent"):
            issues.append(issue("AC-E202", node_id=n.id))
        if n.type == "agent":
            has_task = any(e.source == n.id and e.target_handle == "agent" for e in g.edges)
            if not has_task and not n.data.get("allow_delegation"):
                issues.append(issue("AC-W203", node_id=n.id))
            llm_node = next(iter(g.incoming(n.id, "llm")), None)
            if g.incoming(n.id, "tool") and llm_node is not None and llm_node.data.get("provider") == "ollama":
                issues.append(issue("AC-W701", node_id=n.id))
        if n.type == "input":
            var_name = str(n.data.get("var_name") or "")
            if var_name and not VAR_NAME_PATTERN.match(var_name):
                issues.append(issue("AC-E303", node_id=n.id, field="var_name"))
        if n.type in DISABLED_IN_V1:
            issues.append(issue(
                "AC-W104", node_id=n.id, severity="warn",
                message=f"{label} 노드는 v1.0 에서 실행되지 않습니다",
                hint="v1.1 에서 지원 예정입니다. 실행에서 제외됩니다.",
            ))

    # --- E3xx 변수 보간 ---
    declared = {str(n.data.get("var_name") or "") for n in g.nodes_of_type("input")}
    for t in g.nodes_of_type("task"):
        used = set(extract_vars(str(t.data.get("description") or ""))) | set(
            extract_vars(str(t.data.get("expected_output") or ""))
        )
        for v in used:
            if v not in declared:
                issues.append(issue(
                    "AC-W301", node_id=t.id, field="description",
                    message=f"정의되지 않은 변수 {{{v}}} 를 참조합니다",
                ))
    for a in g.nodes_of_type("agent"):
        for v in set(extract_vars(str(a.data.get("goal") or ""))):
            if v not in declared:
                issues.append(issue(
                    "AC-W301", node_id=a.id, field="goal",
                    message=f"정의되지 않은 변수 {{{v}}} 를 참조합니다",
                ))

    return issues


__all__ = [
    "REQUIRED_FIELDS", "NODE_LABEL", "DISABLED_IN_V1",
    "VAR_PATTERN", "VAR_NAME_PATTERN", "extract_vars", "validate_graph",
]
