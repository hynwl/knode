/**
 * 내장 템플릿 (Spec §15.1)
 * 프론트엔드에 번들되어 **백엔드 없이도** 로드된다. (`MUST`)
 * 백엔드가 살아 있으면 `GET /api/v1/templates` 결과로 대체·확장된다.
 */

import { t } from '@/i18n';
import { defaultDataFor, getNodeDef, type NodeType } from '@/nodes/registry';
import { APP_VERSION, CURRENT_SCHEMA_VERSION, DEFAULT_NODE_UI, type AcEdge, type AcNode, type CanvasDoc } from '@/types/canvas';

/**
 * 이 파일의 사람 말은 전부 `templates.builtin.*` i18n 키다 (Spec §17.3).
 *
 * 두 층이 있고 다루는 법이 다르다.
 *  - **갤러리 카드**(`TemplateMeta.name`/`description`): 키를 **그대로 담아 두고**
 *    화면이 `tk()` 로 푼다. 사용자가 저장한 커스텀 템플릿은 진짜 이름이 들어오는데,
 *    `tk()` 는 "키처럼 생긴 것"만 번역하므로 둘이 한 목록에 섞여도 안전하다.
 *  - **캔버스 내용**(역할·목표·태스크 설명 등): `build()` 안에서 `t()` 로 **즉시**
 *    푼다. 문서에 박히는 값이라 키를 남기면 노드에 `templates.builtin...` 이 그대로
 *    보인다. 템플릿은 고를 때마다 새로 만들어지므로 그 시점 로케일이 반영된다.
 *
 * `{topic}` 같은 캔버스 변수는 `t()` 를 통과해도 그대로 남는다 — `interpolate()`
 * 는 `vars` 를 안 주면 손대지 않는다.
 */

export interface TemplateMeta {
  id: string;
  /** i18n 키(내장) 또는 사용자가 지은 이름(커스텀). 화면에서 `tk()` 로 푼다. */
  name: string;
  /** 〃 */
  description: string;
  difficulty: 1 | 2 | 3;
  requiresKeys: string[];
  /**
   * gpt-4o-mini 기준 1회 실행 예상 실비 (USD).
   *
   * ⚠️ 손으로 어림하지 말 것. 예전 값(hello 0.002 / youtube 0.015 …)은 실측 대비
   * **5~15배 과대**였다. `hello` · `youtube` 는 실제로 태워 본 값이고
   * (각 $0.00013 / $0.00273), 키가 없어 못 태운 `blog` · `market_research` 는
   * 백엔드 Dry Run 추정기(`runtime/cost.py`, 실측 대비 2~3배 오차)에
   * 구조가 같은 `youtube` 에서 관측된 보정 계수를 곱한 값이다.
   */
  estimatedCostUsd: number;
  /**
   * `ollamaModels` 는 §13.1 자동 감지로 **지금 이 머신에 설치된** 모델 이름들이다.
   * 로컬 템플릿이 모델명을 하드코딩하면 그 모델이 없는 머신에서 AC-E702(미설치)로
   * 실행 버튼이 잠겨 버리므로, 감지된 것 중에서 고른다.
   */
  build: (ollamaModels?: string[]) => CanvasDoc;
}

/* ---------- 빌더 헬퍼 ---------- */

/**
 * 그래프 조립기. 내장 템플릿과 **hub 시드 스크립트**(`scripts/build-hub-seeds.mjs`,
 * M5-T8)가 같은 것을 쓴다 — 시드를 손으로 쓴 JSON 으로 두면 포트 타입·엣지 id 같은
 * 규칙이 조용히 갈라진다(`portTypeOf` 주석이 말하는 그 버그가 정확히 그렇게 났다).
 */
