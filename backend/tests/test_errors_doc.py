"""드리프트 가드: `docs/ERRORS.md` 는 `scripts/gen_errors_doc.py` 의 산출물과 항상 동일해야 한다.

AC-X2("모든 에러 코드에 문서 항목 존재")를 손 트랜스크립션이 아니라 생성기로 지키는데,
생성기를 돌리고 커밋하는 걸 잊으면 문서가 조용히 낡는다 — 이 테스트가 그걸 잡는다.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))

from gen_errors_doc import OUT_PATH, render  # noqa: E402

#: 소스 안에 문자열 리터럴로 박힌 에러 코드. `f"AC-E{status_code}"` 같은 동적 코드는
#: 리터럴이 아니라 여기 안 걸린다(문서의 "전송 계층" 절이 한 묶음으로 설명한다).
CODE_RE = re.compile(r"""['"](AC-[EW]\d{3})['"]""")
SOURCE_ROOTS = (
    REPO_ROOT / "backend" / "app",
    REPO_ROOT / "frontend" / "src",
)


def test_errors_doc_matches_generator():
    assert OUT_PATH.exists(), "docs/ERRORS.md 가 없음 — `python backend/scripts/gen_errors_doc.py` 를 실행하세요"
    on_disk = OUT_PATH.read_text(encoding="utf-8")
    assert on_disk == render(), (
        "docs/ERRORS.md 가 ISSUE_CATALOG 와 어긋남 — "
        "`backend/.venv/bin/python backend/scripts/gen_errors_doc.py` 를 다시 실행해 커밋하세요"
    )


def test_every_code_used_in_source_has_a_doc_anchor():
    """AC-X2 를 카탈로그가 아니라 **실제 소스**를 기준으로 검사한다.

    생성기 대조만으로는 "카탈로그 밖에서 raise 되는 코드"를 못 잡는다 — M4-T10 감사에서
    `AC-E001`/`AC-E500` 이 정확히 그 사각지대에 있었고, 두 코드는 사용자에게
    `docs_url` 앵커까지 내보내면서 문서에는 항목이 없어 링크가 깨져 있었다.
    """
    doc = OUT_PATH.read_text(encoding="utf-8")
    anchors = set(re.findall(r'<a id="(AC-[EW]\d{3})">', doc))

    used: dict[str, Path] = {}
    for root in SOURCE_ROOTS:
        for path in root.rglob("*"):
            if path.suffix not in {".py", ".ts", ".tsx"} or ".test." in path.name:
                continue
            for code in CODE_RE.findall(path.read_text(encoding="utf-8")):
                used.setdefault(code, path.relative_to(REPO_ROOT))

    missing = {code: str(path) for code, path in sorted(used.items()) if code not in anchors}
    assert not missing, (
        f"소스가 쓰는데 docs/ERRORS.md 에 항목이 없는 코드: {missing} — "
        "ISSUE_CATALOG 또는 core/errors.py 의 TRANSPORT_ERRORS 에 추가한 뒤 생성기를 다시 실행하세요"
    )
