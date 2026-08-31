"""Ollama 자동 감지 (M3-T5, Spec §13.1). `GET {host}/api/tags` 를 프록시 + 60초 캐시.

프론트가 CORS 없이 로컬 Ollama 를 감지할 수 있게 백엔드가 대신 조회한다
(Spec §13.1 1행: "CORS 회피 목적").

**보안 후속수정 (2026-08-31): 사설망 화이트리스트.**
`host` 는 클라이언트가 보내는 값이고 이 앱에는 인증 레이어가 없다 — 검증 없이
프록시하면 "백엔드가 임의 호스트로 GET 을 대신 쏘고 성공/타임아웃/거부를
구분해서 돌려주는" **SSRF + 내부망 포트스캔 오라클**이 된다(Spec §19.2 의 공개
데모/클라우드 배포가 정확히 그 시나리오, `docs/CREWAI_RECON.md` §7.2/F14).

그렇다고 `core/security.py::guard_declared_url`(→ `validate_url`)이나
`SSRFProtectedAdapter` 를 그대로 재사용할 수는 없다 — 둘 다 사설/루프백을
**전부 차단**하는 정책이라(`crewai_tools.security.safe_path.is_blocked_ip`)
기본 시나리오(`localhost:11434`)와 Spec §13.3(LAN 의 원격 Ollama)이 통째로
막힌다. 그래서 정책만 뒤집은 가드를 여기서 별도로 구현한다:

* 허용: 루프백(127/8, ::1) + RFC1918 사설(10/8, 172.16/12, 192.168/16) + ULA(fc00::/7)
* 거부: 그 외 전부 — 특히 **링크로컬 169.254.0.0/16**(클라우드 메타데이터
  169.254.169.254)과 공인 IP/외부 도메인. `ipaddress` 의 `is_private` 는
  링크로컬·0.0.0.0 까지 True 라 그것만으로는 부족하다(실측 확인).
* DNS 리바인딩·리다이렉트 우회: `SSRFProtectedAdapter` 와 같은 방식으로
  **소켓 레벨에서 실제 피어 IP 를 재검증**하고, 리다이렉트는 아예 따라가지
  않는다(`allow_redirects=False`). 프록시 env 우회도 `trust_env=False` 로 막는다.

⚠️ `_AllowedPeer*Connection` 계열은 urllib3 내부(`HTTPConnection._new_conn`)에
의존한다 — `crewai_tools.security.ssrf_adapter` 가 쓰는 것과 동일한 확장 지점이다.
urllib3 업그레이드 시 `tests/test_ollama.py::test_adapter_*` 가 먼저 깨진다.
"""

from __future__ import annotations

import ipaddress
import socket
import time
from typing import Any
from urllib.parse import urlsplit

import requests
from requests.adapters import DEFAULT_POOLBLOCK, HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NewConnectionError
from urllib3.poolmanager import PoolManager

from app.schemas.ollama import OllamaModel, OllamaStatus

#: Spec §13.1 "타임아웃 1.5s".
TIMEOUT_S = 1.5
#: Spec §13.1 "성공 → 모델 리스트 캐시(60초)".
CACHE_TTL_S = 60.0

#: host 문자열 → (조회 시각, 결과). 프로세스 전역이라 여러 요청이 캐시를 공유한다.
_cache: dict[str, tuple[float, OllamaStatus]] = {}

ALLOWED_SCHEMES = frozenset({"http", "https"})

#: 백엔드가 대신 조회해줄 수 있는 유일한 대역. 화이트리스트라 새 대역은 명시적으로만 는다.
ALLOWED_NETWORKS: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = (
    ipaddress.ip_network("127.0.0.0/8"),      # 루프백 (기본 시나리오)
    ipaddress.ip_network("10.0.0.0/8"),       # RFC1918
    ipaddress.ip_network("172.16.0.0/12"),    # RFC1918
    ipaddress.ip_network("192.168.0.0/16"),   # RFC1918 (가정용 LAN, Spec §13.3)
    ipaddress.ip_network("::1/128"),          # IPv6 루프백
    ipaddress.ip_network("fc00::/7"),         # IPv6 ULA
)


class HostNotAllowedError(ValueError):
    """허용 대역(루프백/사설 LAN) 밖의 Ollama 호스트. SSRF 차단 사유."""


