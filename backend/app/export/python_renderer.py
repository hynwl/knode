"""Export to Python — 캔버스 그래프 → 단독 실행 가능한 `crew.py` (Spec §8.5).

전략적 목적은 "락인 없음"의 증명이다. 그래서 이 렌더러의 성공 기준은
**보기 좋은 코드**가 아니라 `python crew.py` 가 서버 실행과 같은 크루를 만드는
것이다. 그 등가성은 `backend/tests/test_export_python.py` 가 생성 코드를 실제로
`exec` 해서 `CanvasCompiler` 산출물과 필드 단위로 대조해 지킨다.

**설계 원칙 3가지**

1. **CrewAI 객체를 만들지 않는다.** 렌더러는 그래프와 위상 정렬만 본다. 그래서
   API 키가 하나도 없어도, 툴 패키지가 없어도 내보내기가 된다. 대신
   `compiler.py` 와 생성 규칙이 갈라질 위험이 생기는데, 이건 위의 등가성
   테스트가 유일한 방어선이다 — 새 필드를 `compiler.py` 에 추가하면 여기도
   같이 고쳐야 하고, 안 고치면 그 테스트가 깨진다.

2. **서버 전용 장치는 내보내지 않는다.** `step_callback`/`task_callback`(SSE
   브릿지), 워크스페이스 샌드박스(`core/security.py`), 우리 human-input
   프로바이더(RECON F16)는 전부 "웹 백엔드라서" 필요한 것들이다. 사용자가 자기
   터미널에서 돌리는 스크립트에는 해당 경계 자체가 없다. 빠진 것은 조용히
   빼지 않고 `notes` + 생성 코드 주석으로 고지한다.

3. **`resolve_inputs()` 를 쓰지 않는다.** 실행(`POST /runs`)은 필수 입력이 비면
   AC-E302 로 막아야 맞지만, 내보내기는 "값은 나중에 채우는" 스캐폴드를 주는
   기능이다. 그래서 정적 검증(`validate_graph`)만 돌리고, 빈 필수 입력은
   `INPUTS` 에 `# TODO` 주석으로 남긴다. 즉 **내보내기는 성공하는데 실행은
   막히는 그래프가 존재할 수 있다** — 의도된 차이다.

Jinja2 는 파일 골격(§8.5 MUST)에만 쓴다. 노드별 표현식은 아래 Python 코드가
만든다 — 템플릿 안에서 조건 분기로 kwargs 를 조립하면 `compiler.py` 와의 대조가
불가능해진다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version as _pkg_version
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from app.compiler.graph import CanvasGraph
from app.compiler.topology import order_tasks
from app.compiler.validators import validate_graph
from app.core.crewai_compat import (
    CREWAI_VERSION,
    LITELLM_DEPENDENT_PROVIDERS,
    PROVIDER_KEY_NAME,
    build_model_string,
    normalize_ollama_base_url,
)
from app.core.errors import CompilationError
from app.export.messages import DEFAULT_LOCALE, Locale, tr
from app.schemas.errors import Issue, has_errors, issue
from app.schemas.graph import AcNode, CanvasDoc
from app.tools.registry import TOOL_REGISTRY

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

#: `compiler.py` 의 `_build_agent` 기본값과 같아야 한다 (RECON F9: CrewAI 기본은 25).
DEFAULT_MAX_ITER = 20


@dataclass(frozen=True)
class ExportedFile:
    filename: str
    #: 프론트 신택스 하이라이터가 보는 힌트. `python` | `text` | `dotenv`.
    language: str
    content: str


@dataclass(frozen=True)
class PythonExport:
    files: list[ExportedFile]
    #: `validate_graph()` 의 경고(severity=warn). 에러는 CompilationError 로 이미 나갔다.
    warnings: list[Issue]
    #: 캔버스에는 있으나 스크립트로 옮길 수 없는 것들에 대한 고지 (설계 원칙 2).
    notes: list[str]


# ---------------------------------------------------------------------------
# 1. Python 리터럴 렌더링
# ---------------------------------------------------------------------------

def py_str(value: str) -> str:
    """문자열 → Python 리터럴. **들여쓰기에 안전해야 한다.**

    Task 설명은 여러 줄인 경우가 흔한데, 삼중따옴표(`\"\"\"...\"\"\"`)로 내보내면
    `crew.py.j2` 의 `indent(4)` 필터가 **문자열 안쪽 줄까지** 밀어 넣어 값이 조용히
    변조된다(실제로 `local` 템플릿의 `{source_text}` 앞에 공백 4칸이 붙었다).
    그래서 여러 줄은 줄마다 따로 `repr()` 한 **암시적 문자열 연결**로 만든다 —
    각 줄이 독립된 리터럴이라 바깥에서 아무리 들여써도 값이 그대로다.

    이스케이프는 직접 짜지 않고 전부 `repr()` 에 맡긴다.
    """
    if "\n" not in value:
        return repr(value)
    lines = value.split("\n")
    parts = [repr(line + "\n") for line in lines[:-1]]
    if lines[-1] != "":  # 마지막 조각이 빈 문자열이면 붙일 이유가 없다
        parts.append(repr(lines[-1]))
    body = "".join(f"    {part}\n" for part in parts)
    return f"(\n{body})"


def py_value(value: Any) -> str:
    """값 → Python 리터럴. 알 수 없는 타입만 문자열로 떨어뜨린다."""
    if isinstance(value, bool) or value is None:
        return repr(value)
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return py_str(value)
    if isinstance(value, dict):
        inner = ", ".join(f"{py_value(k)}: {py_value(v)}" for k, v in value.items())
        return "{" + inner + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(py_value(v) for v in value) + "]"
    return py_str(str(value))


def _docsafe(text: str) -> str:
    """모듈 docstring 안에 넣어도 문자열이 끊기지 않도록 다듬는다."""
    return (text or "").replace("\\", "\\\\").replace('"""', "'''").strip()


