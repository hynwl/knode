/**
 * 내장 템플릿 (Spec §15.1)
 * 프론트엔드에 번들되어 **백엔드 없이도** 로드된다. (`MUST`)
 * 백엔드가 살아 있으면 `GET /api/v1/templates` 결과로 대체·확장된다.
 */

import { defaultDataFor, type NodeType } from '@/nodes/registry';
import { APP_VERSION, CURRENT_SCHEMA_VERSION, DEFAULT_NODE_UI, type AcEdge, type AcNode, type CanvasDoc } from '@/types/canvas';

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  difficulty: 1 | 2 | 3;
  requiresKeys: string[];
  estimatedCostUsd: number;
  /**
   * `ollamaModels` 는 §13.1 자동 감지로 **지금 이 머신에 설치된** 모델 이름들이다.
   * 로컬 템플릿이 모델명을 하드코딩하면 그 모델이 없는 머신에서 AC-E702(미설치)로
   * 실행 버튼이 잠겨 버리므로, 감지된 것 중에서 고른다.
   */
  build: (ollamaModels?: string[]) => CanvasDoc;
}

/* ---------- 빌더 헬퍼 ---------- */

class Builder {
  nodes: AcNode[] = [];
  edges: AcEdge[] = [];
  private seq = 0;

  node(type: NodeType, x: number, y: number, data: Record<string, unknown> = {}): string {
    const id = `${type}_${++this.seq}`;
    this.nodes.push({
      id,
      type,
      position: { x, y },
      width: null,
      height: null,
      data: { ...defaultDataFor(type), ...data },
      ui: { ...DEFAULT_NODE_UI },
      parentNode: null,
      extent: null,
    });
    return id;
  }

  link(source: string, sourceHandle: string, target: string, targetHandle: string): void {
    this.edges.push({
      id: `e_${this.edges.length + 1}`,
      source,
      sourceHandle,
      target,
      targetHandle,
      type: 'acanvas',
      data: { port_type: targetHandle },
    });
  }

  /**
   * `docId` 는 문서 id 를 명시할 때만 넘긴다. 기본값(이름 슬러그)은 한글 이름이
   * 통째로 `_` 하나로 접혀 서로 다른 템플릿끼리 같은 id 가 되어 버린다
   * (예: "시장 조사 리포트" 와 "로컬 전용 요약봇" 이 둘 다 `cvs_tpl__`).
   */
  doc(name: string, description: string, requiresKeys: string[], docId?: string): CanvasDoc {
    const now = new Date().toISOString();
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      app_version: APP_VERSION,
      id: `cvs_tpl_${docId ?? name.replace(/\W+/g, '_').toLowerCase()}`,
      name,
      description,
      tags: [],
      author: 'AgentCanvas',
      created_at: now,
      updated_at: now,
      viewport: { x: 60, y: 40, zoom: 0.75 },
      nodes: this.nodes,
      edges: this.edges,
      meta: { requires_keys: requiresKeys },
    };
  }
}

/* ---------- 1. Hello Crew (⭐ 3분 첫 성공) ---------- */

function helloCrew(): CanvasDoc {
  const b = new Builder();
  const input = b.node('input', 40, 40, {
    var_name: 'topic', label: '무엇에 대해 알아볼까요?',
    default_value: 'AI 에이전트 시장', required: true,
  });
  const llm = b.node('llm', 40, 220, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7,
  });
  const agent = b.node('agent', 380, 120, {
    name: 'Assistant', role: '만능 리서치 어시스턴트',
    goal: '{topic} 에 대해 핵심만 간결하게 정리한다.',
    backstory: '복잡한 주제를 다섯 문장으로 압축하는 데 능숙한 애널리스트입니다.',
  });
  const task = b.node('task', 720, 120, {
    name: 'Summarize', description: '{topic} 에 대해 핵심 5가지를 정리하라.',
    expected_output: '불릿 5개. 각 항목은 한 문장.',
  });
  const crew = b.node('crew', 1060, 120, { name: 'Hello Crew', process: 'sequential' });
  const out = b.node('output', 1400, 120, { title: '요약 결과' });

  b.link(llm, 'llm', agent, 'llm');
  b.link(agent, 'agent', task, 'agent');
  b.link(agent, 'agent', crew, 'agent');
  b.link(task, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');
  void input;
  return b.doc('Hello Crew', '에이전트 1 + 태스크 1. 3분 안에 첫 성공을 경험합니다.', ['OPENAI_API_KEY']);
}

