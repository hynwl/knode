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
    # ⚠️ StarletteHTTPException 핸들러는 코드를 `f"AC-E{status_code}"`로 만든다 —
    # 그래서 HTTP 404가 카탈로그의 AC-E404("파일에 API 키가 포함되어 있습니다")와
    # **문자열이 겹친다**. 라우팅 404는 그래프 이슈가 아니라 node_id도 hint도
    # 없으므로 프론트가 노드 하이라이팅을 시도하지 않는다는 것으로 구분한다.
    assert body["error"]["code"] == "AC-E404"
    assert "node_id" not in body["error"]
    assert "hint" not in body["error"]


# --- AC-E001: 요청 스키마 위반 (core/errors.py RequestValidationError 핸들러) ---
#
# ⚠️ 모듈 상단의 `client = TestClient(app)`는 lifespan을 돌리지 않는다(Starlette는
# context manager 안에서만 startup을 실행한다). `/runs`는 lifespan이 만드는
# `app.state.run_manager`를 의존성으로 잡으므로 반드시 `with TestClient(app)`로
# 열어야 한다 — 안 그러면 422 대신 AttributeError → 500이 난다.
# (`test_routers_runs.py`가 같은 이유로 전부 `with` 형태를 쓴다.)

def test_malformed_request_body_returns_422_ac_e001_envelope():
    with TestClient(app) as c:
        resp = c.post("/api/v1/runs", json={"graph": {"nodes": "not-a-list"}})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "AC-E001"
    assert body["error"]["severity"] == "error"
    assert body["error"]["hint"]
    assert body["error"]["docs_url"].endswith("#AC-E001")
    assert body["request_id"]


def test_ac_e001_points_at_the_offending_field_path():
    with TestClient(app) as c:
        resp = c.post("/api/v1/runs", json={})
    assert resp.status_code == 422
    field = resp.json()["error"]["field"]
    assert field and "graph" in field


def test_ac_e001_is_the_envelope_shape_not_the_issue_array_shape():
    """`POST /runs`의 422는 두 종류다 — 요청 스키마 위반(AC-E001, `error` 봉투)과
    그래프 검증 실패(`errors` 배열, Spec §9.3 MUST). 프론트가 둘을 구분해야 하므로
    모양이 섞이지 않는지 고정한다."""
    with TestClient(app) as c:
        resp = c.post("/api/v1/runs", json={"graph": 123})
    body = resp.json()
    assert "error" in body and "errors" not in body


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
