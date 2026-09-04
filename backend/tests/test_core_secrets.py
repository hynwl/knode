"""M2-T13 테스트: `core/secrets.py` (Spec §12.1, §12.2).

우선순위(헤더 > 서버 env), Base64/평문 JSON 파싱, 마스킹된 repr/str,
헤더 파싱 실패 시 500이 아니라 빈 값으로 흡수하는지를 검증한다.
"""

from __future__ import annotations

import base64
import json

from app.config import Settings
from app.core.secrets import SecretBundle, parse_secret_header


def _settings(**overrides) -> Settings:
    defaults = dict(
        openai_api_key=None,
        anthropic_api_key=None,
        gemini_api_key=None,
        groq_api_key=None,
        serper_api_key=None,
        openai_compatible_api_key=None,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _b64(payload: dict) -> str:
    return base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")


def test_no_header_no_server_fallback_yields_empty_bundle():
    bundle = parse_secret_header(None, _settings())
    assert bundle.get("OPENAI_API_KEY") is None


def test_base64_json_header_is_decoded():
    header = _b64({"OPENAI_API_KEY": "sk-test123"})
    bundle = parse_secret_header(header, _settings())
    assert bundle.get("OPENAI_API_KEY") == "sk-test123"


def test_plain_json_header_falls_back_when_not_base64():
    header = json.dumps({"OPENAI_API_KEY": "sk-plain"})
    bundle = parse_secret_header(header, _settings())
    assert bundle.get("OPENAI_API_KEY") == "sk-plain"


def test_header_key_overrides_server_fallback():
    settings = _settings(openai_api_key="server-side-key")
    header = _b64({"OPENAI_API_KEY": "header-side-key"})
    bundle = parse_secret_header(header, settings)
    assert bundle.get("OPENAI_API_KEY") == "header-side-key"


def test_server_fallback_used_when_header_missing_key():
    settings = _settings(serper_api_key="server-serper")
    header = _b64({"OPENAI_API_KEY": "sk-only-this"})
    bundle = parse_secret_header(header, settings)
    assert bundle.get("SERPER_API_KEY") == "server-serper"
    assert bundle.get("OPENAI_API_KEY") == "sk-only-this"


def test_openai_compatible_has_its_own_server_fallback():
    """OpenAI 본계정 키와 자체 호스팅 엔드포인트 키는 서버 env 에서도 분리된다."""
    settings = _settings(openai_api_key="sk-real", openai_compatible_api_key="local-key")
    bundle = parse_secret_header(None, settings)
    assert bundle.get("OPENAI_COMPATIBLE_API_KEY") == "local-key"
    assert bundle.get("OPENAI_API_KEY") == "sk-real"


def test_custom_key_slot_ids_pass_through_the_header_untouched():
    """헤더 페이로드의 키는 키 이름이 아니라 **슬롯 id** 다 (`OPENAI_API_KEY#work`)."""
    header = _b64({"OPENAI_API_KEY#work": "sk-work"})
    bundle = parse_secret_header(header, _settings(openai_api_key="sk-personal"))
    assert bundle.get("OPENAI_API_KEY#work") == "sk-work"
    # 커스텀 슬롯은 서버 env 로 채워지지 않는다 — 기본 슬롯만 폴백을 받는다.
    assert bundle.get("OPENAI_API_KEY") == "sk-personal"
    assert bundle.get("OPENAI_API_KEY#other") is None


def test_malformed_header_does_not_raise():
    bundle = parse_secret_header("not json and not base64 {{{", _settings(openai_api_key="fallback"))
    assert bundle.get("OPENAI_API_KEY") == "fallback"


def test_non_dict_json_header_is_ignored():
    header = base64.b64encode(json.dumps(["not", "a", "dict"]).encode()).decode()
    bundle = parse_secret_header(header, _settings())
    assert bundle.get("OPENAI_API_KEY") is None


def test_repr_and_str_never_expose_values():
    bundle = SecretBundle({"OPENAI_API_KEY": "sk-super-secret-value"})
    assert "sk-super-secret-value" not in repr(bundle)
    assert "sk-super-secret-value" not in str(bundle)
    assert "OPENAI_API_KEY" in repr(bundle)


def test_clear_empties_bundle():
    bundle = SecretBundle({"OPENAI_API_KEY": "sk-x"})
    bundle.clear()
    assert bundle.get("OPENAI_API_KEY") is None


def test_get_with_none_key_returns_none():
    bundle = SecretBundle({"OPENAI_API_KEY": "sk-x"})
    assert bundle.get(None) is None
