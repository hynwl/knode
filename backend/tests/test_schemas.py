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


FRONTEND_RUN_CLIENT_TS = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "run" / "client.ts"
)


@pytest.mark.skipif(not FRONTEND_RUN_CLIENT_TS.exists(), reason="frontend 소스가 없는 환경")
def test_frontend_api_issue_matches_wire_format():
    """드리프트 가드: 프론트 `ApiIssue` 필드명 == `Issue` 가 실제로 내보내는 키.

    `Issue` 는 `nodeId`/`edgeId`/`docsUrl` 에 alias 가 걸려 있고 에러 핸들러가
    `model_dump(by_alias=True)` 로 직렬화한다. M4-T10 감사 전까지 프론트는 이걸
    `node_id`/`edge_id` 로 선언하고 있었고, 타입이 그럴싸해서 컴파일도 통과했다 —
    그 결과 `ExportCodeModal` 의 "이 노드 보기" 버튼이 항상 undefined 를 보고
    한 번도 렌더되지 않았다 (Spec §9.1 MUST 위반). 이름만 어긋나는 이런 버그는
    한쪽만 보는 테스트로는 절대 안 잡히므로 경계에서 직접 대조한다.
    """
    wire_keys = set(
        issue("AC-E101", node_id="n1", edge_id="e1", field="f").model_dump(by_alias=True)
    )
    text = FRONTEND_RUN_CLIENT_TS.read_text(encoding="utf-8")
    block = re.search(r"export interface ApiIssue \{(.*?)\}", text, re.S)
    assert block, "ApiIssue 선언을 못 찾음 — 정규식이 포맷 변경을 못 따라감"
    fe_keys = set(re.findall(r"^\s*(\w+)\??:", block.group(1), re.M))

    assert fe_keys == wire_keys, (
        f"ApiIssue 와 와이어 포맷 불일치. FE에만: {fe_keys - wire_keys}, "
        f"BE만 보냄: {wire_keys - fe_keys}"
    )


FRONTEND_LOCALES = [
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n" / loc
    for loc in ("ko.json", "en.json")
]


def _collect_dynamic_issues() -> list:
    """백엔드가 실제로 `message` 를 갈아끼우는 이슈들을 모은다."""
    import json

    from app.compiler.graph import CanvasGraph
    from app.compiler.interpolate import resolve_inputs
    from app.compiler.validators import validate_graph

    fixture = json.loads(json.dumps(EXAMPLE_GRAPH))
    # 필수 필드를 비우고, 없는 변수를 참조시키고, v1.1 노드를 넣어 동적 메시지를 유발한다.
    for n in fixture["nodes"]:
        if n["type"] == "agent":
            n["data"]["role"] = ""
        if n["type"] == "task":
            n["data"]["description"] = "{nope} 를 조사하라"
    fixture["nodes"].append({
        "id": "router_x", "type": "router", "position": {"x": 0, "y": 0}, "data": {},
    })
    doc = CanvasDoc.model_validate(fixture)
    issues = validate_graph(doc)

    _, input_issues = resolve_inputs(CanvasGraph.from_doc(doc).normalize(), {})
    return issues + input_issues


@pytest.mark.skipif(not all(p.exists() for p in FRONTEND_LOCALES), reason="frontend 소스가 없는 환경")
def test_backend_dynamic_messages_carry_translatable_keys():
    """§17.3 — 백엔드가 문구를 갈아끼운 이슈는 `message_key` + `params` 를 함께 실어야 한다.

    프론트 `issueText()` 는 코드별 로케일 오버라이드를 `message` 가 카탈로그 기본값과
    **같을 때만** 적용한다. 그래서 백엔드가 노드/필드 이름을 박아 넣은 순간 그 이슈는
    번역 경로에서 빠지고, 영어 UI 에서도 한국어로 남는다 — M4-T10 감사에서 영어 모드의
    AC-E602 토스트로 실제 확인된 문제다. 여기서 "동적 메시지 = 키 동반"을 강제한다.
    """
    import json

    catalog_defaults = {c: t.message for c, t in ISSUE_CATALOG.items()}
    locales = [json.loads(p.read_text(encoding="utf-8")) for p in FRONTEND_LOCALES]

    dynamic = [i for i in _collect_dynamic_issues() if i.message != catalog_defaults.get(i.code)]
    assert dynamic, "동적 메시지를 하나도 유발하지 못했다 — 픽스처가 낡았다"

    for i in dynamic:
        assert i.message_key, f"{i.code}: 동적 메시지인데 message_key 가 없다 ({i.message!r})"
        for loc, data in zip(FRONTEND_LOCALES, locales):
            section, _, key = i.message_key.partition(".")
            assert key in data.get(section, {}), f"{loc.name} 에 {i.message_key} 가 없다"


@pytest.mark.skipif(not all(p.exists() for p in FRONTEND_LOCALES), reason="frontend 소스가 없는 환경")
def test_issue_params_are_i18n_keys_not_translated_strings():
    """`params` 값은 번역된 문자열이 아니라 **키**여야 한다.

    검증은 그래프가 바뀔 때 돌지 로케일이 바뀔 때 다시 돌지 않는다. 번역문을 굳혀 넣으면
    언어를 바꿔도 메시지 속 노드·필드 이름만 옛 언어로 남는다(M4-T4 가 프론트에서 겪은
    바로 그 버그). 노드/필드 라벨 자리는 `node.*`/`field.*` 키여야 한다.
    """
    import json

    ko = json.loads(FRONTEND_LOCALES[0].read_text(encoding="utf-8"))

    def has_key(dotted: str) -> bool:
        cur = ko
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return False
            cur = cur[part]
        return isinstance(cur, str)

    checked = 0
    for i in _collect_dynamic_issues():
        for name in ("node", "field"):
            value = (i.params or {}).get(name)
            if value is None:
                continue
            assert isinstance(value, str) and has_key(value), (
                f"{i.code}: params[{name}]={value!r} 이 프론트 i18n 키가 아니다"
            )
            checked += 1
    assert checked, "노드/필드 라벨을 쓰는 이슈가 하나도 안 잡혔다 — 픽스처가 낡았다"
