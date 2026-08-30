"""GET /api/v1/tools — 툴 레지스트리 + config JSON Schema. (Spec §5.6, §9.2)

⚠️ 툴 목록 하드코딩 금지 원칙(Spec §5.6)에 따라 프론트는 이 응답만으로 동적 폼을
렌더링한다. 툴 추가 시 `tools/registry.py` 만 고치면 되고 프론트 수정은 불필요하다.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.tools.registry import list_tool_specs, tool_spec_to_dict

router = APIRouter(tags=["tools"])


@router.get("/tools")
async def list_tools() -> dict:
    return {"tools": [tool_spec_to_dict(spec) for spec in list_tool_specs()]}