def _normalize(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """`::ffff:169.254.169.254` 같은 IPv4-mapped 주소로 대역 검사를 우회하지 못하게 푼다."""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def is_allowed_ip(raw: str) -> bool:
    """`raw` 가 루프백/사설 LAN 대역이면 True. 링크로컬(169.254/16)은 명시적으로 False."""
    try:
        ip = _normalize(ipaddress.ip_address(raw))
    except ValueError:
        return False
    # is_private 는 링크로컬(169.254.169.254 = 클라우드 메타데이터)·0.0.0.0 까지
    # True 로 잡는다 — 화이트리스트보다 먼저 잘라낸다.
    if ip.is_link_local or ip.is_multicast or ip.is_unspecified:
        return False
    return any(ip in net for net in ALLOWED_NETWORKS)


def _resolve_allowed(hostname: str, port: int) -> list[tuple[Any, ...]]:
    """`hostname` 의 **모든** 주소가 허용 대역일 때만 addrinfo 를 돌려준다.

    하나라도 허용 밖이면 거부한다 — DNS 라운드로빈으로 검사만 통과시키고
    공인 IP 로 나가는 걸 막기 위함. 이름 해석 실패(`socket.gaierror`)는
    정책 위반이 아니므로 그대로 올려보낸다.
    """
    infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    for info in infos:
        ip = str(info[4][0])
        if not is_allowed_ip(ip):
            raise HostNotAllowedError(
                f"허용되지 않는 Ollama 호스트입니다: {hostname} → {ip}. "
                "로컬호스트 또는 사설망(LAN) 주소만 조회할 수 있습니다."
            )
    return infos


def assert_allowed_host(host: str) -> None:
    """`scheme://host[:port]` 형태의 Ollama 주소를 조회 전에 검사한다."""
    try:
        parts = urlsplit(host)
        port = parts.port
        hostname = parts.hostname
    except ValueError as exc:  # 포트/IPv6 리터럴 파싱 실패
        raise HostNotAllowedError(f"Ollama 호스트 형식이 올바르지 않습니다: {host}") from exc

    if parts.scheme not in ALLOWED_SCHEMES:
        raise HostNotAllowedError(f"http/https 만 허용합니다: {host}")
    if not hostname:
        raise HostNotAllowedError(f"호스트 이름이 없습니다: {host}")
    if parts.username or parts.password:
        raise HostNotAllowedError("Ollama 호스트에 자격증명을 넣을 수 없습니다.")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise HostNotAllowedError(f"경로/쿼리 없는 `scheme://host[:port]` 만 허용합니다: {host}")

    _resolve_allowed(hostname, port or (443 if parts.scheme == "https" else 80))


# ---------------------------------------------------------------------------
# 소켓 레벨 재검증 — 사전 검사와 실제 커넥션 사이의 DNS 리바인딩을 막는다.
# ---------------------------------------------------------------------------

def _connect_timeout(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) else socket.getdefaulttimeout()


def _open_allowed_socket(conn: HTTPConnection) -> socket.socket:
    port = conn.port or (443 if isinstance(conn, HTTPSConnection) else 80)
    host = conn._dns_host.strip("[]")  # noqa: SLF001 — urllib3 확장 지점(모듈 docstring 참조)
    timeout = _connect_timeout(conn.timeout)
    err: OSError | None = None

    for family, socktype, proto, _canonname, sockaddr in _resolve_allowed(host, port):
        sock: socket.socket | None = None
        try:
            sock = socket.socket(family, socktype, proto)
            for opt in conn.socket_options or ():
                sock.setsockopt(*opt)
            sock.settimeout(timeout)
            if conn.source_address:
                sock.bind(conn.source_address)
            sock.connect(sockaddr)
            peer = str(sock.getpeername()[0])
            if not is_allowed_ip(peer):
                raise HostNotAllowedError(f"커넥션이 허용되지 않는 IP 로 연결됐습니다: {peer}")
            return sock
        except HostNotAllowedError:
            if sock is not None:
                sock.close()
            raise
        except OSError as exc:
            err = exc
            if sock is not None:
                sock.close()

    if isinstance(err, socket.timeout):
        raise ConnectTimeoutError(conn, f"Connection to {conn.host} timed out.") from err
    if err is not None:
        raise NewConnectionError(conn, f"Failed to establish a new connection: {err}") from err
    raise NewConnectionError(conn, "getaddrinfo returned an empty list")


class _AllowedPeerHTTPConnection(HTTPConnection):
    def _new_conn(self) -> socket.socket:
        return _open_allowed_socket(self)


class _AllowedPeerHTTPSConnection(HTTPSConnection):
    def _new_conn(self) -> socket.socket:
        return _open_allowed_socket(self)


class _AllowedPeerHTTPConnectionPool(HTTPConnectionPool):
    ConnectionCls = _AllowedPeerHTTPConnection


class _AllowedPeerHTTPSConnectionPool(HTTPSConnectionPool):
    ConnectionCls = _AllowedPeerHTTPSConnection


class _AllowedPeerPoolManager(PoolManager):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.pool_classes_by_scheme = {
            "http": _AllowedPeerHTTPConnectionPool,
            "https": _AllowedPeerHTTPSConnectionPool,
        }


class PrivateNetworkOnlyAdapter(HTTPAdapter):
    """`ALLOWED_NETWORKS` 안의 피어로만 TCP 를 여는 requests 어댑터."""

    def init_poolmanager(
        self,
        connections: int,
        maxsize: int,
        block: bool = DEFAULT_POOLBLOCK,
        **pool_kwargs: Any,
    ) -> None:
        self._pool_connections = connections
        self._pool_maxsize = maxsize
        self._pool_block = block
        self.poolmanager = _AllowedPeerPoolManager(
            num_pools=connections, maxsize=maxsize, block=block, **pool_kwargs
        )


def _guarded_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False  # HTTP(S)_PROXY env 로 가드를 우회하지 못하게 한다.
    adapter = PrivateNetworkOnlyAdapter()
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _get(url: str) -> requests.Response:
    """테스트 이음새(seam). 리다이렉트는 따라가지 않는다 — 302 로 대역을 벗어나는 우회 차단."""
    with _guarded_session() as session:
        return session.get(url, timeout=TIMEOUT_S, allow_redirects=False)


# ---------------------------------------------------------------------------

def _parse_models(raw: list[dict[str, Any]]) -> list[OllamaModel]:
    models: list[OllamaModel] = []
    for m in raw:
        name = str(m.get("name") or m.get("model") or "").strip()
        if not name:
            continue
        details = m.get("details") or {}
        size = m.get("size")
        models.append(OllamaModel(
            name=name,
            size_gb=round(size / 1e9, 1) if isinstance(size, (int, float)) else None,
            family=details.get("family"),
            context=details.get("context_length"),
        ))
    return models


def _fetch(host: str) -> OllamaStatus:
    try:
        assert_allowed_host(host)
    except HostNotAllowedError:
        # 실패 사유를 IP 별로 구분해주지 않는다 — 그 자체가 포트스캔 오라클이 된다.
        return OllamaStatus(available=False, host=host, reason="host_not_allowed")
    except socket.gaierror:
        return OllamaStatus(available=False, host=host, reason="connection_refused")

    try:
        res = _get(f"{host}/api/tags")
        res.raise_for_status()
    except HostNotAllowedError:  # 커넥션 시점 재검증(DNS 리바인딩)
        return OllamaStatus(available=False, host=host, reason="host_not_allowed")
    except requests.exceptions.Timeout:
        return OllamaStatus(available=False, host=host, reason="timeout")
    except requests.exceptions.ConnectionError:
        return OllamaStatus(available=False, host=host, reason="connection_refused")
    except requests.RequestException:
        return OllamaStatus(available=False, host=host, reason="unknown")

    try:
        payload = res.json()
        models = _parse_models(payload.get("models") or [])
    except (ValueError, AttributeError, TypeError):
        return OllamaStatus(available=False, host=host, reason="unknown")

    return OllamaStatus(available=True, host=host, models=models)


def detect_ollama(host: str, *, force: bool = False) -> OllamaStatus:
    """`host` 별 60초 캐시. `force=True` 면 캐시를 건너뛴다(상태바 클릭 즉시 재탐지, Spec §13.2)."""
    now = time.monotonic()
    if not force:
        cached = _cache.get(host)
        if cached is not None and now - cached[0] < CACHE_TTL_S:
            return cached[1]

    status = _fetch(host)
    _cache[host] = (now, status)
    return status


__all__ = [
    "ALLOWED_NETWORKS",
    "CACHE_TTL_S",
    "TIMEOUT_S",
    "HostNotAllowedError",
    "PrivateNetworkOnlyAdapter",
    "assert_allowed_host",
    "detect_ollama",
    "is_allowed_ip",
]
