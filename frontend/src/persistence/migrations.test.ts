/**
 * 스키마 마이그레이션 픽스처 테스트 (Spec §18 `MUST`)
 *
 * > 마이그레이션 | Vitest | 버전별 픽스처 → 최신 스키마 변환
 *
 * 현재 `CURRENT_SCHEMA_VERSION` 은 `'1.0'` 하나뿐이라 `MIGRATIONS` 배열이 비어 있다.
 * 그래도 **변환 기계 자체**는 지금 검증해 둔다 — 첫 마이그레이션을 추가하는 사람이
 * 그때서야 체인 로직을 처음 돌려보는 상황을 만들지 않기 위해서다. 아래
 * `withMigrations()` 가 임시 스텝을 끼워 넣어 다단계 체인·순서·에러 경로를 모두
 * 태운다 (`migrations.ts` 의 "각 스텝마다 픽스처 테스트를 둔다" 주석이 요구하는 것).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, DEFAULT_NODE_UI, type CanvasDoc } from '@/types/canvas';
import { getTemplate } from '@/templates/builtin';
import { AcanvasError, MIGRATIONS, migrate, normalizeDoc } from './migrations';

/* ────────────────────────── 픽스처 ────────────────────────── */

/** v1.0 최소 문서 — 필수 필드만 채운 "손으로 쓴 파일" 수준. */
function minimalV1(): Record<string, unknown> {
  return {
    schema_version: '1.0',
    id: 'cvs_min',
    name: 'Minimal',
    nodes: [{ id: 'crew_1', type: 'crew', position: { x: 10, y: 20 }, data: { name: 'C' } }],
    edges: [],
  };
}

/** v1.0 완전 문서 — 앱이 실제로 내보내는 형태. */
function fullV1(): CanvasDoc {
  return getTemplate('hello')!.build();
}

/** 임시 마이그레이션 스텝을 끼워 넣고 테스트가 끝나면 되돌린다. */
const originalMigrations = [...MIGRATIONS];
afterEach(() => {
  MIGRATIONS.splice(0, MIGRATIONS.length, ...originalMigrations);
});

function withMigrations(steps: typeof MIGRATIONS): void {
  MIGRATIONS.splice(0, MIGRATIONS.length, ...steps);
}

/* ────────────────────────── 현재 버전 통과 ────────────────────────── */

describe('migrate — 최신 버전 문서', () => {
  it('v1.0 문서는 스텝 없이 정규화만 거쳐 나온다', () => {
    const doc = migrate(minimalV1());
    expect(doc.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]!.id).toBe('crew_1');
    expect(doc.nodes[0]!.position).toEqual({ x: 10, y: 20 });
  });

  it('앱이 내보낸 완전한 문서는 노드/엣지가 그대로 살아남는다 (라운드트립)', () => {
    const source = fullV1();
    const restored = migrate(JSON.parse(JSON.stringify(source)));
    expect(restored.nodes).toEqual(source.nodes);
    expect(restored.edges).toEqual(source.edges);
    expect(restored.name).toBe(source.name);
    expect(restored.id).toBe(source.id);
    expect(restored.viewport).toEqual(source.viewport);
  });

  it('schema_version 이 아예 없는 파일은 1.0 으로 간주한다', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 의도적으로 필드를 뺀다
    const { schema_version: _drop, ...noVersion } = minimalV1();
    expect(migrate(noVersion).schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });
});

/* ────────────────────────── 누락 필드 보정 ────────────────────────── */

