"""`docs/ERRORS.md` 를 `app.schemas.errors.ISSUE_CATALOG` 로부터 생성한다.

Spec §22.1 / AC-X2 ("모든 에러 코드에 문서 항목 존재") 를 수동 트랜스크립션이 아니라
**카탈로그를 유일한 소스로 삼는 생성기**로 지킨다 — 프론트/백엔드 카탈로그를 손으로
맞추다 드리프트가 난 전례(§M2-T2 severity 어휘 불일치 등)를 문서에서도 반복하지 않기
위함이다. `backend/tests/test_errors_doc.py` 가 이 생성기의 출력과 커밋된
`docs/ERRORS.md` 를 대조하는 드리프트 가드다.

실행: `backend/.venv/bin/python backend/scripts/gen_errors_doc.py`
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.errors import ISSUE_CATALOG  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = REPO_ROOT / "docs" / "ERRORS.md"

# errors.py 의 인라인 주석(# E1xx — ...)과 동일한 어휘. 코드의 백의 자리로 그룹핑한다.
GROUP_NAMES: dict[int, str] = {
    100: "E1xx — 그래프 구조",
    200: "E2xx — 노드 설정",
    300: "E3xx — 변수 / 보간",
    400: "E4xx — 파일 / 스키마",
    500: "E5xx — 실행 / 런타임",
    600: "E6xx — 프로바이더 / 키",
    700: "E7xx — Ollama / 로컬",
    800: "E8xx — 보안",
}

SEVERITY_LABEL = {"error": "🔴 error", "warn": "🟡 warn"}


def _group_key(code: str) -> int:
    # "AC-E101" / "AC-W104" → 101 / 104 → 100대로 내림
    digits = int("".join(ch for ch in code if ch.isdigit()))
    return (digits // 100) * 100


def render() -> str:
    lines = [
        "# 에러 코드 (AC-Exxx)",
        "",
        "> 이 문서는 `backend/app/schemas/errors.py` 의 `ISSUE_CATALOG` 에서 "
        "`backend/scripts/gen_errors_doc.py` 로 **자동 생성**된다. 코드를 추가/수정하려면 "
        "`ISSUE_CATALOG` 와 `frontend/src/validation/issues.ts` 를 먼저 1:1로 맞춘 뒤 "
        "이 스크립트를 다시 실행할 것 — 직접 편집하지 말 것.",
        "",
        "모든 검증/실행 에러는 `AC-E`(error) 또는 `AC-W`(warn) 접두 코드를 가진다. "
        "앱 안의 에러 토스트/인스펙터 배지에 뜨는 코드를 여기서 그대로 검색하면 된다.",
        "",
    ]

    current_group: int | None = None
    for code, tmpl in ISSUE_CATALOG.items():
        group = _group_key(code)
        if group != current_group:
            current_group = group
            title = GROUP_NAMES.get(group, f"{group}xx")
            lines.append(f"## {title}")
            lines.append("")
        hint = tmpl.hint or "—"
        lines.append(f'<a id="{code}"></a>')
        lines.append(f"### `{code}` {SEVERITY_LABEL[tmpl.severity]}")
        lines.append("")
        lines.append(f"**{tmpl.message}**")
        lines.append("")
        lines.append(f"힌트: {hint}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH} ({len(ISSUE_CATALOG)} codes)")


if __name__ == "__main__":
    main()
