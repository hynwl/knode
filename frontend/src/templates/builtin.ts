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
  build: () => CanvasDoc;
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

  doc(name: string, description: string, requiresKeys: string[]): CanvasDoc {
    const now = new Date().toISOString();
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      app_version: APP_VERSION,
      id: `cvs_tpl_${name.replace(/\W+/g, '_').toLowerCase()}`,
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

/* ---------- 3. 로컬 전용 요약봇 (Ollama · 완전 무료) ---------- */

function localSummarizer(): CanvasDoc {
  const b = new Builder();
  const text = b.node('input', 40, 40, {
    var_name: 'source_text', label: '요약할 원문', input_type: 'textarea',
    default_value: '', required: true,
  });
  const llm = b.node('llm', 40, 260, {
    name: 'Local Llama', provider: 'ollama', model: 'llama3.1', temperature: 0.3,
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
  { id: 'local', name: '로컬 전용 요약봇', description: '완전 무료 오프라인 데모. 진입장벽 0.', difficulty: 1, requiresKeys: [], estimatedCostUsd: 0, build: localSummarizer },
];

export function getTemplate(id: string): TemplateMeta | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
