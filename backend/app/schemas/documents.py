"""`POST /api/v1/documents/extract` 응답 스키마.

파일 자체는 어디에도 남기지 않으므로 응답에 경로나 id 가 없다 — 추출한 텍스트와
사용자에게 보여줄 계량값(글자 수·페이지 수·잘림 여부)뿐이다.
"""

from __future__ import annotations

from pydantic import BaseModel


class ExtractedDocumentResponse(BaseModel):
    filename: str
    text: str
    chars: int
    #: PDF 만 페이지 수를 안다. DOCX·평문은 `None`.
    pages: int | None = None
    #: `MAX_TEXT_CHARS` 를 넘어 잘렸는지. 조용히 자르면 사용자가 앞부분만 반영된
    #: 결과를 보고도 이유를 모른다.
    truncated: bool = False


__all__ = ["ExtractedDocumentResponse"]
