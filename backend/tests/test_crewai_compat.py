"""crewai_compat 픽스처 테스트.

이 테스트가 깨지면 = CrewAI API 가 바뀐 것이다.
그때 할 일: docs/CREWAI_RECON.md 재작성 → crewai_compat.py 수정 → 이 테스트 갱신.
(Spec §4.3 "버전 시그니처 이슈를 이 파일과 픽스처 테스트만 재검증하면 되도록 격리")
"""

from __future__ import annotations

import pytest

from app.core import crewai_compat as c


# --- 버전 -------------------------------------------------------------------

def test_verified_version_matches_installed():
    assert c.CREWAI_VERSION == c.VERIFIED_CREWAI_VERSION, (
        "설치된 CrewAI 버전이 검증본과 다릅니다. docs/CREWAI_RECON.md 를 재작성하세요."
    )
    assert c.check_version() is None


# --- RECON F3/F4: 존재하지 않는 필드 --------------------------------------

def test_crew_has_no_full_output_field():
    """RECON F3 — 스펙이 가정한 Crew.full_output 은 존재하지 않는다."""
    assert "full_output" not in c.Crew.model_fields


def test_llm_has_no_max_retries_field():
    """RECON F4 — 스펙이 가정한 LLM.max_retries 는 존재하지 않는다."""
    assert "max_retries" not in c.LLM.model_fields


# --- RECON: 우리가 실제로 넘기는 필드가 전부 존재하는가 --------------------

AGENT_FIELDS = [
    "role", "goal", "backstory", "llm", "tools", "knowledge_sources",
    "allow_delegation", "verbose", "max_iter", "max_rpm", "cache",
    "respect_context_window", "max_execution_time", "step_callback",
    "allow_code_execution", "code_execution_mode", "id",
]
TASK_FIELDS = [
    "description", "expected_output", "agent", "context", "tools",
    "async_execution", "human_input", "output_file", "markdown",
    "name", "max_retries", "id",
]
CREW_FIELDS = [
    "agents", "tasks", "process", "verbose", "memory", "cache", "max_rpm",
    "manager_llm", "planning", "step_callback", "task_callback",
    "knowledge_sources", "name",
]
LLM_FIELDS = ["model", "temperature", "max_tokens", "top_p", "api_key", "base_url", "timeout"]


@pytest.mark.parametrize("field", AGENT_FIELDS)
def test_agent_field_exists(field):
    assert field in c.Agent.model_fields


@pytest.mark.parametrize("field", TASK_FIELDS)
def test_task_field_exists(field):
    assert field in c.Task.model_fields


@pytest.mark.parametrize("field", CREW_FIELDS)
def test_crew_field_exists(field):
    assert field in c.Crew.model_fields


@pytest.mark.parametrize("field", LLM_FIELDS)
def test_llm_field_exists(field):
    assert field in c.LLM.model_fields


# --- Process enum -----------------------------------------------------------

def test_process_members():
    assert c.PROCESS_MEMBERS == ("sequential", "hierarchical")
    assert c.resolve_process("sequential") is c.Process.sequential
    assert c.resolve_process("hierarchical") is c.Process.hierarchical


def test_resolve_process_rejects_unknown():
    with pytest.raises(ValueError):
        c.resolve_process("parallel")


# --- RECON §2: LLM 라우팅 ---------------------------------------------------

def test_build_model_string():
    assert c.build_model_string("openai", "gpt-4o-mini") == "openai/gpt-4o-mini"
    assert c.build_model_string("groq", "llama-3.3-70b-versatile") == "groq/llama-3.3-70b-versatile"
    assert c.build_model_string("ollama", "llama3.1") == "ollama/llama3.1"
    # 이미 접두사가 있으면 중복 부착하지 않는다
    assert c.build_model_string("openai", "openai/gpt-4o") == "openai/gpt-4o"


