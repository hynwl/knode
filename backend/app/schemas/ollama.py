"""Ollama 자동 감지 응답 스키마. (M3-T5, Spec §13.1)"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

#: `host_not_allowed` = 루프백/사설망 화이트리스트 밖의 주소라 백엔드가 조회를 거부했다
#: (SSRF·내부망 스캔 오라클 차단, `adapters/ollama.py` 참조).
OllamaFailureReason = Literal["connection_refused", "timeout", "unknown", "host_not_allowed"]


class OllamaModel(BaseModel):
    name: str
    size_gb: float | None = None
    family: str | None = None
    context: int | None = None


class OllamaStatus(BaseModel):
    available: bool
    host: str
    models: list[OllamaModel] = Field(default_factory=list)
    reason: OllamaFailureReason | None = None


__all__ = ["OllamaFailureReason", "OllamaModel", "OllamaStatus"]