/* ---------- 2. Blog & SEO Crew (아티팩트 기본 템플릿 이식) ---------- */

function blogSeoCrew(): CanvasDoc {
  const b = new Builder();
  const topic = b.node('input', 40, 40, {
    var_name: 'topic', label: '블로그 주제 / 니치',
    default_value: 'AI 에이전트 자동화', required: true,
  });
  const llm = b.node('llm', 40, 220, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.6,
  });
  const search = b.node('tool', 40, 420, { name: 'Web Search', tool_id: 'serper_search' });
  const scraper = b.node('tool', 40, 580, { name: 'Site Scraper', tool_id: 'scrape_website' });

  const researcher = b.node('agent', 400, 40, {
    name: 'Trend Researcher', role: 'Senior Content Trend Researcher',
    goal: '{topic} 니치에서 지금 뜨는 주제 3개를 발굴한다.',
    backstory: '10년간 수십 개 블로그의 검색 트렌드를 추적해 온 전 SEO 애널리스트입니다.',
  });
  const writer = b.node('agent', 400, 320, {
    name: 'Content Writer', role: 'Senior Blog Content Writer',
    goal: '리서치 결과를 읽히는 글로 바꾼다.',
    backstory: '명확하고 전환율 높은 글로 유명한 베테랑 콘텐츠 마케터입니다.',
  });
  const seo = b.node('agent', 400, 600, {
    name: 'SEO Specialist', role: 'Technical SEO Specialist',
    goal: '검색 의도와 키워드에 맞게 초안을 최적화하되 품질을 해치지 않는다.',
    backstory: 'SERP 데이터와 온페이지 최적화에 집착합니다.',
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Research Trends',
    description: '{topic} 니치에서 지금 트렌딩 중인 주제를 웹 검색으로 조사하라.',
    expected_output: '주제 3개의 순위 목록. 각 항목에 한 줄 근거와 출처 URL 포함.',
  });
  const t2 = b.node('task', 780, 320, {
    name: 'Write Blog Post',
    description: '가장 유망한 트렌드 주제로 800~1200단어 블로그 글을 작성하라.',
    expected_output: '제목과 소제목이 있는 완성된 마크다운 블로그 글.',
  });
  const t3 = b.node('task', 780, 600, {
    name: 'SEO Optimize',
    description: '초안의 제목·헤더·키워드 밀도를 SEO 관점에서 다듬어라.',
    expected_output: '최종 SEO 최적화된 마크다운 블로그 글.',
  });

  const crew = b.node('crew', 1160, 320, { name: 'Blog & SEO Crew', process: 'sequential' });
  const out = b.node('output', 1520, 320, { title: '완성된 블로그 글' });

  for (const a of [researcher, writer, seo]) {
    b.link(llm, 'llm', a, 'llm');
    b.link(a, 'agent', crew, 'agent');
  }
  b.link(search, 'tool', researcher, 'tool');
  b.link(scraper, 'tool', seo, 'tool');
  b.link(researcher, 'agent', t1, 'agent');
  b.link(writer, 'agent', t2, 'agent');
  b.link(seo, 'agent', t3, 'agent');
  b.link(t1, 'task', t2, 'context');
  b.link(t2, 'task', t3, 'context');
  for (const t of [t1, t2, t3]) b.link(t, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');
  void topic;

  return b.doc('Blog & SEO Crew', '트렌드 리서치 → 작성 → SEO 교정까지 순차 실행합니다.',
    ['OPENAI_API_KEY', 'SERPER_API_KEY']);
}

/* ---------- 3. 시장 조사 리포트 (⭐⭐ 병렬 리서치 3인 → 애널리스트 종합) ---------- */

