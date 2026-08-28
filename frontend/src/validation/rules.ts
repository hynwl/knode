/**
 * 프론트엔드 그래프 검증 (Spec §9.4)
 * 백엔드가 꺼져 있어도 항상 동작해야 한다. (`MUST` — AC-S5)
 * 백엔드 `compiler/validators.py` 와 **같은 규칙**을 구현한다.
 */

import { getNodeDef, type NodeType } from '@/nodes/registry';
import type { AcEdge, AcNode } from '@/types/canvas';
import { issue, type ValidationIssue } from './issues';

export interface Graph {
  nodes: AcNode[];
  edges: AcEdge[];
}

/* ────────────────────────── 그래프 조회 헬퍼 ────────────────────────── */

export function nodeById(g: Graph, id: string): AcNode | undefined {
  return g.nodes.find((n) => n.id === id);
}

/** 특정 입력 포트로 들어오는 소스 노드들 */
export function incoming(g: Graph, nodeId: string, handle: string): AcNode[] {
  return g.edges
    .filter((e) => e.target === nodeId && e.targetHandle === handle)
    .map((e) => nodeById(g, e.source))
    .filter((n): n is AcNode => Boolean(n));
}

/** 특정 출력 포트에서 나가는 타깃 노드들 */
export function outgoing(g: Graph, nodeId: string, handle: string): AcNode[] {
  return g.edges
    .filter((e) => e.source === nodeId && e.sourceHandle === handle)
    .map((e) => nodeById(g, e.target))
    .filter((n): n is AcNode => Boolean(n));
}

export function nodesOfType(g: Graph, type: NodeType): AcNode[] {
  return g.nodes.filter((n) => n.type === type && !n.ui.bypassed);
}

/** 실행 대상 그래프 — bypass/비컴파일 노드를 제거한 뷰 (Spec §8.1 Normalize) */
export function normalize(g: Graph): Graph {
  const keep = new Set(
    g.nodes.filter((n) => !n.ui.bypassed && getNodeDef(n.type).compilable).map((n) => n.id),
  );
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

/* ────────────────────────── 사이클 검출 (Spec §6.5) ────────────────────────── */

/**
 * `context` 타입 엣지만 대상으로 DFS. O(V+E).
 * 새 엣지를 **추가하기 전에** 호출해서 거부 판정에 쓴다.
 */
export function wouldCreateCycle(g: Graph, source: string, target: string): boolean {
  if (source === target) return true;
  const adj = new Map<string, string[]>();
  for (const e of contextEdges(g)) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  // target 에서 출발해 source 에 닿으면, source→target 을 추가하는 순간 사이클
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

function contextEdges(g: Graph): AcEdge[] {
  return g.edges.filter((e) => e.targetHandle === 'context');
}

export function findCycle(g: Graph): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of contextEdges(g)) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0=미방문 1=진행중 2=완료
  const path: string[] = [];
  let found: string[] | null = null;

  const dfs = (id: string): boolean => {
    state.set(id, 1);
    path.push(id);
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) {
        found = path.slice(path.indexOf(next));
        return true;
      }
      if (s === 0 && dfs(next)) return true;
    }
    path.pop();
    state.set(id, 2);
    return false;
  };

  for (const n of g.nodes) {
    if ((state.get(n.id) ?? 0) === 0 && dfs(n.id)) break;
  }
  return found;
}

/* ────────────────────────── 위상 정렬 (Spec §5.5) ────────────────────────── */

/**
 * Task 실행 순서 결정.
 * 1. context 엣지로 위상 정렬
 * 2. 동순위는 캔버스 X → Y 오름차순 (사용자의 시각적 배치 = 의도)
 */
export function orderTasks(g: Graph): AcNode[] {
  const tasks = nodesOfType(g, 'task');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const deps = new Map<string, string[]>(
    tasks.map((t) => [t.id, incoming(g, t.id, 'context').filter((d) => byId.has(d.id)).map((d) => d.id)]),
  );
  const remaining = new Set(tasks.map((t) => t.id));
  const placed: AcNode[] = [];

  while (remaining.size) {
    const ready = [...remaining].filter((id) => (deps.get(id) ?? []).every((d) => !remaining.has(d)));
    if (!ready.length) {
      // 사이클 폴백: 남은 것을 좌표순으로 밀어 넣는다 (검증기가 별도로 AC-E105 를 낸다)
      const rest = [...remaining].map((id) => byId.get(id)!).sort(byPosition);
      rest.forEach((t) => { placed.push(t); remaining.delete(t.id); });
      break;
    }
    ready
      .map((id) => byId.get(id)!)
      .sort(byPosition)
      .forEach((t) => { placed.push(t); remaining.delete(t.id); });
  }
  return placed;
}

function byPosition(a: AcNode, b: AcNode): number {
  return a.position.x - b.position.x || a.position.y - b.position.y;
}

/* ────────────────────────── 변수 보간 (Spec §8.4) ────────────────────────── */

/** `{var}` 는 잡고 `{{var}}` 는 무시한다. */
export const VAR_PATTERN = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;

