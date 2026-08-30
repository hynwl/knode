"""실행 API 요청/응답 모델 (Spec §9.2~§9.4, §11).

`X-Provider-Keys` 헤더(BYOK)는 여기 담지 않는다 — 바디에 키가 섞이면 로그/에러
리포트로 유출된다 (Spec §9.3 MUST). 헤더 파싱은 `core/secrets.py`(M2-T13) 몫이다.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.errors import Issue
from app.schemas.graph import CanvasDoc, NodeStatus

RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class RunOptions(BaseModel):
    dry_run: bool = False
    max_duration_s: int | None = None
    stream_thoughts: bool = True
    verbose: bool = True


class RunRequest(BaseModel):
    """`POST /runs`, `POST /validate` 공통 바디 (Spec §9.3)."""

    graph: CanvasDoc
    inputs: dict[str, Any] = Field(default_factory=dict)
    options: RunOptions = Field(default_factory=RunOptions)


class RunWarning(BaseModel):
    code: str
    node_id: str | None = None
    message: str


class RunResponse(BaseModel):
    """`POST /runs` 의 `202 Accepted` 응답."""

    run_id: str
    status: Literal["queued"] = "queued"
    task_order: list[str]
    warnings: list[RunWarning] = Field(default_factory=list)
    events_url: str


class ValidateResponse(BaseModel):
    """`POST /validate` 응답. 실행 없이 검증 결과만 돌려준다 (Spec §9.4)."""

    valid: bool
    issues: list[Issue] = Field(default_factory=list)
    task_order: list[str] | None = None


class NodeUsage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt: int
    completion: int
    cost_usd: float = Field(alias="costUsd")


class NodeRunState(BaseModel):
    """`GET /runs/{id}` 스냅샷의 노드별 상태. 프론트 `NodeRunState`(types/canvas.ts)와 동일 모양."""

    model_config = ConfigDict(populate_by_name=True)

    status: NodeStatus
    output: str | None = None
    error: str | None = None
    usage: NodeUsage | None = None
    started_at: float | None = Field(default=None, alias="startedAt")
    finished_at: float | None = Field(default=None, alias="finishedAt")


class RunSnapshot(BaseModel):
    """`GET /runs/{id}` — 재연결/폴백용 스냅샷 (Spec §9.2 SHOULD)."""

    run_id: str
    status: RunStatus
    task_order: list[str]
    started_at: str | None = None
    finished_at: str | None = None
    node_states: dict[str, NodeRunState] = Field(default_factory=dict)


class HumanResponseRequest(BaseModel):
    """`POST /runs/{id}/human` — Human-in-the-loop 응답 제출 (Spec §9.2 SHOULD, M3-T10)."""

    node_id: str
    response: str


__all__ = [
    "RunStatus",
    "RunOptions",
    "RunRequest",
    "RunWarning",
    "RunResponse",
    "ValidateResponse",
    "NodeUsage",
    "NodeRunState",
    "RunSnapshot",
    "HumanResponseRequest",
]