/**
 * ⚠️ 여기서 말하는 "병렬"은 **그래프의 의존 관계**를 뜻한다 — CrewAI 의 동시 실행이
 * 아니다. `Process` enum 의 실측 멤버는 `sequential` / `hierarchical` 둘뿐이고
 * "parallel" 이라는 값은 존재하지 않는다 (docs/CREWAI_RECON.md §5,
 * `backend/app/core/crewai_compat.py::resolve_process`). 그래서 Crew 는
 * `sequential` 로 두되, 리서처 3인의 태스크가 **서로 context 로 물리지 않게** 두어
 * 논리적으로 독립(= 병렬)이게 하고, 애널리스트 태스크만 그 3개를 전부 context 로 받는다.
 */
function marketResearch(): CanvasDoc {
  const b = new Builder();
  const topic = b.node('input', 40, 40, {
    var_name: 'topic', label: '조사할 시장 / 제품',
    default_value: 'AI 코딩 어시스턴트 시장', required: true,
  });
  const llm = b.node('llm', 40, 240, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4,
  });
  // 리서처 3인이 같은 검색 툴을 공유한다 (tool 포트는 unbounded).
  const search = b.node('tool', 40, 440, { name: 'Web Search', tool_id: 'serper_search' });

  const angles = [
    {
      name: 'Demand Researcher', role: '수요·고객 리서처',
      goal: '{topic} 의 수요층과 구매 동기를 근거와 함께 파악한다.',
      backstory: '설문과 커뮤니티 로그에서 진짜 페인포인트를 캐내는 데 능한 리서처입니다.',
      taskName: 'Research Demand',
      description: '{topic} 의 주요 고객 세그먼트, 사용 동기, 미해결 페인포인트를 웹 검색으로 조사하라.',
      expected: '세그먼트 3개. 각각 동기 / 페인포인트 / 출처 URL 포함.',
    },
    {
      name: 'Competitor Researcher', role: '경쟁사 리서처',
      goal: '{topic} 의 주요 플레이어와 포지셔닝 차이를 정리한다.',
      backstory: '경쟁사 제품 페이지와 릴리스 노트를 몇 년치씩 훑어 온 애널리스트입니다.',
      taskName: 'Research Competitors',
      description: '{topic} 의 주요 경쟁사 5곳을 찾아 가격·핵심기능·포지셔닝을 비교하라.',
      expected: '경쟁사 5곳 비교표(마크다운). 열: 이름 / 가격 / 강점 / 약점 / 출처.',
    },
    {
      name: 'Trend Researcher', role: '트렌드·규제 리서처',
      goal: '{topic} 을(를) 둘러싼 최근 흐름과 리스크를 짚는다.',
      backstory: '기술 트렌드와 규제 변화가 시장에 언제 반영되는지를 추적해 왔습니다.',
      taskName: 'Research Trends',
      description: '{topic} 의 최근 12개월 트렌드, 기술 변화, 규제·리스크 요인을 조사하라.',
      expected: '트렌드 5개. 각각 한 줄 근거와 출처 URL, 리스크 여부 표기.',
    },
  ];

  const researchTasks: string[] = [];
  angles.forEach((a, i) => {
    const y = 40 + i * 300;
    const agent = b.node('agent', 400, y, {
      name: a.name, role: a.role, goal: a.goal, backstory: a.backstory,
    });
    const task = b.node('task', 780, y, {
      name: a.taskName, description: a.description, expected_output: a.expected,
    });
    b.link(llm, 'llm', agent, 'llm');
    b.link(search, 'tool', agent, 'tool');
    b.link(agent, 'agent', task, 'agent');
    // crew 는 아직 만들기 전이다 — agent/task → crew 연결은 crew 생성 후 한 번에 건다.
    researchTasks.push(task);
  });

  const analyst = b.node('agent', 400, 940, {
    name: 'Market Analyst', role: '시장 애널리스트',
    goal: '세 갈래 리서치를 하나의 의사결정용 리포트로 종합한다.',
    backstory: '흩어진 리서치를 임원이 5분 만에 읽는 한 장으로 압축해 온 애널리스트입니다.',
  });
  const analysis = b.node('task', 780, 940, {
    name: 'Synthesize Report',
    description:
      '수요 / 경쟁사 / 트렌드 리서치 결과를 종합해 {topic} 시장 조사 리포트를 작성하라. '
      + '상충하는 근거가 있으면 명시하고, 근거 없는 단정은 피하라.',
    expected_output: '마크다운 리포트: 요약(5줄) → 시장 규모·수요 → 경쟁 구도 → 트렌드/리스크 → 진입 제언 3가지.',
  });

  const crew = b.node('crew', 1180, 400, { name: 'Market Research Crew', process: 'sequential' });
  const out = b.node('output', 1540, 400, { title: '시장 조사 리포트' });

  b.link(llm, 'llm', analyst, 'llm');
  b.link(analyst, 'agent', analysis, 'agent');
  // 리서처 3개 태스크는 서로 context 가 없다 (= 논리적 병렬). 종합 태스크만 셋 다 문다.
  for (const t of researchTasks) b.link(t, 'task', analysis, 'context');
  for (const n of b.nodes) {
    if (n.type === 'agent') b.link(n.id, 'agent', crew, 'agent');
    if (n.type === 'task') b.link(n.id, 'task', crew, 'task');
  }
  b.link(crew, 'result', out, 'result');
  void topic;

  return b.doc(
    '시장 조사 리포트',
    '독립적인 리서치 3갈래를 애널리스트가 하나의 리포트로 종합합니다.',
    ['OPENAI_API_KEY', 'SERPER_API_KEY'],
    'market_research',
  );
}

