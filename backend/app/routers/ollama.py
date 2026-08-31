"""GET /api/v1/ollama/models — Ollama 자동 감지. (M3-T5, Spec §13.1, §13.3)"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.adapters.ollama import detect_ollama
from app.config import get_settings
from app.schemas.ollama import OllamaStatus

router = APIRouter(tags=["ollama"])


@router.get("/ollama/models", response_model=OllamaStatus)
async def get_ollama_models(
    host: str | None = Query(default=None, description="원격 Ollama 호스트 (Spec §13.3). 없으면 서버 기본값."),
    force: bool = Query(default=False, description="60초 캐시를 건너뛰고 즉시 재탐지 (Spec §13.2 인디케이터 클릭)"),
) -> OllamaStatus:
    target = (host or get_settings().ollama_host).rstrip("/")
    return detect_ollama(target, force=force)
