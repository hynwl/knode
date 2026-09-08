"""Export to Python 요청/응답 모델 (Spec §8.5).

⚠️ 요청에 시크릿을 **받지 않는다.** 내보내기는 키가 하나도 없어도 성공해야 하고
(생성 코드는 `os.getenv(...)` 만 쓴다, §8.5 MUST), 받지 않으면 키가 생성 파일에
섞여 나갈 경로 자체가 없다. `POST /runs` 와 달리 `X-Provider-Keys` 를 읽지
않는 이유가 이것이다.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.errors import Issue
from app.schemas.graph import CanvasDoc


class ExportPythonRequest(BaseModel):
    graph: CanvasDoc
    #: 생성 파일 **안의 사람 말**(독스트링·주석·고지)에 쓸 언어. `"ko"` | `"en"`,
    #: 모르는 값이면 기본값으로 떨어진다 (`export/messages.py::resolve_locale`).
    #:
    #: 본문으로 받는 이유: 브라우저 `fetch` 는 `Accept-Language` 를 못 만지고
    #: (금지 헤더), 이 앱의 언어는 브라우저 설정이 아니라 헤더의 KO/EN 토글이 정한다.
    locale: str | None = None


class ExportFile(BaseModel):
    filename: str
    #: 프론트 신택스 하이라이터 힌트. `python` | `text` | `dotenv`.
    language: str
    content: str


class ExportPythonResponse(BaseModel):
    files: list[ExportFile]
    #: 그래프 검증 경고(severity=warn). 에러면 422 `{"errors": [...]}` 로 나간다.
    warnings: list[Issue] = Field(default_factory=list)
    #: 캔버스에는 있으나 단독 스크립트로 옮길 수 없는 것들에 대한 고지.
    notes: list[str] = Field(default_factory=list)


__all__ = ["ExportPythonRequest", "ExportFile", "ExportPythonResponse"]
