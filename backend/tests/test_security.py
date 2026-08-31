"""M2-T19 테스트: `core/security.py` — SSRF / 경로 탈출 / 코드 인터프리터 가드.

IP 리터럴만 사용해 `validate_url` 이 실제 DNS 조회 없이 판정하는 케이스만
검사한다 (`socket.getaddrinfo` 는 리터럴 IP 에는 네트워크를 타지 않는다) —
CI/샌드박스에서 네트워크 접근 없이 결정적으로 통과해야 한다.
"""

from __future__ import annotations

import os

import pytest

from app.compiler.compiler import CanvasCompiler
from app.core import security
from app.core.errors import CompilationError
from app.schemas.graph import CanvasDoc
from app.tools.registry import build_tool
from app.schemas.graph import AcNode


# ---------------------------------------------------------------------------
# M2-T20: RECON F14 카나리 — 라이브러리에 위임한 전제가 아직 참인지 검사한다.
#
# `docs/CREWAI_RECON.md` §7.2 F14: "CrewAI 버전을 올릴 때 이 파일의 가정이
# 여전히 유효한지 `tests/test_security.py` 로 먼저 재검증한다."
# 아래 테스트들이 그 재검증이다. 우리 가드가 **재구현한 것**과 **라이브러리에
# 위임한 것**을 갈라 놓고, 위임한 쪽의 전제가 깨지면 여기서 먼저 빨개진다.
# ---------------------------------------------------------------------------

def test_canary_crewai_tools_security_subpackage_still_exposes_the_primitives():
    """`crewai_tools.security` 가 사라지면 `core/security.py` 는 자체 SSRF/경로
    가드로 되돌아가야 한다 — 그 판단을 여기서 먼저 강제한다."""
    from crewai_tools.security import safe_path, ssrf_adapter

    for fn_name in ("validate_url", "validate_file_path", "validate_directory_path", "format_sandbox_error"):
        assert callable(getattr(safe_path, fn_name)), f"safe_path.{fn_name} 이 사라졌다"
    assert hasattr(ssrf_adapter, "SSRFProtectedAdapter")


def test_canary_validate_path_helpers_still_take_base_dir_as_second_arg():
    """`core/security.py` 는 `validate_file_path(path, base_dir)` 위치 인자로 호출한다."""
    import inspect

    from crewai_tools.security import safe_path

    for fn in (safe_path.validate_file_path, safe_path.validate_directory_path):
        params = list(inspect.signature(fn).parameters)
        assert params[:2] == ["path", "base_dir"], f"{fn.__name__} 시그니처가 바뀌었다: {params}"


def test_canary_force_safe_paths_is_locked_on_at_import_time():
    """BYOK 멀티테넌트라 `CREWAI_TOOLS_ALLOW_UNSAFE_PATHS` 해치가 임의 env 로
    열려서는 안 된다 — `core/security.py` 임포트 시점에 잠근다."""
    assert os.environ.get("CREWAI_TOOLS_FORCE_SAFE_PATHS") == "true"


def test_canary_file_read_tool_constructor_path_still_bypasses_containment(workspace, tmp_path):
    """RECON F14 핵심 함정: `FileReadTool(file_path=...)` 로 생성자에 박은 경로는
    `base_dir` 컨테인먼트를 **우회한다**(라이브러리가 "개발자 의도"로 신뢰).
    그래서 `guard_declared_file_path()` 가 유일한 방어선이다.

    이 전제가 깨지면(라이브러리가 생성자 경로도 가두기 시작하면) 우리 가드는
    중복이 되지만 해롭지는 않다 — 그때 이 테스트를 갱신하면 된다. 반대로
    가드를 빼도 되겠다고 지레짐작하는 걸 막는 게 이 테스트의 목적이다.
    """
    from crewai_tools import FileReadTool

    outside = tmp_path / "outside.txt"
    outside.write_text("secret-outside-workspace")

    bypassing = FileReadTool(file_path=str(outside), base_dir=str(workspace))
    assert "secret-outside-workspace" in bypassing.run()

    # 반대로 런타임에 에이전트가 고른 경로는 같은 base_dir 로 정상 차단된다.
    contained = FileReadTool(base_dir=str(workspace))
    assert contained.run(file_path=str(outside)).startswith("Error:")


