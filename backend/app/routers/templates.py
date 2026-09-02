"""GET /api/v1/templates — 내장 템플릿 갤러리. (Spec §15.1, §15.2)

⚠️ 이 디렉터리의 `*.acanvas.json` 은 **손으로 쓰지 않는다.** 템플릿의 단일 진실
공급원은 `frontend/src/templates/builtin.ts` 이고, 여기 파일들은
`cd frontend && npm run export:templates` 로 떨어뜨린 스냅샷이다. 카드 메타
(난이도/필요 키/예상 비용)는 문서의 `meta` 에 같이 실려 있어 별도 사이드카가 없다.

`local` 템플릿의 모델명은 스냅샷 시점의 폴백 값이다 — 프론트는 로드할 때
`GET /api/v1/ollama/models`(§13.1) 로 감지된 실제 설치 모델로 다시 빌드한다.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter

from app.schemas.graph import CanvasDoc
from app.schemas.templates import TemplateItem, TemplateListResponse

router = APIRouter(tags=["templates"])

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "data" / "templates"

#: 스펙 §15.1 표의 순서. 목록에 없는 파일은 뒤에 이름순으로 붙는다.
_ORDER = ("hello", "blog", "market_research", "youtube", "local")


def _sort_key(template_id: str) -> tuple[int, str]:
    try:
        return (_ORDER.index(template_id), "")
    except ValueError:
        return (len(_ORDER), template_id)


@lru_cache(maxsize=1)
def load_templates() -> tuple[TemplateItem, ...]:
    """`data/templates/*.acanvas.json` → 갤러리 항목. 깨진 파일은 조용히 건너뛴다."""
    items: list[TemplateItem] = []
    if not TEMPLATES_DIR.is_dir():
        return ()
    for path in sorted(TEMPLATES_DIR.glob("*.acanvas.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            doc = CanvasDoc.model_validate(raw)
        except Exception:  # noqa: BLE001 - 손상된 스냅샷 하나가 갤러리 전체를 죽이면 안 된다
            continue
        meta = raw.get("meta") or {}
        items.append(
            TemplateItem(
                id=path.name.removesuffix(".acanvas.json"),
                name=doc.name,
                description=doc.description or "",
                difficulty=int(meta.get("difficulty") or 1),
                requires_keys=list(meta.get("requires_keys") or []),
                estimated_cost_usd=float(meta.get("estimated_cost_usd") or 0.0),
                doc=doc,
            )
        )
    items.sort(key=lambda i: _sort_key(i.id))
    return tuple(items)


@router.get("/templates", response_model=TemplateListResponse)
async def list_templates() -> TemplateListResponse:
    return TemplateListResponse(templates=list(load_templates()))