export function extractVars(text: string): string[] {
  return [...String(text ?? '').matchAll(VAR_PATTERN)].map((m) => m[1]!);
}

export const VAR_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/* ────────────────────────── 검증 본체 ────────────────────────── */

export function validateGraph(raw: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const g = normalize(raw);

  /* --- E1xx 구조 --- */
  const crews = nodesOfType(g, 'crew');
  if (crews.length === 0) issues.push(issue('AC-E101'));
  if (crews.length > 1) crews.slice(1).forEach((c) => issues.push(issue('AC-E102', { nodeId: c.id })));

  const crew = crews[0];
  if (crew) {
    const crewTasks = incoming(g, crew.id, 'task');
    if (crewTasks.length === 0) issues.push(issue('AC-E107', { nodeId: crew.id }));
    if (crew.data.process === 'hierarchical' && incoming(g, crew.id, 'llm').length === 0) {
      issues.push(issue('AC-E103', { nodeId: crew.id, field: 'process' }));
    }
    // Crew 에 연결되지 않은 Agent/Task
    const linkedAgents = new Set(incoming(g, crew.id, 'agent').map((n) => n.id));
    const linkedTasks = new Set(crewTasks.map((n) => n.id));
    for (const n of g.nodes) {
      if (n.type === 'agent' && !linkedAgents.has(n.id)) issues.push(issue('AC-W104', { nodeId: n.id }));
      if (n.type === 'task' && !linkedTasks.has(n.id)) issues.push(issue('AC-W104', { nodeId: n.id }));
    }
  }

  const cycle = findCycle(g);
  if (cycle) cycle.forEach((id) => issues.push(issue('AC-E105', { nodeId: id })));

  /* --- E2xx 노드 설정 --- */
  for (const n of g.nodes) {
    const def = getNodeDef(n.type);

    for (const f of def.fields) {
      if (!f.required) continue;
      const v = n.data[f.key];
      if (v === null || v === undefined || String(v).trim() === '') {
        const code = n.type === 'task' && (f.key === 'description' || f.key === 'expected_output')
          ? 'AC-E204'
          : 'AC-E201';
        issues.push(issue(code, { nodeId: n.id, field: f.key, message: `${def.label}: "${f.label}" 이(가) 비어 있습니다` }));
      }
    }

    if (n.type === 'task' && incoming(g, n.id, 'agent').length === 0) {
      issues.push(issue('AC-E202', { nodeId: n.id }));
    }
    if (n.type === 'agent') {
      const hasTask = g.edges.some((e) => e.source === n.id && e.targetHandle === 'agent');
      if (!hasTask && !n.data.allow_delegation) issues.push(issue('AC-W203', { nodeId: n.id }));
    }
    if (n.type === 'input') {
      const varName = String(n.data.var_name ?? '');
      if (varName && !VAR_NAME_PATTERN.test(varName)) {
        issues.push(issue('AC-E303', { nodeId: n.id, field: 'var_name' }));
      }
    }
    if (def.disabledInV1) {
      issues.push(issue('AC-W104', {
        nodeId: n.id, severity: 'warn',
        message: `${def.label} 노드는 v1.0 에서 실행되지 않습니다`,
        hint: 'v1.1 에서 지원 예정입니다. 실행에서 제외됩니다.',
      }));
    }
  }

  /* --- E3xx 변수 --- */
  const declared = new Set(nodesOfType(g, 'input').map((n) => String(n.data.var_name ?? '')));
  for (const t of nodesOfType(g, 'task')) {
    const used = [
      ...extractVars(String(t.data.description ?? '')),
      ...extractVars(String(t.data.expected_output ?? '')),
    ];
    for (const v of new Set(used)) {
      if (!declared.has(v)) {
        issues.push(issue('AC-W301', {
          nodeId: t.id, field: 'description',
          message: `정의되지 않은 변수 {${v}} 를 참조합니다`,
        }));
      }
    }
  }
  for (const a of nodesOfType(g, 'agent')) {
    for (const v of new Set(extractVars(String(a.data.goal ?? '')))) {
      if (!declared.has(v)) {
        issues.push(issue('AC-W301', {
          nodeId: a.id, field: 'goal',
          message: `정의되지 않은 변수 {${v}} 를 참조합니다`,
        }));
      }
    }
  }

  return issues;
}

/** 실행에 필요한 API 키 이름 목록 (Spec §7.1 meta.requires_keys) */
export function requiredKeys(g: Graph): string[] {
  const keys = new Set<string>();
  const map: Record<string, string | null> = {
    openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY', ollama: null, openai_compatible: 'OPENAI_API_KEY',
  };
  for (const n of nodesOfType(g, 'llm')) {
    const k = map[String(n.data.provider ?? 'openai')];
    if (k) keys.add(k);
  }
  for (const n of nodesOfType(g, 'tool')) {
    if (String(n.data.tool_id ?? '') === 'serper_search') keys.add('SERPER_API_KEY');
  }
  return [...keys].sort();
}
