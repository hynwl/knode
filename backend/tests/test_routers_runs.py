"""M2-T11/T12 테스트: `routers/{providers,runs}.py` (Spec §9.2~§9.4, §10.1).

`app.main.app`은 이제 lifespan에서 `RunManager` 싱글턴을 `app.state`에 만든다 —
`TestClient(app)`을 `with`로 열어야 그 lifespan이 실제로 돈다(FastAPI/Starlette는
context manager 밖에서는 startup/shutdown을 실행하지 않는다).

`crew.kickoff()`는 `test_runtime_manager.py`와 동일하게 monkeypatch로 갈아끼운다 —
실제 LLM 호출은 하지 않는다.

⚠️ `/runs/{id}/events` SSE 테스트는 `TestClient`/`httpx.ASGITransport`를 못 쓴다 —
둘 다 ASGI 앱 코루틴이 **완전히 끝난 뒤에야** 응답을 만든다(`testclient.py`의
`portal.call(self.app, ...)`, `httpx`의 `await self.app(...)` — 둘 다 스트림을
미리 다 모은다). 하트비트가 영원히 도는 무한 제너레이터를 그렇게 구동하면
테스트가 그냥 멈춘다(실제로 겪음). `_drive_streaming_request()`가 ASGI
`send()` 콜백을 직접 잡아서 청크가 오는 대로 조건을 검사하고, 조건이
충족되면 앱 태스크를 취소하는 방식으로 우회한다.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.core.crewai_compat import CrewOutput
from app.main import app
from app.routers.runs import _build_snapshot
from app.runtime import callbacks
from app.runtime.bridge import EventBridge
from app.runtime.manager import RunHandle

BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_test",
    "name": "Router Test",
    "created_at": "2026-08-30T00:00:00Z",
    "updated_at": "2026-08-30T00:00:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


@pytest.fixture(autouse=True)
def _clean_run_registry():
    yield
    callbacks._registry.clear()


def _n(node_id: str, node_type: str, data: dict | None = None) -> dict:
    return {"id": node_id, "type": node_type, "position": {"x": 0, "y": 0}, "data": data or {}}


def _e(edge_id: str, source: str, source_handle: str, target: str, target_handle: str) -> dict:
    return {"id": edge_id, "source": source, "sourceHandle": source_handle, "target": target, "targetHandle": target_handle}


def _valid_graph() -> dict:
    nodes = [
        _n("crew_1", "crew", {"process": "sequential"}),
        _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
        _n("task_1", "task", {"description": "d", "expected_output": "o"}),
    ]
    edges = [
        _e("e1", "agent_1", "agent", "crew_1", "agent"),
        _e("e2", "task_1", "task", "crew_1", "task"),
        _e("e3", "agent_1", "agent", "task_1", "agent"),
    ]
    return {**BASE, "nodes": nodes, "edges": edges}


def _invalid_graph() -> dict:
    return {**BASE, "nodes": [], "edges": []}


# --- GET /providers -----------------------------------------------------


def test_get_providers_lists_supported_providers():
    with TestClient(app) as client:
        resp = client.get("/api/v1/providers")
    assert resp.status_code == 200
    providers = resp.json()["providers"]
    names = [p["provider"] for p in providers]
    assert "openai" in names
    assert "ollama" in names


# --- POST /validate -------------------------------------------------------


def test_validate_valid_graph_returns_task_order():
    with TestClient(app) as client:
        resp = client.post("/api/v1/validate", json={"graph": _valid_graph()})
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["task_order"] == ["task_1"]


def test_validate_invalid_graph_returns_full_issue_array_with_200():
    with TestClient(app) as client:
        resp = client.post("/api/v1/validate", json={"graph": _invalid_graph()})
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    codes = [i["code"] for i in body["issues"]]
    assert "AC-E101" in codes
    assert body["task_order"] is None


# --- POST /runs -------------------------------------------------------------


def test_create_run_returns_202_with_events_url(monkeypatch):
    fake_output = CrewOutput(raw="final answer", tasks_output=[])
    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        resp = client.post("/api/v1/runs", json={"graph": _valid_graph()})
        assert resp.status_code == 202
        body = resp.json()
        assert body["run_id"].startswith("run_")
        assert body["task_order"] == ["task_1"]
        assert body["events_url"] == f"/api/v1/runs/{body['run_id']}/events"


def test_create_run_with_invalid_graph_returns_422_issue_array():
    with TestClient(app) as client:
        resp = client.post("/api/v1/runs", json={"graph": _invalid_graph()})
    assert resp.status_code == 422
    codes = [e["code"] for e in resp.json()["errors"]]
    assert "AC-E101" in codes


# --- GET /runs/{id}, POST /runs/{id}/cancel ---------------------------------


def test_get_run_snapshot_after_completion(monkeypatch):
    fake_output = CrewOutput(raw="final answer", tasks_output=[])
    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        run_id = client.post("/api/v1/runs", json={"graph": _valid_graph()}).json()["run_id"]
        resp = client.get(f"/api/v1/runs/{run_id}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "succeeded"
    assert body["task_order"] == ["task_1"]
    assert body["finished_at"] is not None


def test_get_run_unknown_id_returns_404_ac_e506():
    with TestClient(app) as client:
        resp = client.get("/api/v1/runs/run_does_not_exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "AC-E506"


def test_cancel_unknown_run_returns_404():
    with TestClient(app) as client:
        resp = client.post("/api/v1/runs/run_does_not_exist/cancel")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "AC-E506"


def test_cancel_active_run_returns_202(monkeypatch):
    # threading.Event (OS 레벨) 을 쓴다 — 이 테스트는 동기 함수라 TestClient가
    # 내부적으로 도는 이벤트 루프(별도 스레드)와 다른 루프에 있다. asyncio.Event는
    # `.set()`을 호출한 스레드의 루프와 `.wait()`을 건 루프가 다르면 걸린다.
    started = threading.Event()

    def _fake_kickoff(crew, inputs):
        step_cb = crew.agents[0].step_callback
        started.set()
        while True:
            step_cb(object())

    import asyncio as _asyncio

    async def _fake_to_thread(fn):
        return await _asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        run_id = client.post("/api/v1/runs", json={"graph": _valid_graph()}).json()["run_id"]
        assert started.wait(timeout=2.0)
        resp = client.post(f"/api/v1/runs/{run_id}/cancel")
        assert resp.status_code == 202


# --- GET /runs/{id}/events (SSE) --------------------------------------------


async def _drive_streaming_request(
    asgi_app, path: str, headers: dict[str, str], predicate, timeout: float = 2.0
):
    """ASGI 앱을 직접 구동해 `http.response.body` 청크를 오는 대로 모은다.

    `predicate(text_so_far)`가 True가 되면 앱 태스크를 취소하고 그때까지 모은
    걸 반환한다 — 무한 스트림(하트비트)을 끝까지 기다리지 않기 위함이다.
    반환: (status_code, headers_dict, accumulated_text)
    """
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "scheme": "http",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("testclient", 123),
        "server": ("testclient", 80),
        "state": {},
    }

    body_chunks: list[bytes] = []
    response: dict = {}
    got_body = asyncio.Event()

    request_done = False

    async def receive():
        # ASGI 계약: `more_body: False`를 보낸 뒤 다음으로 유효한 메시지는
        # `http.disconnect`뿐이다(Starlette `BaseHTTPMiddleware`가 이를 강제한다).
        # 실제 연결은 끊기지 않았으므로 그냥 영원히 대기한다 — 밖에서
        # `task.cancel()`이 이 await를 깨운다.
        nonlocal request_done
        if not request_done:
            request_done = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()

    async def send(message):
        if message["type"] == "http.response.start":
            response["status"] = message["status"]
            response["headers"] = {k.decode(): v.decode() for k, v in message.get("headers", [])}
        elif message["type"] == "http.response.body":
            body_chunks.append(message.get("body", b""))
            got_body.set()

    task = asyncio.ensure_future(asgi_app(scope, receive, send))
    try:
        async with asyncio.timeout(timeout):
            while not predicate(b"".join(body_chunks).decode()):
                await got_body.wait()
                got_body.clear()
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    return response.get("status"), response.get("headers", {}), b"".join(body_chunks).decode()


def test_events_endpoint_unknown_run_returns_404():
    with TestClient(app) as client:
        resp = client.get("/api/v1/runs/run_does_not_exist/events")
    assert resp.status_code == 404


async def test_events_endpoint_streams_sse_framed_events(monkeypatch):
    fake_output = CrewOutput(raw="final answer", tasks_output=[])
    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        run_id = client.post("/api/v1/runs", json={"graph": _valid_graph()}).json()["run_id"]

        status, resp_headers, text = await _drive_streaming_request(
            app, f"/api/v1/runs/{run_id}/events", {}, lambda t: "run.completed" in t
        )

    assert status == 200
    assert resp_headers["content-type"].startswith("text/event-stream")
    assert resp_headers["cache-control"] == "no-cache"
    assert resp_headers["x-accel-buffering"] == "no"
    assert "id: 1\nevent: run.started\n" in text
    assert "event: run.completed" in text


async def test_events_endpoint_replays_only_after_last_event_id(monkeypatch):
    fake_output = CrewOutput(raw="final answer", tasks_output=[])
    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        run_id = client.post("/api/v1/runs", json={"graph": _valid_graph()}).json()["run_id"]

        _, _, text = await _drive_streaming_request(
            app,
            f"/api/v1/runs/{run_id}/events",
            {"Last-Event-ID": "1"},
            lambda t: "run.completed" in t,
        )

    assert "run.started" not in text
    assert "event: run.completed" in text


async def test_events_endpoint_ignores_malformed_last_event_id_and_replays_from_zero(monkeypatch):
    """`Last-Event-ID` 는 브라우저가 그대로 되돌려주는 값이라 신뢰할 수 없다 —
    정수로 파싱되지 않으면 0(전량 replay)으로 폴백해야지 500이 나면 안 된다."""
    fake_output = CrewOutput(raw="final answer", tasks_output=[])
    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        run_id = client.post("/api/v1/runs", json={"graph": _valid_graph()}).json()["run_id"]

        status, _, text = await _drive_streaming_request(
            app,
            f"/api/v1/runs/{run_id}/events",
            {"Last-Event-ID": "not-a-number"},
            lambda t: "run.completed" in t,
        )

    assert status == 200
    assert "event: run.started" in text  # 전량 replay


async def test_events_endpoint_accepts_x_last_event_id_fallback_header(monkeypatch):
    """EventSource 를 못 쓰는 클라이언트(fetch 기반 재연결)를 위한 대체 헤더."""
    fake_output = CrewOutput(raw="final answer", tasks_output=[])
    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        run_id = client.post("/api/v1/runs", json={"graph": _valid_graph()}).json()["run_id"]

        _, _, text = await _drive_streaming_request(
            app,
            f"/api/v1/runs/{run_id}/events",
            {"X-Last-Event-Id": "1"},
            lambda t: "run.completed" in t,
        )

    assert "run.started" not in text


async def test_events_endpoint_emits_heartbeat_comment_when_idle(monkeypatch):
    """Spec §10.1 MUST: 유휴 시 `: heartbeat` 코멘트 프레임으로 프록시 타임아웃을 막는다.

    하트비트 주기(기본 15초)를 기다릴 수는 없으므로 브릿지를 짧은 주기로 갈아
    끼운다 — run 이 아직 안 끝난 상태(무한 kickoff)에서 유휴 구간을 만든다.
    """
    started = threading.Event()

    def _fake_kickoff(crew, inputs):
        step_cb = crew.agents[0].step_callback
        started.set()
        while True:
            step_cb(object())
            time.sleep(0.01)

    import asyncio as _asyncio

    async def _fake_to_thread(fn):
        return await _asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    with TestClient(app) as client:
        run_id = client.post("/api/v1/runs", json={"graph": _valid_graph()}).json()["run_id"]
        assert started.wait(timeout=2.0)
        manager = app.state.run_manager
        handle = manager.get(run_id)
        handle.bridge._heartbeat_s = 0.05  # 15초를 기다리지 않는다

        _, _, text = await _drive_streaming_request(
            app, f"/api/v1/runs/{run_id}/events", {}, lambda t: ": heartbeat" in t, timeout=5.0
        )

        manager.cancel(run_id)

    assert ": heartbeat\n\n" in text


# --- GET /runs/{id} 스냅샷 조립 (_build_snapshot) -----------------------------


def _snapshot_handle(events: list[tuple[str, dict]], status: str = "succeeded") -> RunHandle:
    handle = RunHandle(run_id="run_snap", bridge=EventBridge("run_snap"), task_order=["task_1"])
    handle.status = status
    for name, fields in events:
        handle.bridge.emit(name, **fields)
    return handle


def test_snapshot_folds_node_status_into_latest_state():
    handle = _snapshot_handle([
        ("node.status", {"node_id": "task_1", "status": "running"}),
        ("node.status", {"node_id": "task_1", "status": "succeeded"}),
    ])
    snap = _build_snapshot(handle)
    assert snap.node_states["task_1"].status == "succeeded"


def test_snapshot_attaches_task_output_and_error_message():
    handle = _snapshot_handle([
        ("task.completed", {"node_id": "task_1", "task_id": "t1", "output": "결과물", "duration_ms": 5}),
        ("log", {"node_id": "task_2", "level": "error", "message": "터졌다"}),
    ])
    snap = _build_snapshot(handle)
    assert snap.node_states["task_1"].output == "결과물"
    assert snap.node_states["task_2"].status == "failed"
    assert snap.node_states["task_2"].error == "터졌다"


def test_snapshot_accumulates_token_usage_and_cost_per_node():
    handle = _snapshot_handle([
        ("token.usage", {"node_id": "task_1", "prompt_tokens": 100, "completion_tokens": 20, "cost_usd": 0.001}),
        ("token.usage", {"node_id": "task_1", "prompt_tokens": 50, "completion_tokens": 10, "cost_usd": 0.0005},),
    ])
    snap = _build_snapshot(handle)
    usage = snap.node_states["task_1"].usage
    assert usage.prompt == 150
    assert usage.completion == 30
    assert usage.cost_usd == pytest.approx(0.0015)


def test_snapshot_of_non_terminal_run_has_no_finished_at():
    handle = _snapshot_handle(
        [("node.status", {"node_id": "task_1", "status": "running"})], status="running"
    )
    snap = _build_snapshot(handle)
    assert snap.started_at is not None
    assert snap.finished_at is None


def test_snapshot_of_run_without_events_has_no_timestamps():
    handle = _snapshot_handle([], status="queued")
    snap = _build_snapshot(handle)
    assert snap.started_at is None
    assert snap.finished_at is None
    assert snap.node_states == {}


def test_snapshot_ignores_events_without_node_id():
    handle = _snapshot_handle([
        ("run.started", {"task_order": ["task_1"], "agent_count": 1, "started_at": "2026-08-31T00:00:00Z"}),
    ])
    snap = _build_snapshot(handle)
    assert snap.node_states == {}
