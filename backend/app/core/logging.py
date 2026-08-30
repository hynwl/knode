"""structlog 설정 + 시크릿 마스킹. (Spec §12.3, MUST)

모든 로그 레코드는 이 프로세서를 반드시 거친다. 예외 트레이스백도 동일하게
마스킹하고, 클라이언트에는 전문이 아닌 다이제스트(마지막 3프레임)만 노출한다.
"""

from __future__ import annotations

import logging
import re
import traceback
from typing import Any

import structlog

_MASK_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"sk-\w{8,}"), "sk-***"),
    (re.compile(r"AIza[\w\-]{30,}"), "AIza***"),
    (re.compile(r"gsk_\w+"), "gsk_***"),
    (re.compile(r"Bearer \S+"), "Bearer ***"),
]


def mask_secrets(text: str) -> str:
    for pattern, replacement in _MASK_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _mask_value(value: Any) -> Any:
    if isinstance(value, str):
        return mask_secrets(value)
    if isinstance(value, dict):
        return {k: _mask_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_mask_value(v) for v in value]
    return value


def secret_masking_processor(
    logger: Any, method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    return {key: _mask_value(value) for key, value in event_dict.items()}


def traceback_digest(exc: BaseException, frames: int = 3) -> str:
    """클라이언트로 나가는 예외 정보. 전문 대신 마지막 N프레임만. (Spec §12.3)"""
    tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
    joined = "".join(tb_lines)
    digest = "".join(tb_lines[-frames:]) if len(tb_lines) > frames else joined
    return mask_secrets(digest.strip())


def configure_logging(log_level: str = "INFO") -> None:
    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, log_level.upper(), logging.INFO),
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            secret_masking_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> Any:
    return structlog.get_logger(name)
