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
/**
 * 지금 캔버스가 **어느 커스텀 템플릿에서 왔는지**. Save 가 새로 만들지 덮어쓸지를
 * 이 값 하나로 가른다.
 *
 * 캔버스 문서(`CanvasDoc`)가 아니라 별도 키에 둔다 — 문서에 넣으면 스키마 버전과
 * 백엔드 Pydantic 모델, `.acanvas.json` Export, 공유 링크까지 전부 따라 움직여야
 * 하는데, 이건 **이 브라우저에서만 뜻이 있는 값**이다(커스텀 템플릿 자체가
 * LocalStorage 에만 있다). 남에게 공유한 파일이 받는 쪽의 무관한 템플릿을
 * 가리키게 되는 사고도 이 분리로 아예 생기지 않는다.
 */
const SOURCE_KEY = 'agentcanvas.templates.source.v1';

export interface StoredCustomTemplate {
  id: string;
  name: string;
  description: string;
  doc: CanvasDoc;
  createdAt: string;
  /** 덮어쓴 적이 있으면 그 시각. 최초 저장본에는 없다. */
  updatedAt?: string;
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

/** 지금 캔버스의 출처 커스텀 템플릿 id. 없으면 `null`. */
export function loadSourceTemplateId(): string | null {
  const id = readJson<string | null>(SOURCE_KEY, null);
  // 그 사이에 템플릿이 지워졌을 수 있다 — 없는 id 를 들고 있으면 Save 가 유령을
  // 덮어쓰려 든다. 읽는 쪽에서 항상 실재를 확인한다.
  if (!id || !loadCustomTemplates().some((c) => c.id === id)) return null;
  return id;
}

export function saveSourceTemplateId(id: string | null): void {
  writeJson(SOURCE_KEY, id);
}

export function getCustomTemplate(id: string): StoredCustomTemplate | null {
  return loadCustomTemplates().find((c) => c.id === id) ?? null;
}

/**
 * 이미 저장된 커스텀 템플릿을 현재 캔버스로 **덮어쓴다**.
 *
 * 목록에서의 자리는 그대로 두고(매번 맨 앞으로 튀어 오르면 갤러리가 흔들린다),
 * `createdAt` 도 최초 생성 시각을 유지한다 — "언제 만든 템플릿인가" 가 바뀌면
 * 사용자가 찾던 것을 못 찾는다.
 */
export function updateCustomTemplate(
  id: string, name: string, description: string, doc: CanvasDoc,
): StoredCustomTemplate | null {
  const list = loadCustomTemplates();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const updated: StoredCustomTemplate = {
    ...list[idx]!,
    name,
    description,
    doc: JSON.parse(JSON.stringify(doc)) as CanvasDoc,
    updatedAt: new Date().toISOString(),
  };
  const next = [...list];
  next[idx] = updated;
  saveCustomTemplates(next);
  return updated;
}

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
    // 지운 템플릿을 계속 가리키고 있으면 다음 Save 가 갈 곳이 없다.
    if (readJson<string | null>(SOURCE_KEY, null) === id) saveSourceTemplateId(null);
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
