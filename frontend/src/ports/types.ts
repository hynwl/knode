/**
 * 포트 타입 시스템 (Spec §6.1)
 * "연결될 수 없는 선은 애초에 연결되지 않는다" — 이 파일이 AgentCanvas 의 손맛을 결정한다.
 */

export const PORT_TYPES = [
  'llm', 'agent', 'task', 'tool', 'context',
  'knowledge', 'memory', 'result', 'text',
] as const;

export type PortType = (typeof PORT_TYPES)[number];

/** 소켓 모양 (Spec §6.1) */
export type SocketShape = 'circle' | 'diamond' | 'diamond-hollow' | 'triangle' | 'square';

export interface PortTypeMeta {
  /** design/tokens.ts portColor 키 */
  colorKey: PortType;
  shape: SocketShape;
  label: string;
}

export const PORT_TYPE_META: Record<PortType, PortTypeMeta> = {
  llm:       { colorKey: 'llm',       shape: 'circle',         label: '언어 모델' },
  agent:     { colorKey: 'agent',     shape: 'circle',         label: '에이전트' },
  task:      { colorKey: 'task',      shape: 'circle',         label: '태스크' },
  tool:      { colorKey: 'tool',      shape: 'diamond',        label: '툴' },
  context:   { colorKey: 'context',   shape: 'diamond-hollow', label: '태스크 컨텍스트' },
  knowledge: { colorKey: 'knowledge', shape: 'triangle',       label: '지식원' },
  memory:    { colorKey: 'memory',    shape: 'triangle',       label: '메모리' },
  result:    { colorKey: 'result',    shape: 'square',         label: '실행 결과' },
  text:      { colorKey: 'text',      shape: 'square',         label: '문자열 변수' },
};

export type PortDirection = 'in' | 'out';

export interface PortSpec {
  /** 핸들 ID. 노드 안에서 유일해야 한다. */
  id: string;
  type: PortType;
  direction: PortDirection;
  label: string;
  /** 최대 연결 수. 1 이면 새 연결이 기존 연결을 교체한다 (Spec §6.3). */
  maxConnections: number | 'unbounded';
  /** 검증 시 이 입력이 없으면 에러인가 */
  required?: boolean;
  description?: string;
}

/** `maxConnections: 1` 인 입력 포트는 ComfyUI 방식으로 기존 엣지를 자동 교체한다. */
export function isSingleInput(port: PortSpec): boolean {
  return port.direction === 'in' && port.maxConnections === 1;
}
