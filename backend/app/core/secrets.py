"""BYOK 시크릿 — `X-Provider-Keys` 헤더 수신 + 서버 폴백 (Spec §12.1, §12.2).

`SecretBundle`은 요청 처리 동안만 메모리에 상주한다. 디스크/DB/로그 어디에도
남기지 않고, run 종료 시 `clear()`를 명시적으로 호출한다(Run Manager, M2-T10
몫). `__repr__`/`__str__`는 항상 키 이름만 노출한다 — structlog가 이 객체를
그대로 로그에 찍어도 값이 새지 않는다(Spec §12.2 MUST).
"""

from __future__ import annotations

import base64
import binascii
import json

from app.config import Settings

#: 프론트가 보내는 헤더 이름 (Spec §9.3 예시: `X-Provider-Keys: Base64(JSON)`).
HEADER_NAME = "X-Provider-Keys"

#: 헤더 키 이름 → 서버 사이드 폴백 필드(`Settings`). 헤더에 값이 없을 때만 쓴다
#: (Spec §12.1 우선순위: 헤더 > 서버 env).
_SERVER_FALLBACK_FIELDS: dict[str, str] = {
    "OPENAI_API_KEY": "openai_api_key",
    "ANTHROPIC_API_KEY": "anthropic_api_key",
    "GEMINI_API_KEY": "gemini_api_key",
    "GROQ_API_KEY": "groq_api_key",
    "SERPER_API_KEY": "serper_api_key",
}


class SecretBundle:
    """Spec §12.2 예시 그대로. `get()`만으로 `compiler.SecretsLike`를 만족한다."""

    def __init__(self, data: dict[str, str]) -> None:
        self._d = dict(data)

    def get(self, key: str | None) -> str | None:
        if key is None:
            return None
        return self._d.get(key)

    def clear(self) -> None:
        self._d.clear()

    def __repr__(self) -> str:  # 값 노출 금지 — 키 이름만
        return f"SecretBundle(keys={list(self._d)})"

    __str__ = __repr__


def _decode_header(raw: str) -> dict[str, str]:
    """Base64(JSON) 우선 시도, 실패하면 평문 JSON으로 폴백.

    헤더 파싱 실패는 500이 아니라 **빈 딕셔너리**로 흡수한다 — 키 문제는
    실행 시점에 AC-E601/E602로 드러나야 한다(Spec §9.3 취지: 요청 자체를
    막지 않는다).
    """
    text = raw
    try:
        text = base64.b64decode(raw, validate=True).decode("utf-8")
    except (binascii.Error, ValueError, UnicodeDecodeError):
        text = raw
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(v, str) and v}


def parse_secret_header(header_value: str | None, settings: Settings) -> SecretBundle:
    """헤더 값(있으면) + 서버 폴백을 병합해 `SecretBundle`을 만든다.

    라우터(M2-T11)가 `request.headers.get(HEADER_NAME)`을 그대로 넘기면 된다.
    """
    merged: dict[str, str] = {}
    for header_key, field_name in _SERVER_FALLBACK_FIELDS.items():
        fallback = getattr(settings, field_name, None)
        if fallback:
            merged[header_key] = fallback

    if header_value:
        merged.update(_decode_header(header_value))

    return SecretBundle(merged)


__all__ = ["HEADER_NAME", "SecretBundle", "parse_secret_header"]
