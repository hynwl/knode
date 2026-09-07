// @vitest-environment jsdom
/**
 * Zustand 스토어 테스트 (Spec §18 `MUST`)
 *
 * > 스토어 | Vitest | undo/redo, 이벤트 배치 반영, 카디널리티 자동 교체
 *
 * 세 가지 모두 "손맛" 에 직결되는 규칙이라 회귀하면 사용자가 바로 알아챈다:
 *  - undo/redo 는 zundo `temporal` 로 **nodes/edges 만** 되돌린다 (§3.5-11, 최소 50단계)
 *  - SSE 이벤트는 50ms 배치로 한 번의 `set()` 에 묶인다 (§16.2 성능 규칙)
 *  - `maxConnections: 1` 인 입력은 새 연결이 기존 엣지를 **교체**한다 (§6.3 ComfyUI 방식)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyDocMeta, MAX_LOG_LINES, redo, undo, useAppStore } from '.';
import type { NodeType } from '@/nodes/registry';

/* ────────────────────────── 테스트 하네스 ────────────────────────── */

const store = () => useAppStore.getState();
const temporal = () => useAppStore.temporal.getState();

function resetStore(): void {
  useAppStore.setState({
    nodes: [], edges: [], selectedNodeIds: [], selectedEdgeIds: [],
    issues: [], toasts: [], logs: [], nodeStates: {}, activeEdges: [],
    runId: null, runStatus: 'idle', dryRun: false, humanRequest: null,
    startedAt: null, usage: { prompt: 0, completion: 0, costUsd: 0 },
    viewport: { x: 0, y: 0, zoom: 1 }, focusRequest: null, savedAt: null,
    ollamaStatus: null,
    docMeta: emptyDocMeta('2026-01-01T00:00:00.000Z'),
  });
  temporal().clear();
}

