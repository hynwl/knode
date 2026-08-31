"""M2-T10 테스트: `runtime/manager.py` (Spec §11.1~§11.4, §10.6).

`crew.kickoff()`는 실제 LLM 호출을 하므로 `app.runtime.manager.kickoff`을
monkeypatch로 갈아끼운다 — CrewAI 이벤트 버스를 실제로 태우지 않으므로
`node.status`/`task.*` 등 콜백 번역은 테스트하지 않는다(그건 `test_runtime.py`
몫). 여기서는 Run Manager 고유 책임(동시성/취소/타임아웃/GC/격리/시크릿
클리어)만 검증한다.
"""

from __future__ import annotations

import asyncio
import contextlib

import pytest

from app.core.crewai_compat import CrewOutput
from app.core.errors import AppError, CompilationError
from app.runtime import callbacks
from app.runtime.manager import RunManager, _classify_exception
from app.schemas.graph import CanvasDoc

BASE = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_test",
    "name": "Manager Test",
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


def _valid_doc() -> CanvasDoc:
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
    return CanvasDoc.model_validate({**BASE, "nodes": nodes, "edges": edges})


def _invalid_doc() -> CanvasDoc:
    return CanvasDoc.model_validate({**BASE, "nodes": [], "edges": []})


class _FakeSecrets:
    def __init__(self):
        self.cleared = False

    def get(self, key):
        return None

    def clear(self):
        self.cleared = True


@pytest.mark.asyncio
async def test_submit_rejects_invalid_graph_without_registering_run():
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    with pytest.raises(CompilationError):
        await manager.submit(_invalid_doc(), inputs={}, secrets=None, max_duration_s=None)
    assert manager.active_count() == 0


@pytest.mark.asyncio
async def test_submit_rejects_when_over_concurrency_limit(monkeypatch):
    manager = RunManager(max_concurrent=1, ttl_seconds=1800)

    async def _never_finishes(*args, **kwargs):
        await asyncio.sleep(10)
        return CrewOutput(raw="unused", tasks_output=[])

    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: None)
    monkeypatch.setattr(
        "app.runtime.manager.anyio.to_thread.run_sync",
        lambda fn: _never_finishes(),
    )

    handle1 = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    assert handle1.status in ("queued", "running")

    with pytest.raises(AppError) as exc_info:
        await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    assert exc_info.value.code == "AC-E503"
    assert exc_info.value.status_code == 429

    handle1.asyncio_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await handle1.asyncio_task


@pytest.mark.asyncio
async def test_successful_run_emits_started_then_completed(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    secrets = _FakeSecrets()

    fake_output = CrewOutput(raw="final answer", tasks_output=[])

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=secrets, max_duration_s=None)
    await handle.asyncio_task

    events = handle.bridge.buffered()
    names = [e["event"] for e in events]
    assert names == ["run.started", "run.completed"]
    assert events[0]["data"]["task_order"] == ["task_1"]
    assert events[0]["data"]["agent_count"] == 1
    assert events[1]["data"]["final_output"] == "final answer"
    assert handle.status == "succeeded"
    assert secrets.cleared is True


