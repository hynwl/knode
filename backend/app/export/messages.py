"""Export to Python 이 **파일 안에 써넣는** 사람 말 (Spec §8.5, §17.3).

런타임 SSE 와는 사정이 다르다. 이벤트는 키를 실어 보내고 프론트가 로케일로
그리면 되지만(`schemas/events.py::MessageParams`), 내보내기 산출물은 **서버가
최종 문자열을 확정해 파일에 박아** 사용자가 그대로 커밋·공유한다. 그래서 여기만은
백엔드가 번역을 들고 있어야 한다.

왜 고쳤나: EN 로케일에서 내보낸 `canvas.py` 의 독스트링이 한국어였다. 이 파일은
사용자가 남에게 넘기는 산출물이라, 화면 언어와 다른 언어로 나가면 그대로 남의
저장소에 박힌다.

로케일은 요청 본문(`ExportPythonRequest.locale`)으로 받는다. `Accept-Language` 를
쓰지 않는 이유는 두 가지다 — (1) 브라우저 `fetch` 는 그 헤더를 못 만진다(금지 헤더),
(2) 이 앱의 언어는 브라우저 설정이 아니라 **헤더의 KO/EN 토글**이 정한다.

새 문구를 추가할 때는 **두 로케일을 같이** 채운다. `tests/test_export_python.py`
가 빠진 짝을 잡는다.
"""

from __future__ import annotations

from typing import Final, Literal

Locale = Literal["ko", "en"]

#: 로케일을 못 알아들었을 때. 기존 동작(한국어)을 유지한다.
DEFAULT_LOCALE: Final[Locale] = "ko"

LOCALES: Final[tuple[Locale, ...]] = ("ko", "en")