beforeEach(() => {
  window.localStorage.clear();
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 노드를 스토어 액션이 아니라 직접 심는다 — autoWire/검증 부수효과 없이 그래프를 만들 때. */
function seed(nodes: Array<{ id: string; type: NodeType }>): void {
  useAppStore.setState({
    nodes: nodes.map((n, i) => ({
      id: n.id,
      type: n.type,
      position: { x: i * 100, y: 0 },
      width: null,
      height: null,
      data: {},
      ui: { collapsed: false, pinned: false, bypassed: false, colorOverride: null },
      parentNode: null,
      extent: null,
    })),
    edges: [],
  });
  temporal().clear();
}

/* ══════════════════════════ 1. undo / redo ══════════════════════════ */

describe('undo / redo (Spec §3.5-11)', () => {
  it('노드 추가를 되돌리고 다시 실행한다', () => {
    const id = store().addNode('crew', { x: 0, y: 0 });
    expect(store().nodes.map((n) => n.id)).toEqual([id]);

    temporal().undo();
    expect(store().nodes).toHaveLength(0);

    temporal().redo();
    expect(store().nodes.map((n) => n.id)).toEqual([id]);
  });

  it('연결 생성도 한 스텝으로 되돌아간다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }]);
    expect(store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' })).toBe(true);
    expect(store().edges).toHaveLength(1);

    temporal().undo();
    expect(store().edges).toHaveLength(0);

    temporal().redo();
    expect(store().edges).toHaveLength(1);
  });

  it('노드 삭제 → undo 로 노드와 딸린 엣지가 함께 돌아온다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }]);
    store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });

    store().removeNodes(['llm_1']);
    expect(store().nodes).toHaveLength(1);
    expect(store().edges).toHaveLength(0);

    temporal().undo();
    expect(store().nodes).toHaveLength(2);
    expect(store().edges).toHaveLength(1);
  });

  it('필드 편집(updateNodeData)도 히스토리에 남는다', () => {
    seed([{ id: 'agent_1', type: 'agent' }]);
    store().updateNodeData('agent_1', { role: 'writer' });
    expect(store().nodes[0]!.data.role).toBe('writer');

    temporal().undo();
    expect(store().nodes[0]!.data.role).toBeUndefined();
  });

  it('여러 스텝을 순서대로 되돌린다', () => {
    const a = store().addNode('llm', { x: 0, y: 0 });
    const b = store().addNode('crew', { x: 100, y: 0 });
    const c = store().addNode('tool', { x: 200, y: 0 });
    expect(store().nodes).toHaveLength(3);

    temporal().undo();
    expect(store().nodes.map((n) => n.id)).toEqual([a, b]);
    temporal().undo();
    expect(store().nodes.map((n) => n.id)).toEqual([a]);
    temporal().undo();
    expect(store().nodes).toHaveLength(0);

    temporal().redo();
    temporal().redo();
    temporal().redo();
    expect(store().nodes.map((n) => n.id)).toEqual([a, b, c]);
  });

  it('새 편집을 하면 redo 스택이 버려진다', () => {
    store().addNode('llm', { x: 0, y: 0 });
    temporal().undo();
    expect(temporal().futureStates.length).toBeGreaterThan(0);

    store().addNode('crew', { x: 0, y: 0 });
    expect(temporal().futureStates).toHaveLength(0);
  });

  it('그래프와 무관한 상태(패널·토스트·뷰포트)는 히스토리를 만들지 않는다', () => {
    store().addNode('crew', { x: 0, y: 0 });
    const before = temporal().pastStates.length;

    store().togglePanel('left');
    store().toast('info', 'hello');
    store().setViewport({ x: 5, y: 5, zoom: 2 });
    store().setRightTab('raw');
    store().selectNodes([store().nodes[0]!.id]);

    expect(temporal().pastStates.length).toBe(before);
  });

  it('실행 상태(nodeStates/logs)도 히스토리 대상이 아니다 — undo 로 실행 결과가 사라지면 안 된다', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    store().setNodeState('task_1', { status: 'succeeded', output: 'done' });
    store().appendLogs([{ kind: 'ok', text: 'x' }]);
    expect(temporal().pastStates).toHaveLength(0);
  });

  it('히스토리 상한은 최소 50단계다 (Spec §3.5-11)', () => {
    seed([{ id: 'agent_1', type: 'agent' }]);
    for (let i = 0; i < 60; i++) store().updateNodeData('agent_1', { role: `r${i}` });
    expect(temporal().pastStates.length).toBe(50);

    // 상한 안에서는 끝까지 되돌아간다.
    for (let i = 0; i < 50; i++) temporal().undo();
    expect(store().nodes[0]!.data.role).toBe('r9');
  });

  it('빈 히스토리에서 undo/redo 를 눌러도 터지지 않는다', () => {
    expect(() => { temporal().undo(); temporal().redo(); }).not.toThrow();
    expect(store().nodes).toHaveLength(0);
  });

  it('replaceDoc(템플릿 로드) 도 되돌릴 수 있다', () => {
    seed([{ id: 'llm_1', type: 'llm' }]);
    store().replaceDoc({
      schema_version: '1.0', app_version: '0.1.0', id: 'cvs_x', name: 'X',
      created_at: '', updated_at: '', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [], edges: [], meta: { requires_keys: [] },
    });
    expect(store().nodes).toHaveLength(0);

    temporal().undo();
    expect(store().nodes.map((n) => n.id)).toEqual(['llm_1']);
  });

  /**
   * 회귀: `undo()`/`redo()` 는 `zundo` 를 직접 부르는 게 아니라 스토어의 래퍼를
   * 거쳐야 한다. zundo 는 `nodes`/`edges` 만 되돌려 놓고 우리 액션의 후처리
   * (`schedulePersist` · `revalidate`)를 건너뛰기 때문에, 래퍼가 없으면
   * `Ctrl+Z` 직후 LocalStorage 가 undo **이전** 문서를 들고 있다.
   */
  describe('undo/redo 후처리 (LocalStorage · 검증)', () => {
    it('undo 하면 LocalStorage 도 되돌아간 문서로 갱신된다', () => {
      vi.useFakeTimers();
      seed([{ id: 'agent_1', type: 'agent' }]);
      store().updateNodeData('agent_1', { role: 'before' });
      vi.advanceTimersByTime(1100); // schedulePersist 디바운스
      store().updateNodeData('agent_1', { role: 'after' });
      vi.advanceTimersByTime(1100);

      const persistedRole = () => {
        const raw = window.localStorage.getItem('agentcanvas.workspace.v1');
        return JSON.parse(raw!).nodes.find((n: { id: string }) => n.id === 'agent_1').data.role;
      };
      expect(persistedRole()).toBe('after');

      undo();
      expect(store().nodes[0]!.data.role).toBe('before');
      vi.advanceTimersByTime(1100);
      expect(persistedRole()).toBe('before');

      redo();
      expect(store().nodes[0]!.data.role).toBe('after');
      vi.advanceTimersByTime(1100);
      expect(persistedRole()).toBe('after');
    });

    it('undo 하면 검증 결과도 되돌아간 그래프 기준으로 다시 계산된다', () => {
      seed([{ id: 'crew_1', type: 'crew' }]);
      store().removeNodes(['crew_1']);
      // Crew 가 없으므로 AC-E101 이 떠 있다.
      expect(store().issues.some((i) => i.code === 'AC-E101')).toBe(true);

      undo();
      expect(store().nodes.map((n) => n.id)).toEqual(['crew_1']);
      expect(store().issues.some((i) => i.code === 'AC-E101')).toBe(false);
    });

    it('빈 히스토리에서 래퍼를 눌러도 터지지 않는다', () => {
      expect(() => { undo(); redo(); }).not.toThrow();
    });
  });
});