@pytest.mark.asyncio
async def test_failed_run_emits_run_failed_and_isolates_exception(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    def _boom(fn):
        raise RuntimeError("kaboom")

    async def _fake_to_thread(fn):
        return _boom(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: None)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await handle.asyncio_task  # RuntimeError는 절대 여기까지 전파되면 안 된다 (격리 원칙)

    events = handle.bridge.buffered()
    assert events[-1]["event"] == "run.failed"
    assert events[-1]["data"]["error"]["code"] == "AC-E501"
    assert handle.status == "failed"


@pytest.mark.asyncio
async def test_user_cancel_raises_cancelled_by_user_and_emits_run_cancelled(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    started = asyncio.Event()

    def _fake_kickoff(crew, inputs):
        # step_callback 이 CancelledByUser를 raise할 때까지 반복 호출을 흉내낸다.
        step_cb = crew.agents[0].step_callback
        started.set()
        while True:
            step_cb(object())

    async def _fake_to_thread(fn):
        return await asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await started.wait()
    handle.request_cancel("user")
    await handle.asyncio_task

    assert handle.status == "cancelled"
    events = handle.bridge.buffered()
    assert events[-1]["event"] == "run.cancelled"


@pytest.mark.asyncio
async def test_timeout_watchdog_marks_run_failed_with_timeout_code(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    started = asyncio.Event()

    def _fake_kickoff(crew, inputs):
        step_cb = crew.agents[0].step_callback
        started.set()
        while True:
            step_cb(object())

    async def _fake_to_thread(fn):
        return await asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=1)
    await started.wait()
    await handle.asyncio_task

    assert handle.status == "failed"
    events = handle.bridge.buffered()
    assert events[-1]["data"]["error"]["code"] == "AC-E502"


def test_cancel_returns_false_for_unknown_run():
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    assert manager.cancel("run_does_not_exist") is False


# ---------------------------------------------------------------------------
# _classify_exception — litellm 예외 → AC-E601/E603/E604 (M2-T20, Spec §11.4)
#
# 이 세 코드는 실제 LLM 호출이 있어야만 나오는 것처럼 보이지만, 분류 함수는
# 순수 함수라 예외 인스턴스만 만들어 주면 결정적으로 검증할 수 있다.
# litellm 예외 생성자 시그니처가 바뀌면 여기서 먼저 깨진다(의도된 카나리).
# ---------------------------------------------------------------------------

def test_classify_exception_maps_litellm_auth_error_to_ac_e601():
    from litellm.exceptions import AuthenticationError

    code, message = _classify_exception(
        AuthenticationError(message="bad key", llm_provider="openai", model="gpt-4o-mini")
    )
    assert code == "AC-E601"
    assert "401/403" in message


def test_classify_exception_maps_permission_denied_to_ac_e601():
    import httpx
    from litellm.exceptions import PermissionDeniedError

    exc = PermissionDeniedError(
        message="forbidden",
        llm_provider="openai",
        model="gpt-4o-mini",
        response=httpx.Response(403, request=httpx.Request("POST", "https://api.openai.com/v1")),
    )
    assert _classify_exception(exc)[0] == "AC-E601"


def test_classify_exception_maps_rate_limit_to_ac_e603():
    from litellm.exceptions import RateLimitError

    code, message = _classify_exception(
        RateLimitError(message="429", llm_provider="openai", model="gpt-4o-mini")
    )
    assert code == "AC-E603"
    assert "rate limit" in message


def test_classify_exception_maps_not_found_to_ac_e604():
    from litellm.exceptions import NotFoundError

    code, message = _classify_exception(
        NotFoundError(message="no such model", model="gpt-nope", llm_provider="openai")
    )
    assert code == "AC-E604"
    assert "모델" in message


def test_classify_exception_falls_back_to_ac_e501_for_unknown_exception():
    assert _classify_exception(RuntimeError("boom")) == ("AC-E501", "boom")


def test_classify_exception_uses_default_message_when_exception_str_is_empty():
    code, message = _classify_exception(RuntimeError())
    assert code == "AC-E501"
    assert message  # 빈 문자열을 그대로 사용자에게 내보내지 않는다


@pytest.mark.asyncio
async def test_llm_auth_failure_during_run_surfaces_ac_e601_in_run_failed(monkeypatch):
    """분류 결과가 실제로 `run.failed` 이벤트의 error.code 까지 실려 나간다."""
    from litellm.exceptions import AuthenticationError

    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    def _boom(crew, inputs):
        raise AuthenticationError(message="bad key", llm_provider="openai", model="gpt-4o-mini")

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.kickoff", _boom)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await handle.asyncio_task

    assert handle.status == "failed"
    assert handle.bridge.buffered()[-1]["data"]["error"]["code"] == "AC-E601"


@pytest.mark.asyncio
async def test_gc_removes_only_expired_finished_runs(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=0)
    fake_output = CrewOutput(raw="ok", tasks_output=[])

    async def _fake_to_thread(fn):
        return fn()

    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: fake_output)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await handle.asyncio_task

    removed = manager.gc()
    assert removed == 1
    assert manager.get(handle.run_id) is None


@pytest.mark.asyncio
async def test_shutdown_requests_cancel_on_active_runs(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    started = asyncio.Event()

    def _fake_kickoff(crew, inputs):
        step_cb = crew.agents[0].step_callback
        started.set()
        while True:
            step_cb(object())

    async def _fake_to_thread(fn):
        return await asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await started.wait()
    manager.shutdown()
    await handle.asyncio_task

    assert handle.status == "cancelled"
    assert handle.cancel_reason == "shutdown"