_NON_IDENT = re.compile(r"[^a-z0-9]+")


def _slug(text: str) -> str:
    """임의 텍스트 → 식별자 꼬리. 한글 등 비 ASCII 는 통째로 사라질 수 있다.

    사라져도 괜찮다 — 호출부가 `{prefix}_{n}` 폴백을 쓴다. 유니코드 식별자는
    Python 3 에서 합법이지만, 남에게 공유하는 스크립트에 넣기엔 부적절하다.
    """
    return _NON_IDENT.sub("_", (text or "").lower()).strip("_")[:32].strip("_")


class _Names:
    """노드 id → 생성 코드 변수명. 같은 이름이 겹치면 숫자를 붙인다."""

    def __init__(self) -> None:
        self._by_node: dict[str, str] = {}
        self._taken: set[str] = set()
        self._counts: dict[str, int] = {}

    def get(self, node_id: str) -> str:
        return self._by_node[node_id]

    def has(self, node_id: str) -> bool:
        return node_id in self._by_node

    def assign(self, node: AcNode, prefix: str, *hints: Any) -> str:
        if node.id in self._by_node:
            return self._by_node[node.id]
        self._counts[prefix] = self._counts.get(prefix, 0) + 1
        tail = next((s for s in (_slug(str(h or "")) for h in hints) if s), "")
        # 힌트가 전부 비 ASCII 면(한국어 역할명 등) 슬러그가 빈다 → 번호로 떨어뜨린다.
        base = f"{prefix}_{tail}" if tail else f"{prefix}_{self._counts[prefix]}"
        name = base
        n = 2
        while name in self._taken:
            name = f"{base}_{n}"
            n += 1
        self._taken.add(name)
        self._by_node[node.id] = name
        return name


def _call(fn: str, kwargs: list[tuple[str, str]]) -> str:
    """`fn(\n    key=expr,\n)` 형태의 호출식. 인자가 없으면 `fn()`.

    들여쓰기 기준은 **0 열**이다 — `crew.py.j2` 가 `indent(4)` 필터로 블록 전체를
    함수 본문 깊이로 밀어 넣는다. 여기서 미리 들여쓰면 두 번 들여쓰게 된다.
    """
    if not kwargs:
        return f"{fn}()"
    body = "".join(f"    {k}={_reindent(v, 4)},\n" for k, v in kwargs)
    return f"{fn}(\n{body})"