def test_normalize_ollama_base_url_appends_v1():
    """RECON F11 — CrewAI openai_compatible 은 /v1 접미사를 요구한다."""
    assert c.normalize_ollama_base_url("http://localhost:11434") == "http://localhost:11434/v1"
    assert c.normalize_ollama_base_url("http://localhost:11434/") == "http://localhost:11434/v1"
    assert c.normalize_ollama_base_url("http://x:11434/v1") == "http://x:11434/v1"


@pytest.mark.parametrize(
    "provider,model,expected_native",
    [
        ("openai", "gpt-4o-mini", True),
        ("gemini", "gemini-2.0-flash", True),
        ("anthropic", "claude-sonnet-4-5", True),
        ("ollama", "llama3.1", True),
        ("groq", "llama-3.3-70b-versatile", False),  # RECON F2 — litellm 폴백
    ],
)
def test_llm_routing(provider, model, expected_native):
    kwargs = {"provider": provider, "model": model, "api_key": "test-key"}
    if provider == "ollama":
        kwargs["base_url"] = c.normalize_ollama_base_url("http://localhost:11434")
    llm = c.make_llm(**kwargs)
    is_native = not getattr(llm, "is_litellm", False)
    assert is_native is expected_native


def test_groq_requires_litellm():
    """RECON F1/F2 — groq 는 litellm 없이는 생성 자체가 불가능하다."""
    assert "groq" in c.LITELLM_DEPENDENT_PROVIDERS
    import importlib.util
    assert importlib.util.find_spec("litellm") is not None, (
        "litellm 미설치. requirements.txt 에서 제거하면 groq 프로바이더가 깨진다."
    )


# --- RECON F12: Task.context 센티널 -----------------------------------------

def test_task_context_default_is_sentinel_not_none():
    default = c.Task.model_fields["context"].default
    assert default is not None, (
        "Task.context 기본값이 None 이 되었습니다. crewai_compat.make_task 의 "
        "조건부 전달 로직(RECON F12)을 재검토하세요."
    )
    assert type(default).__name__ != "NoneType"


def test_make_task_omits_empty_context():
    agent = c.make_agent(role="r", goal="g", backstory="b")
    task = c.make_task(description="d", expected_output="e", agent=agent, context=None)
    # 컨텍스트를 넘기지 않았으므로 센티널 기본값이 유지되어야 한다
    assert task.context is c.Task.model_fields["context"].default


# --- RECON F6/F7: 이벤트 식별자 --------------------------------------------

BASE_EVENT_IDENTITY_FIELDS = ["agent_id", "agent_role", "task_id", "task_name"]


@pytest.mark.parametrize("kind,event_cls", sorted(c.EVENT_CLASSES.items()))
@pytest.mark.parametrize("field", BASE_EVENT_IDENTITY_FIELDS)
def test_every_event_carries_identity(kind, event_cls, field):
    """RECON F7 — 노드 역매핑이 가능하려면 모든 이벤트가 식별자를 실어야 한다."""
    assert field in event_cls.model_fields, f"{event_cls.__name__} 에 {field} 없음"


def test_agent_action_has_no_identity():
    """RECON F6 — step_callback 페이로드로는 노드를 특정할 수 없음을 고정한다."""
    from crewai.agents.parser import AgentAction
    names = {f.name for f in AgentAction.__dataclass_fields__.values()}
    assert names == {"thought", "tool", "tool_input", "text", "result"}
    assert "agent_id" not in names and "agent" not in names


def test_agent_task_keys_are_uuid_strings():
    agent = c.make_agent(role="r", goal="g", backstory="b")
    task = c.make_task(description="d", expected_output="e", agent=agent)
    assert len(c.agent_key(agent)) == 36  # UUID 문자열
    assert len(c.task_key(task)) == 36


# --- RECON F15: 이벤트 버스의 source 는 Crew 가 아니다 -----------------------