/* ══════════════════════ 2. 카디널리티 자동 교체 ══════════════════════ */

describe('연결 카디널리티 자동 교체 (Spec §6.3)', () => {
  it('Agent.llm(max 1) 에 두 번째 LLM 을 꽂으면 기존 엣지가 교체된다', () => {
    seed([
      { id: 'llm_1', type: 'llm' }, { id: 'llm_2', type: 'llm' }, { id: 'agent_1', type: 'agent' },
    ]);
    expect(store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' })).toBe(true);
    expect(store().connect({ source: 'llm_2', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' })).toBe(true);

    const llmEdges = store().edges.filter((e) => e.target === 'agent_1' && e.targetHandle === 'llm');
    expect(llmEdges).toHaveLength(1);
    expect(llmEdges[0]!.source).toBe('llm_2');
  });

  it.each([
    ['task', 'agent', 'agent', 'agent'],
    ['crew', 'llm', 'llm', 'llm'],
    ['crew', 'memory', 'memory', 'memory'],
  ] as const)('%s.%s 도 자동 교체된다', (targetType, targetHandle, sourceType, sourceHandle) => {
    seed([
      { id: 'src_1', type: sourceType }, { id: 'src_2', type: sourceType },
      { id: 'dst', type: targetType },
    ]);
    store().connect({ source: 'src_1', sourceHandle, target: 'dst', targetHandle });
    store().connect({ source: 'src_2', sourceHandle, target: 'dst', targetHandle });

    const edges = store().edges.filter((e) => e.target === 'dst' && e.targetHandle === targetHandle);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe('src_2');
  });

  it('교체는 같은 핸들에만 적용된다 — 다른 입력 포트의 엣지는 살아남는다', () => {
    seed([
      { id: 'llm_1', type: 'llm' }, { id: 'llm_2', type: 'llm' },
      { id: 'tool_1', type: 'tool' }, { id: 'agent_1', type: 'agent' },
    ]);
    store().connect({ source: 'tool_1', sourceHandle: 'tool', target: 'agent_1', targetHandle: 'tool' });
    store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });
    store().connect({ source: 'llm_2', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });

    expect(store().edges).toHaveLength(2);
    expect(store().edges.some((e) => e.targetHandle === 'tool' && e.source === 'tool_1')).toBe(true);
    expect(store().edges.some((e) => e.targetHandle === 'llm' && e.source === 'llm_2')).toBe(true);
  });

  it('무제한 입력(Agent.tool)은 교체하지 않고 쌓인다', () => {
    seed([
      { id: 'tool_1', type: 'tool' }, { id: 'tool_2', type: 'tool' },
      { id: 'tool_3', type: 'tool' }, { id: 'agent_1', type: 'agent' },
    ]);
    for (const id of ['tool_1', 'tool_2', 'tool_3']) {
      expect(store().connect({ source: id, sourceHandle: 'tool', target: 'agent_1', targetHandle: 'tool' })).toBe(true);
    }
    expect(store().edges).toHaveLength(3);
  });

  it('출력 포트는 무제한 — LLM 하나를 여러 에이전트가 공유한다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }, { id: 'agent_2', type: 'agent' }]);
    store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });
    store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_2', targetHandle: 'llm' });
    expect(store().edges.filter((e) => e.source === 'llm_1')).toHaveLength(2);
  });

  it('교체된 엣지도 undo 한 번으로 원래 연결이 돌아온다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'llm_2', type: 'llm' }, { id: 'agent_1', type: 'agent' }]);
    store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });
    store().connect({ source: 'llm_2', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });

    temporal().undo();
    const edges = store().edges.filter((e) => e.targetHandle === 'llm');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe('llm_1');
  });

  it('엣지 data.port_type 은 타깃 포트 타입으로 기록된다 (백엔드 페이로드 계약)', () => {
    seed([{ id: 'task_1', type: 'task' }, { id: 'task_2', type: 'task' }]);
    store().connect({ source: 'task_1', sourceHandle: 'task', target: 'task_2', targetHandle: 'context' });
    // `depends on` 은 핸들 id 가 'context' 지만 포트 **타입**은 'task' 다 (두 소켓의
    // 모양·색을 하나로 통일하면서 합쳤다). port_type 은 타입을 기록한다.
    expect(store().edges[0]!.data).toEqual({ port_type: 'task' });
    expect(store().edges[0]!.type).toBe('acanvas');
  });
});

