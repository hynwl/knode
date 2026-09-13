"""FastAPI 엔트리포인트. (M2-T1, M2-T11, Spec §9.1, §11.2, §12.3, §12.5)"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware
from app.core.security import workspace_dir
from app.routers import documents, export, health, ollama, providers, runs, templates, tools
from app.runtime.manager import RunManager

settings = get_settings()
configure_logging(settings.log_level)
logger = get_logger(__name__)

#: Spec §11.2 런 보존(30분) GC 주기. 스펙이 주기 자체를 지정하지 않아 하트비트
#: 간격(bridge.py 15s)과 같은 결로 고정한다 — 짧으면 락 경합만 늘고, 길어도
#: 완료된 런이 메모리에 조금 더 남을 뿐 안전에는 영향 없다.
GC_INTERVAL_S = 300


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("workspace_dir_ready", path=workspace_dir())
    run_manager = RunManager(
        max_concurrent=settings.max_concurrent_runs,
        ttl_seconds=settings.run_ttl_seconds,
    )
    app.state.run_manager = run_manager

    async def _gc_loop() -> None:
        while True:
            await asyncio.sleep(GC_INTERVAL_S)
            removed = run_manager.gc()
            if removed:
                logger.info("run_gc", removed=removed)

    gc_task = asyncio.ensure_future(_gc_loop())
    try:
        yield
    finally:
        # Spec §11.2 MUST 그레이스풀 셧다운: uvicorn이 SIGTERM을 받으면 ASGI
        # lifespan shutdown 이벤트를 발행한다 — 여기가 그 지점이라 별도
        # signal.signal() 훅이 필요 없다.
        gc_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await gc_task
        run_manager.shutdown()


app = FastAPI(title="Knode API", version="0.1.0", lifespan=lifespan)

app.add_middleware(RequestContextMiddleware)

# ALLOWED_ORIGINS 화이트리스트. "*" 금지. (Spec §12.5, MUST)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # 브라우저는 교차 출처 응답에서 단순 헤더만 JS 에 노출한다. 이 둘은 명시해야
    # 프론트가 읽을 수 있다: `Content-Disposition` 은 Export zip 의 파일명(§8.5),
    # `X-Request-Id` 는 사용자가 에러를 신고할 때 서버 로그와 맞춰 볼 식별자(§9.1).
    expose_headers=["Content-Disposition", "X-Request-Id"],
)

register_exception_handlers(app)

app.include_router(health.router, prefix="/api/v1")
app.include_router(tools.router, prefix="/api/v1")
app.include_router(providers.router, prefix="/api/v1")
app.include_router(ollama.router, prefix="/api/v1")
app.include_router(templates.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
app.include_router(runs.router, prefix="/api/v1")
