"""요청 ID 부여 + 화이트리스트 기반 요청 로깅. (Spec §9.1, §12.3)

헤더는 블랙리스트가 아니라 **화이트리스트**로만 기록한다 — 새 헤더가 추가돼도
기본적으로 새지 않는 구조. `X-Provider-Keys` 등 시크릿을 나르는 헤더는
화이트리스트에 절대 포함하지 않는다.
"""

from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger

logger = get_logger(__name__)

_LOGGED_HEADERS = frozenset({"content-type", "x-client-version", "accept"})


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = f"req_{uuid.uuid4().hex[:20]}"
        request.state.request_id = request_id

        start = time.monotonic()
        logged_headers = {
            k: v for k, v in request.headers.items() if k.lower() in _LOGGED_HEADERS
        }
        response = await call_next(request)
        duration_ms = round((time.monotonic() - start) * 1000, 2)

        logger.info(
            "request",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
            headers=logged_headers,
        )
        response.headers["X-Request-Id"] = request_id
        return response
