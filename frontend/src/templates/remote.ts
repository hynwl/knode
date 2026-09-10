/**
 * `GET /api/v1/templates` (Spec §15.1) — 백엔드가 서빙하는 템플릿 갤러리.
 *
 * 백엔드가 없어도 **열람 가능해야 한다**(§15.1 `MUST`). 그래서 실패/오프라인은
 * 전부 `BUILTIN_TEMPLATES`(프론트 번들)로 흡수한다 — 호출부가 try/catch 를 쓸
 * 필요가 없게 (`lib/backendStatus.ts` 와 같은 방침).
 */

import { BUILTIN_TEMPLATES, type TemplateMeta } from './builtin';
import type { CanvasDoc } from '@/types/canvas';
import { getApiPrefix } from '@/lib/apiBase';

interface WireTemplate {
  id: string;
  name: string;
  description?: string;
  difficulty?: number;
  requires_keys?: string[];
  estimated_cost_usd?: number;
  doc: CanvasDoc;
}

/**
 * 같은 id 의 내장 템플릿이 있으면 **번들 쪽 빌더를 그대로 쓴다.** 백엔드 파일은
 * 어차피 그 빌더로 생성한 스냅샷(`npm run export:templates`)이고, 스냅샷에는
 * `local` 템플릿의 Ollama 모델명이 폴백 값으로 굳어 있기 때문이다 — 프론트는
 * §13.1 자동 감지 결과로 다시 빌드해야 AC-E702 로 실행이 잠기지 않는다.
 * 백엔드에만 있는 항목(향후 커뮤니티 템플릿)은 받은 문서를 그대로 쓴다.
 */
function toMeta(w: WireTemplate): TemplateMeta {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === w.id);
  if (builtin) return builtin;
  return {
    id: w.id,
    name: w.name,
    description: w.description ?? '',
    difficulty: (w.difficulty === 3 ? 3 : w.difficulty === 2 ? 2 : 1),
    requiresKeys: w.requires_keys ?? [],
    estimatedCostUsd: w.estimated_cost_usd ?? 0,
    // 캔버스를 교체할 때마다 원본이 오염되지 않도록 매번 사본을 준다.
    build: () => JSON.parse(JSON.stringify(w.doc)) as CanvasDoc,
  };
}

export async function fetchTemplates(): Promise<TemplateMeta[]> {
  try {
    const res = await fetch(`${getApiPrefix()}/templates`);
    if (!res.ok) return BUILTIN_TEMPLATES;
    const body = await res.json() as { templates?: WireTemplate[] };
    const remote = (body.templates ?? []).filter((t) => t && t.id && t.doc);
    if (!remote.length) return BUILTIN_TEMPLATES;
    const merged = remote.map(toMeta);
    // 백엔드 스냅샷이 누락돼도 번들 템플릿은 절대 사라지지 않는다.
    const seen = new Set(merged.map((t) => t.id));
    for (const t of BUILTIN_TEMPLATES) if (!seen.has(t.id)) merged.push(t);
    return merged;
  } catch {
    return BUILTIN_TEMPLATES;
  }
}
