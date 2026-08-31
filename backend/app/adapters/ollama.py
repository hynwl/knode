"""Ollama 자동 감지 (M3-T5, Spec §13.1). `GET {host}/api/tags` 를 프록시 + 60초 캐시.

프론트가 CORS 없이 로컬 Ollama 를 감지할 수 있게 백엔드가 대신 조회한다
(Spec §13.1 1행: "CORS 회피 목적"). 기본 호스트는 `localhost` 라 M2-T19 의
SSRF 가드(`core/security.py::guard_declared_url` → `validate_url`)를
**의도적으로 적용하지 않는다** — 실측 결과 `validate_url` 은 사설/루프백 IP 를
전부 차단해서 그대로 쓰면 기본 시나리오(`localhost:11434`)부터 막힌다. 그 가드는
크루 실행 중 신뢰할 수 없는 입력(에이전트가 스스로 고른 URL)이 내부망에 닿는 걸
막는 게 목적이고, Ollama 호스트는 사용자가 자기 로컬/사설 네트워크에 직접
배치·설정한 신뢰된 엔드포인트다(원격 Ollama 도 Spec §13.3 상 마찬가지 전제).
"""

from __future__ import annotations

import time
from typing import Any

import requests

from app.schemas.ollama import OllamaModel, OllamaStatus

#: Spec §13.1 "타임아웃 1.5s".
TIMEOUT_S = 1.5
#: Spec §13.1 "성공 → 모델 리스트 캐시(60초)".
CACHE_TTL_S = 60.0

#: host 문자열 → (조회 시각, 결과). 프로세스 전역이라 여러 요청이 캐시를 공유한다.
_cache: dict[str, tuple[float, OllamaStatus]] = {}


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
        res = requests.get(f"{host}/api/tags", timeout=TIMEOUT_S)
        res.raise_for_status()
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


__all__ = ["CACHE_TTL_S", "TIMEOUT_S", "detect_ollama"]
