"""M2-T1 스캐폴딩 테스트: 헬스체크 / CORS / 에러 봉투 / 로깅 마스킹."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.logging import mask_secrets, traceback_digest
from app.main import app

client = TestClient(app)


def test_health_returns_crewai_version():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "crewai_version" in body
    assert body["crewai_verified_version"] == "1.15.18"


def test_404_uses_error_envelope():
    resp = client.get("/api/v1/does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert "error" in body
    assert "request_id" in body
    assert body["error"]["code"] == "AC-E404"


def test_response_carries_request_id_header():
    resp = client.get("/api/v1/health")
    assert resp.headers["X-Request-Id"].startswith("req_")


def test_cors_rejects_disallowed_origin():
    resp = client.get(
        "/api/v1/health",
        headers={"Origin": "https://evil.example.com"},
    )
    assert "access-control-allow-origin" not in resp.headers


def test_cors_allows_configured_origin():
    resp = client.get(
        "/api/v1/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_mask_secrets_scrubs_known_key_shapes():
    text = (
        "key=sk-abcdefgh12345678 "
        "gemini=AIzaSyD123456789012345678901234567890 "
        "groq=gsk_abcdefghijklmnop "
        "auth=Bearer abc.def.ghi"
    )
    masked = mask_secrets(text)
    assert "sk-abcdefgh12345678" not in masked
    assert "sk-***" in masked
    assert "AIzaSyD123456789012345678901234567890" not in masked
    assert "AIza***" in masked
    assert "gsk_abcdefghijklmnop" not in masked
    assert "gsk_***" in masked
    assert "Bearer abc.def.ghi" not in masked
    assert "Bearer ***" in masked


def test_traceback_digest_masks_and_truncates():
    def inner():
        raise ValueError("token sk-abcdefgh12345678 leaked")

    try:
        inner()
    except ValueError as exc:
        digest = traceback_digest(exc, frames=3)
        assert "sk-abcdefgh12345678" not in digest
        assert "sk-***" in digest


def test_unhandled_exception_returns_masked_500():
    from fastapi import FastAPI
    from starlette.testclient import TestClient as _TC

    from app.core.errors import register_exception_handlers

    probe_app = FastAPI()
    register_exception_handlers(probe_app)

    @probe_app.get("/boom")
    async def _boom() -> dict:
        raise RuntimeError("secret sk-abcdefgh12345678 in trace")

    resp = _TC(probe_app, raise_server_exceptions=False).get("/boom")
    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "AC-E500"
    assert "sk-abcdefgh12345678" not in resp.text


def test_compilation_error_returns_422_with_full_issue_array():
    """Spec §9.3 MUST — 첫 에러만 주지 않고 errors 배열 전체를 돌려준다."""
    from fastapi import FastAPI
    from starlette.testclient import TestClient as _TC

    from app.core.errors import CompilationError, register_exception_handlers
    from app.schemas.errors import issue

    probe_app = FastAPI()
    register_exception_handlers(probe_app)

    @probe_app.get("/compile")
    async def _compile() -> dict:
        raise CompilationError([issue("AC-E101"), issue("AC-E107", node_id="crew_1")])

    resp = _TC(probe_app).get("/compile")
    assert resp.status_code == 422
    body = resp.json()
    assert [e["code"] for e in body["errors"]] == ["AC-E101", "AC-E107"]
    assert body["errors"][1]["nodeId"] == "crew_1"
    assert "request_id" in body
