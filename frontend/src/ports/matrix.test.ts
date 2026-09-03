/**
 * 포트 매트릭스 테이블 드리븐 테스트 (Spec §18 `MUST`)
 *
 * > 포트 매트릭스 (프론트) | Vitest | §6.2 표 **전 셀**을 테이블 드리븐 테스트로 검증 `MUST`
 *
 * 검증은 두 층으로 나뉜다.
 *
 *  1. **스펙 §6.2 표 그대로** — 아래 `SPEC_MATRIX` 는 스펙 문서의 마크다운 표를
 *     행/열 순서까지 그대로 옮긴 것이다. 7행 × 11열 = 77셀 전부를 실제 레지스트리
 *     포트(`nodes/registry.ts`)로 재구성해 `checkConnection()` 에 태운다.
 *  2. **레지스트리 전수 교차곱** — 표에 안 적힌 포트(Human.task, Router.*, Crew.knowledge …)
 *     까지 포함해 모든 (출력 포트 × 입력 포트) 쌍이 `CONNECTION_MATRIX` 의 타입 규칙과
 *     어긋나지 않는지 확인한다. 표는 "대표 셀"이고 이쪽이 "빠짐없음"을 지킨다.
 */

import { describe, expect, it } from 'vitest';

import { NODE_DEFINITIONS, getPort, type NodeType } from '@/nodes/registry';
import {
  CONNECTION_MATRIX, REJECTION_MESSAGE_KEY, canConnectTypes, checkConnection,
  type ConnectionRejection,
} from './matrix';
import { PORT_TYPES, PORT_TYPE_META, isSingleInput, type PortSpec } from './types';

/* ────────────────────────── 헬퍼 ────────────────────────── */

/** `"Agent.llm"` 처럼 스펙 표에 적힌 셀 좌표를 실제 PortSpec 으로 푼다. */
function port(cell: string): { nodeType: NodeType; spec: PortSpec } {
  const [node, portId] = cell.split('.') as [string, string];
  const nodeType = node.toLowerCase() as NodeType;
  const spec = getPort(nodeType, portId);
  if (!spec) throw new Error(`스펙 표의 "${cell}" 에 해당하는 포트가 레지스트리에 없다`);
  return { nodeType, spec };
}

/**
 * 표의 셀은 **서로 다른 두 노드** 사이의 판정이다 — 같은 노드 타입이 행과 열에 모두
 * 나오는 셀(Task.task → Task.context)은 "Task A → Task B" 를 뜻하지, 자기 자신에게
 * 꽂는 것이 아니다. 그래서 노드 id 를 항상 다르게 준다.
 */
function connect(sourceCell: string, targetCell: string) {
  const from = port(sourceCell);
  const to = port(targetCell);
  return checkConnection({
    sourceNode: `src_${from.nodeType}`,
    sourcePort: from.spec,
    targetNode: `dst_${to.nodeType}`,
    targetPort: to.spec,
  });
}

/* ────────────────────────── Spec §6.2 표 원문 ────────────────────────── */

/** 열 = 입력(target). 스펙 표의 열 순서 그대로. */
const SPEC_COLUMNS = [
  'Agent.llm', 'Agent.tool', 'Agent.knowledge',
  'Task.agent', 'Task.context', 'Task.tool',
  'Crew.agent', 'Crew.task', 'Crew.llm', 'Crew.memory',
  'Output.result',
] as const;

/** 행 = 출력(source) → 열별 허용 여부. `true` = ✅, `false` = ❌ */
const SPEC_MATRIX: Array<{ source: string; cells: boolean[] }> = [
  //                          A.llm  A.tool A.know T.agent T.ctx  T.tool C.agent C.task C.llm  C.mem  O.result
  { source: 'LLM.llm', cells: [true, false, false, false, false, false, false, false, true, false, false] },
  { source: 'Agent.agent', cells: [false, false, false, true, false, false, true, false, false, false, false] },
  { source: 'Task.task', cells: [false, false, false, false, true, false, false, true, false, false, true] },
  { source: 'Tool.tool', cells: [false, true, false, false, false, true, false, false, false, false, false] },
  { source: 'Knowledge.knowledge', cells: [false, false, true, false, false, false, false, false, false, false, false] },
  { source: 'Memory.memory', cells: [false, false, false, false, false, false, false, false, false, true, false] },
  { source: 'Crew.result', cells: [false, false, false, false, false, false, false, false, false, false, true] },
];

