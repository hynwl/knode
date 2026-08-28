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