def test_canary_file_read_declared_path_is_blocked_by_our_guard_before_the_tool_exists(workspace, tmp_path):
    """위 우회 경로를 우리가 실제로 막고 있는지 — 가드 없이는 파일이 새어 나간다."""
    outside = tmp_path / "outside.txt"
    outside.write_text("secret-outside-workspace")
    node = _tool_node("file_read", {"file_path": str(outside)})
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node)
    assert [i.code for i in exc_info.value.issues] == ["AC-E802"]


def test_canary_directory_read_tool_still_has_no_base_dir_parameter():
    """`DirectoryReadTool` 에 `base_dir` 가 생기면 `WorkspaceDirectoryReadTool`
    서브클래스는 불필요해진다 — 그 판단 시점을 여기서 잡는다."""
    from crewai_tools import DirectoryReadTool

    assert "base_dir" not in DirectoryReadTool.model_fields
    assert "base_dir" in __import__("crewai_tools", fromlist=["FileReadTool"]).FileReadTool.model_fields


def test_canary_plain_directory_read_tool_would_contain_to_cwd_not_workspace(workspace, tmp_path, monkeypatch):
    """맨 `DirectoryReadTool` 은 `WORKSPACE_DIR` 이 아니라 프로세스 cwd 로 가둬진다.
    (그래서 `_build_directory_read` 가 서브클래스를 쓴다.)"""
    from crewai_tools import DirectoryReadTool

    cwd_visible = tmp_path / "cwd_only"
    cwd_visible.mkdir()
    (cwd_visible / "leak.txt").write_text("x")
    monkeypatch.chdir(tmp_path)

    # cwd 안이라 통과한다 — WORKSPACE_DIR 밖인데도.
    assert "leak.txt" in DirectoryReadTool().run(directory=str(cwd_visible))
    # 우리 서브클래스는 같은 경로를 WORKSPACE_DIR 기준으로 막는다.
    with pytest.raises(ValueError):
        security.WorkspaceDirectoryReadTool().run(directory=str(cwd_visible))


def test_canary_scrape_website_tool_routes_through_the_library_ssrf_guard():
    """`ScrapeWebsiteTool` 의 SSRF 방어는 라이브러리 위임분이다 — 우리가 하는 건
    컴파일 타임 선검사(AC-E801)로 UX 를 개선하는 것뿐이다."""
    import inspect

    from crewai_tools import ScrapeWebsiteTool

    source = inspect.getsource(ScrapeWebsiteTool)
    assert "safe_get" in source, "ScrapeWebsiteTool 이 더 이상 safe_get 을 쓰지 않는다"


# ---------------------------------------------------------------------------
# guard_declared_url — AC-E801
# ---------------------------------------------------------------------------

def test_guard_declared_url_allows_none_and_empty():
    security.guard_declared_url(None, node_id="n1")
    security.guard_declared_url("", node_id="n1")


def test_guard_declared_url_allows_public_ip_literal():
    security.guard_declared_url("http://1.1.1.1/", node_id="n1")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",  # 클라우드 메타데이터
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "file:///etc/passwd",
    ],
)
def test_guard_declared_url_blocks_private_and_reserved_targets(url):
    with pytest.raises(CompilationError) as exc_info:
        security.guard_declared_url(url, node_id="n1")
    assert [i.code for i in exc_info.value.issues] == ["AC-E801"]
    assert exc_info.value.issues[0].node_id == "n1"


# ---------------------------------------------------------------------------
# guard_declared_file_path / guard_declared_directory_path — AC-E802
# ---------------------------------------------------------------------------

@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    ws = tmp_path / "workspace"
    ws.mkdir()
    (ws / "notes.txt").write_text("hi")
    (ws / "sub").mkdir()
    monkeypatch.setenv("WORKSPACE_DIR", str(ws))
    return ws


