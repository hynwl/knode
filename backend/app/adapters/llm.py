"""LLM 프로바이더 메타데이터 어댑터 (Spec §5.3, §9.2 `GET /api/v1/providers`).

⚠️ 실제 CrewAI `LLM` 생성/프로바이더 라우팅(litellm 접두사 부착, 키 이름 매핑)은
`app.core.crewai_compat` 가 전담한다 (Spec §23-5, `compiler.py` 가 이미 사용 중).
이 모듈은 그 위에 **"프리셋 서빙"만** 얹는다 — 새 라우팅 로직을 만들지 않는다.

모델 프리셋은 하드코딩하지 않고 `data/model_presets.json` 에서 읽는다 (Spec §5.3
"모델은 자주 바뀐다"). `GET /api/v1/providers` 라우터 배선 자체는 M2-T11 몫이다 —
여기서는 라우터가 바로 가져다 쓸 수 있는 순수 함수만 제공한다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.crewai_compat import PROVIDER_KEY_NAME, PROVIDER_PREFIX, SUPPORTED_PROVIDERS

MODEL_PRESETS_PATH = Path(__file__).resolve().parent.parent / "data" / "model_presets.json"

#: `base_url` 을 사용자가 직접 지정해야 하는 프로바이더 (Spec §5.3 Advanced base_url).
BASE_URL_PROVIDERS: frozenset[str] = frozenset({"ollama", "openai_compatible"})


@dataclass(frozen=True)
class ProviderInfo:
    provider: str
    litellm_prefix: str
    key_name: str | None
    models: tuple[str, ...]
    requires_base_url: bool


@lru_cache
def _load_presets() -> dict[str, list[str]]:
    with MODEL_PRESETS_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def list_providers() -> list[ProviderInfo]:
    """지원 프로바이더 전체 + 모델 프리셋. 순서는 `SUPPORTED_PROVIDERS` 를 따른다."""
    presets = _load_presets()
    return [
        ProviderInfo(
            provider=provider,
            litellm_prefix=PROVIDER_PREFIX[provider],
            key_name=PROVIDER_KEY_NAME.get(provider),
            models=tuple(presets.get(provider, [])),
            requires_base_url=provider in BASE_URL_PROVIDERS,
        )
        for provider in SUPPORTED_PROVIDERS
    ]


def provider_info_to_dict(info: ProviderInfo) -> dict[str, Any]:
    return {
        "provider": info.provider,
        "litellm_prefix": info.litellm_prefix,
        "key_name": info.key_name,
        "models": list(info.models),
        "requires_base_url": info.requires_base_url,
    }


__all__ = [
    "MODEL_PRESETS_PATH",
    "BASE_URL_PROVIDERS",
    "ProviderInfo",
    "list_providers",
    "provider_info_to_dict",
]
