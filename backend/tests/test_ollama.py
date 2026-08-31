"""M3-T5 테스트: `adapters/ollama.py` + `GET /api/v1/ollama/models` (Spec §13.1).

각 테스트는 서로 다른 host 문자열을 써서 모듈 전역 `_cache` 를 공유해도
간섭하지 않게 한다(캐시 자체를 검증하는 테스트만 예외). host 는 전부
**IP 리터럴**이라 사전 검사(`assert_allowed_host`)가 실제 DNS 를 타지 않는다.

보안 후속수정(2026-08-31) 이후: 백엔드가 대신 조회해줄 수 있는 호스트는
루프백/사설망뿐이다. 아래 `test_policy_*` / `test_adapter_*` 가 그 정책을 고정한다.
"""

from __future__ import annotations

import socket

import pytest
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


# ---------------------------------------------------------------------------
# 기존 동작 — 파싱 / 실패 사유 / 캐시
# ---------------------------------------------------------------------------

def test_fetch_success_parses_models(monkeypatch):
    monkeypatch.setattr(ollama_adapter, "_get", lambda url: _FakeResponse(TAGS_PAYLOAD))
    status = ollama_adapter.detect_ollama("http://10.90.0.1:11434", force=True)
    assert status.available is True
    assert status.reason is None
    assert [m.name for m in status.models] == ["llama3.1:8b", "qwen2.5:14b"]
    assert status.models[0].size_gb == 4.7
    assert status.models[0].family == "llama"


def test_fetch_connection_refused(monkeypatch):
    def _raise(url):
        raise requests.exceptions.ConnectionError("refused")

    monkeypatch.setattr(ollama_adapter, "_get", _raise)
    status = ollama_adapter.detect_ollama("http://10.90.0.2:11434", force=True)
    assert status.available is False
    assert status.reason == "connection_refused"
    assert status.models == []


def test_fetch_timeout(monkeypatch):
    def _raise(url):
        raise requests.exceptions.Timeout("slow")

    monkeypatch.setattr(ollama_adapter, "_get", _raise)
    status = ollama_adapter.detect_ollama("http://10.90.0.3:11434", force=True)
    assert status.reason == "timeout"


def test_fetch_http_error_is_unknown(monkeypatch):
    monkeypatch.setattr(ollama_adapter, "_get", lambda url: _FakeResponse({}, status=500))
    status = ollama_adapter.detect_ollama("http://10.90.0.4:11434", force=True)
    assert status.reason == "unknown"


def test_cache_within_ttl_skips_second_fetch(monkeypatch):
    calls = {"n": 0}

    def _get(url):
        calls["n"] += 1
        return _FakeResponse(TAGS_PAYLOAD)

    monkeypatch.setattr(ollama_adapter, "_get", _get)
    ollama_adapter.detect_ollama("http://10.91.0.1:11434")
    ollama_adapter.detect_ollama("http://10.91.0.1:11434")
    assert calls["n"] == 1


def test_force_bypasses_cache(monkeypatch):
    calls = {"n": 0}

    def _get(url):
        calls["n"] += 1
        return _FakeResponse(TAGS_PAYLOAD)

    monkeypatch.setattr(ollama_adapter, "_get", _get)
    ollama_adapter.detect_ollama("http://10.91.0.2:11434")
    ollama_adapter.detect_ollama("http://10.91.0.2:11434", force=True)
    assert calls["n"] == 2


def test_router_uses_settings_default_host_when_host_omitted(monkeypatch):
    seen = {}

    def _get(url):
        seen["url"] = url
        return _FakeResponse(TAGS_PAYLOAD)

    monkeypatch.setattr(ollama_adapter, "_get", _get)
    resp = client.get("/api/v1/ollama/models?force=true")
    assert resp.status_code == 200
    assert seen["url"] == "http://localhost:11434/api/tags"
    body = resp.json()
    assert body["available"] is True
    assert body["host"] == "http://localhost:11434"


def test_router_honors_host_query_param(monkeypatch):
    """Spec §13.3 — LAN 의 원격 Ollama 는 계속 조회할 수 있어야 한다."""
    seen = {}

    def _get(url):
        seen["url"] = url
        raise requests.exceptions.ConnectionError("refused")

    monkeypatch.setattr(ollama_adapter, "_get", _get)
    resp = client.get("/api/v1/ollama/models?host=http://192.168.1.50:11434&force=true")
    assert resp.status_code == 200
    assert seen["url"] == "http://192.168.1.50:11434/api/tags"
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "connection_refused"