def test_guard_declared_file_path_allows_path_inside_workspace(workspace):
    security.guard_declared_file_path("notes.txt", node_id="n1")
    security.guard_declared_file_path(str(workspace / "notes.txt"), node_id="n1")


def test_guard_declared_file_path_blocks_traversal_outside_workspace(workspace):
    with pytest.raises(CompilationError) as exc_info:
        security.guard_declared_file_path("../outside.txt", node_id="n1")
    assert [i.code for i in exc_info.value.issues] == ["AC-E802"]


def test_guard_declared_file_path_blocks_absolute_path_outside_workspace(workspace):
    with pytest.raises(CompilationError) as exc_info:
        security.guard_declared_file_path("/etc/passwd", node_id="n1")
    assert [i.code for i in exc_info.value.issues] == ["AC-E802"]


def test_guard_declared_directory_path_allows_subdir(workspace):
    security.guard_declared_directory_path("sub", node_id="n1")


def test_guard_declared_directory_path_blocks_outside_workspace(workspace):
    with pytest.raises(CompilationError) as exc_info:
        security.guard_declared_directory_path("/etc", node_id="n1")
    assert [i.code for i in exc_info.value.issues] == ["AC-E802"]


# ---------------------------------------------------------------------------
# guard_code_interpreter — AC-E803
# ---------------------------------------------------------------------------

def test_guard_code_interpreter_noop_when_not_requested():
    security.guard_code_interpreter(False, node_id="n1")


def test_guard_code_interpreter_blocks_when_setting_off(monkeypatch):
    monkeypatch.delenv("ENABLE_CODE_INTERPRETER", raising=False)
    with pytest.raises(CompilationError) as exc_info:
        security.guard_code_interpreter(True, node_id="n1")
    assert [i.code for i in exc_info.value.issues] == ["AC-E803"]


def test_guard_code_interpreter_allows_when_setting_on(monkeypatch):
    monkeypatch.setenv("ENABLE_CODE_INTERPRETER", "true")
    security.guard_code_interpreter(True, node_id="n1")


# ---------------------------------------------------------------------------
# WorkspaceDirectoryReadTool — 런타임 바인딩
# ---------------------------------------------------------------------------

def test_workspace_directory_read_tool_lists_files_inside_workspace(workspace):
    tool = security.WorkspaceDirectoryReadTool()
    result = tool.run(directory=str(workspace))
    assert "notes.txt" in result


def test_workspace_directory_read_tool_blocks_directory_outside_workspace(workspace):
    tool = security.WorkspaceDirectoryReadTool()
    with pytest.raises(ValueError):
        tool.run(directory="/etc")


# ---------------------------------------------------------------------------
# CustomHttpTool / safe_http_request — 런타임 바인딩
# ---------------------------------------------------------------------------

def test_custom_http_tool_extracts_placeholders_from_url_template():
    tool = security.CustomHttpTool(
        name="Search API",
        description="d",
        url_template="https://api.example.com/search?q={query}&lang={lang}",
    )
    assert tool.placeholders == ["lang", "query"]


def test_custom_http_tool_run_blocks_private_ip_without_raising():
    tool = security.CustomHttpTool(
        name="Metadata Probe",
        description="d",
        url_template="http://{host}/latest/meta-data/",
    )
    result = tool.run(host="169.254.169.254")
    assert result.startswith("Error:")
    assert "private" in result.lower() or "reserved" in result.lower()


def test_safe_http_request_rejects_file_scheme():
    with pytest.raises(ValueError):
        security.safe_http_request("GET", "file:///etc/passwd")


# ---------------------------------------------------------------------------
# 레지스트리 통합 — build_tool() 이 컴파일 타임에 먼저 막는다
# ---------------------------------------------------------------------------

def _tool_node(tool_id: str, config: dict) -> AcNode:
    return AcNode.model_validate({
        "id": "tool_1",
        "type": "tool",
        "position": {"x": 0, "y": 0},
        "data": {"tool_id": tool_id, "config": config},
    })


