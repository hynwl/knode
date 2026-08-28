'use client';

/**
 * BYOK 시크릿 저장 (Spec §12.1)
 * 기본값은 **세션 메모리**. 사용자가 명시적으로 체크했을 때만 LocalStorage 에 남긴다.
 */

import { create } from 'zustand';
import { readJson, removeKey, STORAGE_KEYS, writeJson } from '@/persistence/localStorage';

export const KEY_NAMES = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'GROQ_API_KEY', 'SERPER_API_KEY',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

export const KEY_LABELS: Record<KeyName, { label: string; placeholder: string }> = {
  OPENAI_API_KEY: { label: 'OpenAI', placeholder: 'sk-...' },
  ANTHROPIC_API_KEY: { label: 'Anthropic', placeholder: 'sk-ant-...' },
  GEMINI_API_KEY: { label: 'Google Gemini', placeholder: 'AIza...' },
  GROQ_API_KEY: { label: 'Groq', placeholder: 'gsk_...' },
  SERPER_API_KEY: { label: 'Serper (웹 검색)', placeholder: '...' },
};

interface SecretsState {
  secrets: Partial<Record<KeyName, string>>;
  persist: boolean;
  ollamaHost: string;
  setSecret(k: KeyName, v: string): void;
  setPersist(v: boolean): void;
  setOllamaHost(v: string): void;
  clearAll(): void;
  hydrate(): void;
  /** 헤더 전송용. 값이 있는 것만 담는다. */
  headerPayload(): Record<string, string>;
}

interface StoredSecrets {
  secrets: Partial<Record<KeyName, string>>;
  ollamaHost: string;
}

export const useSecretsStore = create<SecretsState>()((set, get) => ({
  secrets: {},
  persist: false,
  ollamaHost: 'http://localhost:11434',

  setSecret(k, v) {
    set((s) => ({ secrets: { ...s.secrets, [k]: v } }));
    if (get().persist) save(get());
  },
  setPersist(v) {
    set({ persist: v });
    if (v) save(get());
    else removeKey(STORAGE_KEYS.secrets);
  },
  setOllamaHost(v) {
    set({ ollamaHost: v });
    if (get().persist) save(get());
  },
  clearAll() {
    set({ secrets: {} });
    removeKey(STORAGE_KEYS.secrets);
  },
  hydrate() {
    const stored = readJson<StoredSecrets | null>(STORAGE_KEYS.secrets, null);
    if (stored) {
      set({ secrets: stored.secrets ?? {}, ollamaHost: stored.ollamaHost ?? 'http://localhost:11434', persist: true });
    }
  },
  headerPayload() {
    return Object.fromEntries(
      Object.entries(get().secrets).filter(([, v]) => Boolean(v && v.trim())),
    ) as Record<string, string>;
  },
}));

function save(s: SecretsState): void {
  const payload: StoredSecrets = { secrets: s.secrets, ollamaHost: s.ollamaHost };
  try { writeJson(STORAGE_KEYS.secrets, payload); } catch { /* 쿼터 초과는 캔버스 저장에서 이미 알린다 */ }
}

/** 표시용 마스킹 (Spec §12.4) */
export function maskKey(v: string): string {
  if (!v) return '';
  if (v.length <= 8) return '***';
  return `${v.slice(0, 3)}...${v.slice(-4)}`;
}
