"""FastAPI 엔트리포인트. (M2-T1, Spec §9.1, §12.3, §12.5)"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.routers import health

settings = get_settings()
configure_logging(settings.log_level)

app = FastAPI(title="AgentCanvas API", version="0.1.0")

app.add_middleware(RequestContextMiddleware)

# ALLOWED_ORIGINS 화이트리스트. "*" 금지. (Spec §12.5, MUST)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(health.router, prefix="/api/v1")
