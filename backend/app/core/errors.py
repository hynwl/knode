"""통일 에러 포맷. (Spec §9.1, MUST)

전 엔드포인트가 `{"error": {...}, "request_id": ...}` 봉투를 반환한다.
`AC-Exxx` 코드 전량은 M2-T4(`compiler/validators.py`)에서 채워진다 — 여기서는
봉투 자체와 FastAPI 예외 핸들러 연결부만 정의한다.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger, traceback_digest

logger = get_logger(__name__)

Severity = Literal["error", "warning", "info"]


class AppError(Exception):
    """AC-Exxx 코드를 실어 나르는 애플리케이션 예외.

    node_id 가 있으면 프론트가 해당 노드로 카메라를 이동시킨다. (Spec §9.1)
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        severity: Severity = "error",
        node_id: str | None = None,
        field: str | None = None,
        hint: str | None = None,
        docs_url: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.severity: Severity = severity
        self.node_id = node_id
        self.field = field
        self.hint = hint
        self.docs_url = docs_url or f"https://github.com/agentcanvas/agentcanvas/docs/errors#{code}"

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
            "docs_url": self.docs_url,
        }
        if self.node_id is not None:
            body["node_id"] = self.node_id
        if self.field is not None:
            body["field"] = self.field
        if self.hint is not None:
            body["hint"] = self.hint
        return body


def _envelope(error_body: dict[str, Any], request: Request) -> dict[str, Any]:
    request_id = getattr(request.state, "request_id", None)
    return {"error": error_body, "request_id": request_id}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.to_dict(), request),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", [])) or None
        body = {
            "code": "AC-E001",
            "message": first.get("msg", "요청 본문이 올바르지 않습니다."),
            "severity": "error",
            "field": field,
            "hint": "요청 스키마를 확인하세요.",
            "docs_url": "https://github.com/agentcanvas/agentcanvas/docs/errors#AC-E001",
        }
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(body, request),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        body = {
            "code": f"AC-E{exc.status_code}",
            "message": str(exc.detail),
            "severity": "error",
            "docs_url": "https://github.com/agentcanvas/agentcanvas/docs/errors",
        }
        return JSONResponse(status_code=exc.status_code, content=_envelope(body, request))

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        digest = traceback_digest(exc)
        logger.error("unhandled_exception", traceback_digest=digest, path=request.url.path)
        body = {
            "code": "AC-E500",
            "message": "서버 내부 오류가 발생했습니다.",
            "severity": "error",
            "hint": "잠시 후 다시 시도하세요. 문제가 계속되면 로그를 확인하세요.",
            "docs_url": "https://github.com/agentcanvas/agentcanvas/docs/errors#AC-E500",
        }
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope(body, request),
        )
