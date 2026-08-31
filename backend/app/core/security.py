"""보안 가드 — SSRF / 경로 탈출 / 코드 인터프리터. (M2-T19, Spec §12.5)

⚠️ 이 파일이 `crewai_tools.security` 서브패키지(SSRF·경로 가드 프리미티브)에
닿는 유일한 통로다 — `tools/registry.py` 가 `crewai_tools` 툴 클래스에 대해,
`core/crewai_compat.py` 가 `crewai` 코어에 대해 그러하듯.

**실측 발견 (2026-08-31, crewai-tools==1.15.18):** RECON 작성 시점(M0-T6)에는
없던 SSRF/경로 가드가 이 버전의 `crewai_tools`에 이미 내장되어 있다.
- `ScrapeWebsiteTool` → `safe_get()` → 소켓 연결마다 피어 IP 를 검증
  (`crewai_tools.security.ssrf_adapter`). DNS 리바인딩·리다이렉트 우회까지 방어.
- `FileReadTool` → 생성자 `base_dir` 로 런타임 경로를 가둔다. 단, **생성자에
  준 `file_path` 자체는 컨테인먼트를 우회한다**(개발자 의도로 간주) — 그래서
  `guard_declared_file_path()` 로 컴파일 타임에 별도 검사해야 한다.
- `DirectoryReadTool` 는 `base_dir` 파라미터 자체가 없다(`cwd` 고정) →
  `WorkspaceDirectoryReadTool` 로 감싼다.
- 이스케이프 해치 `CREWAI_TOOLS_ALLOW_UNSAFE_PATHS=true` 가 존재한다. BYOK
  멀티테넌트 배포에서 임의 env 로 꺼질 수 없도록 `CREWAI_TOOLS_FORCE_SAFE_PATHS`
  를 이 모듈 임포트 시점에 강제한다(라이브러리 자체 권고, safe_path.py 참조).

CrewAI 버전을 올릴 때 이 파일의 가정(위 3가지)이 여전히 유효한지
`tests/test_security.py` 로 먼저 재검증한다.
"""

from __future__ import annotations

import os
import re
from typing import Any

import requests
from crewai_tools import DirectoryReadTool
from crewai_tools.security.safe_path import (
    format_sandbox_error,
    validate_directory_path,
    validate_file_path,
    validate_url,
)
from crewai_tools.security.ssrf_adapter import SSRFProtectedAdapter
from pydantic import Field, create_model

from app.config import get_settings
from app.core.crewai_compat import BaseTool
from app.core.errors import CompilationError
from app.schemas.errors import issue

#: BYOK 멀티테넌트 배포에서는 어떤 env 로도 SSRF/경로 가드를 끌 수 없어야 한다.
#: (crewai_tools/security/safe_path.py 의 자체 권고: "Managed workers should
#: set CREWAI_TOOLS_FORCE_SAFE_PATHS=true")
os.environ["CREWAI_TOOLS_FORCE_SAFE_PATHS"] = "true"


# ---------------------------------------------------------------------------
# 1. WORKSPACE_DIR
# ---------------------------------------------------------------------------

