"""M2-T7 테스트: `adapters/llm.py` (Spec §5.3)."""

from __future__ import annotations

from app.adapters.llm import list_providers, provider_info_to_dict
from app.core.crewai_compat import PROVIDER_KEY_NAME, PROVIDER_PREFIX, SUPPORTED_PROVIDERS


def test_list_providers_covers_all_supported_providers():
    infos = list_providers()
    assert {i.provider for i in infos} == set(SUPPORTED_PROVIDERS)


def test_provider_prefix_and_key_name_match_crewai_compat():
    infos = {i.provider: i for i in list_providers()}
    for provider in SUPPORTED_PROVIDERS:
        assert infos[provider].litellm_prefix == PROVIDER_PREFIX[provider]
        assert infos[provider].key_name == PROVIDER_KEY_NAME.get(provider)


def test_ollama_and_openai_compatible_require_base_url():
    infos = {i.provider: i for i in list_providers()}
    assert infos["ollama"].requires_base_url is True
    assert infos["openai_compatible"].requires_base_url is True
    assert infos["openai"].requires_base_url is False


def test_openai_models_are_nonempty_preset_list():
    infos = {i.provider: i for i in list_providers()}
    assert "gpt-4o-mini" in infos["openai"].models


def test_provider_info_to_dict_uses_snake_case_keys():
    info = list_providers()[0]
    d = provider_info_to_dict(info)
    assert set(d.keys()) == {"provider", "litellm_prefix", "key_name", "models", "requires_base_url"}
