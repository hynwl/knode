"""M2-T2 스키마 테스트: graph/run/events/errors.

`test_issue_catalog_matches_frontend` 는 CrewAI 실측 테스트와 같은 취지의
드리프트 가드다 — `frontend/src/validation/issues.ts` 와 `schemas/errors.py`
`ISSUE_CATALOG` 둘 중 하나만 고치면 이 테스트가 즉시 깨진다.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.errors import ISSUE_CATALOG, Issue, has_errors, issue
from app.schemas.events import EVENT_PAYLOAD_MODELS, EventName, NodeStatusEvent
from app.schemas.graph import AcEdge, AcNode, CanvasDoc
from app.schemas.run import RunRequest, RunResponse, ValidateResponse

FRONTEND_ISSUES_TS = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "validation" / "issues.ts"
)

# spec §7.6 예시 그래프. 프론트가 실제로 만드는 camelCase 와이어 포맷 그대로.
EXAMPLE_GRAPH = {
    "schema_version": "1.0",
    "app_version": "0.1.0",
    "id": "cvs_01J8XKQ2M3N4P5",
    "name": "Minimal Research Crew",
    "created_at": "2026-08-28T09:00:00Z",
    "updated_at": "2026-08-28T09:30:00Z",
    "viewport": {"x": 0, "y": 0, "zoom": 1},
    "nodes": [
        {
            "id": "input_1", "type": "input", "position": {"x": 40, "y": 40},
            "data": {"var_name": "topic", "label": "리서치 주제", "input_type": "text",
                      "default_value": "AI 에이전트 시장", "required": True},
            "ui": {"collapsed": False, "pinned": False, "bypassed": False, "colorOverride": None},
        },
        {
            "id": "agent_1", "type": "agent", "position": {"x": 420, "y": 160},
            "data": {"name": "Researcher", "role": "Senior Market Researcher"},
            "ui": {"collapsed": False, "pinned": False, "bypassed": False, "colorOverride": None},
            "parentNode": None,
        },
    ],
    "edges": [
        {"id": "e1", "source": "input_1", "sourceHandle": "text", "target": "agent_1", "targetHandle": "text"},
    ],
    "meta": {"requires_keys": ["OPENAI_API_KEY", "SERPER_API_KEY"]},
}


def test_canvas_doc_parses_camelcase_wire_format():
    doc = CanvasDoc.model_validate(EXAMPLE_GRAPH)
    assert doc.nodes[1].parent_node is None
    assert doc.edges[0].source_handle == "text"
    assert doc.edges[0].target_handle == "text"
    assert doc.nodes[0].data["var_name"] == "topic"


def test_canvas_doc_round_trips_by_alias():
    doc = CanvasDoc.model_validate(EXAMPLE_GRAPH)
    dumped = doc.model_dump(by_alias=True)
    assert "sourceHandle" in dumped["edges"][0]
    assert "parentNode" in dumped["nodes"][1]
    assert CanvasDoc.model_validate(dumped) == doc


def test_ac_node_defaults_ui_state_when_omitted():
    node = AcNode.model_validate(
        {"id": "n1", "type": "note", "position": {"x": 0, "y": 0}}
    )
    assert node.ui.collapsed is False
    assert node.data == {}


def test_ac_edge_requires_handles():
    with pytest.raises(ValidationError):
        AcEdge.model_validate({"id": "e1", "source": "a", "target": "b"})


def test_run_request_parses_spec_example_body():
    body = {
        "graph": EXAMPLE_GRAPH,
        "inputs": {"topic": "AI 에이전트 시장"},
        "options": {"dry_run": False, "max_duration_s": 900, "stream_thoughts": True, "verbose": True},
    }
    req = RunRequest.model_validate(body)
    assert req.inputs["topic"] == "AI 에이전트 시장"
    assert req.options.max_duration_s == 900


def test_run_request_options_default_when_omitted():
    req = RunRequest.model_validate({"graph": EXAMPLE_GRAPH})
    assert req.options.stream_thoughts is True
    assert req.inputs == {}


def test_run_response_matches_spec_example_shape():
    resp = RunResponse.model_validate(
        {
            "run_id": "run_01J8XKQ2M3N4P5",
            "status": "queued",
            "task_order": ["task_1", "task_2", "task_3"],
            "warnings": [{"code": "AC-W104", "node_id": "agent_9", "message": "..."}],
            "events_url": "/api/v1/runs/run_01J8XKQ2M3N4P5/events",
        }
    )
    assert resp.warnings[0].code == "AC-W104"


def test_validate_response_valid_flag_independent_of_issues_field():
    resp = ValidateResponse.model_validate({"valid": False, "issues": [issue("AC-E101").model_dump()]})
    assert resp.valid is False
    assert resp.issues[0].code == "AC-E101"


# ---------------------------------------------------------------------------
# errors.py — Issue 카탈로그
# ---------------------------------------------------------------------------

def test_issue_severity_rejects_warning_spelling():
    with pytest.raises(ValidationError):
        Issue.model_validate({"code": "AC-W104", "severity": "warning", "message": "x"})


def test_issue_helper_fills_from_catalog():
    i = issue("AC-E101")
    assert i.severity == "error"
    assert i.message == "Crew 노드가 없습니다"
    assert i.docs_url and i.docs_url.endswith("#AC-E101")


def test_issue_helper_overrides_and_unknown_code_fallback():
    i = issue("AC-E201", node_id="agent_1", field="goal")
    assert i.node_id == "agent_1"
    unknown = issue("AC-E999")
    assert unknown.message == "AC-E999"
    assert unknown.severity == "error"


def test_has_errors_distinguishes_warn_from_error():
    warns_only = [issue("AC-W104")]
    assert has_errors(warns_only) is False
    with_error = [issue("AC-W104"), issue("AC-E101")]
    assert has_errors(with_error) is True


@pytest.mark.skipif(not FRONTEND_ISSUES_TS.exists(), reason="frontend 소스가 없는 환경")
def test_issue_catalog_matches_frontend():
    """드리프트 가드: frontend ISSUE_CATALOG 와 코드/severity/message/hint 전량 대조."""
    text = FRONTEND_ISSUES_TS.read_text(encoding="utf-8")
    pattern = re.compile(
        r"'(AC-[EW]\d+)':\s*\{\s*severity:\s*'(error|warn)',\s*message:\s*'([^']*)',\s*hint:\s*'([^']*)'"
    )
    fe_entries = {m.group(1): (m.group(2), m.group(3), m.group(4)) for m in pattern.finditer(text)}

    assert fe_entries, "프론트 ISSUE_CATALOG 파싱 결과가 비어 있음 — 정규식이 포맷 변경을 못 따라감"
    assert set(fe_entries) == set(ISSUE_CATALOG), (
        f"코드 불일치. FE에만: {set(fe_entries) - set(ISSUE_CATALOG)}, "
        f"BE에만: {set(ISSUE_CATALOG) - set(fe_entries)}"
    )
    for code, (severity, message, hint) in fe_entries.items():
        be = ISSUE_CATALOG[code]
        assert be.severity == severity, f"{code} severity 불일치"
        assert be.message == message, f"{code} message 불일치"
        assert be.hint == hint, f"{code} hint 불일치"


# ---------------------------------------------------------------------------
# events.py
# ---------------------------------------------------------------------------

def test_event_payload_models_cover_full_catalog():
    expected = set(EventName.__args__)  # type: ignore[attr-defined]
    assert set(EVENT_PAYLOAD_MODELS) == expected


def test_node_status_event_allows_null_node_id():
    ev = NodeStatusEvent.model_validate(
        {"run_id": "run_1", "seq": 1, "ts": "2026-08-30T00:00:00Z", "node_id": None, "status": "running"}
    )
    assert ev.node_id is None
    assert ev.status == "running"


def test_every_event_payload_model_builds_from_minimal_example():
    ts = "2026-08-30T00:00:00Z"
    minimal: dict[str, dict] = {
        "run.started": {"task_order": ["t1"], "agent_count": 1, "started_at": ts},
        "run.completed": {"duration_ms": 10, "final_output": "ok"},
        "run.failed": {"error": {"code": "AC-E501", "message": "x"}},
        "run.cancelled": {"cancelled_at": ts},
        "node.status": {"node_id": "n1", "status": "running"},
        "task.started": {"node_id": "t1", "task_name": "Research"},
        "task.completed": {"node_id": "t1", "output": "done", "duration_ms": 5},
        "agent.thought": {"agent_node_id": "a1", "text": "thinking"},
        "agent.tool_use": {"agent_node_id": "a1", "tool_id": "serper_search", "call_id": "c1"},
        "agent.tool_result": {"call_id": "c1"},
        "agent.delegation": {"from_node_id": "a1", "to_node_id": "a2", "question": "?"},
        "token.usage": {"node_id": "a1", "prompt_tokens": 1, "completion_tokens": 1, "cost_usd": 0.001},
        "log": {"level": "info", "message": "hi"},
        "human.request": {"node_id": "h1", "prompt": "ok?", "timeout_s": 60},
        "edge.active": {"edge_id": "e1", "active": True},
    }
    for name, model in EVENT_PAYLOAD_MODELS.items():
        payload = {"run_id": "run_1", "seq": 1, "ts": ts, **minimal[name]}
        instance = model.model_validate(payload)
        assert instance.run_id == "run_1"
