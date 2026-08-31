"""툴 레지스트리 — `tool_id` → `crewai_tools` 클래스 (Spec §5.6).

⚠️ 이 파일이 `crewai_tools` 패키지에 닿는 유일한 통로다 — `crewai` 코어에 대해
`app.core.crewai_compat` 가 그러하듯. 다른 모듈은 여기 정의된 `build_tool()` /
`list_tool_specs()` 를 통해서만 툴을 만든다.

**RECON 추가 발견 (F13, 2026-08-30, crewai-tools==1.15.18 실측):**
`SerperDevTool` 등 다수 툴은 API 키를 생성자 인자로 받지 않는다. `_run()` 호출
시점에 `os.environ[...]` 을 직접 읽는다. 따라서 `build_tool()` 은 필요한 키가
있는지 확인한 뒤 프로세스 환경변수에 주입한다.
⚠️ 이건 프로세스 전역 상태라 동시 실행 간 격리가 안 된다 — Run Manager(M2-T10)가
실행 단위로 격리(또는 직렬화)하기 전까지 남는 알려진 제약이다.

**`code_interpreter` 는 등록하지 않는다** — `CodeInterpreterTool` 자체가 설치본에
없다 (RECON F5). 코드 실행은 `Agent.allow_code_execution` (compiler.py 에 이미
배선됨)으로 대체됐다.

**`custom_http` 는 M2-T19 부터 활성화됐다** — `core/security.py` 의
`CustomHttpTool` 이 매 호출을 `safe_http_request`(SSRF 가드) 로만 내보낸다.

**SSRF/경로 탈출 가드는 `core/security.py` 를 경유한다.** `file_read`/
`directory_read`/`scrape_website`/`custom_http` 의 설정값은 `build_tool()` 이
`spec.build()` 를 부르기 전에 `_SECURITY_GUARDS` 로 먼저 검사한다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from crewai_tools import (
    CSVSearchTool,
    FileReadTool,
    ScrapeWebsiteTool,
    SerperDevTool,
    WebsiteSearchTool,
    YoutubeVideoSearchTool,
)

from app.core import security
from app.core.crewai_compat import BaseTool
from app.core.errors import CompilationError
from app.schemas.errors import issue
from app.schemas.graph import AcNode


class SecretsLike(Protocol):
    """`SecretBundle`(M2-T13) 이 만족해야 할 최소 계약. 지금은 `dict` 로도 충분하다."""

    def get(self, key: str) -> str | None: ...


@dataclass(frozen=True)
class ToolSpec:
    tool_id: str
    label: str
    description: str
    required_keys: tuple[str, ...]
    config_schema: dict[str, Any]
    build: Callable[[dict[str, Any]], BaseTool] | None = None
    enabled: bool = True


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _build_serper(config: dict[str, Any]) -> BaseTool:
    kwargs: dict[str, Any] = {}
    if config.get("n_results") is not None:
        kwargs["n_results"] = int(config["n_results"])
    if config.get("country"):
        kwargs["country"] = str(config["country"])
    if config.get("locale"):
        kwargs["locale"] = str(config["locale"])
    return SerperDevTool(**kwargs)


def _build_scrape_website(config: dict[str, Any]) -> BaseTool:
    website_url = config.get("website_url") or None
    return ScrapeWebsiteTool(website_url=website_url) if website_url else ScrapeWebsiteTool()


def _build_file_read(config: dict[str, Any]) -> BaseTool:
    kwargs: dict[str, Any] = {"base_dir": security.workspace_dir()}
    if config.get("file_path"):
        kwargs["file_path"] = str(config["file_path"])
    return FileReadTool(**kwargs)


def _build_directory_read(config: dict[str, Any]) -> BaseTool:
    kwargs: dict[str, Any] = {}
    if config.get("directory"):
        kwargs["directory"] = str(config["directory"])
    return security.WorkspaceDirectoryReadTool(**kwargs)


def _build_website_rag(config: dict[str, Any]) -> BaseTool:
    kwargs: dict[str, Any] = {}
    if config.get("website"):
        kwargs["website"] = str(config["website"])
    return WebsiteSearchTool(**kwargs)


def _build_csv_search(config: dict[str, Any]) -> BaseTool:
    kwargs: dict[str, Any] = {}
    if config.get("csv"):
        kwargs["csv"] = str(config["csv"])
    return CSVSearchTool(**kwargs)


def _build_youtube_search(config: dict[str, Any]) -> BaseTool:
    kwargs: dict[str, Any] = {}
    if config.get("youtube_video_url"):
        kwargs["youtube_video_url"] = str(config["youtube_video_url"])
    return YoutubeVideoSearchTool(**kwargs)


def _build_custom_http(config: dict[str, Any]) -> BaseTool:
    return security.CustomHttpTool(
        name=str(config.get("name") or "Custom HTTP Request"),
        description=str(config.get("description") or "커스텀 HTTP 엔드포인트를 호출합니다."),
        method=str(config.get("method") or "GET"),
        url_template=str(config.get("url_template") or ""),
        headers={str(k): str(v) for k, v in (config.get("headers") or {}).items()},
    )


#: v1.0 툴 레지스트리 (Spec §5.6 표). `code_interpreter` 는 RECON F5 로 제외.
TOOL_REGISTRY: dict[str, ToolSpec] = {
    "serper_search": ToolSpec(
        tool_id="serper_search",
        label="Serper 웹 검색",
        description="Serper.dev API로 실시간 웹 검색을 수행합니다.",
        required_keys=("SERPER_API_KEY",),
        config_schema=_schema({
            "n_results": {"type": "integer", "default": 10, "minimum": 1, "maximum": 100},
            "country": {"type": "string", "default": ""},
            "locale": {"type": "string", "default": ""},
        }),
        build=_build_serper,
    ),
    "scrape_website": ToolSpec(
        tool_id="scrape_website",
        label="웹페이지 스크래핑",
        description="지정한 URL의 웹페이지 본문을 읽습니다.",
        required_keys=(),
        config_schema=_schema({
            "website_url": {
                "type": "string",
                "description": "비워두면 실행 중 에이전트가 동적으로 지정합니다.",
            },
        }),
        build=_build_scrape_website,
    ),
    "file_read": ToolSpec(
        tool_id="file_read",
        label="파일 읽기",
        description="로컬 파일 내용을 읽습니다.",
        required_keys=(),
        config_schema=_schema({"file_path": {"type": "string"}}),
        build=_build_file_read,
    ),
    "directory_read": ToolSpec(
        tool_id="directory_read",
        label="디렉터리 목록",
        description="디렉터리 안의 파일 목록을 재귀적으로 나열합니다.",
        required_keys=(),
        config_schema=_schema({"directory": {"type": "string"}}),
        build=_build_directory_read,
    ),
    "website_rag": ToolSpec(
        tool_id="website_rag",
        label="웹사이트 시맨틱 검색",
        description="지정한 웹사이트 콘텐츠를 임베딩 기반으로 검색합니다.",
        required_keys=("OPENAI_API_KEY",),
        config_schema=_schema({"website": {"type": "string"}}),
        build=_build_website_rag,
    ),
    "csv_search": ToolSpec(
        tool_id="csv_search",
        label="CSV 시맨틱 검색",
        description="CSV 파일 내용을 임베딩 기반으로 검색합니다.",
        required_keys=("OPENAI_API_KEY",),
        config_schema=_schema({"csv": {"type": "string"}}),
        build=_build_csv_search,
    ),
    "youtube_search": ToolSpec(
        tool_id="youtube_search",
        label="유튜브 영상 검색",
        description="유튜브 영상 자막을 임베딩 기반으로 검색합니다.",
        required_keys=("OPENAI_API_KEY",),
        config_schema=_schema({"youtube_video_url": {"type": "string"}}),
        build=_build_youtube_search,
    ),
    "custom_http": ToolSpec(
        tool_id="custom_http",
        label="커스텀 HTTP 요청",
        description=(
            "임의의 HTTP 엔드포인트를 호출하는 커스텀 툴입니다. "
            "SSRF 가드(core/security.py)를 통과한 요청만 나갑니다."
        ),
        required_keys=(),
        config_schema=_schema(
            {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "method": {
                    "type": "string",
                    "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"],
                    "default": "GET",
                },
                "url_template": {"type": "string"},
                "headers": {"type": "object", "additionalProperties": {"type": "string"}},
            },
            required=["name", "description", "url_template"],
        ),
        build=_build_custom_http,
        enabled=True,
    ),
}

#: `build_tool()` 이 `spec.build()` 를 부르기 전에 실행하는 컴파일 타임 보안 검사.
#: (Spec §12.5 MUST — `core/security.py` 가 실제 검증 로직을 갖는다.)
_SECURITY_GUARDS: dict[str, Callable[[dict[str, Any], str], None]] = {
    "scrape_website": lambda cfg, node_id: security.guard_declared_url(
        cfg.get("website_url"), node_id=node_id
    ),
    "file_read": lambda cfg, node_id: security.guard_declared_file_path(
        cfg.get("file_path"), node_id=node_id
    ),
    "directory_read": lambda cfg, node_id: security.guard_declared_directory_path(
        cfg.get("directory"), node_id=node_id
    ),
    # url_template 에 {placeholder} 가 있으면 값은 실행 중에만 정해진다 —
    # 그 경우는 safe_http_request() 가 매 호출마다 검사한다(정적 URL만 선검사).
    "custom_http": lambda cfg, node_id: (
        security.guard_declared_url(cfg.get("url_template"), node_id=node_id)
        if "{" not in str(cfg.get("url_template") or "")
        else None
    ),
}


def list_tool_specs() -> list[ToolSpec]:
    return list(TOOL_REGISTRY.values())


def tool_spec_to_dict(spec: ToolSpec) -> dict[str, Any]:
    return {
        "tool_id": spec.tool_id,
        "label": spec.label,
        "description": spec.description,
        "required_keys": list(spec.required_keys),
        "config_schema": spec.config_schema,
        "enabled": spec.enabled,
    }


def build_tool(node: AcNode, secrets: SecretsLike | None = None) -> BaseTool:
    """레지스트리 + `node.data`(`tool_id`/`config`) → 실제 `BaseTool` 인스턴스.

    `compiler.py` 의 `ToolFactory` 시그니처(`Callable[[AcNode], BaseTool]`)를
    만족한다. `secrets` 는 기본 팩토리를 만들 때 클로저로 미리 묶어 전달한다.
    """
    tool_id = str(node.data.get("tool_id") or "")
    spec = TOOL_REGISTRY.get(tool_id)
    if spec is None or not spec.enabled or spec.build is None:
        raise CompilationError([
            issue(
                "AC-E205",
                node_id=node.id,
                message=f'툴 "{tool_id or "(미지정)"}" 을(를) 아직 사용할 수 없습니다',
                hint="사용 가능한 툴은 GET /api/v1/tools 를 확인하세요.",
            )
        ])

    missing = [k for k in spec.required_keys if not (secrets and secrets.get(k))]
    if missing:
        raise CompilationError([
            issue(
                "AC-E602",
                node_id=node.id,
                message=f'"{spec.label}" 에 필요한 키가 없습니다: {", ".join(missing)}',
            )
        ])

    for key in spec.required_keys:
        value = secrets.get(key) if secrets else None
        if value:
            os.environ[key] = value  # RECON F13 — 이 툴들은 os.environ 에서 키를 읽는다.

    config = node.data.get("config") or {}
    guard = _SECURITY_GUARDS.get(tool_id)
    if guard is not None:
        guard(config, node.id)

    try:
        return spec.build(config)
    except CompilationError:
        raise
    except Exception as exc:  # noqa: BLE001 — 잘못된 config 값을 사용자에게 친절히 알려준다.
        raise CompilationError([
            issue("AC-E206", node_id=node.id, message=str(exc))
        ]) from exc


__all__ = [
    "SecretsLike",
    "ToolSpec",
    "TOOL_REGISTRY",
    "list_tool_specs",
    "tool_spec_to_dict",
    "build_tool",
]
