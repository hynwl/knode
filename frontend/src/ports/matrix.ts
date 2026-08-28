/**
 * 연결 규칙 매트릭스 (Spec §6.2)
 *
 * 스펙의 표는 "노드.포트" 단위로 적혀 있으나, 실제 판정은 **포트 타입 일치 + 방향 반대**
 * 로 환원된다. 표의 모든 셀이 그 규칙과 일치하는지는 테스트로 고정한다
 * (§18 "포트 매트릭스: 표 전 셀을 테이블 드리븐 테스트로 검증").
 */

import type { PortSpec, PortType } from './types';

/** 출력 포트 타입 → 연결 가능한 입력 포트 타입 집합 */
export const CONNECTION_MATRIX: Record<PortType, readonly PortType[]> = {
  llm: ['llm'],
  agent: ['agent'],
  /** Task 출력은 Crew.task 입력과 다른 Task 의 context 입력 양쪽에 꽂힌다 */
  task: ['task', 'context'],
  tool: ['tool'],
  context: ['context'],
  knowledge: ['knowledge'],
  memory: ['memory'],
  result: ['result'],
  text: ['text'],
};

export type ConnectionRejection =
  | 'same-node'
  | 'same-direction'
  | 'incompatible-type'
  | 'cycle'
  | 'duplicate';

export interface ConnectionCheck {
  ok: boolean;
  reason?: ConnectionRejection;
}

export function canConnectTypes(source: PortType, target: PortType): boolean {
  return CONNECTION_MATRIX[source]?.includes(target) ?? false;
}

export interface ConnectionCandidate {
  sourceNode: string;
  sourcePort: PortSpec;
  targetNode: string;
  targetPort: PortSpec;
}

/** 사이클 판정을 제외한 순수 규칙 검사. 사이클은 그래프를 알아야 하므로 validation 에서 한다. */
export function checkConnection(c: ConnectionCandidate): ConnectionCheck {
  if (c.sourceNode === c.targetNode) return { ok: false, reason: 'same-node' };
  if (c.sourcePort.direction !== 'out' || c.targetPort.direction !== 'in') {
    return { ok: false, reason: 'same-direction' };
  }
  if (!canConnectTypes(c.sourcePort.type, c.targetPort.type)) {
    return { ok: false, reason: 'incompatible-type' };
  }
  return { ok: true };
}

export const REJECTION_MESSAGE: Record<ConnectionRejection, string> = {
  'same-node': '같은 노드끼리는 연결할 수 없습니다.',
  'same-direction': '출력은 입력에만 연결할 수 있습니다.',
  'incompatible-type': '호환되지 않는 포트입니다. 같은 색 소켓끼리 연결하세요.',
  cycle: '순환 의존이 생깁니다. Task 컨텍스트 연결을 확인하세요.',
  duplicate: '이미 연결되어 있습니다.',
};
