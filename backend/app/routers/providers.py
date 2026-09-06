"""GET /api/v1/providers — LLM 프로바이더/모델 프리셋 목록. (Spec §5.3, §9.2)"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.adapters.llm import list_providers, provider_info_to_dict
from app.adapters.provider_models import list_provider_models
from app.config import get_settings
from app.core.crewai_compat import PROVIDER_KEY_NAME
from app.core.secrets import HEADER_NAME, parse_secret_header
from app.schemas.provider_models import ProviderModelStatus

router = APIRouter(tags=["providers"])


@router.get("/providers")
async def get_providers() -> dict:
    return {"providers": [provider_info_to_dict(p) for p in list_providers()]}


@router.get("/providers/{provider}/models", response_model=ProviderModelStatus)
async def get_provider_models(
    request: Request,
    provider: str,
    key_ref: str | None = Query(
        default=None,
        max_length=255,
        description="LLM 노드가 지목한 **키 슬롯 id**. 없으면 프로바이더 기본 슬롯(= 키 이름)을 쓴다.",
    ),
    force: bool = Query(default=False, description="캐시를 건너뛰고 즉시 재조회"),
) -> ProviderModelStatus:
    """등록된 BYOK 키로 이 프로바이더에서 **실제 쓸 수 있는** 모델을 조회한다.

    키는 `adapters/ollama.py` 의 호스트와 마찬가지로 브라우저가 CORS 때문에 직접
    못 부르는 것을 백엔드가 대신 조회해 주는 것뿐이다. 값은 요청 처리 동안만
    `SecretBundle` 안에 있고 응답에도 로그에도 나가지 않는다 (§12.2).

    실패해도 200 + `reason` 으로 돌려준다 — 프론트 드롭다운이 사유별로 다른
    안내를 띄워야 하고(키 미등록 vs 키가 틀림), HTTP 상태코드로는 그 구분이
    "백엔드 다운"과 섞인다.
    """
    secrets = parse_secret_header(request.headers.get(HEADER_NAME), get_settings())
    try:
        # `key_ref` 는 슬롯 id 다. 비어 있으면 기본 슬롯 = 키 이름 그대로.
        # `compiler._build_llm` 과 같은 규칙이다 — 노드가 슬롯을 지목했으면 그 슬롯만
        # 보고 기본 키로 **폴백하지 않는다**(사용자가 고르지 않은 계정 키를 쓰면 안 된다).
        slot_id = key_ref or PROVIDER_KEY_NAME.get(provider)
        key = secrets.get(slot_id)
        return list_provider_models(provider, key, force=force)
    finally:
        secrets.clear()