describe('연결 거절 (Spec §6.2 / §6.5)', () => {
  const lastToast = () => store().toasts.at(-1);

  it('호환되지 않는 타입은 거절하고 에러 토스트를 띄운다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }]);
    expect(store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'tool' })).toBe(false);
    expect(store().edges).toHaveLength(0);
    expect(lastToast()?.kind).toBe('error');
  });

  it('같은 노드끼리는 거절한다', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    expect(store().connect({ source: 'task_1', sourceHandle: 'task', target: 'task_1', targetHandle: 'context' })).toBe(false);
    expect(store().edges).toHaveLength(0);
  });

  it('중복 연결은 거절한다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }]);
    const conn = { source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' };
    expect(store().connect(conn)).toBe(true);
    expect(store().connect(conn)).toBe(false);
    expect(store().edges).toHaveLength(1);
  });

  it('존재하지 않는 핸들은 거절한다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }]);
    expect(store().connect({ source: 'llm_1', sourceHandle: 'nope', target: 'agent_1', targetHandle: 'llm' })).toBe(false);
  });

  it('context 사이클은 거절한다 (§6.5)', () => {
    seed([{ id: 'task_1', type: 'task' }, { id: 'task_2', type: 'task' }, { id: 'task_3', type: 'task' }]);
    expect(store().connect({ source: 'task_1', sourceHandle: 'task', target: 'task_2', targetHandle: 'context' })).toBe(true);
    expect(store().connect({ source: 'task_2', sourceHandle: 'task', target: 'task_3', targetHandle: 'context' })).toBe(true);
    // task_3 → task_1 을 이으면 1→2→3→1 순환.
    expect(store().connect({ source: 'task_3', sourceHandle: 'task', target: 'task_1', targetHandle: 'context' })).toBe(false);
    expect(store().edges).toHaveLength(2);
  });

  it('context 가 아닌 타입은 사이클 판정을 하지 않는다 (Agent 공유는 정상)', () => {
    seed([{ id: 'agent_1', type: 'agent' }, { id: 'task_1', type: 'task' }, { id: 'crew_1', type: 'crew' }]);
    expect(store().connect({ source: 'agent_1', sourceHandle: 'agent', target: 'task_1', targetHandle: 'agent' })).toBe(true);
    expect(store().connect({ source: 'agent_1', sourceHandle: 'agent', target: 'crew_1', targetHandle: 'agent' })).toBe(true);
    expect(store().edges).toHaveLength(2);
  });
});

describe('Auto-Wire (Spec §5.7)', () => {
  it('Crew 가 있으면 새 Agent/Task 가 자동으로 연결된다', () => {
    const crew = store().addNode('crew', { x: 0, y: 0 });
    const agent = store().addNode('agent', { x: 100, y: 0 });
    const task = store().addNode('task', { x: 200, y: 0 });

    expect(store().edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: agent, target: crew, targetHandle: 'agent' }),
      expect.objectContaining({ source: task, target: crew, targetHandle: 'task' }),
    ]));
  });

  it('Crew 가 없으면 자동 연결하지 않는다', () => {
    store().addNode('agent', { x: 0, y: 0 });
    expect(store().edges).toHaveLength(0);
  });
});

