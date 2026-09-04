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
import time

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
    callbacks._key_registry.clear()


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


# --- 🐛 2026-08-31 버그픽스: 취소가 실제로 실행을 멈추게 한다 (RECON F15) ----
#
# crewai 1.15.18 의 기본 executor 는 툴 없는 에이전트 경로에서 `step_callback` 을
# **한 번도 호출하지 않는다**(실측). 그래서 step_callback 하나만 검문소로 쓰던
# 기존 구현에서는 Stop 을 눌러도 크루가 끝까지 실행됐다. 이제 태스크 경계
# (`Crew.task_callback`) 가 주 검문소다.


@pytest.mark.asyncio
async def test_cancel_stops_run_at_task_boundary_even_if_step_callback_never_fires(monkeypatch):
    """step_callback 이 한 번도 호출되지 않아도 task_callback 이 취소를 잡아낸다."""
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    started = asyncio.Event()
    executed_tasks = []

    def _fake_kickoff(crew, inputs):
        # 실제 CrewAI 처럼 태스크마다 task_callback 만 부른다 (step_callback 없음).
        started.set()
        for i in range(100):
            executed_tasks.append(i)
            time.sleep(0.01)  # 태스크 실행 시간
            crew.task_callback(object())
        return CrewOutput(raw="never gets here", tasks_output=[])

    async def _fake_to_thread(fn):
        return await asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await started.wait()
    handle.request_cancel("user")
    await handle.asyncio_task

    assert handle.status == "cancelled"
    assert len(executed_tasks) < 100  # 끝까지 돌지 않았다
    assert handle.bridge.buffered()[-1]["event"] == "run.cancelled"


@pytest.mark.asyncio
async def test_cancel_request_emits_notice_log_exactly_once(monkeypatch):
    """Stop 을 여러 번 눌러도 안내는 한 번만 — 다만 '즉시 멈춘다'고 거짓말하지 않는다."""
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    started = asyncio.Event()

    def _fake_kickoff(crew, inputs):
        started.set()
        while True:
            crew.task_callback(object())

    async def _fake_to_thread(fn):
        return await asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await started.wait()
    assert handle.request_cancel("user") is True
    assert handle.request_cancel("user") is True  # 두 번째 클릭
    await handle.asyncio_task

    notices = [
        e for e in handle.bridge.buffered()
        if e["event"] == "log" and "취소를 요청했습니다" in e["data"]["message"]
    ]
    assert len(notices) == 1
    assert notices[0]["data"]["level"] == "warn"
    assert "끝나는 즉시" in notices[0]["data"]["message"]  # 즉시 중단이라고 주장하지 않는다


@pytest.mark.asyncio
async def test_cancelled_run_settles_pending_task_nodes(monkeypatch):
    """취소 후에도 노드가 영원히 '실행 중'으로 남아 있으면 UI가 거짓말을 한다."""
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    started = asyncio.Event()

    def _fake_kickoff(crew, inputs):
        started.set()
        while True:
            crew.task_callback(object())

    async def _fake_to_thread(fn):
        return await asyncio.to_thread(fn)

    monkeypatch.setattr("app.runtime.manager.kickoff", _fake_kickoff)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await started.wait()
    handle.request_cancel("user")
    await handle.asyncio_task

    statuses = [
        e["data"] for e in handle.bridge.buffered() if e["event"] == "node.status"
    ]
    assert {s["node_id"]: s["status"] for s in statuses} == {"task_1": "cancelled"}


@pytest.mark.asyncio
async def test_failed_run_marks_never_started_task_nodes_as_skipped(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)

    async def _fake_to_thread(fn):
        raise RuntimeError("kaboom")

    monkeypatch.setattr("app.runtime.manager.kickoff", lambda crew, inputs: None)
    monkeypatch.setattr("app.runtime.manager.anyio.to_thread.run_sync", _fake_to_thread)

    handle = await manager.submit(_valid_doc(), inputs={}, secrets=None, max_duration_s=None)
    await handle.asyncio_task

    statuses = {
        e["data"]["node_id"]: e["data"]["status"]
        for e in handle.bridge.buffered() if e["event"] == "node.status"
    }
    assert statuses == {"task_1": "skipped"}


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
# Dry Run(M3-T9, Spec §11.3) — `RunManager._run_dry`. `kickoff()`가 절대 호출되지
# 않는다는 것 자체가 핵심 불변식이라 monkeypatch로 "호출되면 실패"를 건다.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dry_run_never_calls_kickoff(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    secrets = _FakeSecrets()
    monkeypatch.setattr("app.runtime.manager.DRY_RUN_STEP_S", 0.0)

    def _kickoff_should_not_be_called(crew, inputs):
        raise AssertionError("dry run은 절대 kickoff()를 호출하면 안 된다")

    monkeypatch.setattr("app.runtime.manager.kickoff", _kickoff_should_not_be_called)

    handle = await manager.submit(
        _valid_doc(), inputs={}, secrets=secrets, max_duration_s=None, dry_run=True
    )
    await handle.asyncio_task

    assert handle.status == "succeeded"
    assert secrets.cleared is True