export class Builder {
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
      // 핸들 id 가 아니라 **실제 포트 타입**이다. 예전엔 `targetHandle` 을 그대로 썼는데,
      // 모든 포트가 우연히 id == type 이라 드러나지 않았을 뿐이다. Task 의 `depends on`
      // 은 id 가 `context`, 타입은 `task` 라 이제 둘이 갈린다 — 스토어(`connect`)가
      // 쓰는 값과 어긋나면 같은 연결인데 엣지 색이 달라진다.
      data: { port_type: this.portTypeOf(target, targetHandle) },
    });
  }

  private portTypeOf(nodeId: string, handleId: string): string {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return handleId;
    const def = getNodeDef(node.type as NodeType);
    return def?.inputs.find((p) => p.id === handleId)?.type ?? handleId;
  }

  /**
   * `docId` 는 **필수다.** 예전엔 이름에서 슬러그를 뽑았는데, (a) 한글 이름이 통째로
   * `_` 하나로 접혀 서로 다른 템플릿이 같은 id 가 됐고(`시장 조사 리포트` 와
   * `로컬 전용 요약봇` 이 둘 다 `cvs_tpl__`), (b) 이제 이름이 로케일마다 달라져
   * **같은 템플릿이 언어에 따라 다른 id 로 저장**될 판이다. id 는 언어와 무관해야 한다.
   */
  doc(name: string, description: string, requiresKeys: string[], docId: string): CanvasDoc {
    const now = new Date().toISOString();
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      app_version: APP_VERSION,
      id: `cvs_tpl_${docId}`,
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
    var_name: 'topic', label: t('templates.builtin.hello.inputLabel'),
    default_value: t('templates.builtin.hello.inputDefault'), required: true,
  });
  const llm = b.node('llm', 40, 220, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7,
  });
  const agent = b.node('agent', 380, 120, {
    name: 'Assistant', role: t('templates.builtin.hello.agentRole'),
    goal: t('templates.builtin.hello.agentGoal'),
    backstory: t('templates.builtin.hello.agentBackstory'),
  });
  const task = b.node('task', 720, 120, {
    name: 'Summarize', description: t('templates.builtin.hello.taskDesc'),
    expected_output: t('templates.builtin.hello.taskExpected'),
  });
  const crew = b.node('crew', 1060, 120, { name: 'Hello Crew', process: 'sequential' });
  const out = b.node('output', 1400, 120, { title: t('templates.builtin.hello.outputTitle') });

  b.link(llm, 'llm', agent, 'llm');
  b.link(agent, 'agent', task, 'agent');
  b.link(agent, 'agent', crew, 'agent');
  b.link(task, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');
  void input;
  return b.doc(
    t('templates.builtin.hello.docName'),
    t('templates.builtin.hello.docDesc'),
    ['OPENAI_API_KEY'],
    'hello_crew',
  );
}

/* ---------- 2. Blog & SEO Crew (아티팩트 기본 템플릿 이식) ---------- */

