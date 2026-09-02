"""템플릿 갤러리 응답 모델 (Spec §15.1 / §15.2)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.graph import CanvasDoc


class TemplateItem(BaseModel):
    """카드 한 장에 필요한 메타 + 실제 캔버스 문서."""

    id: str
    name: str
    description: str = ""
    difficulty: int = 1
    requires_keys: list[str] = Field(default_factory=list)
    estimated_cost_usd: float = 0.0
    doc: CanvasDoc


class TemplateListResponse(BaseModel):
    templates: list[TemplateItem]


__all__ = ["TemplateItem", "TemplateListResponse"]
