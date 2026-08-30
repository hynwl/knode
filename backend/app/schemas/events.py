"""SSE 이벤트 페이로드 (Spec §10.2 이벤트 카탈로그).

이 모듈은 **프론트로 나가는 공개 계약**이다 (`event.status`, `agent.thought` 등
Spec §10.2 이름). `core/crewai_compat.py` 의 `EventInfo.kind` (`crew_started`,
`task_completed` 등 CrewAI 이벤트 버스 원어)와는 **의도적으로 분리**되어 있다 —
CrewAI 쪽 이벤트를 이 카탈로그로 번역하는 로직은 M2-T9(`runtime/callbacks.py`)
몫이고, 여기서는 와이어 스키마만 고정한다.

모든 페이로드는 `EventBase` (run_id/seq/ts)를 공유한다 (Spec §10.1 SSE 포맷 예시).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.graph import NodeStatus

#: Spec §10.2 이벤트 카탈로그 이름 전체.
EventName = Literal[
    "run.started", "run.completed", "run.failed", "run.cancelled",
    "node.status", "task.started", "task.completed",
    "agent.thought", "agent.tool_use", "agent.tool_result", "agent.delegation",
    "token.usage", "log", "human.request", "edge.active",
]


class EventBase(BaseModel):
    run_id: str
    seq: int
    ts: str


class RunErrorInfo(BaseModel):
    code: str
    message: str
    node_id: str | None = None


class RunStartedEvent(EventBase):
    task_order: list[str]
    agent_count: int
    started_at: str


class RunCompletedEvent(EventBase):
    duration_ms: int
    final_output: str
    usage: dict[str, int] = Field(default_factory=dict)


class RunFailedEvent(EventBase):
    error: RunErrorInfo
    traceback_digest: str | None = None


class RunCancelledEvent(EventBase):
    cancelled_at: str
    completed_tasks: list[str] = Field(default_factory=list)


class NodeStatusEvent(EventBase):
    node_id: str | None
    status: NodeStatus
    progress: float | None = None


class TaskStartedEvent(EventBase):
    node_id: str
    task_name: str
    agent_node_id: str | None = None


class TaskCompletedEvent(EventBase):
    node_id: str
    output: str
    duration_ms: int
    usage: dict[str, int] = Field(default_factory=dict)


class AgentThoughtEvent(EventBase):
    agent_node_id: str | None
    text: str
    iteration: int | None = None


class AgentToolUseEvent(EventBase):
    agent_node_id: str | None
    tool_id: str
    input: str | None = None
    call_id: str


class AgentToolResultEvent(EventBase):
    call_id: str
    output_preview: str | None = None
    duration_ms: int | None = None
    is_error: bool = False


class AgentDelegationEvent(EventBase):
    from_node_id: str | None
    to_node_id: str | None
    question: str


class TokenUsageEvent(EventBase):
    node_id: str | None
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float


class LogEvent(EventBase):
    level: Literal["debug", "info", "warn", "error"]
    message: str
    node_id: str | None = None


class HumanRequestEvent(EventBase):
    node_id: str
    prompt: str
    timeout_s: int


class EdgeActiveEvent(EventBase):
    edge_id: str
    active: bool


#: `event:` 이름 → 페이로드 모델. EventBridge 직렬화/테스트에서 참조한다.
EVENT_PAYLOAD_MODELS: dict[EventName, type[EventBase]] = {
    "run.started": RunStartedEvent,
    "run.completed": RunCompletedEvent,
    "run.failed": RunFailedEvent,
    "run.cancelled": RunCancelledEvent,
    "node.status": NodeStatusEvent,
    "task.started": TaskStartedEvent,
    "task.completed": TaskCompletedEvent,
    "agent.thought": AgentThoughtEvent,
    "agent.tool_use": AgentToolUseEvent,
    "agent.tool_result": AgentToolResultEvent,
    "agent.delegation": AgentDelegationEvent,
    "token.usage": TokenUsageEvent,
    "log": LogEvent,
    "human.request": HumanRequestEvent,
    "edge.active": EdgeActiveEvent,
}

__all__ = [
    "EventName",
    "EventBase",
    "RunErrorInfo",
    "RunStartedEvent",
    "RunCompletedEvent",
    "RunFailedEvent",
    "RunCancelledEvent",
    "NodeStatusEvent",
    "TaskStartedEvent",
    "TaskCompletedEvent",
    "AgentThoughtEvent",
    "AgentToolUseEvent",
    "AgentToolResultEvent",
    "AgentDelegationEvent",
    "TokenUsageEvent",
    "LogEvent",
    "HumanRequestEvent",
    "EdgeActiveEvent",
    "EVENT_PAYLOAD_MODELS",
]