#: `{}` 자리표시자는 `tr(key, **params)` 의 키워드 인자로 채운다.
MESSAGES: Final[dict[str, dict[Locale, str]]] = {
    # ── canvas.py 헤더 ──────────────────────────────────────────────────────
    "crew.exportedBy": {
        "ko": "Knode 에서 내보낸 CrewAI 스크립트입니다 (crewai=={version}).",
        "en": "A CrewAI script exported from Knode (crewai=={version}).",
    },
    "crew.standalone": {
        "ko": "Knode 없이 단독으로 실행됩니다:",
        "en": "It runs on its own, without Knode:",
    },
    "crew.fillKeys": {
        "ko": "그리고 키를 채웁니다",
        "en": "then fill in your keys",
    },
    "crew.notesHeading": {
        "ko": "알아두세요:",
        "en": "Worth knowing:",
    },
    "crew.inputsComment": {
        "ko": "`{변수}` 자리에 채워질 실행 입력값입니다 (캔버스의 Input 노드).",
        "en": "Values substituted into `{placeholder}` slots at run time (the canvas Input nodes).",
    },
    "crew.inputTodo": {
        "ko": "TODO: {label} — 값을 채우세요",
        "en": "TODO: {label} — fill this in",
    },
    "crew.inputOptional": {
        "ko": " (선택)",
        "en": " (optional)",
    },
    # ── requirements.txt / .env.example ───────────────────────────────────
    "req.header": {
        "ko": "Knode 가 내보낸 의존성. 버전은 이 크루를 실제로 실행한 서버의 설치본입니다.",
        "en": "Dependencies exported by Knode, pinned to what the server that ran this crew had installed.",
    },
    "env.header": {
        "ko": "Knode 가 내보낸 환경변수 목록. `.env` 로 복사한 뒤 값을 채우세요.",
        "en": "Environment variables exported by Knode. Copy this to `.env` and fill in the values.",
    },
    "env.dotenvNote": {
        "ko": "canvas.py 는 load_dotenv() 로 이 파일을 읽습니다. `.env` 는 절대 커밋하지 마세요.",
        "en": "canvas.py reads this through load_dotenv(). Never commit your `.env`.",
    },
    "env.noKeys": {
        "ko": "이 크루에는 API 키가 필요하지 않습니다 (예: 로컬 Ollama 전용).",
        "en": "This crew needs no API key (for example, local Ollama only).",
    },
    "env.providerKey": {
        "ko": "{provider} 프로바이더용 API 키",
        "en": "API key for the {provider} provider",
    },
    "env.providerKeySlot": {
        "ko": "{provider} 프로바이더용 API 키 (캔버스 키 슬롯 `{slot}`)",
        "en": "API key for the {provider} provider (canvas key slot `{slot}`)",
    },
    "env.toolKey": {
        "ko": "{label} 툴에 필요",
        "en": "Required by the {label} tool",
    },
    "env.memoryKey": {
        "ko": "Crew 메모리 임베딩에 필요",
        "en": "Required for Crew memory embeddings",
    },
    # ── 고지(notes) — 서버 실행과 스크립트가 다른 지점 ────────────────────
    "note.fileRead": {
        "ko": "파일 읽기 툴은 Knode 서버에서 WORKSPACE_DIR 안으로 제한되지만, "
              "이 스크립트에는 그 제한이 없습니다 — 에이전트가 접근할 경로를 직접 확인하세요.",
        "en": "On the Knode server the file-read tool is confined to WORKSPACE_DIR; "
              "this script has no such boundary — check which paths the agent can reach.",
    },
    "note.directoryRead": {
        "ko": "디렉터리 목록 툴은 Knode 서버에서 WORKSPACE_DIR 안으로 제한되지만, "
              "이 스크립트에는 그 제한이 없습니다.",
        "en": "On the Knode server the directory-listing tool is confined to WORKSPACE_DIR; "
              "this script has no such boundary.",
    },
    "note.customHttp": {
        "ko": "커스텀 HTTP 툴은 Knode 서버에서 SSRF 가드를 통과한 요청만 내보내지만, "
              "이 스크립트는 URL 을 그대로 호출합니다 — 신뢰할 수 있는 엔드포인트인지 확인하세요.",
        "en": "On the Knode server the custom HTTP tool only sends requests that pass an SSRF guard; "
              "this script calls the URL as-is — make sure the endpoint is one you trust.",
    },
    "note.knowledgeMemory": {
        "ko": "Knowledge / Memory 노드는 아직 컴파일 대상이 아니라 스크립트에도 포함되지 않았습니다 "
              "(서버 실행에서도 동일합니다).",
        "en": "Knowledge / Memory nodes are not compiled yet, so they are not in this script either "
              "(the same is true of a server run).",
    },
    "note.humanInput": {
        "ko": "사람 검토(human_input)는 이 스크립트에서 터미널 표준입력으로 진행됩니다 — "
              "Knode 의 대기 시간·시간 초과 동작 설정은 웹 실행 전용입니다.",
        "en": "Human review (human_input) happens on the terminal's stdin here — Knode's "
              "wait time and timeout settings apply to web runs only.",
    },
    "note.codeExecution": {
        "ko": '코드 실행 에이전트는 Docker 샌드박스(code_execution_mode="safe")를 사용합니다 — '
              "실행 전에 Docker 가 떠 있어야 합니다.",
        "en": 'Code-executing agents use the Docker sandbox (code_execution_mode="safe") — '
              "Docker has to be running before you start.",
    },
    "note.crewMemory": {
        "ko": "Crew 메모리가 켜져 있습니다 — 임베딩 호출에 OPENAI_API_KEY 가 필요합니다.",
        "en": "Crew memory is on — embedding calls need OPENAI_API_KEY.",
    },
    # ── 생성 코드 안의 기본값 ─────────────────────────────────────────────
    "tool.httpDefaultDescription": {
        "ko": "커스텀 HTTP 엔드포인트를 호출합니다.",
        "en": "Calls a custom HTTP endpoint.",
    },
}


def resolve_locale(raw: str | None) -> Locale:
    """느슨하게 받는다 — `"en-US"`, `"EN"`, `None` 전부 안전하게 떨어진다."""
    head = (raw or "").strip().lower().replace("_", "-").split("-")[0]
    return head if head in LOCALES else DEFAULT_LOCALE  # type: ignore[return-value]


def tr(key: str, locale: Locale = DEFAULT_LOCALE, /, **params: object) -> str:
    """번역 + 자리표시자 치환.

    없는 키는 **조용히 넘기지 않고** 터뜨린다 — 내보내기 산출물에 `note.foo` 같은
    키가 그대로 박히면 사용자가 그걸 발견해 준다는 보장이 없다.
    """
    try:
        entry = MESSAGES[key]
    except KeyError as exc:  # pragma: no cover - 개발 중 오타 방어
        raise KeyError(f"export 메시지 키가 없다: {key}") from exc
    text = entry.get(locale) or entry[DEFAULT_LOCALE]
    return text.format(**params) if params else text


__all__ = ["DEFAULT_LOCALE", "LOCALES", "MESSAGES", "Locale", "resolve_locale", "tr"]
