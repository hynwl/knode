"""AC-Exxx 이슈 카탈로그 (Spec §22.1).

프론트/백엔드 공통 어휘다. `frontend/src/validation/issues.ts` 의
`ISSUE_CATALOG` 와 코드·메시지·힌트가 **1:1 로 동일**해야 한다 — 둘 중 하나만
갱신하면 검증 UX가 어긋난다 (프론트는 이 코드를 키로 노드 카메라 포커스/하이라이트를 한다).

`severity` 값은 `"error" | "warn"` 두 가지뿐이다 (`"warning"` 아님).
프론트 `ValidationIssue` 타입과의 어휘 불일치를 막기 위해 고정한다.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["error", "warn"]


class IssueTemplate(BaseModel):
    severity: Severity
    message: str
    hint: str


#: Spec §22.1 전 코드. frontend/src/validation/issues.ts ISSUE_CATALOG 와 동기화 유지.
ISSUE_CATALOG: dict[str, IssueTemplate] = {
    # E1xx — 그래프 구조
    "AC-E101": IssueTemplate(severity="error", message="Crew 노드가 없습니다", hint="우클릭 → Flow → Crew 를 추가하세요."),
    "AC-E102": IssueTemplate(severity="error", message="Crew 노드가 2개 이상입니다", hint="하나만 남기세요."),
    "AC-E103": IssueTemplate(severity="error", message="hierarchical 프로세스에는 Manager LLM 이 필요합니다", hint="Crew 의 manager llm 소켓에 LLM 을 연결하세요."),
    "AC-W104": IssueTemplate(severity="warn", message="Crew 에 연결되지 않은 노드가 있습니다", hint="실행에서 제외됩니다."),
    "AC-E105": IssueTemplate(severity="error", message="순환 의존이 감지되었습니다", hint="Task 의 depends on 연결을 확인하세요."),
    "AC-E106": IssueTemplate(severity="error", message="호환되지 않는 포트 연결입니다", hint="같은 색 소켓끼리만 연결할 수 있습니다."),
    "AC-E107": IssueTemplate(severity="error", message="Crew 에 Task 가 없습니다", hint="최소 1개의 Task 를 Crew 에 연결하세요."),
    # E2xx — 노드 설정
    "AC-E201": IssueTemplate(severity="error", message="필수 항목이 비어 있습니다", hint="역할·목표·배경을 모두 채우세요."),
    "AC-E202": IssueTemplate(severity="error", message="Task 에 Agent 가 연결되지 않았습니다", hint="Agent 의 출력을 Task 의 agent 소켓에 연결하세요."),
    "AC-W203": IssueTemplate(severity="warn", message="Agent 에 연결된 Task 가 없습니다", hint="이 에이전트는 아무 일도 하지 않습니다."),
    "AC-E204": IssueTemplate(severity="error", message="Task 의 설명 또는 기대 산출물이 비어 있습니다", hint="두 항목 모두 CrewAI 품질에 직접 영향을 줍니다."),
    "AC-E205": IssueTemplate(severity="error", message="알 수 없는 툴입니다", hint="툴 종류를 다시 선택하세요."),
    "AC-E206": IssueTemplate(severity="error", message="툴 설정이 스키마에 맞지 않습니다", hint="필수 설정값을 확인하세요."),
    # E3xx — 변수/보간
    "AC-W301": IssueTemplate(severity="warn", message="정의되지 않은 변수를 참조합니다", hint="Input 노드를 추가하거나 변수명을 고치세요."),
    "AC-E302": IssueTemplate(severity="error", message="필수 입력값이 제공되지 않았습니다", hint="실행 파라미터를 채우세요."),
    "AC-E303": IssueTemplate(severity="error", message="잘못된 변수명 형식입니다", hint="영문으로 시작하고 영문·숫자·밑줄만 사용하세요."),
    # E4xx — 파일/스키마
    "AC-E401": IssueTemplate(severity="error", message="지원하지 않는 스키마 버전입니다", hint="파일이 손상되었을 수 있습니다."),
    "AC-E402": IssueTemplate(severity="error", message="더 최신 버전에서 만든 파일입니다", hint="앱을 업데이트하세요."),
    "AC-E403": IssueTemplate(severity="error", message="파일이 손상되었거나 형식이 올바르지 않습니다", hint="JSON 구조를 확인하세요."),
    "AC-E404": IssueTemplate(severity="error", message="파일에 API 키로 보이는 값이 포함되어 있습니다", hint="해당 필드에서 키를 지운 뒤 다시 내보내세요."),
    "AC-E405": IssueTemplate(severity="error", message="LocalStorage 용량이 부족합니다", hint="오래된 프로젝트를 정리하거나 파일로 내보내세요."),
    "AC-E406": IssueTemplate(severity="error", message="지원하지 않는 문서 형식입니다", hint="PDF, DOCX, 또는 텍스트 파일(.txt/.md/.csv)을 올려주세요."),
    "AC-E407": IssueTemplate(severity="error", message="문서 파일이 너무 큽니다", hint="10MB 이하로 나누어 올리거나 필요한 부분만 잘라내세요."),
    "AC-E408": IssueTemplate(severity="error", message="문서에서 텍스트를 추출하지 못했습니다", hint="파일이 손상되었거나, 스캔 이미지라 텍스트 레이어가 없을 수 있습니다."),
    # E5xx — 실행/런타임
    "AC-E501": IssueTemplate(severity="error", message="실행 중 오류가 발생했습니다", hint="로그 패널에서 상세 내용을 확인하세요."),
    "AC-E502": IssueTemplate(severity="error", message="최대 실행 시간을 초과했습니다", hint="태스크를 나누거나 제한 시간을 늘리세요."),
    "AC-E503": IssueTemplate(severity="error", message="동시 실행 한도를 초과했습니다", hint="진행 중인 실행이 끝난 뒤 다시 시도하세요."),
    "AC-E504": IssueTemplate(severity="error", message="백엔드에 연결할 수 없습니다", hint="백엔드가 떠 있는지 확인하세요. 편집·저장은 계속 가능합니다."),
    "AC-E505": IssueTemplate(severity="error", message="실행이 취소되었습니다", hint=""),
    "AC-E506": IssueTemplate(severity="error", message="실행을 찾을 수 없습니다", hint="run_id를 확인하세요. 완료 후 30분이 지나면 기록이 사라집니다."),
    "AC-E507": IssueTemplate(severity="error", message="사람 검토 대기 시간을 초과했습니다", hint="Human Input 노드의 대기 시간을 늘리거나, 시간 초과 동작을 승인으로 간주하고 계속으로 바꾸세요."),
    "AC-E508": IssueTemplate(severity="error", message="대기 중인 사람 검토 요청이 없습니다", hint="이미 응답했거나 시간이 초과된 요청입니다. 실행 로그를 확인하세요."),
    # E6xx — 프로바이더/키
    "AC-E601": IssueTemplate(severity="error", message="API 키가 유효하지 않습니다 (401/403)", hint="API Keys 설정에서 키를 다시 확인하세요."),
    "AC-E602": IssueTemplate(severity="error", message="필요한 API 키가 설정되지 않았습니다", hint="API Keys 설정에서 키를 입력하세요."),
    "AC-E603": IssueTemplate(severity="error", message="요청 한도(rate limit)에 도달했습니다", hint="잠시 후 다시 시도하세요."),
    "AC-E604": IssueTemplate(severity="error", message="모델을 찾을 수 없습니다", hint="모델명을 확인하세요."),
    "AC-E605": IssueTemplate(severity="error", message="API 크레딧/쿼터가 소진되었습니다", hint="프로바이더 콘솔에서 결제 정보와 잔액을 확인하세요."),
    "AC-E606": IssueTemplate(severity="error", message="선택한 API 키 슬롯을 찾을 수 없습니다", hint="API Keys 에서 같은 이름의 키를 추가하거나, 이 노드의 키를 다시 고르세요."),
    "AC-W606": IssueTemplate(severity="warn", message="이 노드에 필요한 API 키가 등록되지 않았습니다", hint="API Keys 에서 키를 추가하세요. 서버 .env 에 키가 있으면 그대로 실행됩니다."),
    # E7xx — Ollama/로컬
    "AC-E701": IssueTemplate(severity="error", message="Ollama 서버에 연결할 수 없습니다", hint="터미널에서 `ollama serve` 를 실행하세요."),
    "AC-W701": IssueTemplate(severity="warn", message="이 로컬 모델은 툴 호출이 불안정할 수 있습니다", hint="툴을 쓰는 에이전트에는 더 큰 모델을 권장합니다."),
    "AC-E702": IssueTemplate(severity="error", message="선택한 모델이 설치되어 있지 않습니다", hint="`ollama pull <model>` 로 내려받으세요."),
    # E8xx — 보안
    "AC-E801": IssueTemplate(severity="error", message="내부 네트워크 주소 접근이 차단되었습니다", hint="공개 URL 을 사용하세요."),
    "AC-E802": IssueTemplate(severity="error", message="작업 디렉터리 밖의 파일에 접근할 수 없습니다", hint="WORKSPACE_DIR 안의 경로를 지정하세요."),
    "AC-E803": IssueTemplate(severity="error", message="코드 실행 도구가 비활성화되어 있습니다", hint="ENABLE_CODE_INTERPRETER 를 켜고 Docker 샌드박스를 준비하세요."),
}

ALL_ISSUE_CODES: tuple[str, ...] = tuple(ISSUE_CATALOG)

DOCS_URL_BASE = "https://github.com/hynwl/knode/blob/main/docs/ERRORS.md"


class Issue(BaseModel):
    """검증/실행 이슈 1건. `POST /validate` 와 `422` 응답의 `errors` 배열 원소.

    프론트 `ValidationIssue` (frontend/src/validation/issues.ts) 와 동일 모양.
    `node_id` 가 있으면 프론트는 해당 노드로 카메라를 이동시킨다. (Spec §9.1 MUST)
    """

    model_config = ConfigDict(populate_by_name=True)

    code: str
    severity: Severity
    message: str
    hint: str | None = None
    node_id: str | None = Field(default=None, alias="nodeId")
    edge_id: str | None = Field(default=None, alias="edgeId")
    field: str | None = None
    docs_url: str | None = Field(default=None, alias="docsUrl")
    #: **동적 메시지**(노드·필드 이름이 박힌 것)의 i18n 키와 치환값.
    #:
    #: `message` 만으로는 §17.3 의 다국어가 성립하지 않는다 — 프론트의
    #: `issueText()` 는 코드별 로케일 오버라이드를 `message` 가 카탈로그 기본값과
    #: **같을 때만** 적용하므로, 백엔드가 문구를 갈아끼운 이슈는 영어 UI 에서도
    #: 한국어로 남았다(M4-T10 감사에서 실제로 확인: 영어 모드의 AC-E602 토스트).
    #: 그래서 프론트가 이미 갖고 있는 `messageKey`/`params` 경로를 백엔드도 태운다.
    #:
    #: ⚠️ `params` 의 값은 **번역된 문자열이 아니라 i18n 키**여야 한다
    #: (`{"node": "node.agent.label"}`). 검증은 그래프가 바뀔 때 돌지 로케일이
    #: 바뀔 때 다시 돌지 않으므로, 문자열을 굳혀 넣으면 언어를 바꿔도 메시지 속
    #: 이름만 옛 언어로 남는다 — 프론트 `ValidationIssue.params` 와 같은 규칙이다.
    #: 키가 아닌 값(변수명 `{topic}` 등)은 프론트 `tk()` 가 그대로 통과시킨다.
    message_key: str | None = Field(default=None, alias="messageKey")
    hint_key: str | None = Field(default=None, alias="hintKey")
    params: dict[str, Any] | None = None


def issue(code: str, **overrides: Any) -> Issue:
    """`frontend/src/validation/issues.ts` 의 `issue()` 와 대응하는 백엔드 생성 헬퍼.

    카탈로그에 없는 코드도 허용한다(메시지를 코드 자체로 폴백) — 호출부가
    먼저 죽지 않게 하기 위함이다. M2-T4 검증기가 이 함수만 쓰도록 한다.
    """
    template = ISSUE_CATALOG.get(code)
    data: dict[str, Any] = {
        "code": code,
        "severity": overrides.pop("severity", None) or (template.severity if template else "error"),
        "message": overrides.pop("message", None) or (template.message if template else code),
        "hint": overrides.pop("hint", None) or (template.hint if template else None),
        "docs_url": overrides.pop("docs_url", None) or f"{DOCS_URL_BASE}#{code}",
    }
    data.update(overrides)
    return Issue(**data)


def has_errors(issues: list[Issue]) -> bool:
    return any(i.severity == "error" for i in issues)


class ErrorBody(BaseModel):
    """`AppError.to_dict()` 와 동일 모양 (Spec §9.1 에러 응답 포맷)."""

    code: str
    message: str
    severity: Severity | Literal["info"] = "error"
    node_id: str | None = None
    field: str | None = None
    hint: str | None = None
    docs_url: str | None = None


class ErrorEnvelope(BaseModel):
    """전 엔드포인트 공통 에러 봉투. `{"error": {...}, "request_id": ...}`."""

    error: ErrorBody
    request_id: str | None = None


__all__ = [
    "Severity",
    "IssueTemplate",
    "ISSUE_CATALOG",
    "ALL_ISSUE_CODES",
    "Issue",
    "issue",
    "has_errors",
    "ErrorBody",
    "ErrorEnvelope",
]
