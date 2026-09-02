"""토큰 사용량 → 비용(USD) 추정기 (Spec §3.5-20, M2-T14).

가격 테이블을 직접 유지하지 않는다 — LLM 가격은 `adapters/llm.py`의 모델
프리셋과 같은 이유로 자주 바뀐다. litellm이 릴리스마다 갱신해 배포하는
`litellm.cost_per_token`(가격 데이터: `litellm.model_cost`, 3400+ 모델)을
그대로 참조한다. litellm은 이미 최상위 앱 의존성이다(RECON F1/F2,
`requirements.txt`에 명시 고정) — `crewai_compat.py`의 "CrewAI API 유일 통로"
원칙은 `from crewai import`에만 적용되고 litellm에는 적용되지 않는다
(`runtime/manager.py`의 `_classify_exception`도 동일하게 litellm을 직접 참조).

`callbacks.py`의 `llm_completed` 핸들러가 `token.usage` 이벤트를 만들 때 호출한다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import litellm

from app.compiler.graph import CanvasGraph
from app.core.crewai_compat import build_model_string

logger = logging.getLogger(__name__)


def estimate_token_cost(model: str | None, prompt_tokens: int, completion_tokens: int) -> float:
    """모델명 + 토큰 수 → USD 비용.

    가격 정보가 없는 모델(Ollama 로컬 모델, 신규/프리뷰 모델, 오타)은
    `litellm.cost_per_token`이 `(0.0, 0.0)`을 돌려주거나 예외를 던진다 — 두
    경우 모두 `0.0`으로 흡수한다. 비용 추정 실패가 실행을 막으면 안 된다
    (Spec §11.2 격리 원칙과 같은 결).
    """
    if not model or (prompt_tokens <= 0 and completion_tokens <= 0):
        return 0.0
    try:
        prompt_cost, completion_cost = litellm.cost_per_token(
            model=model, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )
    except Exception:  # noqa: BLE001 — 가격 정보 없는 모델도 실행은 계속되어야 한다
        logger.debug("cost lookup failed for model=%s", model, exc_info=True)
        return 0.0
    return float(prompt_cost) + float(completion_cost)


#: Dry Run(Spec §11.3) 텍스트 길이 → 토큰 어림 비율. 실제 토크나이저를 돌리지 않는다 —
#: LLM 호출 없이 즉시 반환해야 하므로 근사치면 충분하다("예상 비용"이지 정산액이 아니다).
_CHARS_PER_TOKEN = 4
#: role/goal/backstory/description 등 텍스트로 안 잡히는 시스템 프롬프트 오버헤드.
_PROMPT_TOKEN_OVERHEAD = 200
#: 실행 전이라 실제 출력 길이를 알 수 없으므로 태스크당 고정 완료 토큰을 가정한다.
_DEFAULT_COMPLETION_TOKENS = 500


@dataclass(frozen=True)
class DryRunTaskEstimate:
    node_id: str
    agent_node_id: str | None
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float


def estimate_dry_run(graph: CanvasGraph, task_order: list[str]) -> list[DryRunTaskEstimate]:
    """그래프 원본 텍스트만으로 태스크별 예상 토큰/비용을 어림한다.

    의도적으로 컴파일된 CrewAI `Task`/`Agent` 객체를 건드리지 않는다 — 그 객체들의
    속성명은 CrewAI 버전마다 바뀔 수 있다(RECON F1~F15). 여기서는 이미 검증된
    `CanvasGraph`(원본 노드 데이터)만 읽으므로 CrewAI 드리프트와 무관하게 동작한다.
    """
    estimates: list[DryRunTaskEstimate] = []
    for node_id in task_order:
        task_node = graph.node(node_id)
        if task_node is None:
            continue
        agent_nodes = graph.incoming(node_id, "agent")
        agent_node = agent_nodes[0] if agent_nodes else None

        text_len = len(str(task_node.data.get("description") or ""))
        text_len += len(str(task_node.data.get("expected_output") or ""))

        model: str | None = None
        if agent_node is not None:
            text_len += len(str(agent_node.data.get("backstory") or ""))
            text_len += len(str(agent_node.data.get("goal") or ""))
            llm_nodes = graph.incoming(agent_node.id, "llm")
            if llm_nodes:
                llm_data = llm_nodes[0].data
                provider = str(llm_data.get("provider") or "openai")
                model = build_model_string(provider, str(llm_data.get("model") or ""))

        prompt_tokens = _PROMPT_TOKEN_OVERHEAD + text_len // _CHARS_PER_TOKEN
        completion_tokens = _DEFAULT_COMPLETION_TOKENS
        estimates.append(DryRunTaskEstimate(
            node_id=node_id,
            agent_node_id=agent_node.id if agent_node else None,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=estimate_token_cost(model, prompt_tokens, completion_tokens),
        ))
    return estimates


__all__ = ["estimate_token_cost", "DryRunTaskEstimate", "estimate_dry_run"]
