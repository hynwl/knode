"""M2-T14 테스트: `runtime/cost.py` (Spec §3.5-20).

가격 테이블은 litellm이 갖고 있으므로 여기서는 우리 코드가 그 값을 올바르게
가져오고, 모르는 모델/토큰 0개일 때 안전하게 0.0으로 흡수하는지만 검증한다.
"""

from __future__ import annotations

import litellm

from app.compiler.graph import CanvasGraph
from app.runtime.cost import estimate_dry_run, estimate_token_cost
from app.schemas.graph import CanvasDoc


def test_known_model_returns_positive_cost_matching_litellm():
    prompt_cost, completion_cost = litellm.cost_per_token(
        model="gpt-4o", prompt_tokens=1000, completion_tokens=500
    )
    expected = prompt_cost + completion_cost
    assert estimate_token_cost("gpt-4o", 1000, 500) == expected
    assert expected > 0


def test_unknown_model_returns_zero_without_raising():
    assert estimate_token_cost("not-a-real-model-xyz", 1000, 500) == 0.0


def test_none_model_returns_zero():
    assert estimate_token_cost(None, 1000, 500) == 0.0


def test_zero_tokens_returns_zero_without_calling_litellm(monkeypatch):
    def _boom(**kwargs):
        raise AssertionError("should not be called for zero tokens")

    monkeypatch.setattr("app.runtime.cost.litellm.cost_per_token", _boom)
    assert estimate_token_cost("gpt-4o", 0, 0) == 0.0


def test_ollama_local_model_is_free():
    assert estimate_token_cost("ollama/llama3.1", 1000, 500) == 0.0


# ---------------------------------------------------------------------------
# estimate_dry_run — M3-T9 Dry Run 모드 (Spec §11.3). LLM 호출 없이 그래프
# 텍스트만으로 태스크별 토큰/비용을 어림한다.
# ---------------------------------------------------------------------------

_BASE = {
    "schema_version": "1.0", "app_version": "0.1.0", "id": "cvs_test", "name": "t",
    "created_at": "2026-08-30T00:00:00Z", "updated_at": "2026-08-30T00:00:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


def _n(node_id: str, node_type: str, data: dict | None = None) -> dict:
    return {"id": node_id, "type": node_type, "position": {"x": 0, "y": 0}, "data": data or {}}


def _e(edge_id: str, source: str, source_handle: str, target: str, target_handle: str) -> dict:
    return {"id": edge_id, "source": source, "sourceHandle": source_handle, "target": target, "targetHandle": target_handle}


def _graph_with_one_task() -> CanvasGraph:
    doc = CanvasDoc.model_validate({
        **_BASE,
        "nodes": [
            _n("crew_1", "crew", {"process": "sequential"}),
            _n("llm_1", "llm", {"provider": "openai", "model": "gpt-4o"}),
            _n("agent_1", "agent", {"role": "r", "goal": "g" * 40, "backstory": "b" * 40}),
            _n("task_1", "task", {"description": "d" * 40, "expected_output": "o" * 40}),
        ],
        "edges": [
            _e("e1", "agent_1", "agent", "crew_1", "agent"),
            _e("e2", "task_1", "task", "crew_1", "task"),
            _e("e3", "agent_1", "agent", "task_1", "agent"),
            _e("e4", "llm_1", "llm", "agent_1", "llm"),
        ],
    })
    return CanvasGraph.from_doc(doc).normalize()


def test_estimate_dry_run_resolves_agent_and_model_from_graph():
    graph = _graph_with_one_task()
    [estimate] = estimate_dry_run(graph, ["task_1"])
    assert estimate.node_id == "task_1"
    assert estimate.agent_node_id == "agent_1"
    assert estimate.prompt_tokens > 0
    assert estimate.completion_tokens > 0
    assert estimate.cost_usd == estimate_token_cost(
        "gpt-4o", estimate.prompt_tokens, estimate.completion_tokens
    )
    assert estimate.cost_usd > 0


def test_estimate_dry_run_longer_text_yields_more_prompt_tokens():
    doc = CanvasDoc.model_validate({
        **_BASE,
        "nodes": [
            _n("crew_1", "crew", {"process": "sequential"}),
            _n("agent_1", "agent", {"role": "r", "goal": "g", "backstory": "b"}),
            _n("task_1", "task", {"description": "d" * 4000, "expected_output": "o"}),
        ],
        "edges": [
            _e("e1", "agent_1", "agent", "crew_1", "agent"),
            _e("e2", "task_1", "task", "crew_1", "task"),
            _e("e3", "agent_1", "agent", "task_1", "agent"),
        ],
    })
    graph = CanvasGraph.from_doc(doc).normalize()
    [short_estimate] = estimate_dry_run(_graph_with_one_task(), ["task_1"])
    [long_estimate] = estimate_dry_run(graph, ["task_1"])
    assert long_estimate.prompt_tokens > short_estimate.prompt_tokens


def test_estimate_dry_run_skips_unknown_task_node_id():
    graph = _graph_with_one_task()
    assert estimate_dry_run(graph, ["task_1", "does_not_exist"]) == estimate_dry_run(graph, ["task_1"])


def test_estimate_dry_run_handles_task_without_agent():
    doc = CanvasDoc.model_validate({
        **_BASE,
        "nodes": [
            _n("crew_1", "crew", {"process": "sequential"}),
            _n("task_1", "task", {"description": "d", "expected_output": "o"}),
        ],
        "edges": [_e("e2", "task_1", "task", "crew_1", "task")],
    })
    graph = CanvasGraph.from_doc(doc).normalize()
    [estimate] = estimate_dry_run(graph, ["task_1"])
    assert estimate.agent_node_id is None
    assert estimate.cost_usd == 0.0  # 모델을 모르므로 비용 추정 불가 → 0으로 흡수