# ---------------------------------------------------------------------------
# 보안 후속수정 — 대역 화이트리스트 (SSRF / 내부망 스캔 오라클 차단)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ip", [
    "127.0.0.1", "127.1.2.3",          # 루프백 (기본 시나리오)
    "10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.50",  # RFC1918 LAN
    "::1", "fd00::1",                  # IPv6 루프백 / ULA
    "::ffff:10.0.0.1",                 # IPv4-mapped 사설
])
def test_policy_allows_loopback_and_private(ip):
    assert ollama_adapter.is_allowed_ip(ip) is True


@pytest.mark.parametrize("ip", [
    "169.254.169.254",                 # ★ 클라우드 메타데이터 (is_private 가 True 라 못 막는다)
    "169.254.0.1", "::ffff:169.254.169.254", "fe80::1",  # 링크로컬 전반
    "8.8.8.8", "1.1.1.1",              # 공인 IP
    "172.32.0.1", "172.15.0.1",        # RFC1918 경계 바깥
    "100.64.0.1",                      # CGNAT — LAN 이 아니다
    "0.0.0.0", "255.255.255.255", "224.0.0.1",  # unspecified / broadcast / multicast
    "2001:4860:4860::8888",            # 공인 IPv6
    "not-an-ip", "",
])
def test_policy_rejects_link_local_and_public(ip):
    assert ollama_adapter.is_allowed_ip(ip) is False


@pytest.mark.parametrize("host", [
    "file:///etc/passwd",
    "gopher://10.0.0.1:11434",
    "ftp://10.0.0.1",
    "http://",
    "http://user:pw@10.0.0.1:11434",
    "http://10.0.0.1:11434/../../admin",
    "http://10.0.0.1:11434?x=1",
    "http://10.0.0.1:99999",           # 포트 파싱 실패
    "http://169.254.169.254",          # 클라우드 메타데이터
    "http://8.8.8.8:11434",            # 공인 IP
])
def test_assert_allowed_host_rejects(host):
    with pytest.raises(ollama_adapter.HostNotAllowedError):
        ollama_adapter.assert_allowed_host(host)


@pytest.mark.parametrize("host", [
    "http://127.0.0.1:11434",
    "http://192.168.0.42:11434",
    "https://10.1.2.3:11434",
    "http://[::1]:11434",
    "http://10.0.0.1",                 # 포트 생략
    "http://10.0.0.1/",                # 트레일링 슬래시
])
def test_assert_allowed_host_accepts(host):
    ollama_adapter.assert_allowed_host(host)


def test_assert_allowed_host_rejects_domain_resolving_to_public(monkeypatch):
    """DNS 이름도 해석 결과로 판정한다 — `myollama.example.com` → 공인 IP 면 거부."""
    monkeypatch.setattr(
        ollama_adapter.socket, "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 11434))],
    )
    with pytest.raises(ollama_adapter.HostNotAllowedError):
        ollama_adapter.assert_allowed_host("http://myollama.example.com:11434")


def test_assert_allowed_host_accepts_domain_resolving_to_lan(monkeypatch):
    """`myollama.local` 처럼 사설 IP 로 도는 LAN 이름은 허용한다 (Spec §13.3)."""
    monkeypatch.setattr(
        ollama_adapter.socket, "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.50", 11434))],
    )
    ollama_adapter.assert_allowed_host("http://myollama.local:11434")


def test_assert_allowed_host_rejects_mixed_dns_round_robin(monkeypatch):
    """한 이름이 사설 + 공인 IP 를 같이 내놓으면 거부한다(라운드로빈 우회 차단)."""
    monkeypatch.setattr(
        ollama_adapter.socket, "getaddrinfo",
        lambda *a, **k: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.50", 11434)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 11434)),
        ],
    )
    with pytest.raises(ollama_adapter.HostNotAllowedError):
        ollama_adapter.assert_allowed_host("http://rebind.example.com:11434")