/**
 * 표와 구현이 **문자 그대로는** 어긋나는 유일한 셀.
 *
 * 스펙 표는 Output 노드의 입력을 `Output.result` 하나로만 적었지만, 레지스트리의
 * Output 노드에는 입력이 둘이다 (`nodes/registry.ts` output.inputs):
 *   - `result` (type `result`, max 1)  — Crew 의 최종 산출물
 *   - `task`   (type `task`, 무제한)   — 개별 Task 의 산출물
 *
 * 그래서 "Task.task → Output" 은 표의 의도(✅)대로 연결되지만, 꽂히는 자리는
 * `Output.result` 가 아니라 `Output.task` 다. 여기에 그 사실을 못박아 두고,
 * 아래 테스트가 (a) 문자 그대로의 셀은 차단되고 (b) 의도한 연결은 열려 있음을
 * 둘 다 확인한다. 어느 한쪽이라도 바뀌면 이 테스트가 먼저 깨진다.
 */
const SPEC_TABLE_DEVIATIONS: Record<string, { literalTarget: string; actualTarget: string }> = {
  'Task.task→Output.result': { literalTarget: 'Output.result', actualTarget: 'Output.task' },
};

describe('Spec §6.2 연결 규칙 매트릭스 — 표 전 셀', () => {
  it('표의 행·열이 스펙 문서와 같은 크기다 (7행 × 11열)', () => {
    expect(SPEC_MATRIX).toHaveLength(7);
    for (const row of SPEC_MATRIX) expect(row.cells).toHaveLength(SPEC_COLUMNS.length);
  });

  const cases = SPEC_MATRIX.flatMap((row) =>
    SPEC_COLUMNS.map((target, i) => ({
      source: row.source,
      target,
      allowed: row.cells[i]!,
      key: `${row.source}→${target}`,
    })),
  );

  it.each(cases)('$source → $target = $allowed', ({ source, target, allowed, key }) => {
    const deviation = SPEC_TABLE_DEVIATIONS[key];
    if (deviation) {
      // (a) 문자 그대로의 셀은 실제로는 차단된다 — 타입이 다르기 때문.
      expect(connect(source, deviation.literalTarget).ok).toBe(false);
      // (b) 표가 의도한 "Task 결과가 Output 노드로 흐른다" 는 전용 핸들로 성립한다.
      expect(connect(source, deviation.actualTarget).ok).toBe(true);
      return;
    }
    const verdict = connect(source, target);
    expect(verdict.ok).toBe(allowed);
    if (!allowed) expect(verdict.reason).toBe('incompatible-type');
  });

  it('표의 좌표가 전부 레지스트리에 실재한다', () => {
    for (const col of SPEC_COLUMNS) expect(port(col).spec.direction).toBe('in');
    for (const row of SPEC_MATRIX) expect(port(row.source).spec.direction).toBe('out');
  });
});

/* ────────────────────── 레지스트리 전수 교차곱 ────────────────────── */

interface RegistryPort { node: NodeType; port: PortSpec; label: string }

const ALL_OUTPUTS: RegistryPort[] = Object.values(NODE_DEFINITIONS).flatMap((def) =>
  def.outputs.map((p) => ({ node: def.type, port: p, label: `${def.type}.${p.id}` })),
);
const ALL_INPUTS: RegistryPort[] = Object.values(NODE_DEFINITIONS).flatMap((def) =>
  def.inputs.map((p) => ({ node: def.type, port: p, label: `${def.type}.${p.id}` })),
);

