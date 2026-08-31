"""GET /api/v1/ollama/models — Ollama 자동 감지. (M3-T5, Spec §13.1, §13.3)"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.adapters.ollama import detect_ollama
from app.config import get_settings
from app.schemas.ollama import OllamaStatus

router = APIRouter(tags=["ollama"])


@router.get("/ollama/models", response_model=OllamaStatus)
async def get_ollama_models(
    host: str | None = Query(
        default=None,
        max_length=255,
        description="원격 Ollama 호스트 (Spec §13.3). 없으면 서버 기본값. "
                    "루프백/사설망(LAN) 주소만 허용된다 — 그 외는 `reason=host_not_allowed`.",
    ),
    force: bool = Query(default=False, description="60초 캐시를 건너뛰고 즉시 재탐지 (Spec §13.2 인디케이터 클릭)"),
) -> OllamaStatus:
    # 클라이언트가 준 host 는 `adapters.ollama` 가 화이트리스트로 검증한다(SSRF 차단).
    # 200 + reason 으로 돌려주는 이유: 상태바 인디케이터가 실패 사유를 그대로 표시하고,
    # HTTP 상태코드로 허용/거부를 구분해주지 않기 위해서다.
    target = (host or get_settings().ollama_host).strip().rstrip("/")
    return detect_ollama(target, force=force)
