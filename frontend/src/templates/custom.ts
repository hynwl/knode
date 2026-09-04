/**
 * 사용자가 만든 커스텀 템플릿 + 숨긴(삭제한) 템플릿 id.
 *
 * 스펙 §15.1의 내장 템플릿과 달리 이 기능은 순수 로컬 확장이다 — 백엔드에
 * 쓰지 않는다(`backend/data/templates/*.acanvas.json`은 `npm run export:templates`
 * 스냅샷 전용이라 여기서 손대지 않는다). "삭제"는 내장 템플릿의 코드 자체를
 * 지우는 게 아니라 이 브라우저의 갤러리 목록에서만 숨긴다 — 그래야 다른 기기/
 * 브라우저에서는 계속 보이고, `localStorage`를 지우면 원래대로 돌아온다.
 */

import { readJson, writeJson } from '@/persistence/localStorage';
import type { TemplateMeta } from './builtin';
import type { CanvasDoc } from '@/types/canvas';
import { requiredKeys } from '@/validation/rules';

const CUSTOM_KEY = 'agentcanvas.templates.custom.v1';
const HIDDEN_KEY = 'agentcanvas.templates.hidden.v1';

export interface StoredCustomTemplate {
  id: string;
  name: string;
  description: string;
  doc: CanvasDoc;
  createdAt: string;
}

export function loadCustomTemplates(): StoredCustomTemplate[] {
  return readJson<StoredCustomTemplate[]>(CUSTOM_KEY, []);
}

function saveCustomTemplates(list: StoredCustomTemplate[]): void {
  writeJson(CUSTOM_KEY, list);
}

export function loadHiddenTemplateIds(): string[] {
  return readJson<string[]>(HIDDEN_KEY, []);
}

function saveHiddenTemplateIds(ids: string[]): void {
  writeJson(HIDDEN_KEY, ids);
}

export const CUSTOM_ID_PREFIX = 'custom_';

/** 현재 캔버스를 새 커스텀 템플릿으로 저장한다. */
export function addCustomTemplate(name: string, description: string, doc: CanvasDoc): StoredCustomTemplate {
  const stored: StoredCustomTemplate = {
    id: `${CUSTOM_ID_PREFIX}${Date.now().toString(36)}`,
    name,
    description,
    // 원본 캔버스가 나중에 바뀌어도 저장된 템플릿은 그 시점 그대로 남아야 한다.
    doc: JSON.parse(JSON.stringify(doc)) as CanvasDoc,
    createdAt: new Date().toISOString(),
  };
  saveCustomTemplates([stored, ...loadCustomTemplates()]);
  return stored;
}

/**
 * 템플릿을 갤러리에서 지운다. 커스텀 템플릿이면 완전히 삭제하고, 내장/백엔드
 * 템플릿이면 숨김 목록에 추가한다(§ 위 문서 코멘트 — 되돌릴 수 있는 숨김).
 */
export function removeTemplate(id: string): void {
  const custom = loadCustomTemplates();
  if (custom.some((c) => c.id === id)) {
    saveCustomTemplates(custom.filter((c) => c.id !== id));
    return;
  }
  const hidden = loadHiddenTemplateIds();
  if (!hidden.includes(id)) saveHiddenTemplateIds([...hidden, id]);
}

function toMeta(c: StoredCustomTemplate): TemplateMeta {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    difficulty: 1,
    requiresKeys: requiredKeys({ nodes: c.doc.nodes, edges: c.doc.edges }),
    estimatedCostUsd: 0,
    build: () => JSON.parse(JSON.stringify(c.doc)) as CanvasDoc,
  };
}

/**
 * 백엔드/내장 템플릿 목록 + 커스텀 템플릿을 합치고, 숨긴 것들을 뺀 최종
 * 갤러리 목록. `TemplatesModal`이 그리는 배열은 항상 이 함수를 거친다.
 */
export function effectiveTemplates(base: TemplateMeta[]): TemplateMeta[] {
  const hidden = new Set(loadHiddenTemplateIds());
  const visible = base.filter((t) => !hidden.has(t.id));
  const custom = loadCustomTemplates().map(toMeta).filter((t) => !hidden.has(t.id));
  return [...visible, ...custom];
}
