"""Ollama 자동 감지 응답 스키마. (M3-T5, Spec §13.1)"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

OllamaFailureReason = Literal["connection_refused", "timeout", "unknown"]


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