def test_event_bus_source_is_the_emitting_object_not_the_crew():
    """실측 근거 고정. `crewai/task.py` 는 `crewai_event_bus.emit(self, TaskStartedEvent(...))`
    로 **Task 자신**을 source 로 넘긴다 — run 라우팅을 `id(crew)` 로만 하면
    task/agent/llm 이벤트가 전부 버려진다(이 프로젝트에서 실제로 겪은 버그).
    """
    import inspect
    import pathlib
    import re

    import crewai
    from crewai.events.event_bus import crewai_event_bus

    # emit(source, event) — 첫 인자가 source 라는 계약
    assert list(inspect.signature(crewai_event_bus.emit).parameters)[:2] == ["source", "event"]

    # `crewai.task` 는 지연 임포트(PEP 562)라 inspect.getsource 로는 원본 파일을
    # 얻을 수 없다 — 패키지 경로에서 파일을 직접 읽는다.
    source = (pathlib.Path(crewai.__file__).parent / "task.py").read_text(encoding="utf-8")
    assert re.search(r"emit\(\s*self,\s*TaskStartedEvent", source), \
        "Task 가 자기 자신을 source 로 넘기지 않는다 — 이벤트 라우팅 전제가 바뀌었다"


def test_task_started_event_carries_no_agent_id_field_value():
    """`TaskStartedEvent` 는 `task_id` 만 채우고 `agent_id` 는 비운다 (F15).

    그래서 `task.started` 의 agent_node_id 는 직전 `agent_started` 로 폴백해야 한다.
    """
    from crewai.events.types.task_events import TaskStartedEvent

    agent = c.make_agent(role="r", goal="g", backstory="b")
    task = c.make_task(description="d", expected_output="e", agent=agent)
    event = TaskStartedEvent(context=None, task=task)
    assert event.task_id == str(task.id)
    assert event.agent_id is None


def test_instance_key_matches_agent_and_task_key():
    agent = c.make_agent(role="r", goal="g", backstory="b")
    task = c.make_task(description="d", expected_output="e", agent=agent)
    assert c.instance_key(agent) == c.agent_key(agent)
    assert c.instance_key(task) == c.task_key(task)
    assert c.instance_key(object()) is None


def test_collect_run_objects_includes_agents_tasks_and_llms():
    llm = c.make_llm(provider="openai", model="gpt-4o-mini")
    agent = c.make_agent(role="r", goal="g", backstory="b", llm=llm)
    task = c.make_task(description="d", expected_output="e", agent=agent)
    crew = c.make_crew(agents=[agent], tasks=[task])

    objs = c.collect_run_objects(crew)
    ids = {id(o) for o in objs}
    assert id(crew) in ids
    assert id(agent) in ids
    assert id(task) in ids
    assert id(agent.llm) in ids
    assert len(objs) == len(ids)  # 중복 없음


def test_collect_run_objects_tolerates_objects_without_crew_shape():
    class _Bare:
        pass

    bare = _Bare()
    assert c.collect_run_objects(bare) == [bare]


# --- 정규화 -----------------------------------------------------------------

def test_normalize_step_action_and_finish():
    from crewai.agents.parser import AgentAction, AgentFinish
    a = c.normalize_step(AgentAction(thought="t", tool="search", tool_input="q", text="raw"))
    assert (a.kind, a.thought, a.tool) == ("action", "t", "search")
    f = c.normalize_step(AgentFinish(thought="t2", output="done", text="raw2"))
    assert (f.kind, f.result) == ("finish", "done")
    u = c.normalize_step(object())
    assert u.kind == "unknown"


def test_normalize_crew_output_handles_non_crewoutput():
    r = c.normalize_crew_output("plain string")
    assert r.raw == "plain string" and r.tasks == [] and r.usage == {}


# --- RECON F5: 존재하지 않는 툴 ---------------------------------------------