/* ---------- 4. YouTube 대본 파이프라인 (⭐⭐ 기획 → 대본 → 훅 최적화) ---------- */

function youtubeScript(): CanvasDoc {
  const b = new Builder();
  const topic = b.node('input', 40, 40, {
    var_name: 'topic', label: '영상 주제',
    default_value: 'AI 에이전트로 업무 자동화하기', required: true,
  });
  const llm = b.node('llm', 40, 240, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.8,
  });
  // `youtube_search` 는 OPENAI_API_KEY 만 요구한다(임베딩) — 추가 키가 필요 없어
  // "필요 키: OpenAI" 라는 §15.1 의 조건을 유지한 채 레퍼런스 조사를 붙일 수 있다.
  const yt = b.node('tool', 40, 440, { name: 'YouTube Reference', tool_id: 'youtube_search' });

  const planner = b.node('agent', 400, 40, {
    name: 'Content Planner', role: '유튜브 콘텐츠 기획자',
    goal: '{topic} 으로 끝까지 보게 만드는 영상 구성을 설계한다.',
    backstory: '조회수보다 시청 지속률을 먼저 보는 채널 기획자입니다.',
  });
  const writer = b.node('agent', 400, 340, {
    name: 'Scriptwriter', role: '영상 대본 작가',
    goal: '기획 구성을 말로 읽히는 대본으로 바꾼다.',
    backstory: '카메라 앞에서 실제로 읽히는 문장만 쓰는 작가입니다. 문어체를 싫어합니다.',
  });
  const hooker = b.node('agent', 400, 640, {
    name: 'Hook Specialist', role: '훅 · 리텐션 최적화 전문가',
    goal: '첫 15초와 이탈 구간을 다시 설계해 시청 지속률을 끌어올린다.',
    backstory: 'A/B 테스트로 도입부만 수백 번 갈아 본 리텐션 전문가입니다.',
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Plan Video',
    description:
      '{topic} 으로 8~12분짜리 영상 구성을 설계하라. 레퍼런스 영상이 있으면 조사해 참고하되 베끼지 마라.',
    expected_output: '타깃 시청자 / 한 줄 약속 / 섹션 5~7개(각 섹션 목적과 예상 길이) / 후보 제목 3개.',
  });
  const t2 = b.node('task', 780, 340, {
    name: 'Write Script',
    description: '확정된 구성을 그대로 따라 실제로 읽을 수 있는 구어체 대본을 작성하라.',
    expected_output: '섹션별 대본. 각 섹션에 [화면 지시] 한 줄 포함. 총 1200~1800단어.',
  });
  const t3 = b.node('task', 780, 640, {
    name: 'Optimize Hook',
    description: '첫 15초 훅과 이탈이 예상되는 구간을 다시 써라. 나머지 본문은 유지한다.',
    expected_output: '훅 후보 3개 + 각각의 근거, 그리고 훅이 교체된 최종 대본 전문.',
  });

  const crew = b.node('crew', 1180, 340, { name: 'YouTube Script Crew', process: 'sequential' });
  const out = b.node('output', 1540, 340, { title: '최종 대본' });

  for (const a of [planner, writer, hooker]) {
    b.link(llm, 'llm', a, 'llm');
    b.link(a, 'agent', crew, 'agent');
  }
  b.link(yt, 'tool', planner, 'tool');
  b.link(planner, 'agent', t1, 'agent');
  b.link(writer, 'agent', t2, 'agent');
  b.link(hooker, 'agent', t3, 'agent');
  b.link(t1, 'task', t2, 'context');
  b.link(t2, 'task', t3, 'context');
  for (const t of [t1, t2, t3]) b.link(t, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');
  void topic;

  return b.doc(
    'YouTube 대본 파이프라인',
    '기획 → 대본 작성 → 훅 최적화까지 한 번에 굴립니다.',
    ['OPENAI_API_KEY'],
    'youtube',
  );
}

