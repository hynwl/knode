"""드리프트 가드: `docs/ERRORS.md` 는 `scripts/gen_errors_doc.py` 의 산출물과 항상 동일해야 한다.

AC-X2("모든 에러 코드에 문서 항목 존재")를 손 트랜스크립션이 아니라 생성기로 지키는데,
생성기를 돌리고 커밋하는 걸 잊으면 문서가 조용히 낡는다 — 이 테스트가 그걸 잡는다.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))

from gen_errors_doc import OUT_PATH, render  # noqa: E402


def test_errors_doc_matches_generator():
    assert OUT_PATH.exists(), "docs/ERRORS.md 가 없음 — `python backend/scripts/gen_errors_doc.py` 를 실행하세요"
    on_disk = OUT_PATH.read_text(encoding="utf-8")
    assert on_disk == render(), (
        "docs/ERRORS.md 가 ISSUE_CATALOG 와 어긋남 — "
        "`backend/.venv/bin/python backend/scripts/gen_errors_doc.py` 를 다시 실행해 커밋하세요"
    )