def _reindent(expr: str, spaces: int) -> str:
    """여러 줄 표현식의 **둘째 줄부터** 들여쓴다.

    `py_str` 의 문자열 연결이나 `_list` 의 줄바꿈 리스트가 kwarg 값으로 들어올 때,
    이어지는 줄을 그 kwarg 깊이에 맞춰 준다. 문자열 리터럴은 줄마다 닫혀 있으므로
    이 들여쓰기가 값에 섞이지 않는다.
    """
    head, *rest = expr.split("\n")
    pad = " " * spaces
    return "\n".join([head] + [pad + line if line else line for line in rest])


#: 리스트 인자를 한 줄로 둘지 판단하는 기준. `crew.py.j2` 가 블록을 4칸 더 밀어
#: 넣으므로 여기서는 그만큼 여유를 두고 잰다.
_WRAP_WIDTH = 84


def _list(items: list[str], *, key: str) -> str:
    """`[a, b]` 또는 줄이 길면 여러 줄로.

    `py_str` 과 같은 규약: 자기 기준 0 열에서 시작하고 안쪽만 4칸. 바깥 깊이는
    `_call` 이 `_reindent` 로 맞춘다.
    """
    one_line = f"[{', '.join(items)}]"
    if len(key) + len(one_line) + 4 <= _WRAP_WIDTH:
        return one_line
    body = "".join(f"    {item},\n" for item in items)
    return f"[\n{body}]"


# ---------------------------------------------------------------------------
# 2. 툴 → 생성 코드
# ---------------------------------------------------------------------------
#
# `tools/registry.py` 의 `build_tool()` 과 **일부러 다르다**. 레지스트리는 서버
# 경계를 지키려고 `FileReadTool(base_dir=...)`, `WorkspaceDirectoryReadTool`,
# `CustomHttpTool`(SSRF 가드) 같은 우리 쪽 래퍼를 끼워 넣는데, 그 래퍼들은
# `app.core.security` 에 살아서 단독 스크립트가 import 할 수 없다. 사용자가 자기
# 머신에서 자기 그래프를 돌리는 상황에는 그 경계 자체가 없으므로, 여기서는
# 대응되는 순수 `crewai_tools` 클래스로 내보내고 차이를 `note` 로 고지한다.
#
# ⚠️ `TOOL_REGISTRY` 에 툴을 추가하면 여기에도 추가해야 한다.
#    `test_export_python.py::test_every_enabled_tool_has_export_mapping` 이 강제한다.


@dataclass(frozen=True)
class ToolExport:
    #: `from crewai_tools import ...` 로 가져올 심볼. None 이면 `render` 가 코드를 직접 만든다.
    symbol: str | None
    #: config 키 → 생성자 kwarg 이름. 값이 비어 있으면 인자를 생략한다.
    config_kwargs: tuple[tuple[str, str], ...] = ()
    #: 정수로 변환할 config 키.
    int_keys: frozenset[str] = frozenset()
    #: 생성 코드 위에 붙는 주석 + `notes` 에 실릴 고지의 **i18n 키**
    #: (`export/messages.py`). 문장을 여기 박아 두면 내보낸 파일이 화면 언어와
    #: 다른 언어로 나간다 — EN 로케일에서 실제로 그랬다.
    note_key: str | None = None


TOOL_EXPORTS: dict[str, ToolExport] = {
    "serper_search": ToolExport(
        symbol="SerperDevTool",
        config_kwargs=(("n_results", "n_results"), ("country", "country"), ("locale", "locale")),
        int_keys=frozenset({"n_results"}),
    ),
    "scrape_website": ToolExport(
        symbol="ScrapeWebsiteTool",
        config_kwargs=(("website_url", "website_url"),),
    ),
    "file_read": ToolExport(
        symbol="FileReadTool",
        config_kwargs=(("file_path", "file_path"),),
        note_key="note.fileRead",
    ),
    "directory_read": ToolExport(
        symbol="DirectoryReadTool",
        config_kwargs=(("directory", "directory"),),
        note_key="note.directoryRead",
    ),
    "website_rag": ToolExport(symbol="WebsiteSearchTool", config_kwargs=(("website", "website"),)),
    "csv_search": ToolExport(symbol="CSVSearchTool", config_kwargs=(("csv", "csv"),)),
    "youtube_search": ToolExport(
        symbol="YoutubeVideoSearchTool",
        config_kwargs=(("youtube_video_url", "youtube_video_url"),),
    ),
    "custom_http": ToolExport(
        symbol=None,  # 아래 `_render_custom_http` 가 함수를 통째로 만든다.
        note_key="note.customHttp",
    ),
}


