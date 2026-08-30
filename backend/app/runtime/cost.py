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

import litellm

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


__all__ = ["estimate_token_cost"]