def test_build_tool_file_read_declared_path_outside_workspace_raises_ac_e802(workspace):
    node = _tool_node("file_read", {"file_path": "/etc/passwd"})
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node)
    assert [i.code for i in exc_info.value.issues] == ["AC-E802"]


def test_build_tool_directory_read_binds_workspace_dir(workspace):
    node = _tool_node("directory_read", {"directory": "sub"})
    tool = build_tool(node)
    assert isinstance(tool, security.WorkspaceDirectoryReadTool)


def test_build_tool_scrape_website_declared_private_ip_raises_ac_e801():
    node = _tool_node("scrape_website", {"website_url": "http://127.0.0.1:8000/admin"})
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node)
    assert [i.code for i in exc_info.value.issues] == ["AC-E801"]


def test_build_tool_custom_http_static_private_ip_raises_ac_e801():
    node = _tool_node(
        "custom_http",
        {"name": "x", "description": "y", "url_template": "http://127.0.0.1/x"},
    )
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node)
    assert [i.code for i in exc_info.value.issues] == ["AC-E801"]


def test_build_tool_custom_http_with_placeholder_skips_static_precheck():
    node = _tool_node(
        "custom_http",
        {"name": "x", "description": "y", "url_template": "http://{host}/x"},
    )
    tool = build_tool(node)
    assert isinstance(tool, security.CustomHttpTool)


# ---------------------------------------------------------------------------
# compiler.py 통합 — AC-E803
# ---------------------------------------------------------------------------

_BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_sec_test",
    "name": "Security Test",
    "created_at": "2026-08-31T00:00:00Z",
    "updated_at": "2026-08-31T00:00:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


def _n(node_id, node_type, data=None, x=0, y=0):
    return {"id": node_id, "type": node_type, "position": {"x": x, "y": y}, "data": data or {}}


def _e(edge_id, source, source_handle, target, target_handle):
    return {"id": edge_id, "source": source, "sourceHandle": source_handle, "target": target, "targetHandle": target_handle}


def _code_exec_doc() -> CanvasDoc:
    nodes = [
        _n("crew_1", "crew", {"process": "sequential", "name": "Crew"}),
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b", "allow_code_execution": True}),
        _n("task_1", "task", {"description": "d", "expected_output": "o"}),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "task_1", "task", "crew_1", "task"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
    ]
    return CanvasDoc.model_validate({**_BASE, "nodes": nodes, "edges": edges})


def test_compile_allow_code_execution_without_setting_raises_ac_e803(monkeypatch):
    monkeypatch.delenv("ENABLE_CODE_INTERPRETER", raising=False)
    with pytest.raises(CompilationError) as exc_info:
        CanvasCompiler(_code_exec_doc()).compile()
    assert [i.code for i in exc_info.value.issues] == ["AC-E803"]


def test_compile_allow_code_execution_with_setting_on_succeeds(monkeypatch):
    monkeypatch.setenv("ENABLE_CODE_INTERPRETER", "true")
    result = CanvasCompiler(_code_exec_doc()).compile()
    assert result.crew.agents[0].allow_code_execution is True


# ---------------------------------------------------------------------------
# M2-T20: 가드의 no-op 경로 + CustomHttpTool 실패 경로
# (실패 경로가 예외를 던지면 CrewAI 실행 전체가 죽는다 — 문자열로 돌려줘야 한다.)
# ---------------------------------------------------------------------------

def test_guard_declared_file_and_directory_paths_are_noop_for_empty_values(workspace):
    security.guard_declared_file_path(None, node_id="n1")
    security.guard_declared_file_path("", node_id="n1")
    security.guard_declared_directory_path(None, node_id="n1")
    security.guard_declared_directory_path("", node_id="n1")


def test_workspace_directory_read_tool_requires_a_directory(workspace):
    """`run()` 은 args_schema 가 먼저 막지만, `_run()` 자체도 방어선을 갖는다."""
    tool = security.WorkspaceDirectoryReadTool()
    with pytest.raises(ValueError, match="arguments validation failed"):
        tool.run()
    with pytest.raises(ValueError, match="Directory must be provided"):
        tool._run()