describe('레지스트리 전 포트 교차곱', () => {
  it('표에 없는 포트까지 포함해 충분한 수의 셀을 검사한다', () => {
    expect(ALL_OUTPUTS.length).toBeGreaterThan(0);
    expect(ALL_INPUTS.length).toBeGreaterThan(0);
    expect(ALL_OUTPUTS.length * ALL_INPUTS.length).toBeGreaterThanOrEqual(SPEC_COLUMNS.length * SPEC_MATRIX.length);
  });

  it('모든 (출력 × 입력) 쌍이 CONNECTION_MATRIX 타입 규칙과 정확히 일치한다', () => {
    const mismatches: string[] = [];
    for (const out of ALL_OUTPUTS) {
      for (const inp of ALL_INPUTS) {
        if (out.node === inp.node) continue; // 같은 노드는 별도 규칙(same-node)
        const expected = canConnectTypes(out.port.type, inp.port.type);
        const actual = checkConnection({
          sourceNode: `s_${out.node}`, sourcePort: out.port,
          targetNode: `t_${inp.node}`, targetPort: inp.port,
        }).ok;
        if (actual !== expected) mismatches.push(`${out.label} → ${inp.label}: ${actual} ≠ ${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('입력 → 입력, 출력 → 출력 은 방향 위반으로 막힌다', () => {
    const [a, b] = [ALL_INPUTS[0]!, ALL_INPUTS[1]!];
    expect(checkConnection({
      sourceNode: 'a', sourcePort: a.port, targetNode: 'b', targetPort: b.port,
    })).toEqual({ ok: false, reason: 'same-direction' });

    const [x, y] = [ALL_OUTPUTS[0]!, ALL_OUTPUTS[1]!];
    expect(checkConnection({
      sourceNode: 'x', sourcePort: x.port, targetNode: 'y', targetPort: y.port,
    })).toEqual({ ok: false, reason: 'same-direction' });
  });

  it('같은 노드끼리는 타입이 맞아도 막힌다 (self-loop 금지)', () => {
    const taskOut = getPort('task', 'task')!;
    const taskCtxIn = getPort('task', 'context')!;
    expect(canConnectTypes(taskOut.type, taskCtxIn.type)).toBe(true);
    expect(checkConnection({
      sourceNode: 'task_1', sourcePort: taskOut, targetNode: 'task_1', targetPort: taskCtxIn,
    })).toEqual({ ok: false, reason: 'same-node' });
  });
});

/* ────────────────────── 매트릭스 자체의 무결성 ────────────────────── */

describe('CONNECTION_MATRIX 무결성', () => {
  it('모든 포트 타입이 행으로 존재한다', () => {
    expect(Object.keys(CONNECTION_MATRIX).sort()).toEqual([...PORT_TYPES].sort());
  });

  it('허용 타입 값도 전부 알려진 포트 타입이다', () => {
    for (const [from, tos] of Object.entries(CONNECTION_MATRIX)) {
      for (const to of tos) {
        expect(PORT_TYPES, `${from} → ${to}`).toContain(to);
      }
    }
  });

  it('모든 포트 타입에 소켓 모양/색/라벨 메타가 있다', () => {
    for (const type of PORT_TYPES) {
      expect(PORT_TYPE_META[type]).toBeDefined();
      expect(PORT_TYPE_META[type].colorKey).toBe(type);
      expect(PORT_TYPE_META[type].labelKey).toBe(`port.type.${type}`);
    }
  });

  it('task 만 두 종류의 입력(task/context)에 꽂힌다 — 나머지는 동일 타입 전용', () => {
    for (const type of PORT_TYPES) {
      if (type === 'task') {
        expect(CONNECTION_MATRIX.task).toEqual(['task', 'context']);
        continue;
      }
      expect(CONNECTION_MATRIX[type]).toEqual([type]);
    }
  });

  it('거절 사유마다 i18n 키가 있다', () => {
    const reasons: ConnectionRejection[] = ['same-node', 'same-direction', 'incompatible-type', 'cycle', 'duplicate'];
    for (const r of reasons) expect(REJECTION_MESSAGE_KEY[r]).toBe(`port.reject.${r}`);
    expect(Object.keys(REJECTION_MESSAGE_KEY).sort()).toEqual([...reasons].sort());
  });
});

/* ────────────────────── §6.3 카디널리티 표 ────────────────────── */

describe('Spec §6.3 연결 카디널리티', () => {
  /** 스펙 §6.3 "최대 연결 수 = 1 → 기존 엣지 자동 교체" 목록 그대로. */
  const SINGLE_INPUTS: Array<[NodeType, string]> = [
    ['agent', 'llm'],
    ['task', 'agent'],
    ['crew', 'llm'],
    ['crew', 'memory'],
  ];

  it.each(SINGLE_INPUTS)('%s.%s 은 최대 1개', (nodeType, portId) => {
    const p = getPort(nodeType, portId)!;
    expect(p.maxConnections).toBe(1);
    expect(isSingleInput(p)).toBe(true);
  });

  it('그 외 입력 포트는 전부 무제한이다', () => {
    const singles = new Set(SINGLE_INPUTS.map(([n, p]) => `${n}.${p}`));
    // Output.result 는 스펙 §6.3 표에 없지만 "크루의 최종 결과는 하나" 라는 의미로
    // 레지스트리가 1로 두고 있다 — 표 밖 예외로 명시해 둔다.
    singles.add('output.result');
    for (const inp of ALL_INPUTS) {
      const expected = singles.has(inp.label) ? 1 : 'unbounded';
      expect(inp.port.maxConnections, inp.label).toBe(expected);
    }
  });

  it('모든 출력 포트는 무제한이다 (LLM 하나를 여러 에이전트가 공유)', () => {
    for (const out of ALL_OUTPUTS) {
      expect(out.port.maxConnections, out.label).toBe('unbounded');
      expect(isSingleInput(out.port)).toBe(false);
    }
  });
});