function blogSeoCrew(): CanvasDoc {
  const b = new Builder();
  const topic = b.node('input', 40, 40, {
    var_name: 'topic', label: t('templates.builtin.blog.inputLabel'),
    default_value: t('templates.builtin.blog.inputDefault'), required: true,
  });
  const llm = b.node('llm', 40, 220, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.6,
  });
  const search = b.node('tool', 40, 420, { name: 'Web Search', tool_id: 'serper_search' });
  const scraper = b.node('tool', 40, 580, { name: 'Site Scraper', tool_id: 'scrape_website' });

  const researcher = b.node('agent', 400, 40, {
    name: 'Trend Researcher', role: t('templates.builtin.blog.researcherRole'),
    goal: t('templates.builtin.blog.researcherGoal'),
    backstory: t('templates.builtin.blog.researcherBackstory'),
  });
  const writer = b.node('agent', 400, 320, {
    name: 'Content Writer', role: t('templates.builtin.blog.writerRole'),
    goal: t('templates.builtin.blog.writerGoal'),
    backstory: t('templates.builtin.blog.writerBackstory'),
  });
  const seo = b.node('agent', 400, 600, {
    name: 'SEO Specialist', role: t('templates.builtin.blog.seoRole'),
    goal: t('templates.builtin.blog.seoGoal'),
    backstory: t('templates.builtin.blog.seoBackstory'),
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Research Trends',
    description: t('templates.builtin.blog.t1Desc'),
    expected_output: t('templates.builtin.blog.t1Expected'),
  });
  const t2 = b.node('task', 780, 320, {
    name: 'Write Blog Post',
    description: t('templates.builtin.blog.t2Desc'),
    expected_output: t('templates.builtin.blog.t2Expected'),
  });
  const t3 = b.node('task', 780, 600, {
    name: 'SEO Optimize',
    description: t('templates.builtin.blog.t3Desc'),
    expected_output: t('templates.builtin.blog.t3Expected'),
  });

  const crew = b.node('crew', 1160, 320, { name: 'Blog & SEO Crew', process: 'sequential' });
  const out = b.node('output', 1520, 320, { title: t('templates.builtin.blog.outputTitle') });

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

  return b.doc(
    t('templates.builtin.blog.docName'),
    t('templates.builtin.blog.docDesc'),
    ['OPENAI_API_KEY', 'SERPER_API_KEY'],
    'blog_seo_crew',
  );
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
    var_name: 'topic', label: t('templates.builtin.market_research.inputLabel'),
    default_value: t('templates.builtin.market_research.inputDefault'), required: true,
  });
  const llm = b.node('llm', 40, 240, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4,
  });
  // 리서처 3인이 같은 검색 툴을 공유한다 (tool 포트는 unbounded).
  const search = b.node('tool', 40, 440, { name: 'Web Search', tool_id: 'serper_search' });

  const angles = [
    {
      name: 'Demand Researcher', role: t('templates.builtin.market_research.demandRole'),
      goal: t('templates.builtin.market_research.demandGoal'),
      backstory: t('templates.builtin.market_research.demandBackstory'),
      taskName: 'Research Demand',
      description: t('templates.builtin.market_research.demandTaskDesc'),
      expected: t('templates.builtin.market_research.demandTaskExpected'),
    },
    {
      name: 'Competitor Researcher', role: t('templates.builtin.market_research.competitorRole'),
      goal: t('templates.builtin.market_research.competitorGoal'),
      backstory: t('templates.builtin.market_research.competitorBackstory'),
      taskName: 'Research Competitors',
      description: t('templates.builtin.market_research.competitorTaskDesc'),
      expected: t('templates.builtin.market_research.competitorTaskExpected'),
    },
    {
      name: 'Trend Researcher', role: t('templates.builtin.market_research.trendRole'),
      goal: t('templates.builtin.market_research.trendGoal'),
      backstory: t('templates.builtin.market_research.trendBackstory'),
      taskName: 'Research Trends',
      description: t('templates.builtin.market_research.trendTaskDesc'),
      expected: t('templates.builtin.market_research.trendTaskExpected'),
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
    name: 'Market Analyst', role: t('templates.builtin.market_research.analystRole'),
    goal: t('templates.builtin.market_research.analystGoal'),
    backstory: t('templates.builtin.market_research.analystBackstory'),
  });
  const analysis = b.node('task', 780, 940, {
    name: 'Synthesize Report',
    description: t('templates.builtin.market_research.synthDesc'),
    expected_output: t('templates.builtin.market_research.synthExpected'),
  });

  const crew = b.node('crew', 1180, 400, { name: 'Market Research Crew', process: 'sequential' });
  const out = b.node('output', 1540, 400, { title: t('templates.builtin.market_research.outputTitle') });

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
    t('templates.builtin.market_research.docName'),
    t('templates.builtin.market_research.docDesc'),
    ['OPENAI_API_KEY', 'SERPER_API_KEY'],
    'market_research',
  );
}

/* ---------- 4. YouTube 대본 파이프라인 (⭐⭐ 기획 → 대본 → 훅 최적화) ---------- */

function youtubeScript(): CanvasDoc {
  const b = new Builder();
  const topic = b.node('input', 40, 40, {
    var_name: 'topic', label: t('templates.builtin.youtube.inputLabel'),
    default_value: t('templates.builtin.youtube.inputDefault'), required: true,
  });
  const llm = b.node('llm', 40, 240, {
    name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.8,
  });
  // `youtube_search` 는 OPENAI_API_KEY 만 요구한다(임베딩) — 추가 키가 필요 없어
  // "필요 키: OpenAI" 라는 §15.1 의 조건을 유지한 채 레퍼런스 조사를 붙일 수 있다.
  const yt = b.node('tool', 40, 440, { name: 'YouTube Reference', tool_id: 'youtube_search' });

  const planner = b.node('agent', 400, 40, {
    name: 'Content Planner', role: t('templates.builtin.youtube.plannerRole'),
    goal: t('templates.builtin.youtube.plannerGoal'),
    backstory: t('templates.builtin.youtube.plannerBackstory'),
  });
  const writer = b.node('agent', 400, 340, {
    name: 'Scriptwriter', role: t('templates.builtin.youtube.writerRole'),
    goal: t('templates.builtin.youtube.writerGoal'),
    backstory: t('templates.builtin.youtube.writerBackstory'),
  });
  const hooker = b.node('agent', 400, 640, {
    name: 'Hook Specialist', role: t('templates.builtin.youtube.hookRole'),
    goal: t('templates.builtin.youtube.hookGoal'),
    backstory: t('templates.builtin.youtube.hookBackstory'),
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Plan Video',
    description: t('templates.builtin.youtube.t1Desc'),
    expected_output: t('templates.builtin.youtube.t1Expected'),
  });
  const t2 = b.node('task', 780, 340, {
    name: 'Write Script',
    description: t('templates.builtin.youtube.t2Desc'),
    expected_output: t('templates.builtin.youtube.t2Expected'),
  });
  const t3 = b.node('task', 780, 640, {
    name: 'Optimize Hook',
    description: t('templates.builtin.youtube.t3Desc'),
    expected_output: t('templates.builtin.youtube.t3Expected'),
  });

  const crew = b.node('crew', 1180, 340, { name: 'YouTube Script Crew', process: 'sequential' });
  const out = b.node('output', 1540, 340, { title: t('templates.builtin.youtube.outputTitle') });

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
    t('templates.builtin.youtube.docName'),
    t('templates.builtin.youtube.docDesc'),
    ['OPENAI_API_KEY'],
    'youtube',
  );
}

