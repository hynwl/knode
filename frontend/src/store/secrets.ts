'use client';

/**
 * BYOK 시크릿 저장 (Spec §12.1)
 * 기본값은 **세션 메모리**. 사용자가 명시적으로 체크했을 때만 LocalStorage 에 남긴다.
 *
 * ## 키 슬롯
 *
 * 키는 프로바이더당 하나가 아니라 **슬롯** 단위로 등록한다. 같은 프로바이더의
 * 계정을 여러 개 쓰거나(업무용/개인용), `openai_compatible` 처럼 엔드포인트마다
 * 다른 키를 써야 하는 경우가 실제로 있기 때문이다. LLM 노드는 슬롯의 **id 만**
 * (`key_ref`) 참조한다 — 키 값 자체는 절대 노드 데이터에 들어가지 않는다.
 * 노드 데이터는 LocalStorage 자동저장·`.acanvas.json` Export·공유 링크·Export to
 * Python 네 경로로 흘러나가므로, 값이 거기 들어가는 순간 §12.1("`.acanvas.json`
 * 절대 포함 금지")이 깨진다.
 *
 * 기본 슬롯의 id 는 **키 이름과 같은 문자열**(`OPENAI_API_KEY`)이다. 덕분에
 * 헤더 페이로드(`{슬롯 id: 값}`)가 슬롯 도입 전과 동일한 모양이고, 백엔드의
 * 서버 `.env` 폴백 표(`core/secrets.py`)도 그대로 성립한다. 추가 슬롯만
 * `OPENAI_API_KEY#work` 처럼 접미사가 붙는다.
 */

import { create } from 'zustand';
import { readJson, removeKey, STORAGE_KEYS, writeJson } from '@/persistence/localStorage';
import { t } from '@/i18n';

/**
 * Electron 데스크톱 빌드(M6-T6)에서 `desktop/preload.ts`가 심어 주는 OS 키체인
 * 브리지. 존재하면 이 슬롯 저장소는 LocalStorage 대신 이걸 쓴다 — 노드 데이터·
 * `.acanvas.json`에 키 값이 들어가지 않는다는 불변식과는 무관하게, "저장 시
 * 어디에 쓰는가"만 바뀐다. 웹 배포에는 이 값이 없으므로 기존 LocalStorage
 * 경로가 그대로 유지된다.
 */
interface SecretsBridge {
  read(): Promise<unknown>;
  write(payload: unknown): Promise<void>;
  remove(): Promise<void>;
}

declare global {
  interface Window {
    __AGENTCANVAS_SECRETS_BRIDGE__?: SecretsBridge;
  }
}

function secretsBridge(): SecretsBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__AGENTCANVAS_SECRETS_BRIDGE__;
}

export const KEY_NAMES = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'GROQ_API_KEY', 'OPENAI_COMPATIBLE_API_KEY', 'SERPER_API_KEY',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

