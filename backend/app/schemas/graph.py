"""`.acanvas.json` 문서 모델 (Spec §7).

⚠️ 필드명은 스펙 문서가 아니라 **`frontend/src/types/canvas.ts` 실측**을 따른다.
프론트는 이 TS 객체를 그대로 `JSON.stringify` 해서 보내므로(케이스 변환 레이어 없음),
와이어 포맷은 스펙 §7.2 예시와 달리 `sourceHandle`/`targetHandle`/`parentNode`/
`colorOverride` 가 **camelCase** 로 나간다. 나머지 최상위 필드는 snake_case.
이 불일치를 추측으로 "정정"하지 말고 실제 프론트 출력에 맞춘다 — 아니면 모든 그래프
POST 요청이 422 로 튕긴다.

노드별 `data` 필드는 14종 노드 타입마다 모양이 다르고 프론트 레지스트리
(`frontend/src/nodes/registry.ts`)가 단일 진실 공급원이므로 여기서는 자유 형식
`dict[str, Any]` 로 받는다. 타입별 필수 필드 검증은 M2-T4 `compiler/validators.py`
몫이다.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CURRENT_SCHEMA_VERSION = "1.0"

#: frontend/src/nodes/registry.ts NODE_TYPES 와 동일해야 한다.
NodeType = Literal[
    "llm", "agent", "task", "tool", "crew", "input", "output",
    "knowledge", "memory", "human", "router", "guardrail", "note", "group",
]

RunStatus = Literal["idle", "queued", "running", "succeeded", "failed", "cancelled"]
NodeStatus = Literal["idle", "queued", "running", "succeeded", "failed", "skipped", "cancelled"]


class XYPosition(BaseModel):
    x: float
    y: float


class Viewport(BaseModel):
    x: float
    y: float
    zoom: float


class NodeUiState(BaseModel):
    """실행에 영향을 주지 않는 순수 UI 상태 (Spec §7.2 `ui`)."""

    model_config = ConfigDict(populate_by_name=True)

    collapsed: bool = False
    pinned: bool = False
    bypassed: bool = False
    color_override: str | None = Field(default=None, alias="colorOverride")


DEFAULT_NODE_UI = NodeUiState()


class AcNode(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: NodeType
    position: XYPosition
    width: float | None = None
    height: float | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    ui: NodeUiState = Field(default_factory=NodeUiState)
    parent_node: str | None = Field(default=None, alias="parentNode")
    extent: Literal["parent"] | None = None


class AcEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    source: str
    source_handle: str = Field(alias="sourceHandle")
    target: str
    target_handle: str = Field(alias="targetHandle")
    type: str | None = None
    data: dict[str, Any] | None = None


class CanvasMeta(BaseModel):
    requires_keys: list[str] = Field(default_factory=list)
    estimated_cost_usd: float | None = None
    estimated_duration_s: float | None = None
    thumbnail: str | None = None
    #: 갤러리 난이도 별표 (Spec §15.1). 내장 템플릿 스냅샷에만 채워진다.
    difficulty: int | None = None


class CanvasDoc(BaseModel):
    """`.acanvas.json` 최상위 문서. `POST /runs`, `POST /validate` 바디의 `graph`."""

    schema_version: str
    app_version: str
    id: str
    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    author: str | None = None
    created_at: str
    updated_at: str
    viewport: Viewport
    nodes: list[AcNode]
    edges: list[AcEdge]
    meta: CanvasMeta = Field(default_factory=CanvasMeta)


__all__ = [
    "CURRENT_SCHEMA_VERSION",
    "NodeType",
    "RunStatus",
    "NodeStatus",
    "XYPosition",
    "Viewport",
    "NodeUiState",
    "DEFAULT_NODE_UI",
    "AcNode",
    "AcEdge",
    "CanvasMeta",
    "CanvasDoc",
]
