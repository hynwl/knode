"""등록된 키로 조회한 프로바이더 모델 목록 응답 스키마.

`schemas/ollama.py` 와 같은 계약이다 — 실패를 HTTP 에러가 아니라 `reason` 으로
돌려주므로, 프론트가 "백엔드가 죽었다"와 "키가 틀렸다"를 구분할 수 있다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

#: - `no_key`             등록된 키가 없다 (프론트가 "API 키를 먼저 등록하세요" 를 띄우는 사유)
#: - `invalid_key`        키가 거부됐다 (401/403)
#: - `rate_limited`       429
#: - `not_probeable`      조회 대상이 아닌 프로바이더 (`ollama` · `openai_compatible`)
#: - `unsupported_provider` 알 수 없는 프로바이더 이름
ProviderModelFailureReason = Literal[
    "no_key",
    "invalid_key",
    "rate_limited",
    "timeout",
    "connection_failed",
    "not_probeable",
    "unsupported_provider",
    "unknown",
]


class ProviderModelStatus(BaseModel):
    provider: str
    available: bool
    models: list[str] = Field(default_factory=list)
    reason: ProviderModelFailureReason | None = None


__all__ = ["ProviderModelFailureReason", "ProviderModelStatus"]
