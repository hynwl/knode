"""M3-T5 테스트: `adapters/ollama.py` + `GET /api/v1/ollama/models` (Spec §13.1).

각 테스트는 서로 다른 host 문자열을 써서 모듈 전역 `_cache` 를 공유해도
간섭하지 않게 한다(캐시 자체를 검증하는 테스트만 예외).
"""

from __future__ import annotations

import requests
from fastapi.testclient import TestClient

from app.adapters import ollama as ollama_adapter
from app.main import app

client = TestClient(app)


class _FakeResponse:
    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")

    def json(self) -> dict:
        return self._payload


TAGS_PAYLOAD = {
    "models": [
        {
            "name": "llama3.1:8b",
            "size": 4700000000,
            "details": {"family": "llama"},
        },
        {"name": "qwen2.5:14b", "size": 9000000000, "details": {"family": "qwen2"}},
    ]
}


def test_fetch_success_parses_models(monkeypatch):
    monkeypatch.setattr(ollama_adapter.requests, "get", lambda *a, **k: _FakeResponse(TAGS_PAYLOAD))
    status = ollama_adapter.detect_ollama("http://host-success:11434", force=True)
    assert status.available is True
    assert status.reason is None
    assert [m.name for m in status.models] == ["llama3.1:8b", "qwen2.5:14b"]
    assert status.models[0].size_gb == 4.7
    assert status.models[0].family == "llama"


def test_fetch_connection_refused(monkeypatch):
    def _raise(*a, **k):
        raise requests.exceptions.ConnectionError("refused")

    monkeypatch.setattr(ollama_adapter.requests, "get", _raise)
    status = ollama_adapter.detect_ollama("http://host-refused:11434", force=True)
    assert status.available is False
    assert status.reason == "connection_refused"
    assert status.models == []


def test_fetch_timeout(monkeypatch):
    def _raise(*a, **k):
        raise requests.exceptions.Timeout("slow")

    monkeypatch.setattr(ollama_adapter.requests, "get", _raise)
    status = ollama_adapter.detect_ollama("http://host-timeout:11434", force=True)
    assert status.reason == "timeout"


def test_cache_within_ttl_skips_second_fetch(monkeypatch):
    calls = {"n": 0}

    def _get(*a, **k):
        calls["n"] += 1
        return _FakeResponse(TAGS_PAYLOAD)

    monkeypatch.setattr(ollama_adapter.requests, "get", _get)
    ollama_adapter.detect_ollama("http://host-cache:11434")
    ollama_adapter.detect_ollama("http://host-cache:11434")
    assert calls["n"] == 1


def test_force_bypasses_cache(monkeypatch):
    calls = {"n": 0}

    def _get(*a, **k):
        calls["n"] += 1
        return _FakeResponse(TAGS_PAYLOAD)

    monkeypatch.setattr(ollama_adapter.requests, "get", _get)
    ollama_adapter.detect_ollama("http://host-force:11434")
    ollama_adapter.detect_ollama("http://host-force:11434", force=True)
    assert calls["n"] == 2


def test_router_uses_settings_default_host_when_host_omitted(monkeypatch):
    seen = {}

    def _get(url, timeout):
        seen["url"] = url
        return _FakeResponse(TAGS_PAYLOAD)

    monkeypatch.setattr(ollama_adapter.requests, "get", _get)
    resp = client.get("/api/v1/ollama/models?force=true")
    assert resp.status_code == 200
    assert seen["url"] == "http://localhost:11434/api/tags"
    body = resp.json()
    assert body["available"] is True
    assert body["host"] == "http://localhost:11434"


def test_router_honors_host_query_param(monkeypatch):
    seen = {}

    def _get(url, timeout):
        seen["url"] = url
        raise requests.exceptions.ConnectionError("refused")

    monkeypatch.setattr(ollama_adapter.requests, "get", _get)
    resp = client.get("/api/v1/ollama/models?host=http://remote-ollama:11434&force=true")
    assert resp.status_code == 200
    assert seen["url"] == "http://remote-ollama:11434/api/tags"
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "connection_refused"