describe('normalizeDoc — 구버전/수기 편집 파일 보정', () => {
  it('노드의 ui/parentNode/extent/width/height 를 기본값으로 채운다', () => {
    const doc = migrate(minimalV1());
    const n = doc.nodes[0]!;
    expect(n.ui).toEqual(DEFAULT_NODE_UI);
    expect(n.parentNode).toBeNull();
    expect(n.extent).toBeNull();
    expect(n.width).toBeNull();
    expect(n.height).toBeNull();
    expect(n.data).toEqual({ name: 'C' });
  });

  it('부분적으로만 적힌 ui 는 기본값과 병합된다 (덮어쓰기 아님)', () => {
    const raw = minimalV1();
    (raw.nodes as Record<string, unknown>[])[0]!.ui = { collapsed: true };
    const n = migrate(raw).nodes[0]!;
    expect(n.ui).toEqual({ ...DEFAULT_NODE_UI, collapsed: true });
  });

  it('엣지의 핸들 누락은 빈 문자열로, type 은 acanvas 로 고정된다', () => {
    const raw = minimalV1();
    raw.nodes = [
      { id: 'a', type: 'task', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'task', position: { x: 0, y: 0 }, data: {} },
    ];
    raw.edges = [{ id: 'e1', source: 'a', target: 'b', type: 'default' }];
    const e = migrate(raw).edges[0]!;
    expect(e).toMatchObject({ id: 'e1', source: 'a', target: 'b', sourceHandle: '', targetHandle: '', type: 'acanvas' });
  });

  it('viewport / meta / 서술 필드가 없으면 안전한 기본값이 들어간다', () => {
    const doc = migrate(minimalV1());
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc.meta).toEqual({
      requires_keys: [], estimated_cost_usd: null, estimated_duration_s: null, thumbnail: null,
    });
    expect(doc.description).toBe('');
    expect(doc.tags).toEqual([]);
    expect(doc.author).toBe('anonymous');
    expect(doc.app_version).toBe('0.1.0');
  });

  it('이름이 없으면 Untitled Crew, id 가 없으면 새로 만든다', () => {
    const doc = normalizeDoc({ nodes: [], edges: [] });
    expect(doc.name).toBe('Untitled Crew');
    expect(doc.id).toMatch(/^cvs_/);
  });

  it('nodes/edges 가 배열이 아니면 빈 배열로 떨어진다', () => {
    const doc = normalizeDoc({ nodes: null, edges: 'nope' });
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });

  it('created_at/updated_at 이 없으면 ISO 타임스탬프가 채워진다', () => {
    const doc = normalizeDoc({ nodes: [], edges: [] });
    expect(() => new Date(doc.created_at).toISOString()).not.toThrow();
    expect(Number.isNaN(Date.parse(doc.updated_at))).toBe(false);
  });
});

/* ────────────────────────── 에러 경로 ────────────────────────── */

describe('migrate — 에러 코드', () => {
  it('객체가 아니면 AC-E403', () => {
    for (const bad of [null, undefined, 'string', 42, true]) {
      expect(() => migrate(bad)).toThrow(AcanvasError);
      try { migrate(bad); } catch (e) { expect((e as AcanvasError).code).toBe('AC-E403'); }
    }
  });

  it('id/type 이 없는 노드가 섞여 있으면 AC-E403', () => {
    const raw = minimalV1();
    raw.nodes = [{ id: 'ok', type: 'crew', position: { x: 0, y: 0 }, data: {} }, { position: { x: 0, y: 0 } }];
    expect(() => migrate(raw)).toThrow(/AC-E403|스키마|형식/);
    try { migrate(raw); } catch (e) { expect((e as AcanvasError).code).toBe('AC-E403'); }
  });

  it('미래 버전(앱보다 최신)은 AC-E402 로 거부한다', () => {
    const raw = { ...minimalV1(), schema_version: '2.0' };
    try {
      migrate(raw);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AcanvasError).code).toBe('AC-E402');
    }
  });

  it('마이그레이션 경로가 없는 과거 버전은 AC-E401 이고 메시지에 버전이 실린다', () => {
    const raw = { ...minimalV1(), schema_version: '0.9' };
    try {
      migrate(raw);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AcanvasError).code).toBe('AC-E401');
      expect((e as AcanvasError).message).toContain('0.9');
    }
  });
});

/* ────────────────────── 버전 비교 (스텝 선택 규칙) ────────────────────── */