@pytest.mark.parametrize("host", [
    "http://169.254.169.254",          # AWS/GCP 메타데이터
    "http://169.254.169.254:80/latest/meta-data",
    "http://8.8.8.8:11434",
    "http://10.0.0.1:22@evil.example.com",  # 호스트는 evil.example.com 이다
])
def test_router_rejects_disallowed_host_without_any_request(monkeypatch, host):
    """거부 케이스는 소켓을 아예 열지 않는다 — 포트스캔 오라클이 생기지 않도록."""
    def _boom(url):  # pragma: no cover - 호출되면 실패해야 한다
        raise AssertionError(f"차단된 호스트로 요청이 나갔다: {url}")

    monkeypatch.setattr(ollama_adapter, "_get", _boom)
    resp = client.get("/api/v1/ollama/models", params={"host": host, "force": "true"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "host_not_allowed"
    assert body["models"] == []


def test_router_rejects_external_domain(monkeypatch):
    monkeypatch.setattr(
        ollama_adapter.socket, "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))],
    )
    monkeypatch.setattr(ollama_adapter, "_get", lambda url: pytest.fail("요청이 나가면 안 된다"))
    resp = client.get("/api/v1/ollama/models?host=http://evil.example.com&force=true")
    assert resp.json()["reason"] == "host_not_allowed"


def test_unresolvable_host_reports_connection_refused(monkeypatch):
    """이름 해석 실패는 정책 위반이 아니라 '연결 불가'다."""
    def _boom(*a, **k):
        raise socket.gaierror("nope")

    monkeypatch.setattr(ollama_adapter.socket, "getaddrinfo", _boom)
    status = ollama_adapter.detect_ollama("http://nx.example.invalid:11434", force=True)
    assert status.reason == "connection_refused"


def test_connect_time_rebinding_is_reported_as_host_not_allowed(monkeypatch):
    """사전 검사를 통과해도 소켓 레벨에서 막히면 `host_not_allowed` 로 떨어진다."""
    def _raise(url):
        raise ollama_adapter.HostNotAllowedError("peer 8.8.8.8")

    monkeypatch.setattr(ollama_adapter, "_get", _raise)
    status = ollama_adapter.detect_ollama("http://10.92.0.1:11434", force=True)
    assert status.reason == "host_not_allowed"


# ---------------------------------------------------------------------------
# 소켓 레벨 가드 — urllib3 확장 지점 드리프트 캐너리 포함
# ---------------------------------------------------------------------------

class _FakeConn:
    """`urllib3.connection.HTTPConnection` 중 `_open_allowed_socket` 이 쓰는 속성만."""

    def __init__(self, host: str, port: int, timeout: float | None = 1.0):
        self.host = host
        self._dns_host = host
        self.port = port
        self.timeout = timeout
        self.socket_options = None
        self.source_address = None


def test_adapter_socket_connects_to_loopback():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    try:
        sock = ollama_adapter._open_allowed_socket(_FakeConn("127.0.0.1", server.getsockname()[1]))
        assert ollama_adapter.is_allowed_ip(str(sock.getpeername()[0]))
        sock.close()
    finally:
        server.close()


def test_adapter_socket_refuses_public_peer():
    with pytest.raises(ollama_adapter.HostNotAllowedError):
        ollama_adapter._open_allowed_socket(_FakeConn("8.8.8.8", 11434))


def test_adapter_socket_wraps_refused_connection():
    from urllib3.exceptions import NewConnectionError

    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()  # 아무도 안 듣는 포트
    with pytest.raises(NewConnectionError):
        ollama_adapter._open_allowed_socket(_FakeConn("127.0.0.1", port))


def test_adapter_socket_default_timeout_for_sentinel():
    """urllib3 의 `_DEFAULT_TIMEOUT` 센티널이 와도 터지지 않는다."""
    assert ollama_adapter._connect_timeout(object()) == socket.getdefaulttimeout()
    assert ollama_adapter._connect_timeout(2) == 2.0


def test_adapter_socket_rejects_rebound_peer(monkeypatch):
    """해석 시점엔 사설 IP 였는데 실제 피어가 다르면(DNS 리바인딩) 소켓을 닫고 거부한다."""
    verdicts = iter([True, False])  # 1) getaddrinfo 검사 통과 2) 실제 peer 는 거부
    monkeypatch.setattr(ollama_adapter, "is_allowed_ip", lambda ip: next(verdicts, False))

    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    try:
        with pytest.raises(ollama_adapter.HostNotAllowedError):
            ollama_adapter._open_allowed_socket(_FakeConn("127.0.0.1", server.getsockname()[1]))
    finally:
        server.close()


def test_adapter_new_conn_goes_through_guard():
    """`_new_conn` 오버라이드가 실제로 가드를 탄다(urllib3 확장 지점 배선 확인)."""
    for cls in (ollama_adapter._AllowedPeerHTTPConnection, ollama_adapter._AllowedPeerHTTPSConnection):
        conn = cls("8.8.8.8", 11434)
        with pytest.raises(ollama_adapter.HostNotAllowedError):
            conn._new_conn()


def test_adapter_empty_addrinfo_raises_new_connection_error(monkeypatch):
    from urllib3.exceptions import NewConnectionError

    monkeypatch.setattr(ollama_adapter.socket, "getaddrinfo", lambda *a, **k: [])
    with pytest.raises(NewConnectionError):
        ollama_adapter._open_allowed_socket(_FakeConn("10.0.0.1", 11434))


def test_adapter_connect_timeout_is_wrapped(monkeypatch):
    """소켓 옵션/바인드 경로를 태우면서 타임아웃을 urllib3 예외로 변환하는지 확인."""
    from urllib3.exceptions import ConnectTimeoutError

    recorded = {}

    class _FakeSocket:
        def __init__(self, *a):
            pass

        def setsockopt(self, *a):
            recorded["opt"] = a

        def settimeout(self, t):
            recorded["timeout"] = t

        def bind(self, addr):
            recorded["bind"] = addr

        def connect(self, addr):
            raise socket.timeout("slow")

        def close(self):
            recorded["closed"] = True

    monkeypatch.setattr(
        ollama_adapter.socket, "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 11434))],
    )
    monkeypatch.setattr(ollama_adapter.socket, "socket", _FakeSocket)

    conn = _FakeConn("10.0.0.1", 11434)
    conn.socket_options = [(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)]
    conn.source_address = ("0.0.0.0", 0)
    with pytest.raises(ConnectTimeoutError):
        ollama_adapter._open_allowed_socket(conn)
    assert recorded["opt"] == (socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    assert recorded["bind"] == ("0.0.0.0", 0)
    assert recorded["closed"] is True


def test_parse_models_skips_nameless_entries(monkeypatch):
    monkeypatch.setattr(
        ollama_adapter, "_get",
        lambda url: _FakeResponse({"models": [{"size": 1}, {"model": "phi3:mini"}]}),
    )
    status = ollama_adapter.detect_ollama("http://10.93.0.1:11434", force=True)
    assert [m.name for m in status.models] == ["phi3:mini"]
    assert status.models[0].size_gb is None


def test_invalid_json_body_is_unknown(monkeypatch):
    class _BadJson(_FakeResponse):
        def json(self):
            raise ValueError("not json")

    monkeypatch.setattr(ollama_adapter, "_get", lambda url: _BadJson({}))
    status = ollama_adapter.detect_ollama("http://10.93.0.2:11434", force=True)
    assert status.reason == "unknown"


def test_adapter_pool_classes_are_guarded():
    """urllib3 업그레이드로 확장 지점이 바뀌면 여기서 먼저 깨진다."""
    adapter = ollama_adapter.PrivateNetworkOnlyAdapter()
    schemes = adapter.poolmanager.pool_classes_by_scheme
    assert schemes["http"] is ollama_adapter._AllowedPeerHTTPConnectionPool
    assert schemes["https"] is ollama_adapter._AllowedPeerHTTPSConnectionPool
    assert schemes["http"].ConnectionCls._new_conn is ollama_adapter._AllowedPeerHTTPConnection._new_conn


def test_guarded_session_mounts_adapter_and_ignores_proxy_env():
    session = ollama_adapter._guarded_session()
    try:
        assert session.trust_env is False  # HTTP_PROXY 로 가드를 우회할 수 없다
        assert isinstance(session.get_adapter("http://10.0.0.1"), ollama_adapter.PrivateNetworkOnlyAdapter)
        assert isinstance(session.get_adapter("https://10.0.0.1"), ollama_adapter.PrivateNetworkOnlyAdapter)
    finally:
        session.close()


def test_get_does_not_follow_redirects(monkeypatch):
    """302 로 허용 대역을 빠져나가는 우회를 막는다."""
    captured = {}

    class _FakeSession:
        trust_env = True

        def mount(self, *a, **k):
            pass

        def get(self, url, **kwargs):
            captured.update(kwargs, url=url)
            return _FakeResponse(TAGS_PAYLOAD)

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(ollama_adapter.requests, "Session", _FakeSession)
    ollama_adapter._get("http://10.0.0.1:11434/api/tags")
    assert captured["allow_redirects"] is False
    assert captured["timeout"] == ollama_adapter.TIMEOUT_S