@pytest.mark.asyncio
async def test_dry_run_emits_full_fake_event_sequence_for_task_and_agent_nodes(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    monkeypatch.setattr("app.runtime.manager.DRY_RUN_STEP_S", 0.0)
    def _kickoff_should_not_be_called(crew, inputs):
        raise AssertionError("dry run은 절대 kickoff()를 호출하면 안 된다")

    monkeypatch.setattr("app.runtime.manager.kickoff", _kickoff_should_not_be_called)

    handle = await manager.submit(
        _valid_doc(), inputs={}, secrets=None, max_duration_s=None, dry_run=True
    )
    await handle.asyncio_task

    events = handle.bridge.buffered()
    names = [e["event"] for e in events]
    assert names[0] == "run.started"
    assert names[-1] == "run.completed"
    assert "task.started" in names
    assert "task.completed" in names
    assert "token.usage" in names

    node_statuses = [e["data"] for e in events if e["event"] == "node.status"]
    task_statuses = [s["status"] for s in node_statuses if s["node_id"] == "task_1"]
    agent_statuses = [s["status"] for s in node_statuses if s["node_id"] == "agent_1"]
    assert task_statuses == ["running", "succeeded"]
    assert agent_statuses == ["running", "succeeded"]

    completed = events[-1]["data"]
    assert "Dry Run" in completed["final_output"]
    assert completed["usage"]["prompt_tokens"] > 0


@pytest.mark.asyncio
async def test_dry_run_can_be_cancelled_mid_sequence(monkeypatch):
    manager = RunManager(max_concurrent=3, ttl_seconds=1800)
    monkeypatch.setattr("app.runtime.manager.DRY_RUN_STEP_S", 0.05)
    def _kickoff_should_not_be_called(crew, inputs):
        raise AssertionError("dry run은 절대 kickoff()를 호출하면 안 된다")

    monkeypatch.setattr("app.runtime.manager.kickoff", _kickoff_should_not_be_called)

    handle = await manager.submit(
        _valid_doc(), inputs={}, secrets=None, max_duration_s=None, dry_run=True
    )
    handle.request_cancel("user")
    await handle.asyncio_task

    assert handle.status == "cancelled"
    assert handle.bridge.buffered()[-1]["event"] == "run.cancelled"


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


# ---------------------------------------------------------------------------
# RECON F17 (M4-T10) — **실제로 올라오는 건 openai SDK 예외다.**
#
# 위 테스트들이 전부 litellm 예외를 만들어 넣는 바람에 초록인 채로 숨어 있던 버그:
# litellm 의 예외는 openai 예외의 **서브클래스**라서, openai SDK 가 직접 던진
# 예외는 `isinstance(exc, litellm.RateLimitError)` 가 False 다. 그래서
# AC-E601/E603/E604 는 실전에서 한 번도 나오지 않고 전부 AC-E501 + 파이썬 repr
# 원문으로 떨어졌다(실제 OpenAI 429 응답으로 확인). 아래는 그 경로를 고정한다.
# ---------------------------------------------------------------------------

def _openai_response(status: int, body: dict | None = None):
    import httpx

    return httpx.Response(
        status, request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"),
        json=body or {},
    )


def test_classify_exception_maps_openai_sdk_auth_error_to_ac_e601():
    """litellm 이 아니라 openai SDK 가 던져도 분류돼야 한다 (RECON F17)."""
    import openai

    exc = openai.AuthenticationError("401", response=_openai_response(401), body=None)
    assert _classify_exception(exc)[0] == "AC-E601"


def test_classify_exception_maps_openai_sdk_permission_denied_to_ac_e601():
    import openai

    exc = openai.PermissionDeniedError("403", response=_openai_response(403), body=None)
    assert _classify_exception(exc)[0] == "AC-E601"


def test_classify_exception_maps_openai_sdk_rate_limit_to_ac_e603():
    import openai

    exc = openai.RateLimitError("429 slow down", response=_openai_response(429), body=None)
    code, message = _classify_exception(exc)
    assert code == "AC-E603"
    assert "rate limit" in message


def test_classify_exception_maps_openai_sdk_not_found_to_ac_e604():
    import openai

    exc = openai.NotFoundError("404", response=_openai_response(404), body=None)
    assert _classify_exception(exc)[0] == "AC-E604"


def test_classify_exception_separates_exhausted_credits_from_rate_limit():
    """잔액 소진은 AC-E605 — AC-E603 의 힌트("잠시 후 다시")가 **틀린 안내**가 된다.

    문구는 2026-09-04 실제 OpenAI 429 응답에서 그대로 가져왔다.
    """
    import openai

    body = {"error": {
        "message": "You have no credits remaining. Add credits to continue using the API at "
                   "https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota", "code": "credit_balance_exhausted",
    }}
    exc = openai.RateLimitError(
        f"Error code: 429 - {body}", response=_openai_response(429, body), body=body["error"],
    )
    code, message = _classify_exception(exc)
    assert code == "AC-E605"
    assert "크레딧" in message


def test_classify_exception_still_handles_litellm_exceptions():
    """litellm 경로도 계속 잡혀야 한다 (openai 서브클래스라 자동으로 잡힌다)."""
    from litellm.exceptions import RateLimitError

    assert _classify_exception(
        RateLimitError(message="429", llm_provider="openai", model="gpt-4o-mini")
    )[0] == "AC-E603"


def test_classify_exception_maps_missing_credentials_to_ac_e602():
    """키를 **아예 안 넣은** 경우 — 신규 사용자가 가장 먼저 만나는 실패.

    HTTP 응답이 없는 예외라 상태코드 분기에 안 걸린다. 실측 문구 두 종:
    CrewAI 는 `OPENAI_API_KEY is required`, openai SDK 는 `Missing credentials …`.
    고치기 전에는 둘 다 AC-E501 + 영문 원문으로 떨어졌다(M4-T10).
    """
    for text in (
        "OpenAI API call failed: OPENAI_API_KEY is required",
        "Missing credentials. Please pass an `api_key`, or set the `OPENAI_API_KEY` environment variable.",
        "ANTHROPIC_API_KEY is required",
    ):
        code, message = _classify_exception(RuntimeError(text))
        assert code == "AC-E602", text
        assert "키" in message


def test_classify_exception_does_not_mistake_invalid_key_for_missing_key():
    """"키가 틀렸다"(401)는 AC-E601 이지 AC-E602 가 아니다 — 안내가 정반대다."""
    import openai

    exc = openai.AuthenticationError(
        "Incorrect API key provided", response=_openai_response(401), body=None,
    )
    assert _classify_exception(exc)[0] == "AC-E601"


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


# ---------------------------------------------------------------------------
# CrewAI 1.15 는 openai 의 NotFoundError 를 **평범한 ValueError 로 다시 감싸서**
# 던진다. 그래서 위의 isinstance 분기가 못 잡고 AC-E501 + 영어 원문 덤프로
# 떨어졌다 — Ollama 로컬 모델 이름을 잘못 적는 건 가장 흔한 실패라 코드가 잡혀야 한다.
# 아래 문구는 2026-09-05 실측(Ollama base_url + 미설치 모델 kickoff)에서 그대로 가져왔다.
# ---------------------------------------------------------------------------

def test_classify_exception_maps_wrapped_model_not_found_to_ac_e604():
    exc = ValueError(
        "Model gpt-4o-mini not found: Error code: 404 - {'error': {'message': "
        "\"model 'gpt-4o-mini' not found\", 'type': 'not_found_error', 'param': None, 'code': None}}"
    )
    code, message = _classify_exception(exc)
    assert code == "AC-E604"
    assert "모델" in message


def test_classify_exception_keeps_plain_404_from_tools_as_ac_e501():
    """툴이 낸 평범한 404 까지 '모델 없음'으로 뭉뚱그리면 안 된다."""
    exc = RuntimeError("Error code: 404 - page not found for https://example.com/missing")
    assert _classify_exception(exc)[0] == "AC-E501"
