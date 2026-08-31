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
