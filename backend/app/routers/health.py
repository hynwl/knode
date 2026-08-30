"""GET /api/v1/health — 헬스체크 + 버전 + crewai 버전. (Spec §9.2)"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.crewai_compat import CREWAI_VERSION, VERIFIED_CREWAI_VERSION, check_version

router = APIRouter(tags=["health"])

APP_VERSION = "0.1.0"


@router.get("/health")
async def health() -> dict:
    drift = check_version()
    return {
        "status": "ok",
        "version": APP_VERSION,
        "crewai_version": CREWAI_VERSION,
        "crewai_verified_version": VERIFIED_CREWAI_VERSION,
        "crewai_version_drift": drift,
    }
