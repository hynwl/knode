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
export type SocketShape = 'circle' | 'diamond' | 'triangle' | 'square';

export interface PortTypeMeta {
  /** design/tokens.ts portColor 키 */
  colorKey: PortType;
  shape: SocketShape;
  /** i18n 키 (`i18n/*.json` 의 `port.type.*`) */
  labelKey: string;
}

export const PORT_TYPE_META: Record<PortType, PortTypeMeta> = {
  llm:       { colorKey: 'llm',       shape: 'circle',         labelKey: 'port.type.llm' },
  agent:     { colorKey: 'agent',     shape: 'circle',         labelKey: 'port.type.agent' },
  task:      { colorKey: 'task',      shape: 'circle',         labelKey: 'port.type.task' },
  tool:      { colorKey: 'tool',      shape: 'diamond',        labelKey: 'port.type.tool' },
  // 현재 이 타입을 쓰는 포트는 없다 — Task 의 `depends on` 이 `task` 로 통합됐다.
  context:   { colorKey: 'context',   shape: 'diamond',        labelKey: 'port.type.context' },
  knowledge: { colorKey: 'knowledge', shape: 'triangle',       labelKey: 'port.type.knowledge' },
  memory:    { colorKey: 'memory',    shape: 'triangle',       labelKey: 'port.type.memory' },
  result:    { colorKey: 'result',    shape: 'square',         labelKey: 'port.type.result' },
  text:      { colorKey: 'text',      shape: 'square',         labelKey: 'port.type.text' },
};

export type PortDirection = 'in' | 'out';

export interface PortSpec {
  /** 핸들 ID. 노드 안에서 유일해야 한다. */
  id: string;
  type: PortType;
  direction: PortDirection;
  /**
   * 소켓 옆에 찍히는 이름. **번역하지 않는다** — `llm` / `tools` / `agent` /
   * `context` 처럼 CrewAI 의 실제 인자 이름이라, 로케일에 따라 바뀌면 오히려
   * 생성된 파이썬 코드(§8.5)와 대조가 안 된다.
   */
  label: string;
  /** 최대 연결 수. 1 이면 새 연결이 기존 연결을 교체한다 (Spec §6.3). */
  maxConnections: number | 'unbounded';
  /** 검증 시 이 입력이 없으면 에러인가 */
  required?: boolean;
  /** i18n 키 (`i18n/*.json` 의 `port.desc.*`) */
  descriptionKey?: string;
}

/** `maxConnections: 1` 인 입력 포트는 새 연결이 기존 엣지를 자동 교체한다. */
export function isSingleInput(port: PortSpec): boolean {
  return port.direction === 'in' && port.maxConnections === 1;
}