def _render_custom_http(
    var: str, config: dict[str, Any], locale: Locale = DEFAULT_LOCALE,
) -> tuple[str, tuple[str, ...]]:
    """`custom_http` → `@tool` 데코레이터 함수. (코드, 추가 requirements)

    `core/security.py::CustomHttpTool` 은 `url_template` 의 `{placeholder}` 를
    `args_schema` 로 바꿔 에이전트가 채우게 한다. 같은 의미를 데코레이터 쪽에서
    가장 단순하게 재현하는 방법이 **플레이스홀더 = 함수 인자**다.
    """
    name = str(config.get("name") or "Custom HTTP Request")
    description = str(config.get("description") or tr("tool.httpDefaultDescription", locale))
    method = str(config.get("method") or "GET").upper()
    url_template = str(config.get("url_template") or "")
    headers = {str(k): str(v) for k, v in (config.get("headers") or {}).items()}
    placeholders = sorted(set(re.findall(r"\{(\w+)\}", url_template)))

    params = ", ".join(f"{p}: str" for p in placeholders)
    fmt_args = ", ".join(f"{p}={p}" for p in placeholders)
    url_expr = f"{py_str(url_template)}.format({fmt_args})" if placeholders else py_str(url_template)
    code = (
        f"@tool({py_str(name)})\n"
        f"def {var}({params}) -> str:\n"
        f"    {py_str(description)}\n"
        f"    response = requests.request(\n"
        f"        {py_str(method)},\n"
        f"        {url_expr},\n"
        f"        headers={py_value(headers)},\n"
        f"        timeout=15,\n"
        f"    )\n"
        f"    return response.text[:20_000]\n"
    )
    return code, ("requests",)


# ---------------------------------------------------------------------------
# 3. 렌더러
# ---------------------------------------------------------------------------


@dataclass
class _Ctx:
    """한 번의 렌더링 동안 쌓이는 상태."""

    #: 이 렌더링이 쓸 언어. `note()`/`env_keys` 문구가 전부 여기에 걸린다.
    locale: Locale = DEFAULT_LOCALE
    names: _Names = field(default_factory=_Names)
    #: `from crewai_tools import ...` 심볼.
    tool_imports: set[str] = field(default_factory=set)
    #: 모듈 최상단에 놓일 코드 조각 (custom_http 함수 등).
    preludes: list[str] = field(default_factory=list)
    #: `build_crew()` 본문 블록. (섹션 제목, [코드 조각])
    blocks: dict[str, list[str]] = field(default_factory=dict)
    env_keys: dict[str, str] = field(default_factory=dict)
    extra_requirements: set[str] = field(default_factory=set)
    notes: list[str] = field(default_factory=list)
    needs_tool_decorator: bool = False
    needs_requests: bool = False

    def tr(self, key: str, **params: object) -> str:
        return tr(key, self.locale, **params)

    def note(self, key: str | None, **params: object) -> None:
        """고지를 **키로** 받는다 — 문장은 이 시점에 로케일로 굳힌다."""
        if not key:
            return
        text = self.tr(key, **params)
        if text not in self.notes:
            self.notes.append(text)

    def emit(self, section: str, code: str) -> None:
        self.blocks.setdefault(section, []).append(code)


