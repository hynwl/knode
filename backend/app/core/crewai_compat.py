"""CrewAI 버전 호환 레이어.

⚠️ 이 파일이 CrewAI API에 접근하는 **유일한 통로**다. (Spec §23-5)
   다른 모듈은 절대 `from crewai import ...` 하지 않는다.

작성 근거: docs/CREWAI_RECON.md — crewai==1.15.18 설치본 **실측**.
           학습 데이터 기반 추측 코드 없음.

CrewAI 버전을 올릴 때 고쳐야 할 곳은 이 파일과
tests/test_crewai_compat.py 두 개뿐이어야 한다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Iterable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 1. 임포트 — CrewAI 표면에 직접 닿는 유일한 지점
# ---------------------------------------------------------------------------
from crewai import Agent, Crew, LLM, Process, Task  # noqa: E402
from crewai.agents.parser import AgentAction, AgentFinish  # noqa: E402
from crewai.crews.crew_output import CrewOutput  # noqa: E402
from crewai.events.event_bus import crewai_event_bus  # noqa: E402
from crewai.events.types.agent_events import (  # noqa: E402
    AgentExecutionCompletedEvent,
    AgentExecutionErrorEvent,
    AgentExecutionStartedEvent,
)
from crewai.events.types.crew_events import (  # noqa: E402
    CrewKickoffCompletedEvent,
    CrewKickoffFailedEvent,
    CrewKickoffStartedEvent,
)
from crewai.events.types.llm_events import (  # noqa: E402
    LLMCallCompletedEvent,
    LLMCallFailedEvent,
)
from crewai.events.types.task_events import (  # noqa: E402
    TaskCompletedEvent,
    TaskFailedEvent,
    TaskStartedEvent,
)
from crewai.events.types.tool_usage_events import (  # noqa: E402
    ToolUsageErrorEvent,
    ToolUsageFinishedEvent,
    ToolUsageStartedEvent,
)
from crewai.tasks.task_output import TaskOutput  # noqa: E402
from crewai.tools import BaseTool, tool as crewai_tool_decorator  # noqa: E402

try:  # 설치 버전 문자열
    from crewai.version import __version__ as CREWAI_VERSION  # type: ignore
except Exception:  # pragma: no cover
    from importlib.metadata import version as _v

    CREWAI_VERSION = _v("crewai")

#: 이 compat 레이어가 실측 검증된 버전. 불일치 시 기동 로그에 경고를 남긴다.
VERIFIED_CREWAI_VERSION = "1.15.18"

#: Task.context 미지정 센티널. `context=None` 과 의미가 다르다. (RECON F12)
#: 연결된 컨텍스트가 없으면 인자를 **아예 넘기지 않는다**.
_CONTEXT_OMITTED = object()


def check_version() -> str | None:
    """설치된 CrewAI 버전이 검증본과 다르면 경고 문자열을 돌려준다."""
    if CREWAI_VERSION != VERIFIED_CREWAI_VERSION:
        msg = (
            f"CrewAI {CREWAI_VERSION} 이(가) 설치되어 있으나 "
            f"crewai_compat 은 {VERIFIED_CREWAI_VERSION} 기준으로 검증되었습니다. "
            f"docs/CREWAI_RECON.md 재검증이 필요합니다."
        )
        logger.warning(msg)
        return msg
    return None


# ---------------------------------------------------------------------------
# 2. LLM 프로바이더 라우팅 (RECON §2)
# ---------------------------------------------------------------------------

#: 우리 provider 키 → CrewAI 모델 문자열 접두사
PROVIDER_PREFIX: dict[str, str] = {
    "openai": "openai/",
    "anthropic": "anthropic/",
    "gemini": "gemini/",
    "groq": "groq/",  # 네이티브 미지원 → litellm 폴백 (RECON F2)
    "ollama": "ollama/",  # openai_compatible 경로
    "openai_compatible": "openai/",  # base_url 과 함께 쓸 때만 유효
}

#: 우리 provider 키 → BYOK 환경변수/헤더 키 이름
PROVIDER_KEY_NAME: dict[str, str | None] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "ollama": None,  # 키 불필요
    "openai_compatible": "OPENAI_API_KEY",
}

#: litellm 폴백 경로를 타는 프로바이더 (litellm 미설치 시 실행 불가)
LITELLM_DEPENDENT_PROVIDERS: frozenset[str] = frozenset({"groq"})

SUPPORTED_PROVIDERS: tuple[str, ...] = tuple(PROVIDER_PREFIX)


def build_model_string(provider: str, model: str) -> str:
    """`provider` + `model` → CrewAI 가 이해하는 모델 문자열.

    이미 접두사가 붙어 있으면 중복 부착하지 않는다.
    """
    prefix = PROVIDER_PREFIX.get(provider, "")
    if not prefix:
        return model
    return model if model.startswith(prefix) else f"{prefix}{model}"


def normalize_ollama_base_url(host: str) -> str:
    """Ollama 태그 API 호스트 → CrewAI 가 요구하는 OpenAI 호환 base_url.

    CrewAI 의 openai_compatible 프로바이더는 `/v1` 접미사를 기대한다. (RECON F11)
    """
    host = (host or "http://localhost:11434").rstrip("/")
    return host if host.endswith("/v1") else f"{host}/v1"


def make_llm(
    *,
    provider: str,
    model: str,
    temperature: float | None = None,
    max_tokens: int | None = None,
    top_p: float | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout_s: int | None = None,
) -> LLM:
    """LLM 인스턴스 생성.

    `provider=` 인자는 CrewAI 에 넘기지 않는다. 넘기면 네이티브 프로바이더가
    강제되어 groq 같은 litellm 전용 프로바이더가 깨진다. (RECON §2.1)
    모델 문자열 접두사만으로 라우팅시킨다.
    """
    kwargs: dict[str, Any] = {"model": build_model_string(provider, model)}
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if top_p is not None:
        kwargs["top_p"] = top_p
    if api_key:
        kwargs["api_key"] = api_key
    if base_url:
        kwargs["base_url"] = base_url
    if timeout_s is not None:
        kwargs["timeout"] = timeout_s
    return LLM(**kwargs)


# ---------------------------------------------------------------------------
# 3. Agent / Task / Crew 생성 (RECON §3~§5)
# ---------------------------------------------------------------------------

def make_agent(
    *,
    role: str,
    goal: str,
    backstory: str,
    llm: LLM | None = None,
    tools: list[BaseTool] | None = None,
    knowledge_sources: list[Any] | None = None,
    allow_delegation: bool = False,
    verbose: bool = True,
    max_iter: int = 20,
    max_rpm: int | None = None,
    cache: bool = True,
    respect_context_window: bool = True,
    max_execution_time: int | None = None,
    allow_code_execution: bool = False,
    step_callback: Callable[[Any], None] | None = None,
) -> Agent:
    """Agent 생성. 실측 확인된 파라미터만 전달한다."""
    kwargs: dict[str, Any] = {
        "role": role,
        "goal": goal,
        "backstory": backstory,
        "allow_delegation": allow_delegation,
        "verbose": verbose,
        "max_iter": max_iter,
        "cache": cache,
        "respect_context_window": respect_context_window,
    }
    if llm is not None:
        kwargs["llm"] = llm
    if tools:
        kwargs["tools"] = tools
    if knowledge_sources:
        kwargs["knowledge_sources"] = knowledge_sources
    if max_rpm is not None:
        kwargs["max_rpm"] = max_rpm
    if max_execution_time is not None:
        kwargs["max_execution_time"] = max_execution_time
    if allow_code_execution:
        # RECON F5: CodeInterpreterTool 부재 → 에이전트 네이티브 코드 실행으로 대체.
        # 항상 safe 모드(Docker 샌드박스). unsafe 는 노출하지 않는다.
        kwargs["allow_code_execution"] = True
        kwargs["code_execution_mode"] = "safe"
    if step_callback is not None:
        kwargs["step_callback"] = step_callback
    return Agent(**kwargs)


def make_task(
    *,
    description: str,
    expected_output: str,
    agent: Agent,
    name: str | None = None,
    context: list[Task] | None = None,
    tools: list[BaseTool] | None = None,
    async_execution: bool = False,
    human_input: bool = False,
    output_file: str | None = None,
    markdown: bool = True,
    max_retries: int | None = None,
) -> Task:
    """Task 생성.

    `context` 가 비어 있으면 인자를 **생략**한다. `None` 을 넘기면 CrewAI 가
    "컨텍스트 없음"으로 확정해 자동 컨텍스트 전달을 꺼 버린다. (RECON F12)
    """
    kwargs: dict[str, Any] = {
        "description": description,
        "expected_output": expected_output,
        "agent": agent,
        "async_execution": async_execution,
        "human_input": human_input,
        "markdown": markdown,
    }
    if name:
        # 이벤트 페이로드의 task_name 으로 되돌아온다 → 캔버스 노드명을 넣는다.
        kwargs["name"] = name
    if context:
        kwargs["context"] = context
    if tools:
        kwargs["tools"] = tools
    if output_file:
        kwargs["output_file"] = output_file
    if max_retries is not None:
        kwargs["max_retries"] = max_retries
    return Task(**kwargs)


def make_crew(
    *,
    agents: list[Agent],
    tasks: list[Task],
    process: str = "sequential",
    name: str | None = None,
    verbose: bool = True,
    memory: bool = False,
    cache: bool = True,
    max_rpm: int | None = None,
    planning: bool = False,
    manager_llm: LLM | None = None,
    knowledge_sources: list[Any] | None = None,
    step_callback: Callable[[Any], None] | None = None,
    task_callback: Callable[[Any], None] | None = None,
) -> Crew:
    """Crew 생성. `full_output` 은 1.15.18 에 존재하지 않는다. (RECON F3)"""
    kwargs: dict[str, Any] = {
        "agents": agents,
        "tasks": tasks,
        "process": resolve_process(process),
        "verbose": verbose,
        "memory": memory,
        "cache": cache,
        "planning": planning,
    }
    if name:
        kwargs["name"] = name
    if max_rpm is not None:
        kwargs["max_rpm"] = max_rpm
    if manager_llm is not None:
        kwargs["manager_llm"] = manager_llm
    if knowledge_sources:
        kwargs["knowledge_sources"] = knowledge_sources
    if step_callback is not None:
        kwargs["step_callback"] = step_callback
    if task_callback is not None:
        kwargs["task_callback"] = task_callback
    return Crew(**kwargs)


def resolve_process(name: str) -> Process:
    """문자열 → Process enum. 실측 멤버는 sequential / hierarchical 둘뿐."""
    try:
        return Process[name]
    except KeyError as exc:  # pragma: no cover - 검증기가 먼저 걸러낸다
        raise ValueError(
            f"지원하지 않는 process '{name}'. 사용 가능: {list(Process.__members__)}"
        ) from exc


PROCESS_MEMBERS: tuple[str, ...] = tuple(Process.__members__)


# ---------------------------------------------------------------------------
# 4. 식별자 추출 — 노드 역매핑용 (RECON F7)
# ---------------------------------------------------------------------------

def agent_key(agent: Agent) -> str:
    """Agent 인스턴스 → 이벤트의 `agent_id` 와 대조 가능한 문자열 키."""
    return str(getattr(agent, "id", id(agent)))


def task_key(task: Task) -> str:
    """Task 인스턴스 → 이벤트의 `task_id` 와 대조 가능한 문자열 키."""
    return str(getattr(task, "id", id(task)))


def instance_key(obj: Any) -> str | None:
    """임의의 CrewAI 객체 → `agent_key`/`task_key` 와 같은 형태의 문자열 키.

    이벤트 페이로드에 `agent_id`/`task_id` 가 비어 있을 때(RECON F15 — 예:
    `AgentExecutionStartedEvent`), 이벤트를 발행한 **source 객체 자체**로
    노드를 역매핑하기 위해 쓴다. `id` 속성이 없으면 `None`.
    """
    ident = getattr(obj, "id", None)
    return str(ident) if ident is not None else None


def collect_run_objects(crew: Crew) -> list[Any]:
    """이 크루 실행에서 이벤트 버스의 `source` 로 등장할 수 있는 객체 전량.

    ⚠️ RECON F15: `crewai_event_bus.emit(source, event)` 의 `source` 는 **이벤트를
       발행한 객체 자신**이다 — `Task.execute` 는 `Task` 를, `Agent.execute_task` 는
       `Agent` 를, LLM 호출은 `LLM` 을 넘긴다. `Crew` 가 source 로 오는 건
       `crew_*` 이벤트뿐이다. 따라서 run 라우팅을 `id(crew)` 하나로만 하면
       task/agent/llm 이벤트가 전부 버려진다.

    알 수 없는 속성은 조용히 건너뛴다(더미 객체·CrewAI 버전차 방어).
    """
    objs: list[Any] = [crew]
    agents = list(getattr(crew, "agents", None) or [])
    tasks = list(getattr(crew, "tasks", None) or [])
    objs.extend(agents)
    objs.extend(tasks)

    for attr in ("manager_agent", "manager_llm", "function_calling_llm"):
        value = getattr(crew, attr, None)
        if value is not None:
            objs.append(value)

    for holder in (*agents, *tasks):
        for attr in ("llm", "function_calling_llm", "agent_executor"):
            value = getattr(holder, attr, None)
            if value is not None:
                objs.append(value)
        objs.extend(getattr(holder, "tools", None) or [])

    # 같은 객체가 여러 번 들어와도 무해하지만(딕셔너리 키), 중복은 걷어낸다.
    seen: set[int] = set()
    unique: list[Any] = []
    for obj in objs:
        if id(obj) not in seen:
            seen.add(id(obj))
            unique.append(obj)
    return unique


# ---------------------------------------------------------------------------
# 5. 콜백 페이로드 정규화 (RECON §3~§4, F6)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StepInfo:
    """`step_callback` 페이로드 정규화 결과.

    ⚠️ AgentAction / AgentFinish 에는 에이전트 식별자가 없다. (RECON F6)
       따라서 이 값만으로 노드를 특정할 수 없다. 노드 매핑은 이벤트 버스가 한다.
    """

    kind: str  # 'action' | 'finish' | 'unknown'
    thought: str | None
    tool: str | None
    tool_input: str | None
    text: str | None
    result: str | None


def normalize_step(payload: Any) -> StepInfo:
    """AgentAction / AgentFinish → StepInfo. 알 수 없는 타입도 죽지 않는다."""
    if isinstance(payload, AgentAction):
        return StepInfo(
            kind="action",
            thought=getattr(payload, "thought", None),
            tool=getattr(payload, "tool", None),
            tool_input=getattr(payload, "tool_input", None),
            text=getattr(payload, "text", None),
            result=getattr(payload, "result", None),
        )
    if isinstance(payload, AgentFinish):
        out = getattr(payload, "output", None)
        return StepInfo(
            kind="finish",
            thought=getattr(payload, "thought", None),
            tool=None,
            tool_input=None,
            text=getattr(payload, "text", None),
            result=out if isinstance(out, str) else str(out) if out is not None else None,
        )
    return StepInfo(
        kind="unknown",
        thought=None,
        tool=None,
        tool_input=None,
        text=str(payload)[:500] if payload is not None else None,
        result=None,
    )


@dataclass(frozen=True)
class TaskResult:
    """`TaskOutput` 정규화. `.agent` 는 role 문자열이므로 역매핑에 쓰지 않는다."""

    name: str | None
    description: str
    raw: str
    agent_role: str | None
    json_dict: dict[str, Any] | None


def normalize_task_output(output: Any) -> TaskResult:
    if isinstance(output, TaskOutput):
        return TaskResult(
            name=getattr(output, "name", None),
            description=getattr(output, "description", "") or "",
            raw=getattr(output, "raw", "") or "",
            agent_role=getattr(output, "agent", None),
            json_dict=getattr(output, "json_dict", None),
        )
    return TaskResult(
        name=None, description="", raw=str(output or ""), agent_role=None, json_dict=None
    )


@dataclass(frozen=True)
class RunResult:
    """`CrewOutput` 정규화."""

    raw: str
    tasks: list[TaskResult]
    usage: dict[str, int]


def normalize_crew_output(output: Any) -> RunResult:
    if isinstance(output, CrewOutput):
        usage_obj = getattr(output, "token_usage", None)
        usage: dict[str, int] = {}
        if usage_obj is not None:
            dump = getattr(usage_obj, "model_dump", None)
            raw_usage = dump() if callable(dump) else dict(getattr(usage_obj, "__dict__", {}))
            usage = {k: int(v) for k, v in raw_usage.items() if isinstance(v, (int, float))}
        return RunResult(
            raw=getattr(output, "raw", "") or "",
            tasks=[normalize_task_output(t) for t in (getattr(output, "tasks_output", None) or [])],
            usage=usage,
        )
    return RunResult(raw=str(output or ""), tasks=[], usage={})


# ---------------------------------------------------------------------------
# 6. 이벤트 버스 (RECON §6)
# ---------------------------------------------------------------------------

#: 우리가 구독하는 CrewAI 이벤트. Spec §10.2 SSE 카탈로그와 1:1 대응.
EVENT_CLASSES: dict[str, type] = {
    "crew_started": CrewKickoffStartedEvent,
    "crew_completed": CrewKickoffCompletedEvent,
    "crew_failed": CrewKickoffFailedEvent,
    "task_started": TaskStartedEvent,
    "task_completed": TaskCompletedEvent,
    "task_failed": TaskFailedEvent,
    "agent_started": AgentExecutionStartedEvent,
    "agent_completed": AgentExecutionCompletedEvent,
    "agent_failed": AgentExecutionErrorEvent,
    "tool_started": ToolUsageStartedEvent,
    "tool_finished": ToolUsageFinishedEvent,
    "tool_error": ToolUsageErrorEvent,
    "llm_completed": LLMCallCompletedEvent,
    "llm_failed": LLMCallFailedEvent,
}


@dataclass(frozen=True)
class EventInfo:
    """CrewAI 이벤트 → 프레임워크 중립 구조체.

    모든 CrewAI 이벤트가 BaseEvent 공통 필드로 agent_id / task_id 를 실어 준다.
    이것이 캔버스 노드 역매핑의 1차 키다. (RECON F7)
    """

    kind: str
    agent_id: str | None
    agent_role: str | None
    task_id: str | None
    task_name: str | None
    payload: dict[str, Any]


def _s(value: Any, limit: int = 4000) -> str | None:
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    return text[:limit]


def normalize_event(kind: str, event: Any) -> EventInfo:
    """이벤트 객체 → EventInfo. 알 수 없는 필드는 조용히 건너뛴다."""
    payload: dict[str, Any] = {}

    if kind == "crew_started":
        payload = {"crew_name": getattr(event, "crew_name", None),
                   "inputs": getattr(event, "inputs", None)}
    elif kind == "crew_completed":
        payload = {"total_tokens": getattr(event, "total_tokens", 0),
                   "output": _s(getattr(getattr(event, "output", None), "raw", None))}
    elif kind in ("crew_failed", "task_failed", "agent_failed", "llm_failed"):
        payload = {"error": _s(getattr(event, "error", None), 1000)}
    elif kind == "task_started":
        payload = {"context": _s(getattr(event, "context", None), 500)}
    elif kind == "task_completed":
        result = normalize_task_output(getattr(event, "output", None))
        payload = {"output": result.raw, "agent_role": result.agent_role}
    elif kind == "agent_started":
        payload = {"task_prompt": _s(getattr(event, "task_prompt", None), 1000)}
    elif kind == "agent_completed":
        payload = {"output": _s(getattr(event, "output", None))}
    elif kind in ("tool_started", "tool_finished", "tool_error"):
        payload = {
            "tool_name": getattr(event, "tool_name", None),
            "tool_class": getattr(event, "tool_class", None),
            "tool_args": _s(getattr(event, "tool_args", None), 800),
            "run_attempts": getattr(event, "run_attempts", 0),
        }
        if kind == "tool_finished":
            payload["output"] = _s(getattr(event, "output", None), 800)
            payload["from_cache"] = bool(getattr(event, "from_cache", False))
            started, finished = getattr(event, "started_at", None), getattr(event, "finished_at", None)
            if started and finished:
                payload["duration_ms"] = int((finished - started).total_seconds() * 1000)
        if kind == "tool_error":
            payload["error"] = _s(getattr(event, "error", None), 500)
    elif kind == "llm_completed":
        payload = {
            "model": getattr(event, "model", None),
            "call_id": getattr(event, "call_id", None),
            "usage": getattr(event, "usage", None) or {},
            "finish_reason": getattr(event, "finish_reason", None),
        }

    return EventInfo(
        kind=kind,
        agent_id=_s(getattr(event, "agent_id", None), 64),
        agent_role=_s(getattr(event, "agent_role", None), 200),
        task_id=_s(getattr(event, "task_id", None), 64),
        task_name=_s(getattr(event, "task_name", None), 200),
        payload=payload,
    )


def register_event_handlers(dispatch: Callable[[EventInfo, Any], None]) -> None:
    """전역 이벤트 버스에 핸들러를 **앱 기동 시 한 번만** 등록한다.

    ⚠️ `crewai_event_bus` 는 프로세스 싱글턴이다. run 마다 `scoped_handlers()` 를
       쓰면 다른 run 의 핸들러가 사라진다. 반드시 단일 등록 + run 라우팅. (RECON §6.3)

    Args:
        dispatch: `(EventInfo, source)` 를 받아 해당 run 으로 라우팅하는 함수.
                  이 함수 안에서 예외가 나도 CrewAI 실행이 죽으면 안 된다.
    """
    for kind, event_cls in EVENT_CLASSES.items():
        def _make(kind: str = kind) -> Callable[[Any, Any], None]:
            def _handler(source: Any, event: Any) -> None:
                try:
                    dispatch(normalize_event(kind, event), source)
                except Exception:  # noqa: BLE001 — 콜백 예외가 실행을 죽이면 안 된다 (Spec §10.4)
                    logger.exception("이벤트 핸들러 실패: %s", kind)

            return _handler

        crewai_event_bus.on(event_cls)(_make())


# ---------------------------------------------------------------------------
# 7. 실행
# ---------------------------------------------------------------------------

def kickoff(crew: Crew, inputs: dict[str, Any] | None = None) -> Any:
    """동기 실행. 워커 스레드에서 호출된다."""
    return crew.kickoff(inputs=inputs or {})


async def kickoff_async(crew: Crew, inputs: dict[str, Any] | None = None) -> Any:
    """비동기 실행. 1.15.18 에 코루틴이 존재한다. (RECON F8)"""
    return await crew.kickoff_async(inputs=inputs or {})


# ---------------------------------------------------------------------------
# 8. 툴
# ---------------------------------------------------------------------------

def make_custom_tool(name: str, description: str, fn: Callable[..., str]) -> BaseTool:
    """`@tool` 데코레이터로 커스텀 툴 생성."""
    fn.__doc__ = description or fn.__doc__ or name
    return crewai_tool_decorator(name)(fn)  # type: ignore[return-value]


def is_base_tool(obj: Any) -> bool:
    return isinstance(obj, BaseTool)


__all__ = [
    "Agent", "Crew", "LLM", "Process", "Task", "BaseTool",
    "CREWAI_VERSION", "VERIFIED_CREWAI_VERSION", "check_version",
    "PROVIDER_PREFIX", "PROVIDER_KEY_NAME", "SUPPORTED_PROVIDERS",
    "LITELLM_DEPENDENT_PROVIDERS", "PROCESS_MEMBERS",
    "build_model_string", "normalize_ollama_base_url",
    "make_llm", "make_agent", "make_task", "make_crew", "resolve_process",
    "agent_key", "task_key", "instance_key", "collect_run_objects",
    "StepInfo", "normalize_step",
    "TaskResult", "normalize_task_output",
    "RunResult", "normalize_crew_output",
    "EventInfo", "EVENT_CLASSES", "normalize_event", "register_event_handlers",
    "kickoff", "kickoff_async",
    "make_custom_tool", "is_base_tool",
]