def workspace_dir() -> str:
    """`WORKSPACE_DIR` 의 절대 경로. 없으면 생성한다."""
    path = os.path.realpath(get_settings().workspace_dir)
    os.makedirs(path, exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# 2. 컴파일 타임 가드 — 노드 설정에 개발자가 직접 써넣은 값을 검사한다.
#    (런타임에 에이전트가 스스로 고르는 값은 아래 3번의 바인딩이 막는다.)
# ---------------------------------------------------------------------------

def guard_declared_url(url: str | None, *, node_id: str) -> None:
    """`scrape_website`/`custom_http` 설정에 박힌 URL이 사설 IP 를 향하면 AC-E801."""
    if not url:
        return
    try:
        validate_url(url)
    except ValueError as exc:
        raise CompilationError([
            issue("AC-E801", node_id=node_id, message=str(exc))
        ]) from exc


def guard_declared_file_path(path: str | None, *, node_id: str) -> None:
    """`file_read` 설정에 박힌 경로가 WORKSPACE_DIR 밖이면 AC-E802.

    `FileReadTool` 은 생성자로 받은 `file_path` 를 컨테인먼트 검사 없이 그대로
    믿는다 — 그래서 여기서 미리 걸러야 유일한 검사 지점이다.
    """
    if not path:
        return
    try:
        validate_file_path(path, workspace_dir())
    except ValueError as exc:
        raise CompilationError([
            issue(
                "AC-E802",
                node_id=node_id,
                message=format_sandbox_error(exc, "WORKSPACE_DIR 안의 경로를 지정하세요."),
            )
        ]) from exc


def guard_declared_directory_path(path: str | None, *, node_id: str) -> None:
    """`directory_read` 설정에 박힌 디렉터리가 WORKSPACE_DIR 밖이면 AC-E802."""
    if not path:
        return
    try:
        validate_directory_path(path, workspace_dir())
    except ValueError as exc:
        raise CompilationError([
            issue(
                "AC-E802",
                node_id=node_id,
                message=format_sandbox_error(exc, "WORKSPACE_DIR 안의 경로를 지정하세요."),
            )
        ]) from exc


def guard_code_interpreter(requested: bool, *, node_id: str) -> None:
    """`allow_code_execution=True` 인데 `ENABLE_CODE_INTERPRETER` 가 꺼져 있으면 AC-E803."""
    if not requested:
        return
    if not get_settings().enable_code_interpreter:
        raise CompilationError([issue("AC-E803", node_id=node_id)])


# ---------------------------------------------------------------------------
# 3. 런타임 바인딩 — 에이전트가 실행 중 스스로 고르는 경로/URL 을 가둔다.
# ---------------------------------------------------------------------------

class WorkspaceDirectoryReadTool(DirectoryReadTool):
    """`DirectoryReadTool` 은 `base_dir` 를 지원하지 않아(항상 `cwd` 고정) 직접 가둔다.

    `crewai_tools.tools.directory_read_tool.DirectoryReadTool._run()` 의 목록화
    로직을 그대로 두고 `validate_directory_path` 호출에만 `base_dir` 를 끼워
    넣는다. crewai-tools 업그레이드 시 그 파일의 `_run()` 과 diff 를 대조한다.
    """

    def _run(self, **kwargs: Any) -> Any:
        directory: str | None = kwargs.get("directory", self.directory)
        if directory is None:
            raise ValueError("Directory must be provided.")
        directory = validate_directory_path(directory, workspace_dir())
        if directory[-1] == "/":
            directory = directory[:-1]
        files_list = [
            f"{directory}/{(os.path.join(root, filename).replace(directory, '').lstrip(os.path.sep))}"
            for root, dirs, files in os.walk(directory)
            for filename in files
        ]
        files = "\n- ".join(files_list)
        return f"File paths: \n-{files}"


def _ssrf_safe_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False  # HTTP(S)_PROXY env 로 SSRF 가드를 우회하지 못하게 한다.
    adapter = SSRFProtectedAdapter()
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def safe_http_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 15,
    **kwargs: Any,
) -> requests.Response:
    """SSRF 가드를 통과한 커넥션으로만 나가는 HTTP 요청. `custom_http` 툴의 유일한 통로."""
    validated_url = validate_url(url)
    with _ssrf_safe_session() as session:
        return session.request(method.upper(), validated_url, headers=headers, timeout=timeout, **kwargs)


class CustomHttpTool(BaseTool):
    """`url_template` 의 `{placeholder}` 를 에이전트가 채우는 커스텀 HTTP 툴.

    URL 은 매 호출마다 `safe_http_request` → `validate_url` 을 통과해야 하므로,
    플레이스홀더에 사설 IP/호스트를 채워 넣어도 SSRF 가드가 그때 막는다.
    """

    name: str = "Custom HTTP Request"
    description: str = "Calls a custom HTTP endpoint."
    method: str = "GET"
    url_template: str = ""
    static_headers: dict[str, str] = Field(default_factory=dict)
    placeholders: list[str] = Field(default_factory=list)

    def __init__(
        self,
        *,
        name: str,
        description: str,
        url_template: str,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> None:
        placeholders = sorted(set(re.findall(r"\{(\w+)\}", url_template)))
        fields: dict[str, Any] = {p: (str, ...) for p in placeholders}
        if not fields:
            fields = {"note": (str, Field(default="", description="이 툴은 인자가 필요 없습니다."))}
        model_name = re.sub(r"\W+", "", name.title()) or "CustomHttp"
        args_schema = create_model(f"{model_name}Args", **fields)
        super().__init__(
            name=name,
            description=description,
            method=method.upper(),
            url_template=url_template,
            static_headers=dict(headers or {}),
            placeholders=placeholders,
            args_schema=args_schema,
            **kwargs,
        )

    def _run(self, **kwargs: Any) -> str:
        try:
            url = self.url_template.format(**{p: kwargs.get(p, "") for p in self.placeholders})
        except (KeyError, IndexError) as exc:
            return f"Error: invalid url_template substitution: {exc}"
        try:
            response = safe_http_request(self.method, url, headers=self.static_headers)
        except ValueError as exc:
            return f"Error: {exc}"
        except requests.RequestException as exc:
            return f"Error: HTTP request failed: {exc}"
        return response.text[:20_000]


__all__ = [
    "workspace_dir",
    "guard_declared_url",
    "guard_declared_file_path",
    "guard_declared_directory_path",
    "guard_code_interpreter",
    "WorkspaceDirectoryReadTool",
    "safe_http_request",
    "CustomHttpTool",
]
