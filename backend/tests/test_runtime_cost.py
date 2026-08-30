"""M2-T14 테스트: `runtime/cost.py` (Spec §3.5-20).

가격 테이블은 litellm이 갖고 있으므로 여기서는 우리 코드가 그 값을 올바르게
가져오고, 모르는 모델/토큰 0개일 때 안전하게 0.0으로 흡수하는지만 검증한다.
"""

from __future__ import annotations

import litellm

from app.runtime.cost import estimate_token_cost


def test_known_model_returns_positive_cost_matching_litellm():
    prompt_cost, completion_cost = litellm.cost_per_token(
        model="gpt-4o", prompt_tokens=1000, completion_tokens=500
    )
    expected = prompt_cost + completion_cost
    assert estimate_token_cost("gpt-4o", 1000, 500) == expected
    assert expected > 0


def test_unknown_model_returns_zero_without_raising():
    assert estimate_token_cost("not-a-real-model-xyz", 1000, 500) == 0.0


def test_none_model_returns_zero():
    assert estimate_token_cost(None, 1000, 500) == 0.0


def test_zero_tokens_returns_zero_without_calling_litellm(monkeypatch):
    def _boom(**kwargs):
        raise AssertionError("should not be called for zero tokens")

    monkeypatch.setattr("app.runtime.cost.litellm.cost_per_token", _boom)
    assert estimate_token_cost("gpt-4o", 0, 0) == 0.0


def test_ollama_local_model_is_free():
    assert estimate_token_cost("ollama/llama3.1", 1000, 500) == 0.0
