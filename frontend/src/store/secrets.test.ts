// @vitest-environment jsdom
/**
 * BYOK 키 슬롯 저장소 (Spec §12.1)
 *
 * 여기서 지키는 계약 세 가지:
 *  - 기본 슬롯의 id 는 **키 이름 그대로**다. 헤더 페이로드 모양과 백엔드의 서버
 *    `.env` 폴백 표(`core/secrets.py`)가 이 전제 위에 서 있다.
 *  - 슬롯 도입 전 저장본(`{secrets: {KEY: 값}}`)도 그대로 열린다.
 *  - "이 브라우저에 저장" 을 켜지 않으면 LocalStorage 에 아무것도 남지 않는다.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { STORAGE_KEYS } from '@/persistence/localStorage';
import {
  filledSlots, makeSlotId, maskKey, readSlots, slotsForKey, useSecretsStore,
} from './secrets';

const store = () => useSecretsStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  useSecretsStore.setState({ slots: [], persist: false, ollamaHost: 'http://localhost:11434' });
});

describe('슬롯 id', () => {
  it('프로바이더의 첫 키는 키 이름을 그대로 id 로 쓴다', () => {
    expect(makeSlotId('OPENAI_API_KEY', '', [])).toBe('OPENAI_API_KEY');
  });

  it('별칭이 있으면 접미사가 붙는다', () => {
    expect(makeSlotId('OPENAI_API_KEY', '업무 Work', [])).toBe('OPENAI_API_KEY#work');
    expect(makeSlotId('GROQ_API_KEY', 'Side Project', [])).toBe('GROQ_API_KEY#side-project');
  });

  it('id 가 겹치면 번호를 붙여 유일하게 만든다', () => {
    const taken = ['OPENAI_API_KEY', 'OPENAI_API_KEY#work'];
    expect(makeSlotId('OPENAI_API_KEY', '', taken)).toBe('OPENAI_API_KEY#2');
    expect(makeSlotId('OPENAI_API_KEY', 'work', taken)).toBe('OPENAI_API_KEY#work-2');
  });
});

describe('addSlot / headerPayload', () => {
  it('헤더 페이로드의 키는 슬롯 id 다 — 값은 그대로 실린다', () => {
    store().addSlot('OPENAI_API_KEY', 'sk-personal');
    store().addSlot('OPENAI_API_KEY', 'sk-work', 'work');
    expect(store().headerPayload()).toEqual({
      OPENAI_API_KEY: 'sk-personal',
      'OPENAI_API_KEY#work': 'sk-work',
    });
  });

  it('값이 빈 슬롯은 헤더에도 "보유 키" 목록에도 들어가지 않는다', () => {
    const id = store().addSlot('GEMINI_API_KEY', 'AIza-x');
    store().setSlotValue(id, '   ');
    expect(store().headerPayload()).toEqual({});
    expect(filledSlots(store().slots)).toEqual([]);
  });

  it('슬롯 삭제는 그 슬롯만 지운다', () => {
    store().addSlot('OPENAI_API_KEY', 'sk-personal');
    const work = store().addSlot('OPENAI_API_KEY', 'sk-work', 'work');
    store().removeSlot(work);
    expect(Object.keys(store().headerPayload())).toEqual(['OPENAI_API_KEY']);
  });

  it('프로바이더별 조회는 값이 있는 슬롯만 돌려준다', () => {
    store().addSlot('OPENAI_API_KEY', 'sk-personal');
    store().addSlot('GROQ_API_KEY', 'gsk_x');
    const found = slotsForKey(store().slots, 'OPENAI_API_KEY');
    expect(found.map((s) => s.id)).toEqual(['OPENAI_API_KEY']);
  });
});

describe('저장 정책 (§12.1)', () => {
  it('기본값(세션 메모리)에서는 LocalStorage 에 아무것도 쓰지 않는다', () => {
    store().addSlot('OPENAI_API_KEY', 'sk-secret');
    expect(window.localStorage.getItem(STORAGE_KEYS.secrets)).toBeNull();
  });

  it('"이 브라우저에 저장" 을 켜면 그때부터 남고, 끄면 지워진다', () => {
    store().addSlot('OPENAI_API_KEY', 'sk-secret');
    store().setPersist(true);
    expect(window.localStorage.getItem(STORAGE_KEYS.secrets)).toContain('sk-secret');
    store().setPersist(false);
    expect(window.localStorage.getItem(STORAGE_KEYS.secrets)).toBeNull();
  });

  it('모든 키 삭제는 메모리와 LocalStorage 양쪽을 비운다', () => {
    store().addSlot('OPENAI_API_KEY', 'sk-secret');
    store().setPersist(true);
    store().clearAll();
    expect(store().slots).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.secrets)).toBeNull();
  });
});

describe('저장본 읽기', () => {
  it('슬롯 도입 전 저장본은 기본 슬롯으로 올라온다', () => {
    const slots = readSlots({
      secrets: { OPENAI_API_KEY: 'sk-old', SERPER_API_KEY: '' },
      ollamaHost: 'http://localhost:11434',
    });
    // 값이 빈 항목은 슬롯 자체를 만들지 않는다.
    expect(slots).toEqual([
      { id: 'OPENAI_API_KEY', keyName: 'OPENAI_API_KEY', label: '', value: 'sk-old' },
    ]);
  });

  it('hydrate 는 옛 저장본도 그대로 복원한다 (기존 사용자가 키를 다시 넣지 않도록)', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.secrets,
      JSON.stringify({ secrets: { GROQ_API_KEY: 'gsk_old' }, ollamaHost: 'http://box:11434' }),
    );
    store().hydrate();
    expect(store().headerPayload()).toEqual({ GROQ_API_KEY: 'gsk_old' });
    expect(store().ollamaHost).toBe('http://box:11434');
    expect(store().persist).toBe(true);
  });

  it('알 수 없는 키 이름의 슬롯은 버린다 (수기 편집된 저장본 방어)', () => {
    const slots = readSlots({
      version: 2,
      ollamaHost: '',
      slots: [
        { id: 'X', keyName: 'NOT_A_KEY', label: '', value: 'v' },
        { id: 'OPENAI_API_KEY', keyName: 'OPENAI_API_KEY', label: '', value: 'sk-x' },
      ] as never,
    });
    expect(slots.map((s) => s.id)).toEqual(['OPENAI_API_KEY']);
  });
});

describe('maskKey', () => {
  it('앞 3 · 뒤 4 만 남긴다 (§12.4)', () => {
    expect(maskKey('sk-abcdefghijklmnop')).toBe('sk-...mnop');
    expect(maskKey('short')).toBe('***');
    expect(maskKey('')).toBe('');
  });
});
