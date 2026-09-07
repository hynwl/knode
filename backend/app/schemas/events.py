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


#: 서버가 만든 **자유 텍스트**에 붙는 i18n 키의 타입.
#:
#: 백엔드는 화면 언어를 모른다(실행 요청에 로케일이 없다). 그래서 사람이 읽는
#: 문장을 서버가 확정해 보내면 UI 언어와 어긋난다 — 실제로 EN 로케일에서 Dry Run
#: 로그만 한국어로 나왔다. 규약은 `schemas/errors.py::Issue.message_key` 와 같다:
#: **한국어 원문을 그대로 싣되**(SSE 를 직접 읽는 API 소비자를 위해) 키를 함께 보내고,
#: 프론트(`store/index.ts::applyRunEvent`)는 키가 있으면 그것을 현재 로케일로 그린다.
#: 키는 `frontend/src/i18n/{ko,en}.json` 에 실재해야 한다.
MessageParams = dict[str, str | int | float]


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
    #: `final_output` 이 크루 산출물이 아니라 **서버 문구**일 때만 채운다 (Dry Run).
    final_output_key: str | None = None
    final_output_params: MessageParams | None = None


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
    #: `output` 이 태스크 산출물이 아니라 **서버 문구**일 때만 채운다 (Dry Run).
    output_key: str | None = None


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
    #: 서버가 지은 문장이면 함께 보낸다. CrewAI/툴이 뱉은 원문 로그에는 붙지 않는다.
    message_key: str | None = None
    params: MessageParams | None = None


class HumanRequestEvent(EventBase):
    node_id: str
    prompt: str
    timeout_s: int
    #: 재검토 회차(1 = 첫 요청). "2차 검토" 같은 표기는 프론트가 만든다 — 서버가
    #: `prompt` 앞에 붙여 보내면 사용자가 쓴 글과 서버 문구가 한 문자열로 섞인다.
    round: int = 1


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