def test_workspace_directory_read_tool_strips_trailing_slash(workspace):
    tool = security.WorkspaceDirectoryReadTool()
    result = tool.run(directory=str(workspace) + "/")
    assert "notes.txt" in result
    assert "//notes.txt" not in result


def test_ssrf_safe_session_mounts_the_protected_adapter_and_ignores_proxy_env():
    from crewai_tools.security.ssrf_adapter import SSRFProtectedAdapter

    session = security._ssrf_safe_session()
    try:
        # HTTP(S)_PROXY 를 심어 SSRF 가드를 우회하는 고전적인 수법을 막는다.
        assert session.trust_env is False
        assert isinstance(session.adapters["http://"], SSRFProtectedAdapter)
        assert isinstance(session.adapters["https://"], SSRFProtectedAdapter)
    finally:
        session.close()


def test_safe_http_request_validates_url_before_opening_a_session(monkeypatch):
    """URL 검증이 세션 생성보다 먼저다 — 사설 IP 로는 소켓조차 열지 않는다."""
    opened = []
    monkeypatch.setattr(
        security, "_ssrf_safe_session", lambda: opened.append(1) or (_ for _ in ()).throw(AssertionError)
    )
    with pytest.raises(ValueError):
        security.safe_http_request("GET", "http://127.0.0.1/admin")
    assert opened == []


class _FakeSession:
    def __init__(self, response=None, exc=None):
        self.response = response
        self.exc = exc
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if self.exc is not None:
            raise self.exc
        return self.response

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


class _FakeResponse:
    def __init__(self, text):
        self.text = text


def test_safe_http_request_uses_the_guarded_session_and_uppercases_method(monkeypatch):
    session = _FakeSession(response=_FakeResponse("ok"))
    monkeypatch.setattr(security, "_ssrf_safe_session", lambda: session)
    resp = security.safe_http_request("get", "http://1.1.1.1/x", headers={"A": "b"})
    assert resp.text == "ok"
    method, url, kwargs = session.calls[0]
    assert method == "GET"
    assert kwargs["headers"] == {"A": "b"}
    assert kwargs["timeout"] == 15


def test_custom_http_tool_without_placeholders_gets_a_noop_note_argument():
    tool = security.CustomHttpTool(
        name="Ping", description="d", url_template="https://api.example.com/ping"
    )
    assert tool.placeholders == []
    assert "note" in tool.args_schema.model_fields


def test_custom_http_tool_returns_error_string_for_unusable_url_template():
    """`{0}` 같은 위치 인덱스 자리표시자는 키워드 치환에서 IndexError 를 낸다 —
    예외가 새어 나가면 크루 실행 전체가 죽으므로 문자열로 돌려준다."""
    tool = security.CustomHttpTool(
        name="Bad", description="d", url_template="https://api.example.com/{0}"
    )
    result = tool.run(**{"0": "x"})
    assert result.startswith("Error: invalid url_template substitution")


def test_custom_http_tool_returns_error_string_when_the_request_fails(monkeypatch):
    import requests as _requests

    tool = security.CustomHttpTool(
        name="Flaky", description="d", url_template="http://1.1.1.1/{path}"
    )
    monkeypatch.setattr(
        security, "_ssrf_safe_session",
        lambda: _FakeSession(exc=_requests.ConnectionError("boom")),
    )
    result = tool.run(path="x")
    assert result.startswith("Error: HTTP request failed")


def test_custom_http_tool_truncates_very_long_responses(monkeypatch):
    tool = security.CustomHttpTool(
        name="Big", description="d", url_template="http://1.1.1.1/{path}"
    )
    monkeypatch.setattr(
        security, "_ssrf_safe_session",
        lambda: _FakeSession(response=_FakeResponse("x" * 50_000)),
    )
    assert len(tool.run(path="x")) == 20_000