/* ---------- 5. 로컬 전용 요약봇 (Ollama · 완전 무료) ---------- */

function localSummarizer(ollamaModels?: string[]): CanvasDoc {
  const b = new Builder();
  const text = b.node('input', 40, 40, {
    var_name: 'source_text', label: '요약할 원문', input_type: 'textarea',
    default_value: '', required: true,
  });
  // 설치된 모델이 있으면 그중 첫 번째(= Ollama 가 최근 수정순으로 돌려주는 모델)를 쓴다.
  // 감지 결과가 없을 때만 관례적인 이름으로 떨어지고, 그 경우 검증이 AC-E701/E702 로
  // "ollama serve" / "ollama pull" 을 안내한다.
  const model = ollamaModels?.[0] ?? 'llama3';
  const llm = b.node('llm', 40, 260, {
    name: 'Local Llama', provider: 'ollama', model, temperature: 0.3,
  });
  const agent = b.node('agent', 400, 120, {
    name: 'Summarizer', role: '문서 요약 전문가',
    goal: '원문의 핵심을 왜곡 없이 압축한다.',
    backstory: '긴 보고서를 임원용 한 페이지로 줄여 온 애널리스트입니다.',
  });
  const task = b.node('task', 760, 120, {
    name: 'Summarize',
    description: '다음 원문을 요약하라:\n\n{source_text}',
    expected_output: '핵심 요약 5줄 + 실행 제안 3줄.',
  });
  const crew = b.node('crew', 1120, 120, { name: 'Local Summarizer', process: 'sequential' });
  const out = b.node('output', 1480, 120, { title: '요약' });

  b.link(llm, 'llm', agent, 'llm');
  b.link(agent, 'agent', task, 'agent');
  b.link(agent, 'agent', crew, 'agent');
  b.link(task, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');
  void text;
  return b.doc('로컬 전용 요약봇', 'Ollama 로컬 모델만 사용합니다. API 키도 비용도 필요 없습니다.', []);
}

export const BUILTIN_TEMPLATES: TemplateMeta[] = [
  { id: 'hello', name: 'Hello Crew', description: '에이전트 1 + 태스크 1. 첫 성공까지 3분.', difficulty: 1, requiresKeys: ['OPENAI_API_KEY'], estimatedCostUsd: 0.002, build: helloCrew },
  { id: 'blog', name: 'SEO 블로그 작성팀', description: '리서치 → 작성 → 교정 (순차)', difficulty: 2, requiresKeys: ['OPENAI_API_KEY', 'SERPER_API_KEY'], estimatedCostUsd: 0.02, build: blogSeoCrew },
  { id: 'market_research', name: '시장 조사 리포트', description: '독립 리서치 3갈래 → 애널리스트 종합', difficulty: 2, requiresKeys: ['OPENAI_API_KEY', 'SERPER_API_KEY'], estimatedCostUsd: 0.03, build: marketResearch },
  { id: 'youtube', name: 'YouTube 대본 파이프라인', description: '기획 → 대본 → 훅 최적화', difficulty: 2, requiresKeys: ['OPENAI_API_KEY'], estimatedCostUsd: 0.015, build: youtubeScript },
  { id: 'local', name: '로컬 전용 요약봇', description: '완전 무료 오프라인 데모. 진입장벽 0.', difficulty: 1, requiresKeys: [], estimatedCostUsd: 0, build: localSummarizer },
];

export function getTemplate(id: string): TemplateMeta | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