describe('버전 비교', () => {
  it('자릿수가 달라도 숫자로 비교한다 — 1.10 은 1.9 보다 크다', () => {
    withMigrations([]);
    // 1.10 > 1.0 이므로 "미래 버전" 으로 거부돼야 한다.
    try { migrate({ ...minimalV1(), schema_version: '1.10' }); } catch (e) {
      expect((e as AcanvasError).code).toBe('AC-E402');
    }
    // 0.9 < 1.0 이므로 "경로 없음" 이다 (미래 버전 아님).
    try { migrate({ ...minimalV1(), schema_version: '0.9' }); } catch (e) {
      expect((e as AcanvasError).code).toBe('AC-E401');
    }
  });

  it('1.0 과 1.0.0 은 같은 버전으로 본다', () => {
    // 뒷자리가 없으면 0 으로 채워 비교하므로 "미래 버전" 이 아니다.
    // 다만 문자열이 다르니 마이그레이션 스텝을 찾다가 AC-E401 로 떨어진다.
    try {
      migrate({ ...minimalV1(), schema_version: '1.0.0' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AcanvasError).code).toBe('AC-E401');
    }
  });
});

/* ────────────────────── 마이그레이션 체인 (미래 대비) ────────────────────── */

describe('MIGRATIONS 체인', () => {
  it('현재 릴리스에는 스텝이 없다 (1.0 이 최초 스키마)', () => {
    expect(originalMigrations).toEqual([]);
    expect(CURRENT_SCHEMA_VERSION).toBe('1.0');
  });

  it('단일 스텝: 0.9 → 1.0 픽스처가 최신 스키마로 변환된다', () => {
    withMigrations([
      {
        from: '0.9',
        to: '1.0',
        // 0.9 는 노드 데이터가 `props` 였다고 가정한 가상의 스텝.
        fn: (doc) => ({
          ...doc,
          nodes: (doc.nodes as Record<string, unknown>[]).map((n) => ({
            id: n.id, type: n.type, position: n.position, data: n.props,
          })),
        }),
      },
    ]);

    const legacy = {
      schema_version: '0.9',
      id: 'cvs_legacy',
      name: 'Legacy',
      nodes: [{ id: 'agent_1', type: 'agent', position: { x: 1, y: 2 }, props: { role: 'r' } }],
      edges: [],
    };
    const doc = migrate(legacy);
    expect(doc.schema_version).toBe('1.0');
    expect(doc.nodes[0]!.data).toEqual({ role: 'r' });
    expect(doc.nodes[0]!.ui).toEqual(DEFAULT_NODE_UI);
  });

  it('다단계 스텝: 0.8 → 0.9 → 1.0 을 순서대로 통과한다', () => {
    const trail: string[] = [];
    withMigrations([
      { from: '0.9', to: '1.0', fn: (d) => { trail.push('0.9→1.0'); return { ...d, name: `${d.name}!` }; } },
      { from: '0.8', to: '0.9', fn: (d) => { trail.push('0.8→0.9'); return { ...d, name: `${d.name}?` }; } },
    ]);

    const doc = migrate({ ...minimalV1(), schema_version: '0.8', name: 'X' });
    // 배열 순서가 아니라 `from` 매칭으로 체인이 이어져야 한다.
    expect(trail).toEqual(['0.8→0.9', '0.9→1.0']);
    expect(doc.name).toBe('X?!');
    expect(doc.schema_version).toBe('1.0');
  });

  it('체인 중간에 경로가 끊기면 AC-E401 로 멈춘다', () => {
    withMigrations([
      { from: '0.8', to: '0.9', fn: (d) => d },
      // 0.9 → 1.0 이 없다.
    ]);
    try {
      migrate({ ...minimalV1(), schema_version: '0.8' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AcanvasError).code).toBe('AC-E401');
      expect((e as AcanvasError).message).toContain('0.9');
    }
  });

  it('스텝은 순수 함수여야 한다 — 원본 입력을 건드리지 않는다', () => {
    withMigrations([{ from: '0.9', to: '1.0', fn: (d) => ({ ...d, name: 'renamed' }) }]);
    const legacy = { ...minimalV1(), schema_version: '0.9', name: 'original' };
    const snapshot = JSON.parse(JSON.stringify(legacy));
    migrate(legacy);
    expect(legacy).toEqual(snapshot);
  });
});
