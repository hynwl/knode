"""`adapters/provider_models.py` + `GET /api/v1/providers/{provider}/models`.

등록된 BYOK 키로 프로바이더의 **실제 사용 가능 모델**을 조회하는 경로다.
정적 프리셋(`adapters/llm.py`)과 달리 키가 있어야 하고, 실패를 HTTP 에러가 아니라
`reason` 으로 돌려준다 — 프론트 드롭다운이 "키를 등록하세요"와 "키가 거부됐다"에
서로 다른 안내를 띄워야 하기 때문이다.

네트워크는 전부 모킹한다. 실제 프로바이더를 때리면 테스트가 키와 요금에 묶인다.
"""

from __future__ import annotations

import base64
import json

import pytest
import requests
from fastapi.testclient import TestClient

from app.adapters import provider_models as pm
from app.core.crewai_compat import PROVIDER_KEY_NAME
from app.core.secrets import HEADER_NAME
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_cache():
    pm.clear_cache()
    yield
    pm.clear_cache()


class _FakeResponse:
    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            err = requests.HTTPError(f"HTTP {self.status_code}")
            err.response = self  # type: ignore[assignment]
            raise err

    def json(self) -> dict:
        return self._payload


def _header(payload: dict[str, str]) -> dict[str, str]:
    return {HEADER_NAME: base64.b64encode(json.dumps(payload).encode()).decode()}


# ────────────────────────── 어댑터: 조회 대상 판정 ──────────────────────────


def test_no_key_is_its_own_reason():
    """키 미등록은 실패가 아니라 **안내 사유**다 — 프론트가 "먼저 등록하세요"를 띄운다."""
    status = pm.list_provider_models("openai", None)
    assert status.available is False
    assert status.reason == "no_key"
    assert status.models == []


def test_ollama_is_not_probed_here():
    """Ollama 는 `adapters/ollama.py` 가 설치 목록을 따로 감지한다."""
    assert pm.list_provider_models("ollama", "whatever").reason == "not_probeable"


def test_openai_compatible_is_not_probed():
    """임의 `base_url` 로 백엔드가 GET 을 대신 쏘면 SSRF 오라클이 된다 (모듈 주석)."""
    assert pm.is_probeable("openai_compatible") is False
    assert pm.list_provider_models("openai_compatible", "sk-x").reason == "not_probeable"


def test_unknown_provider():
    assert pm.list_provider_models("nope", "sk-x").reason == "unsupported_provider"


# ────────────────────────── 어댑터: 성공/실패 분류 ──────────────────────────


