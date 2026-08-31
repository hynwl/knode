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


def test_custom_http_is_registered_and_enabled_since_m2_t19():
    spec = TOOL_REGISTRY["custom_http"]
    assert spec.enabled is True
    assert spec.build is not None


def test_build_tool_unknown_id_raises_ac_e205():
    node = _tool_node("nonexistent_tool")
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


# ---------------------------------------------------------------------------
# M2-T20: 등록된 모든 툴의 빌더 경로를 최소 1번씩 태운다.
# 지금까지 serper/file_read/directory_read/scrape_website/custom_http 만
# 커버돼 있었고 RAG 3종(website_rag/csv_search/youtube_search)의 `_build_*` 는
# 한 번도 실행되지 않았다 — 생성자 인자 이름이 바뀌면 런타임에야 터졌다.
# ---------------------------------------------------------------------------

_RAG_TOOLS = {
    "website_rag": "WebsiteSearchTool",
    "csv_search": "CSVSearchTool",
    "youtube_search": "YoutubeVideoSearchTool",
}


@pytest.mark.parametrize("tool_id,class_name", sorted(_RAG_TOOLS.items()))
def test_build_tool_rag_tools_instantiate_without_config(tool_id, class_name):
    """설정값(`website`/`csv`/`youtube_video_url`)을 주면 그 자리에서 임베딩
    인덱싱이 돌아 네트워크를 타므로, 여기서는 빈 config 경로만 태운다 —
    설정값을 넣은 인덱싱 동작은 백엔드 자동화 테스트 범위 밖이다."""
    tool = build_tool(_tool_node(tool_id, {}), secrets={"OPENAI_API_KEY": "sk-test-embed"})
    assert tool.__class__.__name__ == class_name


@pytest.mark.parametrize("tool_id", sorted(_RAG_TOOLS))
def test_build_tool_rag_tools_require_openai_key(tool_id):
    with pytest.raises(CompilationError) as exc_info:
        build_tool(_tool_node(tool_id, {}), secrets={})
    assert [i.code for i in exc_info.value.issues] == ["AC-E602"]
    assert "OPENAI_API_KEY" in exc_info.value.issues[0].message


def test_build_tool_scrape_website_without_url_defers_target_to_runtime():
    tool = build_tool(_tool_node("scrape_website", {}))
    assert tool.__class__.__name__ == "ScrapeWebsiteTool"


def test_build_tool_scrape_website_with_public_url_is_bound_at_compile_time():
    tool = build_tool(_tool_node("scrape_website", {"website_url": "https://example.com/a"}))
    assert tool.website_url == "https://example.com/a"


def test_build_tool_custom_http_carries_method_and_static_headers():
    tool = build_tool(_tool_node("custom_http", {
        "name": "Weather",
        "description": "날씨 조회",
        "method": "post",
        "url_template": "https://api.example.com/w/{city}",
        "headers": {"X-Api-Key": "abc"},
    }))
    assert tool.method == "POST"  # 소문자로 줘도 정규화된다
    assert tool.static_headers == {"X-Api-Key": "abc"}
    assert tool.placeholders == ["city"]


def test_build_tool_invalid_config_value_raises_ac_e206_not_a_raw_traceback():
    """빌더가 던지는 임의 예외는 AC-E206(툴 설정이 스키마에 맞지 않습니다)으로
    감싸져 사용자에게 나간다 — 스택 트레이스를 그대로 던지지 않는다(Spec §17.5-4)."""
    node = _tool_node("serper_search", {"n_results": "열개"})
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node, secrets={"SERPER_API_KEY": "sk-test-serper"})
    assert [i.code for i in exc_info.value.issues] == ["AC-E206"]
    assert exc_info.value.issues[0].node_id == "tool_1"
    assert exc_info.value.issues[0].hint


def test_build_tool_security_compilation_error_is_not_reclassified_as_ac_e206():
    """`_SECURITY_GUARDS`가 던진 AC-E801/E802 가 `except Exception` 에 잡혀
    AC-E206 으로 뭉개지면 안 된다 (`build_tool`의 `except CompilationError: raise`)."""
    node = _tool_node("scrape_website", {"website_url": "http://127.0.0.1/admin"})
    with pytest.raises(CompilationError) as exc_info:
        build_tool(node)
    assert [i.code for i in exc_info.value.issues] == ["AC-E801"]


def test_every_registered_tool_has_a_builder_and_json_schema():
    for tool_id, spec in TOOL_REGISTRY.items():
        assert spec.build is not None, f"{tool_id}: build 팩토리가 없다"
        assert spec.enabled is True, f"{tool_id}: 비활성 툴은 레지스트리에서 빼라"
        assert spec.label and spec.description


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