/** 프로바이더 표시 이름은 i18n 키 (`secrets.<KEY_NAME>`). `keyLabel()` 로 읽는다. */
export const KEY_LABELS: Record<KeyName, { labelKey: string; placeholder: string }> = {
  OPENAI_API_KEY: { labelKey: 'secrets.OPENAI_API_KEY', placeholder: 'sk-...' },
  ANTHROPIC_API_KEY: { labelKey: 'secrets.ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
  GEMINI_API_KEY: { labelKey: 'secrets.GEMINI_API_KEY', placeholder: 'AIza...' },
  GROQ_API_KEY: { labelKey: 'secrets.GROQ_API_KEY', placeholder: 'gsk_...' },
  OPENAI_COMPATIBLE_API_KEY: { labelKey: 'secrets.OPENAI_COMPATIBLE_API_KEY', placeholder: '...' },
  SERPER_API_KEY: { labelKey: 'secrets.SERPER_API_KEY', placeholder: '...' },
};

/** 현재 로케일의 프로바이더 이름. 알 수 없는 키 이름이면 그대로 돌려준다. */
export function keyLabel(name: string): string {
  const meta = KEY_LABELS[name as KeyName];
  return meta ? t(meta.labelKey) : name;
}

export function isKeyName(v: string): v is KeyName {
  return (KEY_NAMES as readonly string[]).includes(v);
}

/**
 * 붙여넣은 키 문자열만으로 어느 프로바이더 키인지 자동 판별한다.
 * 순서가 중요하다: `sk-ant-`는 OpenAI 패턴(`sk-...`)의 부분집합이므로 먼저 검사해야 한다.
 * 판별 불가 시 null — 호출 측에서 수동 선택 UI로 폴백한다 (예: Serper는 고유 프리픽스가 없음).
 *
 * ⚠️ `OPENAI_COMPATIBLE_API_KEY` 는 여기서 절대 나오지 않는다 — 자체 호스팅
 * 엔드포인트의 키는 형식이 제각각이고 `sk-` 를 쓰는 경우도 흔해서 OpenAI 본계정
 * 키와 구분할 수 없다. 그래서 모달은 감지 결과를 **미리 채워 두되 항상 바꿀 수
 * 있는** 선택기로 보여준다.
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

/** 등록된 키 하나. `id` 가 LLM 노드 `key_ref` 와 헤더 페이로드의 키다. */
export interface KeySlot {
  id: string;
  keyName: KeyName;
  /** 사용자가 붙인 별칭. 기본 슬롯은 빈 문자열. */
  label: string;
  value: string;
}

/** 별칭 → id 접미사. 노드 데이터와 공유 링크에 남는 값이라 ASCII 로 좁힌다. */
function slugify(label: string): string {
  return label
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

/**
 * 슬롯 id 생성. 프로바이더의 첫 슬롯은 키 이름 그대로 — 슬롯 도입 전에 저장된
 * 그래프·헤더 페이로드·서버 `.env` 폴백이 전부 이 이름을 전제로 하고 있다.
 */
export function makeSlotId(keyName: KeyName, label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = slugify(label);
  const base = slug ? `${keyName}#${slug}` : keyName;
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = slug ? `${base}-${i}` : `${keyName}#${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${keyName}#${Date.now().toString(36)}`;
}

interface SecretsState {
  slots: KeySlot[];
  persist: boolean;
  ollamaHost: string;
  /** 슬롯을 추가하고 그 id 를 돌려준다. */
  addSlot(keyName: KeyName, value: string, label?: string): string;
  setSlotValue(id: string, value: string): void;
  removeSlot(id: string): void;
  setPersist(v: boolean): void;
  setOllamaHost(v: string): void;
  clearAll(): void;
  hydrate(): void;
  /** 헤더 전송용 `{슬롯 id: 값}`. 값이 있는 것만 담는다. */
  headerPayload(): Record<string, string>;
}

interface StoredSecretsV2 {
  version: 2;
  slots: KeySlot[];
  ollamaHost: string;
}

/** 슬롯 도입 전 모양 (`{secrets: {KEY_NAME: 값}}`). */
interface StoredSecretsV1 {
  secrets: Partial<Record<KeyName, string>>;
  ollamaHost?: string;
}

const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

export const useSecretsStore = create<SecretsState>()((set, get) => ({
  slots: [],
  persist: false,
  ollamaHost: DEFAULT_OLLAMA_HOST,

  addSlot(keyName, value, label = '') {
    const id = makeSlotId(keyName, label, get().slots.map((s) => s.id));
    set((s) => ({ slots: [...s.slots, { id, keyName, label: label.trim(), value }] }));
    if (get().persist) save(get());
    return id;
  },
  setSlotValue(id, value) {
    set((s) => ({ slots: s.slots.map((slot) => (slot.id === id ? { ...slot, value } : slot)) }));
    if (get().persist) save(get());
  },
  removeSlot(id) {
    set((s) => ({ slots: s.slots.filter((slot) => slot.id !== id) }));
    if (get().persist) save(get());
  },
  setPersist(v) {
    set({ persist: v });
    if (v) save(get());
    else clearStorage();
  },
  setOllamaHost(v) {
    set({ ollamaHost: v });
    if (get().persist) save(get());
  },
  clearAll() {
    set({ slots: [] });
    clearStorage();
  },
  hydrate() {
    const bridge = secretsBridge();
    if (bridge) {
      // IPC는 본질적으로 비동기다 — 초기 상태는 빈 슬롯으로 잠깐 렌더되고
      // 응답이 오면 채워진다. 호출부(`app/page.tsx`)도 이미 결과를 기다리지 않는다.
      bridge.read()
        .then((stored) => {
          if (!stored) return;
          const parsed = stored as StoredSecretsV2 | StoredSecretsV1;
          set({
            slots: readSlots(parsed),
            ollamaHost: parsed.ollamaHost || DEFAULT_OLLAMA_HOST,
            persist: true,
          });
        })
        .catch(() => { /* 키체인 접근 실패 — 빈 상태로 시작 */ });
      return;
    }
    const stored = readJson<StoredSecretsV2 | StoredSecretsV1 | null>(STORAGE_KEYS.secrets, null);
    if (!stored) return;
    set({
      slots: readSlots(stored),
      ollamaHost: stored.ollamaHost || DEFAULT_OLLAMA_HOST,
      persist: true,
    });
  },
  headerPayload() {
    const out: Record<string, string> = {};
    for (const slot of get().slots) {
      if (slot.value && slot.value.trim()) out[slot.id] = slot.value;
    }
    return out;
  },
}));

/** 저장본 → 슬롯 배열. v1(프로바이더당 1개) 은 기본 슬롯으로 그대로 올라온다. */
export function readSlots(stored: StoredSecretsV2 | StoredSecretsV1): KeySlot[] {
  if (Array.isArray((stored as StoredSecretsV2).slots)) {
    return (stored as StoredSecretsV2).slots
      .filter((s) => s && typeof s.id === 'string' && isKeyName(String(s.keyName)))
      .map((s) => ({
        id: s.id, keyName: s.keyName as KeyName,
        label: String(s.label ?? ''), value: String(s.value ?? ''),
      }));
  }
  const legacy = (stored as StoredSecretsV1).secrets ?? {};
  return Object.entries(legacy)
    .filter(([name, value]) => isKeyName(name) && Boolean(value))
    .map(([name, value]) => ({
      id: name, keyName: name as KeyName, label: '', value: String(value),
    }));
}

function save(s: SecretsState): void {
  const payload: StoredSecretsV2 = { version: 2, slots: s.slots, ollamaHost: s.ollamaHost };
  const bridge = secretsBridge();
  if (bridge) {
    bridge.write(payload).catch(() => { /* 키체인 저장 실패 — UI를 막지 않는다 */ });
    return;
  }
  try { writeJson(STORAGE_KEYS.secrets, payload); } catch { /* 쿼터 초과는 캔버스 저장에서 이미 알린다 */ }
}

function clearStorage(): void {
  const bridge = secretsBridge();
  if (bridge) {
    bridge.remove().catch(() => { /* 이미 없거나 접근 실패 — 메모리는 이미 비웠다 */ });
    return;
  }
  removeKey(STORAGE_KEYS.secrets);
}

/* ────────────────────────── 파생 조회 ────────────────────────── */

/** 값이 실제로 들어 있는 슬롯만. 빈 슬롯은 "없는 키"로 친다. */
export function filledSlots(slots: KeySlot[]): KeySlot[] {
  return slots.filter((s) => Boolean(s.value && s.value.trim()));
}

/** 특정 프로바이더 키의 슬롯 목록 (LLM 노드 `key_ref` 드롭다운용). */
export function slotsForKey(slots: KeySlot[], keyName: string): KeySlot[] {
  return filledSlots(slots).filter((s) => s.keyName === keyName);
}

/** 슬롯 표시 이름 — 별칭이 있으면 별칭, 없으면 프로바이더 이름. */
export function slotLabel(slot: KeySlot): string {
  return slot.label || keyLabel(slot.keyName);
}

/** 표시용 마스킹 (Spec §12.4) */
export function maskKey(v: string): string {
  if (!v) return '';
  if (v.length <= 8) return '***';
  return `${v.slice(0, 3)}...${v.slice(-4)}`;
}
