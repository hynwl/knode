"""EventBridge — 워커 스레드(동기 CrewAI) → SSE 이벤트 루프 브릿지 (Spec §10.1, §10.4).

`crew.kickoff()`는 동기 블로킹이라 워커 스레드에서 돈다. 이 브릿지는 그 스레드가
`emit()`으로 넣은 이벤트를 스레드-세이프 큐에 쌓고, 이벤트 루프 쪽의 `stream()`이
비동기로 소비한다. 최근 500개는 링버퍼에 유지해 `Last-Event-ID` 재연결 시 replay한다.

이 모듈은 SSE 라우터(M2-T11/T12)가 아직 없어도 독립적으로 테스트 가능하도록
설계했다 — 라우터는 `stream()`이 내주는 항목을 `id:`/`event:`/`data:` 텍스트
프레임으로 직렬화하기만 하면 된다.
"""

from __future__ import annotations

import asyncio
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Any

from app.schemas.events import EVENT_PAYLOAD_MODELS, EventName

#: `stream()`이 하트비트로 내주는 표지. `event`/`data` 없이 `: heartbeat` 코멘트만
#: 내보내면 되므로 실제 SSE payload 모델이 없다 (Spec §10.1 MUST).
HEARTBEAT = object()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class EventBridge:
    """단일 run 전용. run마다 하나씩 만든다 (Spec §10.4)."""

    def __init__(self, run_id: str, *, buffer_size: int = 500, heartbeat_s: float = 15.0) -> None:
        self.run_id = run_id
        self._buffer_size = buffer_size
        self._heartbeat_s = heartbeat_s
        self._q: queue.Queue[dict[str, Any]] = queue.Queue()
        self._seq = 0
        self._lock = threading.Lock()
        self._buffer: list[dict[str, Any]] = []

    def emit(self, event: EventName, **fields: Any) -> dict[str, Any]:
        """워커 스레드에서 호출. 페이로드 모델로 검증 후 큐에 적재한다.

        `run_id`/`seq`/`ts`는 여기서 채운다 — 호출부(`runtime/callbacks.py`)는
        이벤트별 고유 필드만 넘긴다.
        """
        with self._lock:
            self._seq += 1
            seq = self._seq

        model = EVENT_PAYLOAD_MODELS[event]
        validated = model.model_validate({"run_id": self.run_id, "seq": seq, "ts": _now_iso(), **fields})
        item = {"id": seq, "event": event, "data": validated.model_dump(by_alias=True, mode="json")}

        with self._lock:
            self._buffer = (self._buffer + [item])[-self._buffer_size :]
        self._q.put(item)
        return item

    def buffered(self) -> list[dict[str, Any]]:
        """현재 링버퍼 스냅샷(최근 `buffer_size`개). `stream()`의 replay와 같은
        데이터를 동기적으로 읽고 싶은 호출부(Run Manager의 취소 시 완료된 태스크
        집계, 향후 `GET /runs/{id}` 스냅샷 등)를 위한 공개 접근자."""
        with self._lock:
            return list(self._buffer)

    async def stream(self, last_id: int = 0):
        """이벤트 루프에서 소비. 재연결 시 `last_id` 이후 replay → 실시간 폴링.

        큐가 15초 이상 비어 있으면 `HEARTBEAT` 항목을 내준다 (프록시 타임아웃 방지,
        Spec §10.1 MUST). 소비자가 순회를 멈추면(클라이언트 연결 종료) 그냥
        가비지컬렉션된다 — 명시적 `close()`는 필요 없다.
        """
        with self._lock:
            backlog = [item for item in self._buffer if item["id"] > last_id]
        for item in backlog:
            yield item

        last_emit = time.monotonic()
        while True:
            try:
                item = self._q.get_nowait()
            except queue.Empty:
                if time.monotonic() - last_emit >= self._heartbeat_s:
                    last_emit = time.monotonic()
                    yield HEARTBEAT
                await asyncio.sleep(0.05)
                continue
            last_emit = time.monotonic()
            yield item


__all__ = ["EventBridge", "HEARTBEAT"]