def render_python(doc: CanvasDoc, locale: Locale = DEFAULT_LOCALE) -> PythonExport:
    """캔버스 문서 → `crew.py` / `requirements.txt` / `.env.example`.

    `locale` 은 **생성 파일 안의 사람 말**(독스트링·주석·고지)에만 쓴다. 코드 자체와
    변수명·필드값은 언어와 무관하다. 사용자가 이 파일들을 그대로 커밋·공유하므로
    화면 언어와 어긋나면 안 된다 (`export/messages.py` 첫머리 참조).

    Raises:
        CompilationError: 그래프에 **에러** 이슈가 있을 때. 경고는 통과시키고
            `PythonExport.warnings` 에 실어 보낸다.
    """
    issues = validate_graph(doc)
    if has_errors(issues):
        raise CompilationError(issues)

    g = CanvasGraph.from_doc(doc).normalize()
    crew_node = g.single("crew")
    assert crew_node is not None  # AC-E101 이 이미 걸렀다

    ctx = _Ctx(locale=locale)
    order = order_tasks(g)

    # 정의 순서 = 의존 순서. `order_tasks` 가 이미 위상 정렬이지만, 태스크 렌더가
    # `compiler.py::_build_task` 와 같은 재귀 구조라 순서가 어긋나도 안전하다.
    for task_node in order:
        _render_task(ctx, g, task_node)
    agent_nodes = g.incoming(crew_node.id, "agent")
    for agent_node in agent_nodes:
        _render_agent(ctx, g, agent_node)

    crew_expr = _crew_expr(ctx, g, crew_node, agent_nodes, order)
    inputs = _render_inputs(g, ctx.locale)

    ignored = [n.type for n in g.nodes if n.type in ("knowledge", "memory")]
    if ignored:
        ctx.note("note.knowledgeMemory")
    if any(n.type == "human" for n in g.nodes) or any(
        n.data.get("human_input") for n in g.nodes_of_type("task")
    ):
        ctx.note("note.humanInput")

    crew_py = _env().get_template("crew.py.j2").render(
        title=_docsafe(doc.name or "AgentCanvas Crew"),
        description=_docsafe(doc.description or ""),
        crewai_version=CREWAI_VERSION,
        notes=[_docsafe(n) for n in ctx.notes],
        text={
            "exported_by": tr("crew.exportedBy", locale, version=CREWAI_VERSION),
            "standalone": tr("crew.standalone", locale),
            "fill_keys": tr("crew.fillKeys", locale),
            "notes_heading": tr("crew.notesHeading", locale),
            "inputs_comment": tr("crew.inputsComment", locale),
        },
        tool_imports=sorted(ctx.tool_imports),
        needs_tool_decorator=ctx.needs_tool_decorator,
        needs_requests=ctx.needs_requests,
        preludes=ctx.preludes,
        inputs=inputs,
        sections=[(title, ctx.blocks[title]) for title in _SECTION_ORDER if title in ctx.blocks],
        crew_expr=crew_expr,
    )
    requirements = _env().get_template("requirements.txt.j2").render(
        packages=_requirements(ctx),
        text={"header": tr("req.header", locale)},
    )
    env_example = _env().get_template("env.example.j2").render(
        keys=sorted(ctx.env_keys.items()),
        text={
            "header": tr("env.header", locale),
            "dotenv_note": tr("env.dotenvNote", locale),
            "no_keys": tr("env.noKeys", locale),
        },
    )

    return PythonExport(
        files=[
            ExportedFile("crew.py", "python", crew_py),
            ExportedFile("requirements.txt", "text", requirements),
            ExportedFile(".env.example", "dotenv", env_example),
        ],
        warnings=issues,
        notes=list(ctx.notes),
    )


_SECTION_ORDER = ("LLM", "Tools", "Agents", "Tasks")


@lru_cache(maxsize=1)
def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        # 파이썬 소스를 만드는 템플릿이다 — HTML 이스케이프가 켜지면 따옴표가 깨진다.
        autoescape=False,
        undefined=StrictUndefined,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )


# --- 노드별 렌더 (compiler.py 의 _build_* 와 1:1 대응) ---


def env_var_for_key_ref(key_ref: str, key_name: str | None) -> str | None:
    """LLM 노드의 키 슬롯 id → 내보낸 스크립트가 읽을 환경변수 이름.

    기본 슬롯의 id 는 키 이름 그대로(`OPENAI_API_KEY`)라 변환이 항등이고,
    추가 슬롯(`OPENAI_API_KEY#work`)만 환경변수로 쓸 수 있는 형태
    (`OPENAI_API_KEY_WORK`)로 정규화된다. 내보낸 스크립트는 브라우저의 키
    저장소에 닿을 수 없으므로 슬롯 구분을 환경변수 이름으로 옮겨 준다.
    """
    if not key_ref:
        return key_name
    sanitized = re.sub(r"[^A-Za-z0-9_]+", "_", key_ref).strip("_").upper()
    return sanitized or key_name


