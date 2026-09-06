// @vitest-environment jsdom
/**
 * 커스텀 템플릿 저장/덮어쓰기 + "이 캔버스의 출처" 추적.
 *
 * 회귀 대상: 예전엔 Save 가 언제나 새 템플릿을 만들어서, 같은 것을 고쳐 저장할
 * 때마다 갤러리에 사본이 쌓였다. 출처 포인터가 그 구분을 담당한다.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCustomTemplate,
  getCustomTemplate,
  loadCustomTemplates,
  loadSourceTemplateId,
  removeTemplate,
  saveSourceTemplateId,
  updateCustomTemplate,
} from './custom';
import type { CanvasDoc } from '@/types/canvas';

function doc(name: string): CanvasDoc {
  return {
    schema_version: '1.0', app_version: '0.1.0', id: `cvs_${name}`, name,
    created_at: '', updated_at: '', viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [], edges: [], meta: { requires_keys: [] },
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('커스텀 템플릿 덮어쓰기', () => {
  it('업데이트는 사본을 만들지 않고 같은 id 를 유지한다', () => {
    const created = addCustomTemplate('My Crew', 'first', doc('a'));
    const updated = updateCustomTemplate(created.id, 'My Crew', 'second', doc('b'));

    expect(loadCustomTemplates()).toHaveLength(1);
    expect(updated?.id).toBe(created.id);
    expect(updated?.description).toBe('second');
    expect(updated?.doc.name).toBe('b');
  });

  it('createdAt 은 유지하고 updatedAt 만 새로 찍는다', () => {
    const created = addCustomTemplate('My Crew', '', doc('a'));
    expect(created.updatedAt).toBeUndefined();

    const updated = updateCustomTemplate(created.id, 'My Crew', '', doc('b'));
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.updatedAt).toBeTruthy();
  });

  it('갤러리 순서를 흔들지 않는다 — 업데이트해도 자리가 그대로다', () => {
    const first = addCustomTemplate('A', '', doc('a'));
    const second = addCustomTemplate('B', '', doc('b'));
    // addCustomTemplate 은 앞에 붙이므로 지금 순서는 [B, A].
    expect(loadCustomTemplates().map((c) => c.id)).toEqual([second.id, first.id]);

    updateCustomTemplate(first.id, 'A2', '', doc('a2'));
    expect(loadCustomTemplates().map((c) => c.id)).toEqual([second.id, first.id]);
  });

  it('없는 id 를 업데이트하면 null — 호출부가 새로 만들기로 폴백한다', () => {
    expect(updateCustomTemplate('custom_gone', 'x', '', doc('a'))).toBeNull();
  });

  it('저장한 문서는 원본 캔버스와 분리된 사본이다', () => {
    const original = doc('a');
    const created = addCustomTemplate('My Crew', '', original);
    original.name = 'mutated';
    expect(getCustomTemplate(created.id)?.doc.name).toBe('a');
  });
});

describe('출처 템플릿 포인터', () => {
  it('저장한 뒤 그 id 를 가리키면 그대로 읽힌다', () => {
    const created = addCustomTemplate('My Crew', '', doc('a'));
    saveSourceTemplateId(created.id);
    expect(loadSourceTemplateId()).toBe(created.id);
  });

  it('가리키던 템플릿이 지워지면 null 로 읽힌다 (유령을 덮어쓰지 않는다)', () => {
    const created = addCustomTemplate('My Crew', '', doc('a'));
    saveSourceTemplateId(created.id);
    removeTemplate(created.id);
    expect(loadSourceTemplateId()).toBeNull();
  });

  it('저장된 적 없는 id 를 가리켜도 null 이다', () => {
    saveSourceTemplateId('custom_never');
    expect(loadSourceTemplateId()).toBeNull();
  });

  it('내장 템플릿을 숨겨도 출처 포인터는 건드리지 않는다', () => {
    const created = addCustomTemplate('My Crew', '', doc('a'));
    saveSourceTemplateId(created.id);
    removeTemplate('hello'); // 내장 = 숨김 처리
    expect(loadSourceTemplateId()).toBe(created.id);
  });
});