def test_code_interpreter_tool_absent():
    """RECON F5 — 스펙 §5.6 의 CodeInterpreterTool 은 1.15.18 에 없다."""
    import crewai_tools
    assert not hasattr(crewai_tools, "CodeInterpreterTool")


@pytest.mark.parametrize("name", [
    "SerperDevTool", "ScrapeWebsiteTool", "FileReadTool", "DirectoryReadTool",
    "WebsiteSearchTool", "CSVSearchTool", "YoutubeVideoSearchTool",
])
def test_registry_tools_exist(name):
    import crewai_tools
    assert hasattr(crewai_tools, name)


# --- 실행 API ---------------------------------------------------------------

def test_kickoff_async_is_coroutine_function():
    """RECON F8 — kickoff_async 코루틴 존재."""
    import inspect
    assert inspect.iscoroutinefunction(c.Crew.kickoff_async)


def test_crew_has_no_stop_or_cancel():
    """RECON §5 — 취소 API 부재 → step_callback 예외 전략(Spec §10.6) 유지 근거."""
    assert not hasattr(c.Crew, "stop")
    assert not hasattr(c.Crew, "cancel")


# --- RECON F16: Human-in-the-loop 프로바이더 ----------------------------------
#
# 이 절이 깨지면 = CrewAI 가 사람 검토 훅을 바꾼 것이다. 그때 할 일은
# docs/CREWAI_RECON.md §10 재작성 → crewai_compat 의 프로바이더 수정이다.
# 그냥 테스트를 고쳐서 통과시키면 **서버 스레드가 stdin 에서 영원히 멈춘다**.

def test_default_human_input_provider_reads_stdin():
    """F16-a — 기본 프로바이더는 `input()` 을 부른다. 웹 백엔드에선 치명적이라
    반드시 갈아끼워야 한다는 전제 자체를 고정한다."""
    import inspect

    source = inspect.getsource(c.SyncHumanInputProvider._prompt_input)
    assert "input()" in source


def test_human_input_provider_protocol_surface():
    """우리 구현이 만족해야 할 메서드 집합."""
    for name in ("setup_messages", "post_setup_messages", "handle_feedback", "handle_feedback_async"):
        assert hasattr(c.SyncHumanInputProvider, name), f"{name} 이 사라졌다"
        assert hasattr(c.DelegatingHumanInputProvider, name), f"우리 구현에 {name} 이 없다"


def test_agent_executor_calls_provider_when_task_human_input_is_true():
    """F16-a — 사람 검토는 Task 가 아니라 **에이전트 실행기**가 구현한다.

    `Agent._execute_without_timeout` 이 `ask_for_human_input=task.human_input` 을
    실행기에 넘기고, 실행기가 `get_provider().handle_feedback(...)` 을 부른다.
    """
    import inspect

    from crewai.agent.core import Agent as _Agent
    from crewai.experimental.agent_executor import AgentExecutor

    assert "ask_for_human_input" in inspect.getsource(_Agent._execute_without_timeout)
    assert "task.human_input" in inspect.getsource(_Agent._execute_without_timeout)
    handler = inspect.getsource(AgentExecutor._handle_human_feedback)
    assert "get_provider()" in handler
    assert "handle_feedback" in handler


def test_executor_context_members_we_depend_on_exist():
    """F16-b — 우리 프로바이더가 실제로 만지는 컨텍스트 멤버."""
    from crewai.experimental.agent_executor import AgentExecutor

    for name in ("_invoke_loop", "_ainvoke_loop", "_format_feedback_message", "messages"):
        assert hasattr(AgentExecutor, name), f"ExecutorContext.{name} 이 사라졌다"
    # task/crew/agent 는 BaseAgentExecutor 필드다 — 노드 역매핑의 유일한 통로.
    for name in ("task", "crew", "agent"):
        assert name in AgentExecutor.model_fields, f"ExecutorContext.{name} 이 사라졌다"


