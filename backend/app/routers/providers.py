"""GET /api/v1/providers — LLM 프로바이더/모델 프리셋 목록. (Spec §5.3, §9.2)"""

from __future__ import annotations

from fastapi import APIRouter

from app.adapters.llm import list_providers, provider_info_to_dict

router = APIRouter(tags=["providers"])


@router.get("/providers")
async def get_providers() -> dict:
    return {"providers": [provider_info_to_dict(p) for p in list_providers()]}
