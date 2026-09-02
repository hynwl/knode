/** LocalStorage 키 스펙 및 안전한 접근 (Spec §14.1, §14.2) */

import type { CanvasDoc } from '@/types/canvas';
import { t } from '@/i18n';

export const STORAGE_KEYS = {
  workspace: 'agentcanvas.workspace.v1',
  projects: 'agentcanvas.projects.v1',
  secrets: 'agentcanvas.secrets.v1',
  settings: 'agentcanvas.settings.v1',
  inputs: 'agentcanvas.inputs.v1',
  onboarding: 'agentcanvas.onboarding.v1',
} as const;

export class QuotaError extends Error {
  code = 'AC-E405';
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const s = storage();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 저장 실패를 **조용히 넘기지 않는다.** (Spec §14.2 `MUST`)
 * 쿼터 초과면 QuotaError 를 던져 UI 가 정리 모달을 띄우게 한다.
 */
export function writeJson(key: string, value: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      throw new QuotaError(t('storage.quotaExceeded'));
    }
    throw err;
  }
}

export function removeKey(key: string): void {
  storage()?.removeItem(key);
}

/* ---- 워크스페이스 (열려 있는 캔버스) ---- */

export function loadWorkspace(): CanvasDoc | null {
  return readJson<CanvasDoc | null>(STORAGE_KEYS.workspace, null);
}

export function saveWorkspace(doc: CanvasDoc): void {
  writeJson(STORAGE_KEYS.workspace, doc);
}

/* ---- 저장된 프로젝트 목록 (최대 50개) ---- */

export interface ProjectEntry {
  id: string;
  name: string;
  updated_at: string;
  doc: CanvasDoc;
}

export const MAX_PROJECTS = 50;

export function loadProjects(): ProjectEntry[] {
  return readJson<ProjectEntry[]>(STORAGE_KEYS.projects, []);
}

export function saveProjects(list: ProjectEntry[]): void {
  const trimmed = [...list]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, MAX_PROJECTS);
  writeJson(STORAGE_KEYS.projects, trimmed);
}

/* ---- 실행 입력값 프리필 (Spec §5.8-5) ---- */

export function loadLastInputs(canvasId: string): Record<string, string> {
  return readJson<Record<string, Record<string, string>>>(STORAGE_KEYS.inputs, {})[canvasId] ?? {};
}

export function saveLastInputs(canvasId: string, inputs: Record<string, string>): void {
  const all = readJson<Record<string, Record<string, string>>>(STORAGE_KEYS.inputs, {});
  all[canvasId] = inputs;
  writeJson(STORAGE_KEYS.inputs, all);
}

/** 디바운스 유틸 — 자동 저장 1초 (Spec §14.2) */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => { if (t) clearTimeout(t); };
  wrapped.flush = (...args: A) => { if (t) clearTimeout(t); fn(...args); };
  return wrapped;
}