def test_openai_models_are_sorted_and_deduped(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        assert url == "https://api.openai.com/v1/models"
        assert headers["Authorization"] == "Bearer sk-real"
        return _FakeResponse({"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}, {"id": "gpt-4o"}]})

    monkeypatch.setattr(pm.requests, "get", fake_get)
    status = pm.list_provider_models("openai", "sk-real")
    assert status.available is True
    assert status.models == ["gpt-4o", "gpt-4o-mini"]


def test_anthropic_sends_version_header(monkeypatch):
    seen: dict = {}

    def fake_get(url, headers=None, timeout=None):
        seen.update(headers)
        return _FakeResponse({"data": [{"id": "claude-3-5-haiku-latest"}]})

    monkeypatch.setattr(pm.requests, "get", fake_get)
    assert pm.list_provider_models("anthropic", "sk-ant-x").models == ["claude-3-5-haiku-latest"]
    assert seen["anthropic-version"] == "2023-06-01"
    assert seen["x-api-key"] == "sk-ant-x"


def test_gemini_strips_prefix_and_drops_non_generative(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        return _FakeResponse({"models": [
            {"name": "models/gemini-2.0-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
        ]})

    monkeypatch.setattr(pm.requests, "get", fake_get)
    # litellm 이 기대하는 건 `models/` 접두사가 없는 쪽이고, 임베딩 전용은 LLM 노드에서 고를 수 없다.
    assert pm.list_provider_models("gemini", "AIza-x").models == ["gemini-2.0-flash"]


@pytest.mark.parametrize(
    ("status_code", "expected"),
    [(401, "invalid_key"), (403, "invalid_key"), (429, "rate_limited"), (500, "unknown")],
)
def test_http_errors_are_classified(monkeypatch, status_code, expected):
    monkeypatch.setattr(
        pm.requests, "get", lambda *a, **k: _FakeResponse({}, status=status_code)
    )
    status = pm.list_provider_models("openai", "sk-bad")
    assert status.available is False
    assert status.reason == expected


def test_timeout_and_connection_errors(monkeypatch):
    def boom(*a, **k):
        raise requests.Timeout()

    monkeypatch.setattr(pm.requests, "get", boom)
    assert pm.list_provider_models("openai", "sk-x").reason == "timeout"

    def refused(*a, **k):
        raise requests.ConnectionError()

    monkeypatch.setattr(pm.requests, "get", refused)
    assert pm.list_provider_models("groq", "gsk_x").reason == "connection_failed"


# ────────────────────────────── 캐시 동작 ──────────────────────────────


def test_success_is_cached_but_failure_is_not(monkeypatch):
    calls = {"n": 0}

    def fake_get(*a, **k):
        calls["n"] += 1
        return _FakeResponse({"data": [{"id": "gpt-4o-mini"}]})

    monkeypatch.setattr(pm.requests, "get", fake_get)
    pm.list_provider_models("openai", "sk-a")
    pm.list_provider_models("openai", "sk-a")
    assert calls["n"] == 1, "성공은 캐시되어야 한다"

    def failing(*a, **k):
        raise requests.Timeout()

    monkeypatch.setattr(pm.requests, "get", failing)
    pm.clear_cache()
    pm.list_provider_models("openai", "sk-a")
    pm.list_provider_models("openai", "sk-a")
    # 실패를 캐시하면 키를 고쳐 넣어도 사용자가 결과를 못 본다.
    assert calls["n"] == 1


def test_different_keys_do_not_share_cache(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, headers=None, timeout=None):
        calls["n"] += 1
        return _FakeResponse({"data": [{"id": f"model-{calls['n']}"}]})

    monkeypatch.setattr(pm.requests, "get", fake_get)
    assert pm.list_provider_models("openai", "sk-a").models == ["model-1"]
    assert pm.list_provider_models("openai", "sk-b").models == ["model-2"]


def test_force_bypasses_cache(monkeypatch):
    calls = {"n": 0}

    def fake_get(*a, **k):
        calls["n"] += 1
        return _FakeResponse({"data": [{"id": "gpt-4o-mini"}]})

    monkeypatch.setattr(pm.requests, "get", fake_get)
    pm.list_provider_models("openai", "sk-a")
    pm.list_provider_models("openai", "sk-a", force=True)
    assert calls["n"] == 2


# ────────────────────────────── 라우터 ──────────────────────────────


def test_route_without_header_reports_no_key():
    res = client.get("/api/v1/providers/openai/models")
    assert res.status_code == 200, "실패도 200 + reason 이어야 프론트가 백엔드 다운과 구분한다"
    assert res.json()["reason"] in {"no_key", "invalid_key"}


def test_route_uses_default_slot(monkeypatch):
    monkeypatch.setattr(
        pm.requests, "get", lambda *a, **k: _FakeResponse({"data": [{"id": "gpt-4o-mini"}]})
    )
    res = client.get(
        "/api/v1/providers/openai/models",
        headers=_header({"OPENAI_API_KEY": "sk-real"}),
    )
    body = res.json()
    assert body["available"] is True
    assert body["models"] == ["gpt-4o-mini"]


def test_route_uses_named_slot(monkeypatch):
    seen: dict = {}

    def fake_get(url, headers=None, timeout=None):
        seen["auth"] = headers.get("Authorization")
        return _FakeResponse({"data": [{"id": "gpt-4o"}]})

    monkeypatch.setattr(pm.requests, "get", fake_get)
    res = client.get(
        "/api/v1/providers/openai/models",
        params={"key_ref": "OPENAI_API_KEY#work"},
        headers=_header({"OPENAI_API_KEY": "sk-default", "OPENAI_API_KEY#work": "sk-work"}),
    )
    assert res.json()["available"] is True
    assert seen["auth"] == "Bearer sk-work", "노드가 지목한 슬롯의 키를 써야 한다"


def test_route_does_not_fall_back_to_default_slot(monkeypatch):
    """`compiler._build_llm` 과 같은 규칙 — 지목한 슬롯이 없으면 기본 키로 폴백하지 않는다.

    폴백하면 사용자가 고르지 않은 계정의 키가 조회에 쓰인다.
    """
    monkeypatch.setattr(pm.requests, "get", lambda *a, **k: _FakeResponse({"data": []}))
    res = client.get(
        "/api/v1/providers/openai/models",
        params={"key_ref": "OPENAI_API_KEY#gone"},
        headers=_header({"OPENAI_API_KEY": "sk-default"}),
    )
    assert res.json()["reason"] == "no_key"


def test_route_never_echoes_the_key(monkeypatch):
    monkeypatch.setattr(
        pm.requests, "get", lambda *a, **k: _FakeResponse({"data": [{"id": "gpt-4o-mini"}]})
    )
    res = client.get(
        "/api/v1/providers/openai/models",
        headers=_header({"OPENAI_API_KEY": "sk-supersecret-value"}),
    )
    assert "sk-supersecret-value" not in res.text


def test_probeable_set_matches_key_bearing_providers():
    """조회 대상 표가 프론트 미러(`useProviderModels`)와 어긋나지 않게 고정한다.

    키가 필요한 프로바이더 = 조회 대상 + `openai_compatible`(SSRF 로 제외) 뿐이어야 한다.
    """
    key_bearing = {p for p, k in PROVIDER_KEY_NAME.items() if k}
    assert set(pm.FETCHERS) == key_bearing - {"openai_compatible"}
