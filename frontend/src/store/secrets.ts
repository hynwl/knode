'use client';

/**
 * BYOK 시크릿 저장 (Spec §12.1)
 * 기본값은 **세션 메모리**. 사용자가 명시적으로 체크했을 때만 LocalStorage 에 남긴다.
 */

import { create } from 'zustand';
import { readJson, removeKey, STORAGE_KEYS, writeJson } from '@/persistence/localStorage';
import { t } from '@/i18n';

export const KEY_NAMES = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'GROQ_API_KEY', 'SERPER_API_KEY',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

/** 프로바이더 표시 이름은 i18n 키 (`secrets.<KEY_NAME>`). `keyLabel()` 로 읽는다. */
export const KEY_LABELS: Record<KeyName, { labelKey: string; placeholder: string }> = {
  OPENAI_API_KEY: { labelKey: 'secrets.OPENAI_API_KEY', placeholder: 'sk-...' },
  ANTHROPIC_API_KEY: { labelKey: 'secrets.ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
  GEMINI_API_KEY: { labelKey: 'secrets.GEMINI_API_KEY', placeholder: 'AIza...' },
  GROQ_API_KEY: { labelKey: 'secrets.GROQ_API_KEY', placeholder: 'gsk_...' },
  SERPER_API_KEY: { labelKey: 'secrets.SERPER_API_KEY', placeholder: '...' },
};

/** 현재 로케일의 프로바이더 이름. 알 수 없는 키 이름이면 그대로 돌려준다. */
export function keyLabel(name: string): string {
  const meta = KEY_LABELS[name as KeyName];
  return meta ? t(meta.labelKey) : name;
}

/**
 * 붙여넣은 키 문자열만으로 어느 프로바이더 키인지 자동 판별한다.
 * 순서가 중요하다: `sk-ant-`는 OpenAI 패턴(`sk-...`)의 부분집합이므로 먼저 검사해야 한다.
 * 판별 불가 시 null — 호출 측에서 수동 선택 UI로 폴백한다 (예: Serper는 고유 프리픽스가 없음).
 */
const DETECT_RULES: Array<{ key: KeyName; re: RegExp }> = [
  { key: 'ANTHROPIC_API_KEY', re: /^sk-ant-[a-zA-Z0-9_-]{20,}$/ },
  { key: 'OPENAI_API_KEY', re: /^sk-[a-zA-Z0-9_-]{20,}$/ },
  { key: 'GEMINI_API_KEY', re: /^AIza[0-9A-Za-z\-_]{35}$/ },
  { key: 'GROQ_API_KEY', re: /^gsk_[a-zA-Z0-9]{20,}$/ },
];

export function detectKeyName(raw: string): KeyName | null {
  const v = raw.trim();
  if (!v) return null;
  for (const { key, re } of DETECT_RULES) if (re.test(v)) return key;
  return null;
}

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
