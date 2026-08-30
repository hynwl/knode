"""M2-T6 테스트: `tools/registry.py` + `routers/tools.py` (Spec §5.6)."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.core.errors import CompilationError
from app.main import app
from app.schemas.graph import AcNode
from app.tools.registry import TOOL_REGISTRY, build_tool, list_tool_specs, tool_spec_to_dict

client = TestClient(app)


def _tool_node(tool_id: str, config: dict | None = None) -> AcNode:
    return AcNode.model_validate({
        "id": "tool_1",
        "type": "tool",
        "position": {"x": 0, "y": 0},
        "data": {"tool_id": tool_id, "config": config or {}},
    })


def test_registry_excludes_code_interpreter_per_recon_f5():
    assert "code_interpreter" not in TOOL_REGISTRY


def test_custom_http_is_registered_but_disabled_pending_ssrf_guard():
    spec = TOOL_REGISTRY["custom_http"]
    assert spec.enabled is False
    assert spec.build is None


def test_build_tool_unknown_id_raises_ac_e205():
    node = _tool_node("nonexistent_tool")
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node)
    assert [i.code for i in exc_info.value.issues] == ["AC-E205"]


def test_build_tool_disabled_id_raises_ac_e205():
    node = _tool_node("custom_http", {"name": "x", "description": "y", "url_template": "https://example.com"})
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node)
    assert [i.code for i in exc_info.value.issues] == ["AC-E205"]


def test_build_tool_missing_required_secret_raises_ac_e602():
    node = _tool_node("serper_search")
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node, secrets={})
    assert [i.code for i in exc_info.value.issues] == ["AC-E602"]


def test_build_tool_with_secret_builds_instance_and_sets_env():
    os.environ.pop("SERPER_API_KEY", None)
    node = _tool_node("serper_search", {"n_results": 3, "country": "kr"})
    tool = build_tool(node, secrets={"SERPER_API_KEY": "sk-test-serper"})
    assert tool.__class__.__name__ == "SerperDevTool"
    assert tool.n_results == 3
    assert tool.country == "kr"
    assert os.environ["SERPER_API_KEY"] == "sk-test-serper"


def test_build_tool_no_secret_needed_for_file_read():
    node = _tool_node("file_read", {"file_path": "README.md"})
    tool = build_tool(node)
    assert tool.__class__.__name__ == "FileReadTool"


def test_every_tool_spec_serializes_to_dict_with_json_schema_shape():
    for spec in list_tool_specs():
        d = tool_spec_to_dict(spec)
        assert d["tool_id"] == spec.tool_id
        assert d["config_schema"]["type"] == "object"
        assert isinstance(d["required_keys"], list)


def test_get_tools_endpoint_serves_registry():
    resp = client.get("/api/v1/tools")
    assert resp.status_code == 200
    body = resp.json()
    tool_ids = {t["tool_id"] for t in body["tools"]}
    assert "serper_search" in tool_ids
    assert "code_interpreter" not in tool_ids
    serper = next(t for t in body["tools"] if t["tool_id"] == "serper_search")
    assert serper["required_keys"] == ["SERPER_API_KEY"]
    assert serper["config_schema"]["properties"]["n_results"]["default"] == 10
