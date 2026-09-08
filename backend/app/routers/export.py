"""POST /api/v1/export/python — 그래프 → 실행 가능한 CrewAI 스크립트 (Spec §8.5).

`format=json` (기본) 은 모달에 띄울 파일 3종을 그대로 돌려주고,
`format=zip` 은 같은 내용을 압축 파일로 내려준다 — 사용자는 결국 파일 3개를
한 디렉터리에 놓고 `python crew.py` 를 돌려야 하므로, 브라우저에서 파일을 하나씩
받게 하는 것보다 zip 한 번이 실제 사용 흐름에 맞다.

그래프에 **에러**가 있으면 `CompilationError` → 422 `{"errors": Issue[]}` 로 나간다
(`POST /runs` 와 같은 봉투, Spec §9.3 "첫 에러만 반환하지 말 것"). 경고는 막지
않고 응답에 실어 보낸다.
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import Literal

from fastapi import APIRouter, Query, Response

from app.export.messages import resolve_locale
from app.export.python_renderer import render_python
from app.schemas.export import ExportFile, ExportPythonRequest, ExportPythonResponse

router = APIRouter(tags=["export"])

#: ⚠️ ASCII 만 남긴다. `Content-Disposition` 은 latin-1 헤더라 한글 프로젝트명을
#: 그대로 실으면 응답 자체가 깨진다 — 한글만 있는 이름은 통째로 폴백된다.
_UNSAFE_FILENAME = re.compile(r"[^a-z0-9\-]+")


def _slug(name: str) -> str:
    """프로젝트 이름 → zip 파일명. `persistence/fileIO.ts::slugify` 와 같은 결."""
    slug = _UNSAFE_FILENAME.sub("-", (name or "").strip().lower()).strip("-")
    return slug or "crew"


@router.post("/export/python", response_model=ExportPythonResponse)
async def export_python(
    payload: ExportPythonRequest,
    fmt: Literal["json", "zip"] = Query("json", alias="format", description="응답 형식"),
) -> Response | ExportPythonResponse:
    export = render_python(payload.graph, resolve_locale(payload.locale))
    files = [ExportFile(filename=f.filename, language=f.language, content=f.content) for f in export.files]

    if fmt == "zip":
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for f in files:
                archive.writestr(f.filename, f.content)
        slug = _slug(payload.graph.name)
        name = f"{slug}.zip" if slug.endswith("crew") else f"{slug}-crew.zip"
        return Response(
            content=buffer.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    return ExportPythonResponse(files=files, warnings=export.warnings, notes=export.notes)
