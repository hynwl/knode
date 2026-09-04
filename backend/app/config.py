"""애플리케이션 설정.

`.env.example` (리포 루트)에 정의된 환경변수를 로드한다. (Spec §19.3)
서버 사이드 프로바이더 키(OPENAI_API_KEY 등)는 헤더 폴백 전용이며
`SecretBundle` 생성 시에만 참조한다 — 여기서는 문자열로만 보관한다. (Spec §12.1)
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- Backend ----
    allowed_origins: str = Field(default="http://localhost:3000")
    ollama_host: str = Field(default="http://localhost:11434")
    max_concurrent_runs: int = Field(default=3)
    run_ttl_seconds: int = Field(default=1800)
    max_run_duration_s: int = Field(default=900)
    workspace_dir: str = Field(default="./workspace")
    enable_code_interpreter: bool = Field(default=False)
    persistence_mode: str = Field(default="none")
    log_level: str = Field(default="INFO")

    # ---- 선택: 서버 사이드 폴백 키 (헤더가 없을 때만 사용, Spec §12.1) ----
    openai_api_key: str | None = Field(default=None)
    groq_api_key: str | None = Field(default=None)
    gemini_api_key: str | None = Field(default=None)
    anthropic_api_key: str | None = Field(default=None)
    serper_api_key: str | None = Field(default=None)
    #: `openai_compatible` 프로바이더 전용. OpenAI 본계정 키(`openai_api_key`)와
    #: 절대 섞지 않는다 — `crewai_compat.PROVIDER_KEY_NAME` 주석 참조.
    openai_compatible_api_key: str | None = Field(default=None)

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
