"""M2-T20: AC-Exxx 이슈 카탈로그 계약 테스트 (Spec §18 "검증기" 행, §22.1).

Spec §18 은 **모든 `AC-Exxx` 코드마다 최소 1개 트리거 테스트**를 `MUST` 로
요구한다. 그런데 카탈로그의 절반 가까이는 백엔드가 **원리적으로 발생시킬 수
없는** 프론트 전용 코드다(파일 파싱·LocalStorage·Ollama 프로브·백엔드 연결
실패). 그런 코드에 가짜 백엔드 트리거를 만들면 실제로 검증되는 건 아무것도
없으면서 테스트만 늘어난다.

그래서 이 파일이 코드 전량을 두 부류로 **명시적으로 갈라 고정**한다.

1. `BACKEND_TRIGGERED` — 백엔드 소스가 실제로 raise/emit 하는 코드.
   각각 어느 테스트가 트리거하는지 표에 적고, 그 코드가 정말 `app/` 안에서
   발생 지점을 갖는지 검사한다.
2. `FRONTEND_ONLY` — 카탈로그에만 존재하는 코드. `app/` 안에서 카탈로그
   정의 외에는 등장하지 않아야 한다. 누군가 백엔드에서 이 코드를 raise 하기
   시작하면 이 테스트가 깨지고, 그때 트리거 테스트를 추가하도록 강제한다.

추가로 `frontend/src/validation/issues.ts` 의 `ISSUE_CATALOG` 와 **1:1 동일**
해야 한다는 `app/schemas/errors.py` 모듈 docstring 의 계약도 여기서 실측한다 —
지금까지 어느 테스트도 이걸 확인하지 않았다.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.schemas.errors import (
    ALL_ISSUE_CODES,
    DOCS_URL_BASE,
    ISSUE_CATALOG,
    has_errors,
    issue,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_APP = REPO_ROOT / "backend" / "app"
FRONTEND_ISSUES_TS = REPO_ROOT / "frontend" / "src" / "validation" / "issues.ts"


# ---------------------------------------------------------------------------
# 코드 → 트리거 테스트 인벤토리
# ---------------------------------------------------------------------------

#: 백엔드가 실제로 발생시키는 코드 → 트리거하는 테스트(파일::테스트 접두).
#: 새 코드를 백엔드에서 raise 하면 여기에 등록하고 트리거 테스트를 만들어야 한다.
BACKEND_TRIGGERED: dict[str, str] = {
    "AC-E101": "test_compiler_golden.py::err_AC_E101_no_crew",
    "AC-E102": "test_compiler_golden.py::err_AC_E102_two_crews",
    "AC-E103": "test_compiler_golden.py::err_AC_E103_hierarchical_no_manager_llm",
    "AC-W104": "test_compiler_validators.py::test_agent_and_task_not_linked_to_crew_emit_w104",
    "AC-E105": "test_compiler_golden.py::err_AC_E105_context_cycle",
    "AC-E107": "test_compiler_golden.py::err_AC_E107_crew_without_task",
    "AC-E201": "test_compiler_golden.py::err_AC_E201_agent_missing_role",
    "AC-E202": "test_compiler_golden.py::err_AC_E202_task_without_agent",
    "AC-W203": "test_compiler_validators.py::test_agent_without_task_or_delegation_emits_w203",
    "AC-E204": "test_compiler_golden.py::err_AC_E204_task_missing_expected_output",
    "AC-E205": "test_compiler_golden.py::err_AC_E205_unknown_tool_id",
    "AC-E206": "test_compiler_golden.py::err_AC_E206_tool_config_schema_mismatch",
    "AC-W301": "test_compiler_validators.py::test_undefined_variable_in_task_description_emits_w301",
    "AC-E302": "test_compiler_golden.py::err_AC_E302_missing_required_input",
    "AC-E303": "test_compiler_golden.py::err_AC_E303_invalid_var_name",
    "AC-E501": "test_runtime_manager.py::test_failed_run_emits_run_failed_and_isolates_exception",
    "AC-E502": "test_runtime_manager.py::test_timeout_watchdog_marks_run_failed_with_timeout_code",
    "AC-E503": "test_runtime_manager.py::test_submit_rejects_when_over_concurrency_limit",
    "AC-E506": "test_routers_runs.py::test_get_run_unknown_id_returns_404_ac_e506",
    "AC-E601": "test_runtime_manager.py::test_classify_exception_maps_litellm_auth_error_to_ac_e601",
    "AC-E602": "test_compiler_golden.py::err_AC_E602_tool_missing_secret",
    "AC-E603": "test_runtime_manager.py::test_classify_exception_maps_rate_limit_to_ac_e603",
    "AC-E604": "test_runtime_manager.py::test_classify_exception_maps_not_found_to_ac_e604",
    "AC-E801": "test_compiler_golden.py::err_AC_E801_ssrf_private_url",
    "AC-E802": "test_compiler_golden.py::err_AC_E802_file_path_traversal",
    "AC-E803": "test_compiler_golden.py::err_AC_E803_code_interpreter_disabled",
    "AC-W701": "test_compiler_validators.py::test_agent_with_ollama_llm_and_tool_emits_w701",
}

#: 카탈로그에만 존재하고 백엔드는 절대 발생시키지 않는 코드 + 그 이유.
#: (프론트 Vitest 가 담당한다 — Spec §18 "마이그레이션"/"스토어" 행.)
FRONTEND_ONLY: dict[str, str] = {
    "AC-E106": "포트 호환성은 프론트 연결 시점에 차단한다(§6.2 포트 매트릭스). 백엔드에 도달할 수 없는 엣지다.",
    "AC-E401": "스키마 버전 판정은 Import 시 프론트 마이그레이션이 한다(§7.3).",
    "AC-E402": "미래 버전 파일 감지 — 프론트 Import 전용.",
    "AC-E403": "손상된 JSON 감지 — 프론트 Import 전용.",
    "AC-E404": "Export 시크릿 스캐너 — 프론트 Export 전용(§12.4).",
    "AC-E405": "LocalStorage 용량 — 브라우저 전용.",
    "AC-E504": "백엔드에 연결 실패 — 정의상 백엔드가 낼 수 없다.",
    "AC-E505": "실행 취소 안내 — 백엔드는 `run.cancelled` 이벤트로 알린다(코드 없이).",
    "AC-E701": "Ollama 서버 프로브 — 백엔드 `GET /ollama/models` 는 순수 프록시일 뿐, "
               "그래프+프로브 결과를 합쳐 이슈로 만드는 건 프론트 `validateOllama()` 전용이다(§13).",
    "AC-E702": "Ollama 모델 미설치 — 위와 같은 이유로 프론트 전용(§13).",
}


def _backend_sources() -> list[Path]:
    return sorted(p for p in BACKEND_APP.rglob("*.py") if "__pycache__" not in p.parts)


def _files_mentioning(code: str) -> set[str]:
    hits: set[str] = set()
    for path in _backend_sources():
        if code in path.read_text(encoding="utf-8"):
            hits.add(str(path.relative_to(BACKEND_APP)))
    return hits


# ---------------------------------------------------------------------------
# 1. 인벤토리 전수 커버 (Spec §18 검증기 행 MUST)
# ---------------------------------------------------------------------------

def test_every_catalog_code_is_classified_exactly_once():
    """카탈로그의 모든 코드는 '백엔드 트리거' 아니면 '프론트 전용' 둘 중 하나다."""
    classified = set(BACKEND_TRIGGERED) | set(FRONTEND_ONLY)
    assert classified == set(ALL_ISSUE_CODES), (
        f"미분류: {set(ALL_ISSUE_CODES) - classified}, 카탈로그에 없음: {classified - set(ALL_ISSUE_CODES)}"
    )
    assert not (set(BACKEND_TRIGGERED) & set(FRONTEND_ONLY))


@pytest.mark.parametrize("code", sorted(BACKEND_TRIGGERED))
def test_backend_triggered_code_has_a_raise_site_in_app(code: str):
    """트리거 테스트를 등록해 둔 코드는 카탈로그 정의 말고도 발생 지점이 있어야 한다."""
    files = _files_mentioning(code)
    assert files - {"schemas/errors.py"}, f"{code} 는 카탈로그에만 있다 — FRONTEND_ONLY 로 옮겨라"


@pytest.mark.parametrize("code", sorted(FRONTEND_ONLY))
def test_frontend_only_code_never_appears_in_backend_logic(code: str):
    """프론트 전용 코드가 백엔드에서 쓰이기 시작하면 여기서 막고 트리거 테스트를 요구한다."""
    files = _files_mentioning(code)
    assert files <= {"schemas/errors.py"}, (
        f"{code} 가 {files - {'schemas/errors.py'}} 에서 쓰인다 — "
        f"BACKEND_TRIGGERED 로 옮기고 트리거 테스트를 추가해라"
    )


def test_transport_level_codes_are_not_in_the_issue_catalog():
    """`AC-E001`(요청 스키마 위반)/`AC-E500`(미처리 예외)은 그래프 이슈가 아니라
    전송 계층 에러다 — `core/errors.py` 핸들러가 직접 만든다. 카탈로그에 섞이면
    프론트가 노드 하이라이팅을 시도하게 되므로 분리를 고정한다."""
    assert "AC-E001" not in ISSUE_CATALOG
    assert "AC-E500" not in ISSUE_CATALOG
    assert _files_mentioning("AC-E001") == {"core/errors.py"}
    assert _files_mentioning("AC-E500") == {"core/errors.py"}


# ---------------------------------------------------------------------------
# 2. 카탈로그 항목 자체의 계약 (Spec §17.5)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("code", sorted(ALL_ISSUE_CODES))
def test_catalog_entry_shape(code: str):
    template = ISSUE_CATALOG[code]
    assert re.fullmatch(r"AC-[EW]\d{3}", code)
    # 코드 접두(E/W)와 severity 가 어긋나면 프론트가 경고를 에러로 칠한다.
    expected_severity = "error" if code[3] == "E" else "warn"
    assert template.severity == expected_severity
    assert template.message.strip()
    # AC-E505(취소)만 의도적으로 hint 가 없다 — 사용자가 스스로 누른 행동이라
    # 제안할 "다음 행동"이 없다.
    if code != "AC-E505":
        assert template.hint.strip(), f"{code}: Spec §17.5-3 은 hint 를 MUST 로 요구한다"


@pytest.mark.parametrize("code", sorted(ALL_ISSUE_CODES))
def test_issue_helper_fills_template_and_docs_url(code: str):
    built = issue(code, node_id="n1")
    template = ISSUE_CATALOG[code]
    assert built.code == code
    assert built.severity == template.severity
    assert built.message == template.message
    assert built.docs_url == f"{DOCS_URL_BASE}#{code}"
    assert built.node_id == "n1"


def test_issue_helper_tolerates_unknown_code_without_raising():
    built = issue("AC-E999")
    assert built.code == "AC-E999"
    assert built.message == "AC-E999"
    assert built.severity == "error"


def test_has_errors_ignores_warnings_only():
    assert has_errors([issue("AC-W104"), issue("AC-W203")]) is False
    assert has_errors([issue("AC-W104"), issue("AC-E101")]) is True


def test_issue_serializes_with_camel_case_aliases_for_frontend():
    payload = issue("AC-E101", node_id="crew_1", edge_id="e1").model_dump(
        mode="json", by_alias=True
    )
    assert payload["nodeId"] == "crew_1"
    assert payload["edgeId"] == "e1"
    assert payload["docsUrl"].endswith("#AC-E101")


# ---------------------------------------------------------------------------
# 3. 프론트 ISSUE_CATALOG 와 1:1 동기화 (schemas/errors.py docstring 계약)
# ---------------------------------------------------------------------------

_TS_ENTRY = re.compile(
    r"'(?P<code>AC-[EW]\d{3})':\s*\{\s*"
    r"severity:\s*'(?P<severity>error|warn)',\s*"
    r"message:\s*'(?P<message>(?:[^'\\]|\\.)*)',\s*"
    r"hint:\s*'(?P<hint>(?:[^'\\]|\\.)*)'"
)


def _parse_frontend_catalog() -> dict[str, tuple[str, str, str]]:
    text = FRONTEND_ISSUES_TS.read_text(encoding="utf-8")
    return {
        m.group("code"): (
            m.group("severity"),
            m.group("message").replace("\\'", "'"),
            m.group("hint").replace("\\'", "'"),
        )
        for m in _TS_ENTRY.finditer(text)
    }


def test_frontend_issues_ts_exists_and_parses():
    assert FRONTEND_ISSUES_TS.exists(), f"{FRONTEND_ISSUES_TS} 가 없다"
    parsed = _parse_frontend_catalog()
    assert len(parsed) == len(ALL_ISSUE_CODES), (
        "정규식이 항목을 놓쳤거나 카탈로그 크기가 어긋났다 — "
        f"프론트 {len(parsed)}개 vs 백엔드 {len(ALL_ISSUE_CODES)}개"
    )


def test_frontend_and_backend_catalogs_have_identical_code_sets():
    assert set(_parse_frontend_catalog()) == set(ALL_ISSUE_CODES)


@pytest.mark.parametrize("code", sorted(ALL_ISSUE_CODES))
def test_frontend_and_backend_catalog_entries_match(code: str):
    """`app/schemas/errors.py` docstring: 프론트와 코드·메시지·힌트가 1:1 동일해야 한다."""
    severity, message, hint = _parse_frontend_catalog()[code]
    template = ISSUE_CATALOG[code]
    assert severity == template.severity, f"{code} severity 불일치"
    assert message == template.message, f"{code} message 불일치"
    assert hint == template.hint, f"{code} hint 불일치"
