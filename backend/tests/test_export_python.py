"""M4-T2: Export to Python 테스트 (Spec §8.5).

이 스위트의 중심은 `test_exported_script_is_equivalent_to_compiled_crew` 다.
생성된 `crew.py` 를 **실제 파일로 써서 import 한 뒤** `build_crew()` 를 호출하고,
같은 그래프를 `CanvasCompiler` 로 컴파일한 결과와 필드 단위로 대조한다.

왜 이렇게까지 하느냐면, `export/python_renderer.py` 는 CrewAI 객체를 만들지 않고
그래프만 보고 코드를 찍어내기 때문이다 — `compiler.py` 에 필드가 하나 추가되고
렌더러가 안 따라가면 **생성 코드는 문법적으로 멀쩡한데 동작만 달라진다.** 그건
어떤 스냅샷 테스트로도 안 잡힌다. 두 결과물을 같은 자리에서 만들어 비교하는
것만이 유일한 방어선이다.

`exec()` 가 아니라 임시 파일 + `importlib` 인 이유: 생성 코드의 `load_dotenv()` 가
호출자 스택 프레임에서 파일 경로를 거슬러 올라가 `.env` 를 찾는데, `exec` 로
만든 합성 프레임에서는 `find_dotenv()` 가 `AssertionError` 로 죽는다. 실제
사용자는 `python crew.py` 로 돌리므로 파일 경로가 있는 쪽이 실측에 가깝다.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.compiler.compiler import CanvasCompiler
from app.core.errors import CompilationError
from app.export.python_renderer import (
    TOOL_EXPORTS,
    py_str,
    py_value,
    render_python,
)
from app.main import app
from app.schemas.graph import CanvasDoc
from app.tools.registry import TOOL_REGISTRY

client = TestClient(app)

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / "backend" / "app" / "data" / "templates"

BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_export",
    "name": "Export Fixture",
    "created_at": "2026-09-02T00:00:00Z",
    "updated_at": "2026-09-02T00:00:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


def _n(node_id: str, node_type: str, data: dict | None = None, x: float = 0, y: float = 0) -> dict:
    return {"id": node_id, "type": node_type, "position": {"x": x, "y": y}, "data": data or {}}


def _e(edge_id: str, source: str, source_handle: str, target: str, target_handle: str) -> dict:
    return {
        "id": edge_id, "source": source, "sourceHandle": source_handle,
        "target": target, "targetHandle": target_handle,
    }


def _doc(nodes: list[dict], edges: list[dict], **overrides: Any) -> CanvasDoc:
    return CanvasDoc.model_validate({**BASE, **overrides, "nodes": nodes, "edges": edges})


def _minimal(**task_data: Any) -> CanvasDoc:
    """LLM → Agent → Task → Crew 최소 그래프."""
    return _doc(
        [
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o", "temperature": 0.5}),
            _n("agent_1", "agent", {"role": "Researcher", "goal": "find", "backstory": "b"}),
            _n("task_1", "task", {"description": "do it", "expected_output": "out", **task_data}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "agent_1", "agent", "task_1", "agent"),
            _e("e3", "task_1", "task", "crew_1", "task"),
            _e("e4", "agent_1", "agent", "crew_1", "agent"),
        ],
    )


def _crew_py(doc: CanvasDoc) -> str:
    return render_python(doc).files[0].content


def _load_exported(code: str, tmp_path: Path, tag: str) -> Any:
    """생성 코드를 파일로 써서 모듈로 불러온다.

    `__name__` 이 `"__main__"` 이 아니므로 스크립트 말미의 `kickoff()` 는 돌지
    않는다 — 그 가드 자체도 이 테스트가 매번 확인하는 셈이다.
    """
    path = tmp_path / f"{tag}_crew.py"
    path.write_text(code, encoding="utf-8")
    spec = importlib.util.spec_from_file_location(f"exported_{tag}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(spec.name, None)
    return module


def _snapshot(crew: Any) -> dict[str, Any]:
    """두 경로(컴파일러 / 생성 스크립트)의 Crew 를 같은 모양으로 납작하게 만든다.

    ⚠️ RECON F12 — `Task.context` 는 비었을 때 리스트가 아니라 센티널이다. 그
    구분까지 스냅샷해야 "빈 리스트를 넘겼는지 인자를 생략했는지"가 대조된다.
    """
    def llm_of(agent: Any) -> Any:
        llm = getattr(agent, "llm", None)
        if llm is None:
            return None
        return tuple(
            getattr(llm, attr, None)
            for attr in ("model", "base_url", "temperature", "max_tokens", "top_p", "timeout")
        )

    return {
        "process": str(crew.process),
        "verbose": crew.verbose,
        "memory": crew.memory,
        "cache": crew.cache,
        "planning": crew.planning,
        "manager_llm": (
            None if getattr(crew, "manager_llm", None) is None
            else tuple(getattr(crew.manager_llm, a, None) for a in ("model", "base_url"))
        ),
        "agents": [
            (
                a.role, a.goal, a.backstory, a.max_iter, a.cache, a.allow_delegation,
                a.verbose, a.respect_context_window, a.max_rpm, llm_of(a),
                sorted(t.name for t in (a.tools or [])),
            )
            for a in crew.agents
        ],
        "tasks": [
            (
                t.description, t.expected_output, t.name, t.human_input, t.markdown,
                t.async_execution, t.output_file,
                t.agent.role if t.agent else None,
                [c.description for c in t.context] if isinstance(t.context, list) else "OMITTED",
                sorted(x.name for x in (t.tools or [])),
            )
            for t in crew.tasks
        ],
    }


# ---------------------------------------------------------------------------
# ⭐ 핵심 — 생성 스크립트 ≡ 컴파일러 산출물
# ---------------------------------------------------------------------------

TEMPLATE_CASES = [
    ("hello", {}),
    ("blog", {}),
    ("market_research", {}),
    ("youtube", {}),
    # `local` 은 필수 Input 에 기본값이 없다 — 실행은 AC-E302 로 막히지만
    # 내보내기는 통과해야 한다(설계 원칙 3). 컴파일러 쪽에만 값을 준다.
    ("local", {"source_text": "원문"}),
]


@pytest.mark.parametrize("template_id, inputs", TEMPLATE_CASES)
def test_exported_script_is_equivalent_to_compiled_crew(
    template_id: str, inputs: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    monkeypatch.setenv("SERPER_API_KEY", "serper-test-not-real")
    raw = json.loads((TEMPLATES_DIR / f"{template_id}.acanvas.json").read_text(encoding="utf-8"))
    doc = CanvasDoc.model_validate(raw)

    exported = _load_exported(_crew_py(doc), tmp_path, template_id).build_crew()
    compiled = CanvasCompiler(
        doc,
        secrets={"OPENAI_API_KEY": "sk-test-not-real", "SERPER_API_KEY": "serper-test-not-real"},
        inputs=inputs,
    ).compile().crew

    assert _snapshot(exported) == _snapshot(compiled)


def test_exported_hierarchical_crew_keeps_manager_llm(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    doc = _doc(
        [
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o-mini"}),
            _n("llm_mgr", "llm", {"provider": "anthropic", "model": "claude-sonnet-4-5"}),
            _n("agent_1", "agent", {"role": "Worker", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "hierarchical"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "agent_1", "agent", "task_1", "agent"),
            _e("e3", "task_1", "task", "crew_1", "task"),
            _e("e4", "agent_1", "agent", "crew_1", "agent"),
            # Crew 의 manager LLM 입력 핸들 이름은 `manager_llm` 이 아니라 `llm` 이다
            # (`validators.py` 의 AC-E103 판정, `compiler.py::_build_crew` 와 동일).
            _e("e5", "llm_mgr", "llm", "crew_1", "llm"),
        ],
    )
    exported = _load_exported(_crew_py(doc), tmp_path, "hier").build_crew()
    compiled = CanvasCompiler(doc, secrets={"OPENAI_API_KEY": "sk-test-not-real"}).compile().crew

    assert str(exported.process) == "Process.hierarchical"
    assert exported.manager_llm is not None
    # ⚠️ 값을 하드코딩하지 않는다 — CrewAI 의 `LLM` 은 네이티브 프로바이더를 알아보면
    # `anthropic/` 접두사를 `.model` 에서 다시 벗겨낸다. 우리가 지켜야 할 계약은
    # "특정 문자열"이 아니라 "서버 실행과 같은 값"이므로 컴파일러 쪽과 대조한다.
    assert exported.manager_llm.model == compiled.manager_llm.model
    assert _snapshot(exported) == _snapshot(compiled)


# ---------------------------------------------------------------------------
# 문자열 리터럴 — 값이 그대로 복원되어야 한다
# ---------------------------------------------------------------------------

TRICKY_STRINGS = [
    "plain",
    "작은따옴표 ' 포함",
    '큰따옴표 " 포함',
    "삼중 \"\"\" 따옴표",
    "백슬래시 \\ 와 \\n 리터럴",
    "여러\n줄\n텍스트",
    "끝이 개행\n",
    "\n앞이 개행",
    "{var} 중괄호와 {{이중}}",
    "탭\t과 유니코드 ✅ 한글",
    "",
    "여러 줄에 따옴표 ' 와 \" 가\n섞인 경우",
]


@pytest.mark.parametrize("value", TRICKY_STRINGS)
def test_py_str_roundtrips_exactly(value: str) -> None:
    """생성 리터럴을 평가하면 원문 그대로여야 한다 — 한 글자도 달라지면 안 된다."""
    assert eval(py_str(value)) == value  # noqa: S307 - 우리가 만든 리터럴만 평가한다


@pytest.mark.parametrize("value", TRICKY_STRINGS)
def test_multiline_literal_survives_reindentation(value: str) -> None:
    """`crew.py.j2` 의 `indent()` 로 밀려도 문자열 값이 바뀌면 안 된다.

    회귀 방지: 처음에는 여러 줄을 삼중따옴표로 냈는데, 템플릿의 `indent(4)` 가
    **문자열 안쪽 줄까지** 밀어 넣어 `local` 템플릿의 `{source_text}` 앞에 공백
    4칸이 붙었다. 지금은 줄마다 닫힌 리터럴을 이어 붙여 그 경로를 막았다.
    """
    literal = py_str(value)
    head, *rest = literal.split("\n")
    reindented = "\n".join([head] + ["        " + line for line in rest])
    assert eval(reindented) == value  # noqa: S307 - 우리가 만든 리터럴만 평가한다


def test_py_value_renders_containers_not_their_repr_as_string() -> None:
    """dict/list 는 문자열이 아니라 리터럴로 나가야 한다 (custom_http headers 경로)."""
    assert eval(py_value({"X-Api": "v1"})) == {"X-Api": "v1"}  # noqa: S307
    assert eval(py_value([1, "a", True])) == [1, "a", True]  # noqa: S307
    assert eval(py_value(None)) is None  # noqa: S307
    assert eval(py_value(3)) == 3  # noqa: S307


# ---------------------------------------------------------------------------
# 툴
# ---------------------------------------------------------------------------

def test_every_enabled_tool_has_export_mapping() -> None:
    """레지스트리에 툴을 추가하고 내보내기 매핑을 잊으면 여기서 깨진다."""
    enabled = {tid for tid, spec in TOOL_REGISTRY.items() if spec.enabled and spec.build is not None}
    assert enabled <= set(TOOL_EXPORTS), f"내보내기 매핑 누락: {sorted(enabled - set(TOOL_EXPORTS))}"


def test_custom_http_tool_becomes_a_runnable_decorated_function(tmp_path: Path) -> None:
    doc = _doc(
        [
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o"}),
            _n("tool_1", "tool", {
                "tool_id": "custom_http",
                "config": {
                    "name": "Weather Lookup",
                    "description": "도시의 날씨를 조회합니다.",
                    "method": "GET",
                    "url_template": "https://api.example.com/w/{city}",
                    "headers": {"X-Api-Key": "placeholder"},
                },
            }),
            _n("agent_1", "agent", {"role": "Reporter", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "tool_1", "tool", "agent_1", "tool"),
            _e("e3", "agent_1", "agent", "task_1", "agent"),
            _e("e4", "task_1", "task", "crew_1", "task"),
            _e("e5", "agent_1", "agent", "crew_1", "agent"),
        ],
    )
    result = render_python(doc)
    code = result.files[0].content
    assert "@tool('Weather Lookup')" in code or '@tool("Weather Lookup")' in code
    assert "city: str" in code  # url_template 의 {city} → 함수 인자
    assert "import requests" in code
    # SSRF 가드가 빠졌다는 사실을 조용히 넘기지 않는다.
    assert any("SSRF" in note for note in result.notes)

    crew = _load_exported(code, tmp_path, "http").build_crew()
    assert [t.name for t in crew.agents[0].tools] == ["Weather Lookup"]
    assert "requests" in "\n".join(f.content for f in result.files if f.filename == "requirements.txt")


def test_workspace_sandboxed_tools_are_exported_with_a_warning(tmp_path: Path) -> None:
    """`file_read` 는 서버에서 WORKSPACE_DIR 로 가둬지지만 스크립트에는 그 경계가 없다."""
    doc = _doc(
        [
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o"}),
            _n("tool_1", "tool", {"tool_id": "file_read", "config": {}}),
            _n("agent_1", "agent", {"role": "Reader", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "tool_1", "tool", "agent_1", "tool"),
            _e("e3", "agent_1", "agent", "task_1", "agent"),
            _e("e4", "task_1", "task", "crew_1", "task"),
            _e("e5", "agent_1", "agent", "crew_1", "agent"),
        ],
    )
    result = render_python(doc)
    code = result.files[0].content
    assert "from crewai_tools import FileReadTool" in code
    assert "base_dir" not in code  # 서버 전용 인자를 흘려보내지 않는다
    assert any("WORKSPACE_DIR" in note for note in result.notes)
    assert _load_exported(code, tmp_path, "fileread").build_crew() is not None


# ---------------------------------------------------------------------------
# 시크릿 / 부수 파일
# ---------------------------------------------------------------------------

def test_api_keys_are_read_from_env_never_hardcoded(tmp_path: Path) -> None:
    """Spec §8.5 MUST — 키 자리는 `os.getenv(...)` 여야 한다."""
    doc = _minimal()
    result = render_python(doc)
    code = result.files[0].content
    assert 'api_key=os.getenv("OPENAI_API_KEY")' in code
    env_example = next(f for f in result.files if f.filename == ".env.example")
    assert "OPENAI_API_KEY=" in env_example.content


def test_renderer_never_receives_or_emits_secret_values() -> None:
    """렌더러에 시크릿을 넘길 통로 자체가 없다 — 시그니처가 그래프만 받는다."""
    import inspect

    params = set(inspect.signature(render_python).parameters)
    assert params == {"doc"}


def test_requirements_pin_only_what_the_graph_needs() -> None:
    plain = render_python(_minimal())
    reqs = next(f for f in plain.files if f.filename == "requirements.txt").content
    assert "crewai==" in reqs
    assert "crewai-tools" not in reqs  # 툴을 안 쓰면 넣지 않는다
    assert "litellm" not in reqs


def test_groq_provider_pulls_in_litellm() -> None:
    """RECON F2 — groq 는 네이티브 미지원이라 litellm 폴백 경로를 탄다."""
    doc = _doc(
        [
            _n("llm_1", "llm", {"provider": "groq", "model": "llama-3.3-70b-versatile"}),
            _n("agent_1", "agent", {"role": "R", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "agent_1", "agent", "task_1", "agent"),
            _e("e3", "task_1", "task", "crew_1", "task"),
            _e("e4", "agent_1", "agent", "crew_1", "agent"),
        ],
    )
    result = render_python(doc)
    code = result.files[0].content
    assert "model='groq/llama-3.3-70b-versatile'" in code
    assert "litellm==" in next(f for f in result.files if f.filename == "requirements.txt").content
    assert 'GROQ_API_KEY=' in next(f for f in result.files if f.filename == ".env.example").content


def test_ollama_base_url_gets_the_openai_compatible_suffix(tmp_path: Path) -> None:
    """RECON F11 — CrewAI 의 ollama 경로는 `/v1` 이 붙은 base_url 을 요구한다."""
    doc = _doc(
        [
            _n("llm_1", "llm", {"provider": "ollama", "model": "llama3.1", "base_url": "http://localhost:11434"}),
            _n("agent_1", "agent", {"role": "R", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "agent_1", "agent", "task_1", "agent"),
            _e("e3", "task_1", "task", "crew_1", "task"),
            _e("e4", "agent_1", "agent", "crew_1", "agent"),
        ],
    )
    result = render_python(doc)
    code = result.files[0].content
    assert "base_url='http://localhost:11434/v1'" in code
    assert "api_key" not in code  # ollama 는 키가 없다
    env_example = next(f for f in result.files if f.filename == ".env.example").content
    assert "API 키가 필요하지 않습니다" in env_example
    assert _load_exported(code, tmp_path, "ollama").build_crew() is not None


# ---------------------------------------------------------------------------
# 검증 / 고지
# ---------------------------------------------------------------------------

def test_invalid_graph_raises_compilation_error_with_all_issues() -> None:
    """Spec §9.3 — 첫 에러만이 아니라 전량을 돌려준다."""
    doc = _doc([_n("agent_1", "agent", {"role": "", "goal": "", "backstory": ""})], [])
    with pytest.raises(CompilationError) as exc:
        render_python(doc)
    codes = {i.code for i in exc.value.issues}
    assert "AC-E101" in codes  # Crew 노드 없음


def test_export_succeeds_where_run_would_fail_on_missing_input() -> None:
    """설계 원칙 3 — 내보내기는 빈 필수 입력을 막지 않고 TODO 로 남긴다."""
    doc = _doc(
        [
            _n("input_1", "input", {"var_name": "topic", "label": "주제", "required": True, "default_value": ""}),
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o"}),
            _n("agent_1", "agent", {"role": "R", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "{topic} 조사", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "agent_1", "agent", "task_1", "agent"),
            _e("e3", "task_1", "task", "crew_1", "task"),
            _e("e4", "agent_1", "agent", "crew_1", "agent"),
        ],
    )
    code = _crew_py(doc)
    assert "'topic': ''," in code
    assert "TODO" in code

    with pytest.raises(CompilationError) as exc:
        CanvasCompiler(doc, secrets={}, inputs={}).compile()
    assert {i.code for i in exc.value.issues} == {"AC-E302"}


def test_human_input_task_is_exported_with_a_note(tmp_path: Path) -> None:
    """RECON F16 — 우리 프로바이더는 서버 전용이라 스크립트는 stdin 으로 물어본다."""
    doc = _minimal(human_input=True)
    result = render_python(doc)
    assert "human_input=True" in result.files[0].content
    assert any("표준입력" in note for note in result.notes)
    assert _load_exported(result.files[0].content, tmp_path, "human").build_crew().tasks[0].human_input


def test_bypassed_and_note_nodes_are_left_out(tmp_path: Path) -> None:
    """`normalize()` 와 같은 규칙 — bypass/Note 는 실행에도 스크립트에도 없다."""
    doc = _doc(
        [
            _n("note_1", "note", {"text": "메모"}),
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o"}),
            _n("tool_1", "tool", {"tool_id": "scrape_website", "config": {}}),
            _n("agent_1", "agent", {"role": "R", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "tool_1", "tool", "agent_1", "tool"),
            _e("e3", "agent_1", "agent", "task_1", "agent"),
            _e("e4", "task_1", "task", "crew_1", "task"),
            _e("e5", "agent_1", "agent", "crew_1", "agent"),
        ],
    )
    doc.nodes[2].ui.bypassed = True  # tool_1
    code = _crew_py(doc)
    assert "ScrapeWebsiteTool" not in code
    assert "메모" not in code
    assert _load_exported(code, tmp_path, "bypass").build_crew().agents[0].tools == []


def test_generated_variable_names_are_ascii_and_unique(tmp_path: Path) -> None:
    """한국어 역할명은 슬러그가 비어 번호 폴백으로 떨어진다 (유니코드 식별자 금지)."""
    doc = _doc(
        [
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o"}),
            _n("agent_1", "agent", {"role": "리서처", "goal": "g", "backstory": "b"}),
            _n("agent_2", "agent", {"role": "작성자", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d1", "expected_output": "o"}),
            _n("task_2", "task", {"description": "d2", "expected_output": "o"}),
            _n("crew_1", "crew", {"process": "sequential"}),
        ],
        [
            _e("e1", "llm_1", "llm", "agent_1", "llm"),
            _e("e2", "llm_1", "llm", "agent_2", "llm"),
            _e("e3", "agent_1", "agent", "task_1", "agent"),
            _e("e4", "agent_2", "agent", "task_2", "agent"),
            _e("e5", "task_1", "task", "crew_1", "task"),
            _e("e6", "task_2", "task", "crew_1", "task"),
            _e("e7", "agent_1", "agent", "crew_1", "agent"),
            _e("e8", "agent_2", "agent", "crew_1", "agent"),
        ],
    )
    code = _crew_py(doc)
    assert "agent_1 = Agent(" in code and "agent_2 = Agent(" in code
    assert "리서처 =" not in code and "작성자 =" not in code  # 유니코드 식별자 금지
    crew = _load_exported(code, tmp_path, "korean").build_crew()
    assert sorted(a.role for a in crew.agents) == ["리서처", "작성자"]


# ---------------------------------------------------------------------------
# 라우터
# ---------------------------------------------------------------------------

def test_export_endpoint_returns_three_files() -> None:
    doc = _minimal()
    res = client.post("/api/v1/export/python", json={"graph": doc.model_dump(by_alias=True, mode="json")})
    assert res.status_code == 200
    body = res.json()
    assert [f["filename"] for f in body["files"]] == ["crew.py", "requirements.txt", ".env.example"]
    assert body["files"][0]["language"] == "python"


def test_export_endpoint_zip_contains_the_same_files() -> None:
    import io
    import zipfile

    doc = _minimal()
    res = client.post(
        "/api/v1/export/python?format=zip",
        json={"graph": doc.model_dump(by_alias=True, mode="json")},
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert "attachment" in res.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(res.content)) as archive:
        assert sorted(archive.namelist()) == [".env.example", "crew.py", "requirements.txt"]


def test_zip_filename_header_is_exposed_to_cross_origin_js() -> None:
    """⚠️ 브라우저는 교차 출처 응답에서 단순 헤더만 JS 에 준다.

    `Access-Control-Expose-Headers` 에 `Content-Disposition` 이 없으면
    `res.headers.get(...)` 이 **조용히 null 을 돌려주고** 다운로드 파일명이
    폴백된다(실제로 Playwright 검증에서 `crew.zip` 으로 떨어졌다). 조용히
    깨지는 종류라 계약으로 고정한다.
    """
    doc = _minimal()
    res = client.post(
        "/api/v1/export/python?format=zip",
        json={"graph": doc.model_dump(by_alias=True, mode="json")},
        headers={"Origin": "http://localhost:3000"},
    )
    exposed = {h.strip().lower() for h in res.headers["access-control-expose-headers"].split(",")}
    assert "content-disposition" in exposed


def test_export_endpoint_zip_filename_stays_ascii_for_korean_project() -> None:
    """`Content-Disposition` 은 latin-1 헤더 — 한글 이름을 그대로 실으면 응답이 깨진다."""
    doc = _minimal()
    payload = doc.model_dump(by_alias=True, mode="json")
    payload["name"] = "한글 프로젝트"
    res = client.post("/api/v1/export/python?format=zip", json={"graph": payload})
    assert res.status_code == 200
    disposition = res.headers["content-disposition"]
    assert disposition.isascii()
    # 한글만 있는 이름은 슬러그가 통째로 비어 `crew` 로 폴백된다. 이미 crew 로
    # 끝나므로 `-crew` 를 덧붙이지 않는다("crew-crew.zip" 방지).
    assert 'filename="crew.zip"' in disposition


def test_export_endpoint_returns_422_envelope_for_invalid_graph() -> None:
    doc = _doc([_n("agent_1", "agent", {"role": "", "goal": "", "backstory": ""})], [])
    res = client.post("/api/v1/export/python", json={"graph": doc.model_dump(by_alias=True, mode="json")})
    assert res.status_code == 422
    body = res.json()
    assert "errors" in body and body["errors"]
    assert "AC-E101" in {e["code"] for e in body["errors"]}
