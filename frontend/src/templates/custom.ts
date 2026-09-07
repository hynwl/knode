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

/**
 * 지금 캔버스의 출처 템플릿 id. 없으면 `null`.
 *
 * 커스텀 템플릿뿐 아니라 **내장/백엔드 템플릿 id** 도 들어온다 — 워드처럼
 * "연 것을 그대로 저장" 하려면 출처가 커스텀인지 아닌지를 가리면 안 된다.
 * 내장 템플릿엔 저장본이 아직 없을 수 있으므로(첫 덮어쓰기 전) 실재 확인은
 * `custom_` id 에만 적용하고, 나머지는 호출부가 갤러리 목록으로 검증한다.
 */
export function loadSourceTemplateId(): string | null {
  const id = readJson<string | null>(SOURCE_KEY, null);
  if (!id) return null;
  // 지운(=숨긴) 템플릿을 계속 가리키면 Save 가 유령을 되살린다.
  if (loadHiddenTemplateIds().includes(id)) return null;
  if (id.startsWith(CUSTOM_ID_PREFIX) && !loadCustomTemplates().some((c) => c.id === id)) return null;
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

/**
 * **갤러리에 이미 있는 템플릿을 현재 캔버스로 덮어쓴다** (워드의 "저장").
 *
 * 커스텀 템플릿이면 그 자리에서 갱신하고, 내장/백엔드 템플릿이면 같은 id 로
 * **이 브라우저 한정 덮어쓰기 사본**을 만든다 — `effectiveTemplates` 가 id 로
 * 원본 자리에 겹쳐 놓으므로 갤러리에 사본이 하나 더 생기지 않고, 그 사본을
 * 지우면 원본 내장 템플릿이 그대로 돌아온다(코드에 있는 것은 건드릴 수 없다).
 */
export function overwriteTemplate(
  id: string, name: string, description: string, doc: CanvasDoc,
): StoredCustomTemplate {
  const updated = updateCustomTemplate(id, name, description, doc);
  if (updated) return updated;
  const now = new Date().toISOString();
  const stored: StoredCustomTemplate = {
    id,
    name,
    description,
    doc: JSON.parse(JSON.stringify(doc)) as CanvasDoc,
    createdAt: now,
    updatedAt: now,
  };
  saveCustomTemplates([stored, ...loadCustomTemplates()]);
  return stored;
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
  const stored = custom.some((c) => c.id === id);
  if (stored) {
    saveCustomTemplates(custom.filter((c) => c.id !== id));
    // 지운 템플릿을 계속 가리키고 있으면 다음 Save 가 갈 곳이 없다.
    if (readJson<string | null>(SOURCE_KEY, null) === id) saveSourceTemplateId(null);
    // 내장 템플릿의 덮어쓰기 사본(`custom_` 이 아닌 id)이었다면 저장본만 지웠을 뿐
    // 원본은 그대로 갤러리에 남는다 — 사용자는 "지웠는데 왜 있냐" 로 읽는다.
    if (id.startsWith(CUSTOM_ID_PREFIX)) return;
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
  const stored = new Map(loadCustomTemplates().map((c) => [c.id, toMeta(c)]));
  // 내장 템플릿을 덮어쓴 저장본은 **원본 자리에서 원본을 대신한다** — 뒤에 덧붙이면
  // 같은 템플릿이 갤러리에 두 번 뜬다. 난이도·예상 비용은 저장본이 알 수 없는
  // 값이라(`toMeta` 가 1/0 으로 채운다) 원본 것을 그대로 물려준다.
  const visible = base.filter((t) => !hidden.has(t.id)).map((t) => {
    const override = stored.get(t.id);
    return override
      ? { ...override, difficulty: t.difficulty, estimatedCostUsd: t.estimatedCostUsd }
      : t;
  });
  const baseIds = new Set(base.map((t) => t.id));
  const custom = [...stored.values()].filter((t) => !baseIds.has(t.id) && !hidden.has(t.id));
  return [...visible, ...custom];
}