/* ══════════════════════ 3. SSE 이벤트 배치 반영 ══════════════════════ */

describe('SSE 이벤트 50ms 배치 (Spec §16.2 MUST)', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  /** 배치 타이머를 흘려보낸다. */
  const flush = () => vi.advanceTimersByTime(60);

  it('50ms 안에 들어온 이벤트는 한 번의 set() 으로 묶여 반영된다', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    let renders = 0;
    const unsub = useAppStore.subscribe(() => { renders++; });

    store().enqueueEvent('run.started', { task_order: ['task_1'] });
    store().enqueueEvent('task.started', { node_id: 'task_1', task_name: 'T' });
    store().enqueueEvent('task.completed', { node_id: 'task_1', output: 'done', duration_ms: 12 });

    // 타이머가 돌기 전엔 아무것도 반영되지 않는다.
    expect(store().runStatus).toBe('idle');
    expect(renders).toBe(0);

    flush();
    expect(renders).toBe(1); // 이벤트 3건 → set() 1회
    expect(store().runStatus).toBe('running');
    expect(store().nodeStates.task_1?.status).toBe('succeeded');
    expect(store().nodeStates.task_1?.output).toBe('done');
    unsub();
  });

  it('배치 안에서 이벤트 순서가 보존된다 (마지막 상태가 이긴다)', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    store().enqueueEvent('node.status', { node_id: 'task_1', status: 'queued' });
    store().enqueueEvent('node.status', { node_id: 'task_1', status: 'running' });
    store().enqueueEvent('node.status', { node_id: 'task_1', status: 'failed' });
    flush();
    expect(store().nodeStates.task_1?.status).toBe('failed');
  });

  it('배치 경계를 넘어 들어온 이벤트는 다음 배치로 이어진다', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    store().enqueueEvent('node.status', { node_id: 'task_1', status: 'running' });
    flush();
    expect(store().nodeStates.task_1?.status).toBe('running');

    store().enqueueEvent('node.status', { node_id: 'task_1', status: 'succeeded' });
    expect(store().nodeStates.task_1?.status).toBe('running'); // 아직
    flush();
    expect(store().nodeStates.task_1?.status).toBe('succeeded');
  });

  it('resetRun 은 아직 반영 안 된 큐를 버린다 (직전 실행 이벤트가 새 실행에 새지 않게)', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    store().enqueueEvent('task.completed', { node_id: 'task_1', output: 'stale' });
    store().resetRun();
    flush();
    expect(store().nodeStates).toEqual({});
    expect(store().runStatus).toBe('idle');
  });

  it('run.started 는 task_order 의 노드를 queued 로 표시한다', () => {
    seed([{ id: 't1', type: 'task' }, { id: 't2', type: 'task' }]);
    store().enqueueEvent('run.started', { task_order: ['t1', 't2'] });
    flush();
    expect(store().nodeStates.t1?.status).toBe('queued');
    expect(store().nodeStates.t2?.status).toBe('queued');
    expect(store().runStatus).toBe('running');
    expect(store().startedAt).not.toBeNull();
  });

  it('run.completed 는 Crew 에 물린 Output 노드에 최종 결과를 꽂는다 (§5.9)', () => {
    seed([{ id: 'crew_1', type: 'crew' }, { id: 'out_1', type: 'output' }]);
    store().connect({ source: 'crew_1', sourceHandle: 'result', target: 'out_1', targetHandle: 'result' });

    store().enqueueEvent('run.completed', { final_output: '# 최종 보고서' });
    flush();

    expect(store().runStatus).toBe('succeeded');
    expect(store().nodeStates.out_1?.status).toBe('succeeded');
    expect(store().nodeStates.out_1?.output).toBe('# 최종 보고서');
    expect(store().logs.at(-1)?.kind).toBe('final');
    expect(store().toasts.at(-1)?.kind).toBe('success');
  });

  it('Crew↔Output 연결이 없으면 캔버스의 모든 Output 노드로 폴백한다', () => {
    seed([{ id: 'crew_1', type: 'crew' }, { id: 'out_1', type: 'output' }, { id: 'out_2', type: 'output' }]);
    store().enqueueEvent('run.completed', { final_output: 'R' });
    flush();
    expect(store().nodeStates.out_1?.output).toBe('R');
    expect(store().nodeStates.out_2?.output).toBe('R');
  });

  it('task.completed 는 그 태스크에 직접 물린 Output 노드에도 흘러간다', () => {
    seed([{ id: 'task_1', type: 'task' }, { id: 'out_1', type: 'output' }]);
    store().connect({ source: 'task_1', sourceHandle: 'task', target: 'out_1', targetHandle: 'task' });

    store().enqueueEvent('task.completed', { node_id: 'task_1', output: '부분 결과', duration_ms: 5 });
    flush();
    expect(store().nodeStates.out_1?.output).toBe('부분 결과');
    expect(store().nodeStates.task_1?.output).toBe('부분 결과');
  });

  it('run.failed 는 실패 노드로 카메라 포커스를 요청하고 sticky 에러 토스트를 남긴다 (§17.4)', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    store().enqueueEvent('run.failed', { error: { code: 'AC-E501', message: 'boom', node_id: 'task_1' } });
    flush();

    expect(store().runStatus).toBe('failed');
    expect(store().nodeStates.task_1?.status).toBe('failed');
    expect(store().focusRequest?.nodeId).toBe('task_1');
    expect(store().toasts.at(-1)).toMatchObject({ kind: 'error', sticky: true });
    expect(store().logs.at(-1)?.text).toContain('AC-E501');
  });

  it('run.cancelled 는 상태를 cancelled 로 옮기고 대기 중 human 요청을 지운다', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    store().enqueueEvent('human.request', { node_id: 'task_1', prompt: 'ok?', timeout_s: 30 });
    flush();
    expect(store().humanRequest?.nodeId).toBe('task_1');

    store().enqueueEvent('run.cancelled', {});
    flush();
    expect(store().runStatus).toBe('cancelled');
    expect(store().humanRequest).toBeNull();
  });

  it('token.usage 는 전역 합계와 노드별 합계를 함께 누적한다', () => {
    seed([{ id: 'task_1', type: 'task' }]);
    store().enqueueEvent('token.usage', { node_id: 'task_1', prompt_tokens: 100, completion_tokens: 20, cost_usd: 0.001 });
    store().enqueueEvent('token.usage', { node_id: 'task_1', prompt_tokens: 50, completion_tokens: 10, cost_usd: 0.002 });
    flush();

    expect(store().usage).toEqual({ prompt: 150, completion: 30, costUsd: 0.003 });
    expect(store().nodeStates.task_1?.usage).toEqual({ prompt: 150, completion: 30, costUsd: 0.003 });
  });

  it('실행 중인 노드의 in/out 엣지가 activeEdges 로 파생된다 (§3.4.3)', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }, { id: 'task_1', type: 'task' }]);
    store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });
    store().connect({ source: 'agent_1', sourceHandle: 'agent', target: 'task_1', targetHandle: 'agent' });
    const [e1, e2] = store().edges.map((e) => e.id);

    store().enqueueEvent('node.status', { node_id: 'agent_1', status: 'running' });
    flush();
    expect(new Set(store().activeEdges)).toEqual(new Set([e1, e2]));

    store().enqueueEvent('node.status', { node_id: 'agent_1', status: 'succeeded' });
    flush();
    expect(store().activeEdges).toEqual([]);
  });

  it('edge.active 이벤트는 직접 활성 엣지를 켜고 끈다', () => {
    seed([{ id: 'llm_1', type: 'llm' }, { id: 'agent_1', type: 'agent' }]);
    store().connect({ source: 'llm_1', sourceHandle: 'llm', target: 'agent_1', targetHandle: 'llm' });
    const edgeId = store().edges[0]!.id;

    store().enqueueEvent('edge.active', { edge_id: edgeId, active: true });
    flush();
    expect(store().activeEdges).toEqual([edgeId]);

    store().enqueueEvent('edge.active', { edge_id: edgeId, active: false });
    flush();
    expect(store().activeEdges).toEqual([]);
  });

  it('node_id 가 없는 node.status 는 경고 로그만 남기고 상태를 건드리지 않는다', () => {
    store().enqueueEvent('node.status', { node_id: null, status: 'running' });
    flush();
    expect(store().nodeStates).toEqual({});
    expect(store().logs.at(-1)?.kind).toBe('warn');
  });

  it('모르는 이벤트는 시스템 로그로 흘려보내고 무시한다', () => {
    store().enqueueEvent('totally.unknown', { x: 1 });
    flush();
    expect(store().logs).toHaveLength(1);
    expect(store().logs[0]!.kind).toBe('sys');
    expect(store().runStatus).toBe('idle');
  });

  it('로그는 링버퍼 상한을 넘지 않는다 (§16.2)', () => {
    for (let i = 0; i < MAX_LOG_LINES + 50; i++) {
      store().enqueueEvent('log', { level: 'info', message: `line ${i}` });
    }
    flush();
    expect(store().logs).toHaveLength(MAX_LOG_LINES);
    expect(store().logs.at(-1)!.text).toBe(`line ${MAX_LOG_LINES + 49}`);
  });

  it('appendLogs 도 같은 상한을 지킨다', () => {
    store().appendLogs(Array.from({ length: MAX_LOG_LINES + 10 }, (_, i) => ({ kind: 'sys' as const, text: `l${i}` })));
    expect(store().logs).toHaveLength(MAX_LOG_LINES);
    expect(store().logs[0]!.text).toBe('l10');
  });

  it('로그 id 는 단조 증가한다 (React key 안정성)', () => {
    store().appendLogs([{ kind: 'sys', text: 'a' }, { kind: 'sys', text: 'b' }]);
    const [a, b] = store().logs;
    expect(b!.id).toBeGreaterThan(a!.id);
  });
});

