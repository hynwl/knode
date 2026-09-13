"""통일 에러 포맷. (Spec §9.1, MUST)

전 엔드포인트가 `{"error": {...}, "request_id": ...}` 봉투를 반환한다. 단
`POST /runs` 의 그래프 검증 실패(422)만 예외로 `{"errors": Issue[], ...}`
배열 전체를 돌려준다(Spec §9.3 MUST — 첫 에러만 주면 사용자가 한 번에 다
못 고친다) — 이건 `CompilationError` 가 담당한다.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger, traceback_digest

if TYPE_CHECKING:
    from app.schemas.errors import Issue

logger = get_logger(__name__)

#: "warn" 이지 "warning" 이 아니다 — frontend/src/validation/issues.ts 의
#: `ValidationIssue.severity` 어휘와 맞춘다 (schemas/errors.py `Issue` 참조).
Severity = Literal["error", "warn", "info"]


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
        self.docs_url = docs_url or f"https://github.com/hynwl/knode/blob/main/docs/ERRORS.md#{code}"

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


class CompilationError(Exception):
    """구조/의미 검증(§8.1 [2]/[3], `compiler/validators.py`) 실패 시 발생.

    `compiler.py`(M2-T5)가 raise 하고, 라우터(M2-T11)가 잡아 `POST /runs` 의
    422 응답을 `{"errors": Issue[]}` 배열 전체로 구성한다 (Spec §9.3 MUST).
    """

    def __init__(self, issues: list["Issue"]) -> None:
        self.issues = issues
        super().__init__(f"compilation failed with {len(issues)} issue(s)")


#: **전송 계층** 에러 — 그래프의 특정 노드가 아니라 요청 자체가 스키마에 안 맞거나
#: 서버가 처리 중 죽었을 때 봉투에 실려 나간다. `ISSUE_CATALOG`(검증 이슈)에는 속하지
#: 않지만 사용자에게 코드와 `docs_url` 이 그대로 노출되므로 AC-X2("모든 에러 코드에
#: 문서 항목 존재")의 대상이다 — `scripts/gen_errors_doc.py` 가 이 표에서도
#: `docs/ERRORS.md` 항목을 생성하고 `tests/test_errors_doc.py` 가 드리프트를 막는다.
#: (M4-T10 감사에서 두 코드의 `docs_url` 앵커가 문서에 없어 링크가 깨져 있던 것을 발견해 추가.)
TRANSPORT_ERRORS: dict[str, tuple[str, str]] = {
    "AC-E001": (
        "요청 본문이 올바르지 않습니다.",
        "요청 스키마를 확인하세요.",
    ),
    "AC-E500": (
        "서버 내부 오류가 발생했습니다.",
        "잠시 후 다시 시도하세요. 문제가 계속되면 로그를 확인하세요.",
    ),
}

DOCS_BASE = "https://github.com/hynwl/knode/blob/main/docs/ERRORS.md"


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

    @app.exception_handler(CompilationError)
    async def _compilation_error_handler(request: Request, exc: CompilationError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "errors": [i.model_dump(mode="json", by_alias=True) for i in exc.issues],
                "request_id": request_id,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", [])) or None
        message, hint = TRANSPORT_ERRORS["AC-E001"]
        body = {
            "code": "AC-E001",
            # pydantic 의 구체적 사유가 있으면 그게 더 유용하다 — 카탈로그 문구는 폴백.
            "message": first.get("msg", message),
            "severity": "error",
            "field": field,
            "hint": hint,
            "docs_url": f"{DOCS_BASE}#AC-E001",
        }
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(body, request),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        # HTTP 상태코드를 그대로 실은 동적 코드. 개별 항목이 아니라 `docs/ERRORS.md` 의
        # "전송 계층" 절이 한 묶음으로 설명하므로 앵커 없이 문서 루트로 링크한다.
        # (일부 상태코드는 카탈로그의 E4xx 와 문자열이 겹친다 — 구분법은
        #  tests/test_main.py::test_404_uses_error_envelope 의 주석 참조.)
        body = {
            "code": f"AC-E{exc.status_code}",
            "message": str(exc.detail),
            "severity": "error",
            "docs_url": DOCS_BASE,
        }
        return JSONResponse(status_code=exc.status_code, content=_envelope(body, request))

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        digest = traceback_digest(exc)
        logger.error("unhandled_exception", traceback_digest=digest, path=request.url.path)
        message, hint = TRANSPORT_ERRORS["AC-E500"]
        body = {
            "code": "AC-E500",
            "message": message,
            "severity": "error",
            "hint": hint,
            "docs_url": f"{DOCS_BASE}#AC-E500",
        }
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope(body, request),
        )
