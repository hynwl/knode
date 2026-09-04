/**
 * 키 사전 검증 (`validateKeys`) — Spec §12.4 MUST
 * "키 없이 실행 시도 → 어떤 키가 왜 필요한지 명확히 안내"
 *
 * 핵심은 **심각도가 두 갈래**라는 점이다. 셀프호스팅 서버의 `.env` 폴백이
 * 채워 줄 수 있는 경우(경고)와, 원리적으로 채워질 수 없어 반드시 실패하는
 * 경우(에러)를 섞으면 둘 중 하나가 반드시 틀린다.
 */

import { describe, expect, it } from 'vitest';

import type { AcEdge, AcNode } from '@/types/canvas';
import { PROVIDER_KEY_NAME, validateKeys, type RegisteredKeys } from './rules';

function node(id: string, type: AcNode['type'], data: Record<string, unknown>): AcNode {
  return {
    id, type,
    position: { x: 0, y: 0 },
    width: null, height: null,
    data,
    ui: { collapsed: false, pinned: false, bypassed: false, colorOverride: null },
    parentNode: null, extent: null,
  };
}

function graph(nodes: AcNode[], edges: AcEdge[] = []) {
  return { nodes, edges };
}

function registered(...ids: string[]): RegisteredKeys {
  return {
    slotIds: new Set(ids),
    // 슬롯 id 는 언제나 키 이름으로 시작한다 (`OPENAI_API_KEY#work`).
    keyNames: new Set(ids.map((id) => id.split('#')[0]!)),
  };
}

const NONE = registered();

describe('기본 키 (key_ref 없음)', () => {
  it('등록돼 있으면 아무 이슈도 내지 않는다', () => {
    const g = graph([node('llm_1', 'llm', { provider: 'openai', model: 'gpt-4o' })]);
    expect(validateKeys(g, registered('OPENAI_API_KEY'))).toEqual([]);
  });

  it('없으면 경고다 — 서버 .env 가 채워 줄 수 있으므로 실행을 막으면 안 된다', () => {
    const g = graph([node('llm_1', 'llm', { provider: 'openai', model: 'gpt-4o' })]);
    const issues = validateKeys(g, NONE);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('AC-W606');
    expect(issues[0]!.severity).toBe('warn');
    expect(issues[0]!.nodeId).toBe('llm_1');
    expect(issues[0]!.params).toEqual({ key: 'OPENAI_API_KEY' });
  });

  it('ollama 는 키를 요구하지 않는다', () => {
    const g = graph([node('llm_1', 'llm', { provider: 'ollama', model: 'llama3.1' })]);
    expect(validateKeys(g, NONE)).toEqual([]);
  });

  it('bypass 된 노드는 실행 대상이 아니므로 검사하지 않는다', () => {
    const n = node('llm_1', 'llm', { provider: 'openai', model: 'gpt-4o' });
    n.ui.bypassed = true;
    expect(validateKeys(graph([n]), NONE)).toEqual([]);
  });

  it('openai_compatible 은 OpenAI 본계정 키로 만족되지 않는다', () => {
    const g = graph([node('llm_1', 'llm', { provider: 'openai_compatible', model: 'm' })]);
    expect(PROVIDER_KEY_NAME.openai_compatible).toBe('OPENAI_COMPATIBLE_API_KEY');
    const issues = validateKeys(g, registered('OPENAI_API_KEY'));
    expect(issues.map((i) => i.code)).toEqual(['AC-W606']);
    expect(validateKeys(g, registered('OPENAI_COMPATIBLE_API_KEY'))).toEqual([]);
  });
});

describe('키 슬롯 지정 (key_ref)', () => {
  const withRef = (ref: string, provider = 'openai') =>
    graph([node('llm_1', 'llm', { provider, model: 'gpt-4o', key_ref: ref })]);

  it('지정한 슬롯이 있으면 통과한다', () => {
    expect(validateKeys(withRef('OPENAI_API_KEY#work'), registered('OPENAI_API_KEY#work'))).toEqual([]);
  });

  it('커스텀 슬롯이 없으면 에러다 — 서버 .env 로는 채워질 수 없다', () => {
    const issues = validateKeys(withRef('OPENAI_API_KEY#gone'), registered('OPENAI_API_KEY'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('AC-E606');
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.params).toEqual({ ref: 'OPENAI_API_KEY#gone' });
  });

  it('기본 슬롯을 지정했는데 없으면 경고에 그친다 (서버 폴백 여지)', () => {
    const issues = validateKeys(withRef('OPENAI_API_KEY'), NONE);
    expect(issues.map((i) => i.code)).toEqual(['AC-W606']);
  });

  it('다른 프로바이더의 슬롯을 지목하고 있으면 에러다', () => {
    // provider 만 groq 로 바꾸고 key_ref 를 안 지운 그래프 (공유 링크로 흔히 온다).
    const g = withRef('OPENAI_API_KEY#work', 'groq');
    const issues = validateKeys(g, registered('OPENAI_API_KEY#work', 'GROQ_API_KEY'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('AC-E606');
    expect(issues[0]!.params).toEqual({ ref: 'OPENAI_API_KEY#work', key: 'GROQ_API_KEY' });
  });
});

describe('Tool 노드', () => {
  it('Serper 툴도 키가 없으면 실행 전에 알린다', () => {
    const g = graph([node('tool_1', 'tool', { tool_id: 'serper_search' })]);
    const issues = validateKeys(g, NONE);
    expect(issues.map((i) => [i.code, i.field])).toEqual([['AC-W606', 'tool_id']]);
    expect(validateKeys(g, registered('SERPER_API_KEY'))).toEqual([]);
  });

  it('키가 필요 없는 툴은 조용하다', () => {
    const g = graph([node('tool_1', 'tool', { tool_id: 'file_read' })]);
    expect(validateKeys(g, NONE)).toEqual([]);
  });
});