/* ---------- 5. 로컬 전용 요약봇 (Ollama · 완전 무료) ---------- */

function localSummarizer(ollamaModels?: string[]): CanvasDoc {
  const b = new Builder();
  const text = b.node('input', 40, 40, {
    var_name: 'source_text', label: t('templates.builtin.local.inputLabel'), input_type: 'textarea',
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
    name: 'Summarizer', role: t('templates.builtin.local.agentRole'),
    goal: t('templates.builtin.local.agentGoal'),
    backstory: t('templates.builtin.local.agentBackstory'),
  });
  const task = b.node('task', 760, 120, {
    name: 'Summarize',
    description: t('templates.builtin.local.taskDesc'),
    expected_output: t('templates.builtin.local.taskExpected'),
  });
  const crew = b.node('crew', 1120, 120, { name: 'Local Summarizer', process: 'sequential' });
  const out = b.node('output', 1480, 120, { title: t('templates.builtin.local.outputTitle') });

  b.link(llm, 'llm', agent, 'llm');
  b.link(agent, 'agent', task, 'agent');
  b.link(agent, 'agent', crew, 'agent');
  b.link(task, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');
  void text;
  return b.doc(
    t('templates.builtin.local.docName'),
    t('templates.builtin.local.docDesc'),
    [],
    // 예전엔 이름 슬러그를 썼는데 한글 이름이 통째로 접혀 `cvs_tpl__` 이 됐다
    // (시장 조사 리포트와 충돌). 이제 명시한다.
    'local',
  );
}

/**
 * ⚠️ `name`/`description` 은 **키를 그대로 담는다** — 여기서 `t()` 로 풀면 모듈이
 * 로드될 때의 로케일로 굳어, 언어를 바꿔도 갤러리만 옛 언어로 남는다
 * (`validation/issues.ts` 의 `params` 주석과 같은 함정). 화면이 `tk()` 로 푼다.
 */
export const BUILTIN_TEMPLATES: TemplateMeta[] = [
  { id: 'hello', name: 'templates.builtin.hello.name', description: 'templates.builtin.hello.desc', difficulty: 1, requiresKeys: ['OPENAI_API_KEY'], estimatedCostUsd: 0.0002, build: helloCrew },
  { id: 'blog', name: 'templates.builtin.blog.name', description: 'templates.builtin.blog.desc', difficulty: 2, requiresKeys: ['OPENAI_API_KEY', 'SERPER_API_KEY'], estimatedCostUsd: 0.003, build: blogSeoCrew },
  { id: 'market_research', name: 'templates.builtin.market_research.name', description: 'templates.builtin.market_research.desc', difficulty: 2, requiresKeys: ['OPENAI_API_KEY', 'SERPER_API_KEY'], estimatedCostUsd: 0.004, build: marketResearch },
  { id: 'youtube', name: 'templates.builtin.youtube.name', description: 'templates.builtin.youtube.desc', difficulty: 2, requiresKeys: ['OPENAI_API_KEY'], estimatedCostUsd: 0.003, build: youtubeScript },
  { id: 'local', name: 'templates.builtin.local.name', description: 'templates.builtin.local.desc', difficulty: 1, requiresKeys: [], estimatedCostUsd: 0, build: localSummarizer },
];

export function getTemplate(id: string): TemplateMeta | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