def _render_llm(ctx: _Ctx, node: AcNode) -> str:
    if ctx.names.has(node.id):
        return ctx.names.get(node.id)

    data = node.data
    provider = str(data.get("provider") or "openai")
    model = str(data.get("model") or "")
    var = ctx.names.assign(node, "llm", model, provider)

    base_url = data.get("base_url") or None
    if provider == "ollama":
        base_url = normalize_ollama_base_url(base_url or "")

    kwargs: list[tuple[str, str]] = [("model", py_str(build_model_string(provider, model)))]
    for key, kwarg in (("temperature", "temperature"), ("top_p", "top_p")):
        if data.get(key) is not None:
            kwargs.append((kwarg, py_value(data[key])))
    if data.get("max_tokens") is not None:
        kwargs.append(("max_tokens", py_value(int(data["max_tokens"]))))
    # 스펙 §8.5 MUST — 키는 절대 하드코딩하지 않고 환경변수에서 읽는다.
    key_ref = str(data.get("key_ref") or "").strip()
    key_name = PROVIDER_KEY_NAME.get(provider)
    env_name = env_var_for_key_ref(key_ref, key_name)
    if env_name:
        kwargs.append(("api_key", f'os.getenv("{env_name}")'))
        ctx.env_keys[env_name] = (
            ctx.tr("env.providerKeySlot", provider=provider, slot=key_ref)
            if key_ref else ctx.tr("env.providerKey", provider=provider)
        )
    if base_url:
        kwargs.append(("base_url", py_str(base_url)))
    if data.get("timeout_s") is not None:
        kwargs.append(("timeout", py_value(int(data["timeout_s"]))))
    if provider in LITELLM_DEPENDENT_PROVIDERS:
        ctx.extra_requirements.add("litellm")

    ctx.emit("LLM", f"{var} = {_call('LLM', kwargs)}")
    return var


def _render_tool(ctx: _Ctx, node: AcNode) -> str:
    if ctx.names.has(node.id):
        return ctx.names.get(node.id)

    tool_id = str(node.data.get("tool_id") or "")
    spec = TOOL_REGISTRY.get(tool_id)
    export = TOOL_EXPORTS.get(tool_id)
    if spec is None or not spec.enabled or export is None:
        # validate_graph() 가 AC-E205 로 이미 막았어야 한다. 여기까지 왔다면
        # 레지스트리에 툴이 추가됐는데 내보내기 매핑이 빠진 것이다.
        raise CompilationError([
            issue(
                "AC-E205",
                node_id=node.id,
                message=f'툴 "{tool_id or "(미지정)"}" 은(는) Python 으로 내보낼 수 없습니다',
                hint="AgentCanvas 이슈로 알려주세요 — 내보내기 매핑이 누락되었습니다.",
                message_key="validation.toolNotExportable",
                hint_key="validation.toolNotExportableHint",
                params={"tool": tool_id or "?"},
            )
        ])

    var = ctx.names.assign(node, "tool", tool_id)
    config = node.data.get("config") or {}
    for key in spec.required_keys:
        ctx.env_keys[key] = ctx.tr("env.toolKey", label=spec.label)
    ctx.note(export.note_key)

    if export.symbol is None:  # custom_http
        code, extras = _render_custom_http(var, config, ctx.locale)
        ctx.needs_tool_decorator = True
        ctx.needs_requests = True
        ctx.extra_requirements.update(extras)
        ctx.preludes.append(code)
        # `@tool` 함수는 모듈 최상단에 정의되므로 build_crew() 안에 다시 쓰지 않는다.
        return var

    kwargs: list[tuple[str, str]] = []
    for cfg_key, kwarg in export.config_kwargs:
        value = config.get(cfg_key)
        if value in (None, ""):
            continue
        kwargs.append((kwarg, py_value(int(value) if cfg_key in export.int_keys else str(value))))

    ctx.tool_imports.add(export.symbol)
    ctx.extra_requirements.add("crewai-tools")
    prefix = f"# ⚠️ {ctx.tr(export.note_key)}\n" if export.note_key else ""
    ctx.emit("Tools", f"{prefix}{var} = {_call(export.symbol, kwargs)}")
    return var