/* ───────────────────── 문서 메타 왕복 (M5-T1) ───────────────────── */

describe('문서 메타 (docMeta)', () => {
  const published = {
    schema_version: '1.0', app_version: '0.1.0', id: 'cvs_pub', name: 'Published Team',
    description: '공개된 팀', tags: ['seo', 'research'], author: 'hynwl',
    license: 'MIT' as const, revision: 4,
    forked_from: { id: 'cvs_origin', revision: 2, source: 'https://hub.example', name: 'Origin' },
    created_at: '2026-02-03T04:05:06.000Z', updated_at: '2026-02-03T04:05:06.000Z',
    viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], meta: { requires_keys: [] },
  };

  /**
   * 회귀: `toDoc()` 이 `description`/`tags`/`author`/`created_at` 을 매번 빈 값으로
   * 하드코딩하고 있었다. 그래서 문서를 불러온 뒤 노드를 하나만 건드려도 자동저장이
   * 메타를 지운 문서로 덮어썼다 — 게시 메타를 얹기 전에 이것부터 막아야 한다.
   */
  it('replaceDoc → toDoc 왕복에서 게시 메타가 살아남는다', () => {
    store().replaceDoc(published);
    const out = store().toDoc();
    expect(out.description).toBe('공개된 팀');
    expect(out.tags).toEqual(['seo', 'research']);
    expect(out.author).toBe('hynwl');
    expect(out.license).toBe('MIT');
    expect(out.revision).toBe(4);
    expect(out.forked_from).toEqual(published.forked_from);
    expect(out.created_at).toBe('2026-02-03T04:05:06.000Z');
  });

  it('created_at 은 보존되고 updated_at 만 새로 찍힌다', () => {
    store().replaceDoc(published);
    const out = store().toDoc();
    expect(out.created_at).toBe(published.created_at);
    expect(out.updated_at).not.toBe(published.updated_at);
  });

  it('그래프를 편집해도 메타가 날아가지 않는다', () => {
    store().replaceDoc(published);
    store().addNode('agent', { x: 0, y: 0 });
    expect(store().toDoc().author).toBe('hynwl');
    expect(store().toDoc().license).toBe('MIT');
  });

  it('setDocMeta 는 부분 갱신이다', () => {
    store().replaceDoc(published);
    store().setDocMeta({ license: 'CC0-1.0' });
    expect(store().toDoc().license).toBe('CC0-1.0');
    expect(store().toDoc().description).toBe('공개된 팀');
  });

  it('메타는 undo 대상이 아니다 — 게시 신원은 그래프 히스토리와 다른 축이다', () => {
    store().replaceDoc(published);
    store().setDocMeta({ license: 'Apache-2.0' });
    store().addNode('agent', { x: 0, y: 0 });
    undo();
    expect(store().docMeta.license).toBe('Apache-2.0');
  });
});
