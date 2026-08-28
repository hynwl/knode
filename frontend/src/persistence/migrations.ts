/** 스키마 버전 마이그레이션 (Spec §7.5) */

import { CURRENT_SCHEMA_VERSION, DEFAULT_NODE_UI, type CanvasDoc } from '@/types/canvas';
import { issue } from '@/validation/issues';

export class AcanvasError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'AcanvasError';
  }
}

type MigrationFn = (doc: Record<string, unknown>) => Record<string, unknown>;

interface MigrationStep { from: string; to: string; fn: MigrationFn; }

/** 새 버전을 낼 때 여기에 순수 함수를 추가한다. 각 스텝마다 픽스처 테스트를 둔다. */
export const MIGRATIONS: MigrationStep[] = [
  // 예시: { from: '1.0', to: '1.1', fn: (doc) => doc },
];

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function migrate(input: unknown): CanvasDoc {
  if (!input || typeof input !== 'object') {
    throw new AcanvasError('AC-E403', issue('AC-E403').message);
  }
  let doc = input as Record<string, unknown>;
  let cur = String(doc.schema_version ?? '1.0');

  if (compareVersions(cur, CURRENT_SCHEMA_VERSION) > 0) {
    throw new AcanvasError('AC-E402', issue('AC-E402').message);
  }

  while (cur !== CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === cur);
    if (!step) throw new AcanvasError('AC-E401', `${issue('AC-E401').message}: ${cur}`);
    doc = step.fn(doc);
    cur = step.to;
    doc.schema_version = cur;
  }
  return normalizeDoc(doc);
}

/** 누락 필드 보정 — 구버전/수기 편집 파일도 열려야 한다. */
export function normalizeDoc(doc: Record<string, unknown>): CanvasDoc {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const edges = Array.isArray(doc.edges) ? doc.edges : [];
  if (!nodes.every((n) => n && typeof n === 'object' && 'id' in n && 'type' in n)) {
    throw new AcanvasError('AC-E403', issue('AC-E403').message);
  }
  const now = new Date().toISOString();
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    app_version: String(doc.app_version ?? '0.1.0'),
    id: String(doc.id ?? `cvs_${Math.random().toString(36).slice(2, 12)}`),
    name: String(doc.name ?? 'Untitled Crew'),
    description: typeof doc.description === 'string' ? doc.description : '',
    tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
    author: String(doc.author ?? 'anonymous'),
    created_at: String(doc.created_at ?? now),
    updated_at: String(doc.updated_at ?? now),
    viewport: (doc.viewport as CanvasDoc['viewport']) ?? { x: 0, y: 0, zoom: 1 },
    nodes: nodes.map((n) => {
      const node = n as Record<string, unknown>;
      return {
        id: String(node.id),
        type: node.type as CanvasDoc['nodes'][number]['type'],
        position: (node.position as { x: number; y: number }) ?? { x: 0, y: 0 },
        width: (node.width as number | null) ?? null,
        height: (node.height as number | null) ?? null,
        data: (node.data as Record<string, unknown>) ?? {},
        ui: { ...DEFAULT_NODE_UI, ...((node.ui as object) ?? {}) },
        parentNode: (node.parentNode as string | null) ?? null,
        extent: (node.extent as 'parent' | null) ?? null,
      };
    }),
    edges: edges.map((e) => {
      const edge = e as Record<string, unknown>;
      return {
        id: String(edge.id),
        source: String(edge.source),
        sourceHandle: String(edge.sourceHandle ?? ''),
        target: String(edge.target),
        targetHandle: String(edge.targetHandle ?? ''),
        type: 'acanvas',
        data: (edge.data as { port_type: string }) ?? undefined,
      };
    }),
    meta: {
      requires_keys: (doc.meta as { requires_keys?: string[] })?.requires_keys ?? [],
      estimated_cost_usd: (doc.meta as { estimated_cost_usd?: number })?.estimated_cost_usd ?? null,
      estimated_duration_s: (doc.meta as { estimated_duration_s?: number })?.estimated_duration_s ?? null,
      thumbnail: null,
    },
  };
}
