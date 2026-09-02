"""M4-T1: GET /api/v1/templates — 내장 템플릿 5종 서빙 (Spec §15.1, §15.2).

⚠️ 드리프트 가드 성격의 테스트다. `backend/app/data/templates/*.acanvas.json` 은
`frontend/src/templates/builtin.ts`(SSoT)에서 `npm run export:templates` 로
떨어뜨린 스냅샷이므로, 여기서 검증하는 것은 "스냅샷이 실제로 `CanvasDoc` 으로
파싱되고 5종이 다 있는가" 다. 프론트 빌더를 고치고 재생성을 잊으면 여기서 깨진다.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.main import app
from app.routers.templates import TEMPLATES_DIR, load_templates
from app.schemas.graph import CanvasDoc

client = TestClient(app)

#: Spec §15.1 "v1.0 필수 5종" (MUST)
REQUIRED_IDS = ["hello", "blog", "market_research", "youtube", "local"]


def test_all_five_builtin_templates_are_served_in_spec_order():
    resp = client.get("/api/v1/templates")
    assert resp.status_code == 200
    ids = [t["id"] for t in resp.json()["templates"]]
    assert ids == REQUIRED_IDS


def test_every_served_doc_parses_as_canvas_doc():
    body = client.get("/api/v1/templates").json()
    for item in body["templates"]:
        doc = CanvasDoc.model_validate(item["doc"])
        assert doc.nodes, f"{item['id']}: 노드가 비어 있다"
        assert any(n.type == "crew" for n in doc.nodes), f"{item['id']}: crew 노드가 없다"
        assert any(n.type == "task" for n in doc.nodes), f"{item['id']}: task 노드가 없다"


def test_stored_files_on_disk_are_valid_canvas_docs():
    """라우터를 거치지 않고 파일 자체도 스키마를 만족해야 한다(손편집 방지)."""
    paths = sorted(TEMPLATES_DIR.glob("*.acanvas.json"))
    assert {p.name.removesuffix(".acanvas.json") for p in paths} == set(REQUIRED_IDS)
    for path in paths:
        CanvasDoc.model_validate(json.loads(path.read_text(encoding="utf-8")))


def test_card_metadata_matches_spec_table():
    by_id = {t["id"]: t for t in client.get("/api/v1/templates").json()["templates"]}

    # §15.1 표: 필요 키
    assert by_id["hello"]["requires_keys"] == ["OPENAI_API_KEY"]
    assert by_id["blog"]["requires_keys"] == ["OPENAI_API_KEY", "SERPER_API_KEY"]
    assert by_id["market_research"]["requires_keys"] == ["OPENAI_API_KEY", "SERPER_API_KEY"]
    assert by_id["youtube"]["requires_keys"] == ["OPENAI_API_KEY"]
    # 진입장벽 0 — 완전 무료 오프라인 데모
    assert by_id["local"]["requires_keys"] == []
    assert by_id["local"]["estimated_cost_usd"] == 0

    # §15.1 표: 난이도 별표
    assert by_id["hello"]["difficulty"] == 1
    assert by_id["local"]["difficulty"] == 1
    for tid in ("blog", "market_research", "youtube"):
        assert by_id[tid]["difficulty"] == 2


def test_local_template_uses_ollama_only():
    """§15.1 "필요 키 없음". LLM 노드가 전부 ollama 프로바이더여야 한다."""
    by_id = {t["id"]: t for t in client.get("/api/v1/templates").json()["templates"]}
    llms = [n for n in by_id["local"]["doc"]["nodes"] if n["type"] == "llm"]
    assert llms
    assert all(n["data"]["provider"] == "ollama" for n in llms)


def test_market_research_researchers_are_independent():
    """§15.1 "병렬 리서치 3인 → 애널리스트 종합".

    CrewAI `Process` 에 parallel 은 없다(RECON §5, `crewai_compat.resolve_process`).
    "병렬"은 그래프 의존 관계로 표현된다 — 리서처 태스크 3개는 서로 context 가
    없고, 종합 태스크 하나만 그 셋을 전부 context 로 문다.
    """
    by_id = {t["id"]: t for t in client.get("/api/v1/templates").json()["templates"]}
    doc = by_id["market_research"]["doc"]

    crews = [n for n in doc["nodes"] if n["type"] == "crew"]
    assert len(crews) == 1
    assert crews[0]["data"]["process"] == "sequential"

    tasks = {n["id"] for n in doc["nodes"] if n["type"] == "task"}
    ctx = [e for e in doc["edges"] if e["targetHandle"] == "context"]
    # context 를 받는 태스크는 종합 태스크 단 하나, 그리고 그 하나가 3개를 다 문다.
    consumers = {e["target"] for e in ctx}
    assert len(consumers) == 1
    assert len(ctx) == 3
    # 나머지 3개 리서처 태스크는 context 입력이 0개 = 논리적으로 병렬
    independent = tasks - consumers
    assert len(independent) == 3


def test_youtube_pipeline_is_a_three_stage_chain():
    """§15.1 "기획 → 대본 → 훅 최적화" — 태스크 3개가 사슬로 이어져야 한다."""
    by_id = {t["id"]: t for t in client.get("/api/v1/templates").json()["templates"]}
    doc = by_id["youtube"]["doc"]
    tasks = [n for n in doc["nodes"] if n["type"] == "task"]
    assert len(tasks) == 3
    ctx = [e for e in doc["edges"] if e["targetHandle"] == "context"]
    assert len(ctx) == 2
    # 사슬: 각 단계가 정확히 하나의 선행 태스크만 문다
    assert len({e["target"] for e in ctx}) == 2


def test_loader_is_cached():
    assert load_templates() is load_templates()
