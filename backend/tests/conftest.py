from __future__ import annotations

import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    """설정을 monkeypatch 하는 테스트(M2-T19 등)가 새 env 를 즉시 읽게 한다."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