def _render_agent(ctx: _Ctx, g: CanvasGraph, node: AcNode) -> str:
    if ctx.names.has(node.id):
        return ctx.names.get(node.id)

    data = node.data
    var = ctx.names.assign(node, "agent", data.get("role"))
    llm_nodes = g.incoming(node.id, "llm")
    tool_nodes = g.incoming(node.id, "tool")

    llm_var = _render_llm(ctx, llm_nodes[0]) if llm_nodes else None
    tool_vars = [_render_tool(ctx, t) for t in tool_nodes]

    kwargs: list[tuple[str, str]] = [
        ("role", py_str(str(data.get("role") or ""))),
        ("goal", py_str(str(data.get("goal") or ""))),
        ("backstory", py_str(str(data.get("backstory") or ""))),
        ("allow_delegation", py_value(bool(data.get("allow_delegation", False)))),
        ("verbose", py_value(bool(data.get("verbose", True)))),
        ("max_iter", py_value(int(data["max_iter"]) if data.get("max_iter") is not None else DEFAULT_MAX_ITER)),
        ("cache", py_value(bool(data.get("cache", True)))),
        ("respect_context_window", py_value(bool(data.get("respect_context_window", True)))),
    ]
    if llm_var:
        kwargs.append(("llm", llm_var))
    if tool_vars:
        kwargs.append(("tools", _list(tool_vars, key="tools")))
    if data.get("max_rpm") is not None:
        kwargs.append(("max_rpm", py_value(int(data["max_rpm"]))))
    if data.get("max_execution_time") is not None:
        kwargs.append(("max_execution_time", py_value(int(data["max_execution_time"]))))
    if bool(data.get("allow_code_execution", False)):
        # RECON F5 — CodeInterpreterTool 대신 에이전트 네이티브 실행. 항상 Docker safe 모드.
        kwargs.append(("allow_code_execution", "True"))
        kwargs.append(("code_execution_mode", py_str("safe")))
        ctx.note("note.codeExecution")

    ctx.emit("Agents", f"{var} = {_call('Agent', kwargs)}")
    return var


def _render_task(ctx: _Ctx, g: CanvasGraph, node: AcNode) -> str:
    if ctx.names.has(node.id):
        return ctx.names.get(node.id)

    data = node.data
    var = ctx.names.assign(node, "task", data.get("name"), data.get("description"))
    agent_nodes = g.incoming(node.id, "agent")
    context_nodes = g.incoming(node.id, "context")
    tool_nodes = g.incoming(node.id, "tool")

    # ⚠️ 이름을 먼저 잡고(위) 의존을 렌더한다 — 재귀 순환은 AC-E105 가 이미 막았다.
    agent_var = _render_agent(ctx, g, agent_nodes[0]) if agent_nodes else None
    context_vars = [_render_task(ctx, g, c) for c in context_nodes]
    tool_vars = [_render_tool(ctx, t) for t in tool_nodes]

    human_input = _human_input(g, node)
    kwargs: list[tuple[str, str]] = [
        ("description", py_str(str(data.get("description") or ""))),
        ("expected_output", py_str(str(data.get("expected_output") or ""))),
    ]
    if agent_var:
        kwargs.append(("agent", agent_var))
    if data.get("name"):
        kwargs.append(("name", py_str(str(data["name"]))))
    kwargs.append(("async_execution", py_value(bool(data.get("async_execution", False)))))
    kwargs.append(("human_input", py_value(human_input)))
    kwargs.append(("markdown", py_value(bool(data.get("markdown", True)))))
    if context_vars:
        # RECON F12 — 비어 있으면 인자 자체를 생략해야 한다. `context=None` 과 의미가 다르다.
        kwargs.append(("context", _list(context_vars, key="context")))
    if tool_vars:
        kwargs.append(("tools", _list(tool_vars, key="tools")))
    if data.get("output_file"):
        kwargs.append(("output_file", py_str(str(data["output_file"]))))
    if data.get("max_retries") is not None:
        kwargs.append(("max_retries", py_value(int(data["max_retries"]))))

    ctx.emit("Tasks", f"{var} = {_call('Task', kwargs)}")
    return var


