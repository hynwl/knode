"""변수 보간 + 실행 입력 해석 (Spec §8.4).

CrewAI가 `{var}` 치환을 자체 지원하므로 이 모듈은 텍스트를 직접 바꾸지 않는다.
역할은 두 가지뿐이다.

1. Input 노드의 기본값과 사용자가 실행 시 제공한 `inputs` 를 합쳐
   `crew.kickoff(inputs=...)` 에 넘길 최종 dict 를 만든다.
2. `required` 인 Input 인데 값도 기본값도 없으면 AC-E302 이슈를 낸다 — 이건
   그래프만 보고는 판정할 수 없고 런타임 `inputs` 값에 의존하므로,
   정적 그래프만 보는 `validators.py` 가 아니라 컴파일 단계에서 확인한다.

`{var}` 패턴 탐지는 `validators.py` 의 `extract_vars` 를 그대로 재수출해 쓴다 —
두 곳에서 정규식이 갈리면 프론트/백엔드 판정이 어긋난다.
"""

from __future__ import annotations

from typing import Any

from app.compiler.graph import CanvasGraph
from app.compiler.validators import extract_vars
from app.schemas.errors import Issue, issue

__all__ = ["extract_vars", "resolve_inputs"]


def resolve_inputs(graph: CanvasGraph, provided: dict[str, Any]) -> tuple[dict[str, Any], list[Issue]]:
    """Input 노드 기본값 + `provided` 병합. 누락된 필수 입력은 AC-E302 로 보고한다."""
    resolved: dict[str, Any] = {}
    issues: list[Issue] = []

    for n in graph.nodes_of_type("input"):
        var_name = str(n.data.get("var_name") or "")
        if not var_name:
            continue

        value = provided.get(var_name)
        if value not in (None, ""):
            resolved[var_name] = value
            continue

        default_value = n.data.get("default_value")
        if default_value not in (None, ""):
            resolved[var_name] = default_value
            continue

        if n.data.get("required", True):
            label = n.data.get("label") or var_name
            issues.append(issue(
                "AC-E302", node_id=n.id, field="var_name",
                message=f'"{label}" 입력값이 필요합니다',
                # `label` 은 사용자가 Input 노드에 직접 쓴 값이라 번역 대상이 아니다 —
                # 프론트 `tk()` 는 i18n 키가 아닌 값을 그대로 통과시킨다.
                message_key="validation.inputRequired",
                params={"label": label},
            ))
        else:
            resolved[var_name] = ""

    return resolved, issues
