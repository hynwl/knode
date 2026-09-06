"""POST /api/v1/documents/extract — 업로드한 문서에서 텍스트만 뽑아 돌려준다.

Input 노드가 긴 원문을 파일로 받을 수 있게 하기 위한 것이다. **파일은 저장하지
않는다** — 요청 처리 동안 메모리에만 있다가 응답과 함께 사라진다. 워크스페이스에
쓰지 않는 이유는 §12 의 결과 그대로다: 사용자가 올린 문서에 무엇이 들어 있을지
모르는데 서버 디스크에 남길 이유가 없다.
"""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile

from app.adapters.documents import (
    DocumentParseError,
    DocumentTooLargeError,
    MAX_UPLOAD_BYTES,
    SUPPORTED_EXTENSIONS,
    UnsupportedDocumentError,
    extract_document,
)
from app.core.errors import AppError
from app.schemas.documents import ExtractedDocumentResponse
from app.schemas.errors import ISSUE_CATALOG

router = APIRouter(tags=["documents"])


def _error(code: str, status_code: int, *, hint: str | None = None) -> AppError:
    """카탈로그 문구 그대로 `AppError` 를 만든다 — 라우터가 메시지를 새로 쓰지 않게."""
    template = ISSUE_CATALOG[code]
    return AppError(code, template.message, status_code=status_code, hint=hint or template.hint)


@router.post("/documents/extract", response_model=ExtractedDocumentResponse)
async def post_extract_document(file: UploadFile = File(...)) -> ExtractedDocumentResponse:
    data = await file.read()
    filename = file.filename or "document"

    try:
        result = extract_document(filename, data)
    except UnsupportedDocumentError as exc:
        raise _error(
            "AC-E406", 415,
            hint=f"지원 형식: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        ) from exc
    except DocumentTooLargeError as exc:
        raise _error(
            "AC-E407", 413,
            hint=f"{MAX_UPLOAD_BYTES // (1024 * 1024)}MB 이하로 나누어 올려주세요.",
        ) from exc
    except DocumentParseError as exc:
        raise _error("AC-E408", 422) from exc

    # 텍스트 레이어가 없는 스캔 PDF 는 "성공했는데 빈 문자열" 로 돌아온다.
    # 그대로 주면 사용자는 조용히 빈 Input 을 얻고 이유를 모른다 — 실패로 다룬다.
    if not result.text.strip():
        raise _error("AC-E408", 422)

    return ExtractedDocumentResponse(
        filename=result.filename,
        text=result.text,
        chars=result.chars,
        pages=result.pages,
        truncated=result.truncated,
    )