def test_default_provider_loop_semantics_empty_means_approve():
    """F16-b — 빈 응답 = 승인(종료), 비어 있지 않으면 = 재실행 후 재질문.

    우리 엔드포인트/모달이 이 의미를 그대로 노출하므로 계약이 바뀌면 UI 가 거짓말을 한다.
    """
    import inspect

    source = inspect.getsource(c.SyncHumanInputProvider._handle_regular_feedback)
    assert "while context.ask_for_human_input" in source
    assert 'feedback.strip() == ""' in source
    assert "context.ask_for_human_input = False" in source
    assert "_invoke_loop()" in source


def test_agent_execute_task_swallows_exceptions_into_retry_loop():
    """F16-c — 사람 검토 중단 신호를 `Exception` 으로 던지면 안 되는 이유.

    `execute_task` 의 `except Exception` 이 `_handle_execution_error` 로 보내
    `max_retry_limit`(기본 2)만큼 태스크를 통째로 재실행한다 → 타임아웃이
    "사람에게 두 번 더 묻기"로 둔갑한다. 그래서 `HumanInputAborted` 는
    `BaseException` 을 상속한다.
    """
    import inspect

    from crewai.agent.core import Agent as _Agent

    assert "except Exception as e" in inspect.getsource(_Agent.execute_task)
    assert "_handle_execution_error" in inspect.getsource(_Agent.execute_task)
    assert _Agent.model_fields["max_retry_limit"].default == 2

    from app.runtime.manager import HumanInputAborted

    assert issubclass(HumanInputAborted, BaseException)
    assert not issubclass(HumanInputAborted, Exception)


def test_provider_is_context_var_scoped_and_swappable():
    """F16-d — 프로바이더는 `ContextVar` 에 산다. 설치/복구가 실제로 동작하는지 고정."""
    seen: list[c.HumanFeedbackRequest] = []

    def _handler(request):
        seen.append(request)
        return ""

    before = c.current_human_input_provider()
    token = c.install_human_input_provider(_handler)
    try:
        assert isinstance(c.current_human_input_provider(), c.DelegatingHumanInputProvider)
    finally:
        c.restore_human_input_provider(token)
    assert c.current_human_input_provider() is before


class _FakeExecutorContext:
    """`ExecutorContext` 프로토콜의 최소 구현. 실제 LLM 없이 루프 의미만 검증한다."""

    def __init__(self, answers):
        self._answers = list(answers)
        self.task = None
        self.crew = None
        self.agent = None
        self.messages: list = []
        self.ask_for_human_input = True
        self.llm = None
        self.invocations = 0

    def _invoke_loop(self):
        self.invocations += 1
        return self._answers.pop(0)

    def _is_training_mode(self):
        return False

    def _handle_crew_training_output(self, result, human_feedback=None):
        return None

    def _format_feedback_message(self, feedback):
        return {"role": "user", "content": feedback}


class _FakeAnswer:
    def __init__(self, output):
        self.output = output


def test_our_provider_stops_on_empty_response():
    provider = c.DelegatingHumanInputProvider(lambda req: "")
    ctx = _FakeExecutorContext([])
    answer = provider.handle_feedback(_FakeAnswer("v1"), ctx)
    assert answer.output == "v1"
    assert ctx.invocations == 0
    assert ctx.ask_for_human_input is False


def test_our_provider_reinvokes_on_feedback_then_stops():
    rounds: list[int] = []

    def _handler(request):
        rounds.append(request.round)
        return "더 짧게" if request.round == 1 else ""

    provider = c.DelegatingHumanInputProvider(_handler)
    ctx = _FakeExecutorContext([_FakeAnswer("v2")])
    answer = provider.handle_feedback(_FakeAnswer("v1"), ctx)
    assert answer.output == "v2"
    assert ctx.invocations == 1
    assert rounds == [1, 2]
    assert ctx.messages == [{"role": "user", "content": "더 짧게"}]