def _human_input(g: CanvasGraph, node: AcNode) -> bool:
    """`compiler.py::_human_gate` 의 참/거짓 판정만 옮긴 것.

    프롬프트·타임아웃·시간초과 동작은 우리 human-input 프로바이더(RECON F16)의
    설정이라 단독 스크립트에는 옮길 수 없다 — CrewAI 기본 프로바이더가
    표준입력으로 물어본다. 그 사실은 `notes` 로 고지한다.
    """
    has_human_node = any(n.type == "human" for n in g.outgoing(node.id, "task"))
    return has_human_node or bool(node.data.get("human_input", False))


def _crew_expr(
    ctx: _Ctx, g: CanvasGraph, node: AcNode, agent_nodes: list[AcNode], order: list[AcNode]
) -> str:
    data = node.data
    kwargs: list[tuple[str, str]] = [
        ("agents", _list([ctx.names.get(a.id) for a in agent_nodes], key="agents")),
        ("tasks", _list([ctx.names.get(t.id) for t in order], key="tasks")),
        ("process", f"Process.{str(data.get('process') or 'sequential')}"),
    ]
    if data.get("name"):
        kwargs.append(("name", py_str(str(data["name"]))))
    kwargs.append(("verbose", py_value(bool(data.get("verbose", True)))))
    kwargs.append(("memory", py_value(bool(data.get("memory", False)))))
    kwargs.append(("cache", py_value(bool(data.get("cache", True)))))
    kwargs.append(("planning", py_value(bool(data.get("planning", False)))))
    if data.get("max_rpm") is not None:
        kwargs.append(("max_rpm", py_value(int(data["max_rpm"]))))
    if data.get("process") == "hierarchical":
        llm_nodes = g.incoming(node.id, "llm")
        if llm_nodes:
            kwargs.append(("manager_llm", _render_llm(ctx, llm_nodes[0])))
    if bool(data.get("memory", False)):
        ctx.env_keys.setdefault("OPENAI_API_KEY", ctx.tr("env.memoryKey"))
        ctx.note("note.crewMemory")
    return _call("Crew", kwargs)


def _render_inputs(g: CanvasGraph, locale: Locale = DEFAULT_LOCALE) -> list[dict[str, str]]:
    """Input 노드 → `INPUTS` 딕셔너리 항목.

    `compiler/interpolate.py::resolve_inputs` 와 달리 **비어 있어도 실패시키지
    않는다**(모듈 docstring 설계 원칙 3). 대신 채워야 할 자리를 주석으로 남긴다.
    """
    rows: list[dict[str, str]] = []
    for n in g.nodes_of_type("input"):
        var_name = str(n.data.get("var_name") or "")
        if not var_name:
            continue
        default_value = n.data.get("default_value")
        required = bool(n.data.get("required", True))
        label = str(n.data.get("label") or var_name)
        filled = default_value not in (None, "")
        rows.append({
            "key": py_str(var_name),
            "value": py_value(default_value if filled else ""),
            "comment": (
                f"{label}" if filled
                else tr("crew.inputTodo", locale, label=label)
                + ("" if required else tr("crew.inputOptional", locale))
            ),
        })
    return rows


# --- 부수 파일 ---


def _pinned(package: str) -> str:
    """설치본 버전으로 고정. 이 서버가 실제로 검증한 조합을 그대로 내보낸다."""
    try:
        return f"{package}=={_pkg_version(package)}"
    except PackageNotFoundError:  # pragma: no cover — 백엔드 의존성이라 항상 설치돼 있다
        return package


def _requirements(ctx: _Ctx) -> list[str]:
    packages = ["crewai"]
    packages += sorted(ctx.extra_requirements)
    return [_pinned(p) for p in packages]


__all__ = [
    "ExportedFile",
    "PythonExport",
    "ToolExport",
    "TOOL_EXPORTS",
    "DEFAULT_MAX_ITER",
    "py_str",
    "py_value",
    "render_python",
]
