"""등록된 BYOK 키로 프로바이더의 **실제 사용 가능 모델**을 조회한다.

`adapters/llm.py` 의 `model_presets.json` 은 "이 프로바이더에 이런 모델들이
있다" 는 **정적 목록**이라, 사용자의 키로 실제 쓸 수 있는지와는 무관하다.
그래서 키가 없어도 모델이 잔뜩 보이고, 골라 놓으면 실행 시점에야
`AC-E601`/`AC-E602` 로 터진다. Ollama 는 이미 `adapters/ollama.py` 가
`GET /api/tags` 로 **설치된 것만** 보여주는데, 원격 프로바이더만 그렇지 않았다.

여기서는 각 프로바이더의 모델 목록 API 를 키로 조회해 같은 수준을 맞춘다.
CORS 때문에 브라우저가 직접 못 부르므로 백엔드가 대신 조회한다 —
`adapters/ollama.py` 와 정확히 같은 이유의 프록시다.

## `openai_compatible` 을 조회하지 않는 이유

이 프로바이더만 엔드포인트가 **사용자 입력**(`base_url`)이다. 인증이 없는 이
백엔드가 그 주소로 GET 을 대신 쏘고 성공/실패를 구분해 돌려주면 그대로
SSRF + 내부망 포트스캔 오라클이 된다 — `adapters/ollama.py` 헤더 주석이 설명하는
바로 그 구조다. Ollama 는 루프백/사설망 화이트리스트로 좁혀서 허용했지만,
`openai_compatible` 은 공인 인터넷 호스트를 겨냥한 기능이라 같은 화이트리스트를
쓸 수 없다. 그래서 **조회 대상에서 제외**하고 프론트가 자유 입력으로 폴백한다.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from app.core.crewai_compat import PROVIDER_KEY_NAME
from app.schemas.provider_models import ProviderModelStatus

logger = logging.getLogger(__name__)

#: 원격 API 라 Ollama(1.5s) 보다는 넉넉히 준다. 그래도 인스펙터를 막을 만큼은 아니게.
TIMEOUT_S = 6.0
#: 모델 목록은 자주 바뀌지 않는다. 프로바이더 rate limit 도 아껴야 한다.
CACHE_TTL_S = 300.0

#: (provider, 키 지문) → (조회 시각, 결과). 키 값 자체는 **절대** 캐시 키에 넣지 않는다
#: (§12.2 — 메모리에 남더라도 값 그대로는 안 된다). 키가 바뀌면 지문이 달라져 재조회된다.
_cache: dict[tuple[str, int], tuple[float, ProviderModelStatus]] = {}


def _fingerprint(key: str) -> int:
    """캐시 무효화용 키 지문. 값 복원이 목적이 아니므로 내장 해시로 충분하다."""
    return hash(key)


def _openai_style(url: str, headers: dict[str, str]) -> list[str]:
    """OpenAI 호환 `{"data": [{"id": ...}]}` 응답."""
    r = requests.get(url, headers=headers, timeout=TIMEOUT_S)
    r.raise_for_status()
    payload = r.json()
    return [str(m["id"]) for m in payload.get("data", []) if isinstance(m, dict) and m.get("id")]


def _fetch_openai(key: str) -> list[str]:
    return _openai_style("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"})


def _fetch_groq(key: str) -> list[str]:
    return _openai_style("https://api.groq.com/openai/v1/models", {"Authorization": f"Bearer {key}"})


def _fetch_anthropic(key: str) -> list[str]:
    # Anthropic 은 `data[].id` 로 같은 모양이지만 버전 헤더가 필수다.
    return _openai_style(
        "https://api.anthropic.com/v1/models",
        {"x-api-key": key, "anthropic-version": "2023-06-01"},
    )


def _fetch_gemini(key: str) -> list[str]:
    r = requests.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        headers={"x-goog-api-key": key},
        timeout=TIMEOUT_S,
    )
    r.raise_for_status()
    names: list[str] = []
    for m in r.json().get("models", []):
        if not isinstance(m, dict):
            continue
        # `models/gemini-2.0-flash` → `gemini-2.0-flash`. litellm 이 기대하는 건 접두사 없는 쪽이다.
        raw = str(m.get("name") or "")
        if not raw:
            continue
        # 텍스트 생성을 지원하지 않는 임베딩 전용 모델은 LLM 노드에서 고를 이유가 없다.
        methods = m.get("supportedGenerationMethods")
        if isinstance(methods, list) and "generateContent" not in methods:
            continue
        names.append(raw.split("/", 1)[-1])
    return names


#: 프로바이더 → 조회 함수. 여기 **없는** 프로바이더는 조회하지 않는다(위 모듈 주석 참조).
FETCHERS: dict[str, Any] = {
    "openai": _fetch_openai,
    "anthropic": _fetch_anthropic,
    "gemini": _fetch_gemini,
    "groq": _fetch_groq,
}


def is_probeable(provider: str) -> bool:
    return provider in FETCHERS


def _classify(exc: Exception) -> str:
    if isinstance(exc, requests.Timeout):
        return "timeout"
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        if exc.response.status_code in (401, 403):
            return "invalid_key"
        if exc.response.status_code == 429:
            return "rate_limited"
    if isinstance(exc, requests.ConnectionError):
        return "connection_failed"
    return "unknown"


def list_provider_models(provider: str, key: str | None, *, force: bool = False) -> ProviderModelStatus:
    """프로바이더의 사용 가능 모델. 실패는 예외가 아니라 `reason` 으로 돌려준다.

    `adapters/ollama.py` 와 같은 계약이다 — 인스펙터 드롭다운을 채우는 조회라
    HTTP 상태코드로 실패를 알리면 프론트가 "백엔드가 죽었다" 와 구분하지 못한다.
    """
    if provider not in PROVIDER_KEY_NAME:
        return ProviderModelStatus(provider=provider, available=False, reason="unsupported_provider")
    if not is_probeable(provider):
        return ProviderModelStatus(provider=provider, available=False, reason="not_probeable")
    if not key:
        return ProviderModelStatus(provider=provider, available=False, reason="no_key")

    cache_key = (provider, _fingerprint(key))
    now = time.monotonic()
    if not force:
        hit = _cache.get(cache_key)
        if hit and now - hit[0] < CACHE_TTL_S:
            return hit[1]

    try:
        models = sorted(set(FETCHERS[provider](key)))
    except Exception as exc:  # noqa: BLE001 — 조회 실패가 인스펙터를 막으면 안 된다
        reason = _classify(exc)
        logger.debug("provider model listing failed provider=%s reason=%s", provider, reason, exc_info=True)
        # 실패는 캐시하지 않는다 — 키를 고쳐 넣자마자 다시 시도할 수 있어야 한다.
        return ProviderModelStatus(provider=provider, available=False, reason=reason)

    status = ProviderModelStatus(provider=provider, available=True, models=models)
    _cache[cache_key] = (now, status)
    return status


def clear_cache() -> None:
    _cache.clear()


__all__ = [
    "CACHE_TTL_S",
    "FETCHERS",
    "TIMEOUT_S",
    "clear_cache",
    "is_probeable",
    "list_provider_models",
]
