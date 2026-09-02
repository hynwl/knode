/**
 * 내장 템플릿(Spec §15.1) 스냅샷 생성기 — `npm run export:templates`
 *
 * 드리프트 방지: 템플릿의 단일 진실 공급원은 `src/templates/builtin.ts` 의
 * `Builder` 다. 백엔드가 서빙하는 `backend/app/data/templates/*.acanvas.json` 은
 * **손으로 쓰지 않고** 이 스크립트로 떨어뜨린다. (`docs/CREWAI_RECON.md` 를 SSoT 로
 * 두고 나머지를 거기서 파생시키는 것과 같은 관례.)
 *
 * ⚠️ `local` 템플릿은 원래 `build(ollamaModels)` 로 **이 머신에 설치된** 모델을
 * 받는다(§13.1). 백엔드 스냅샷은 인자 없이 만들어 기본 폴백 모델명이 들어가며,
 * 프론트에서 실제로 로드할 때는 런타임 감지 결과로 다시 빌드된다.
 */

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../backend/app/data/templates');

/** 재실행해도 바이트가 같아야 diff 가 조용하다 — 시각은 고정값으로 덮어쓴다. */
const FROZEN_AT = '2026-01-01T00:00:00.000Z';

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.acanvas.json')) unlinkSync(join(outDir, f));
}

for (const tpl of BUILTIN_TEMPLATES) {
  const doc = tpl.build();
  doc.created_at = FROZEN_AT;
  doc.updated_at = FROZEN_AT;
  doc.meta = {
    ...doc.meta,
    requires_keys: tpl.requiresKeys,
    estimated_cost_usd: tpl.estimatedCostUsd,
    difficulty: tpl.difficulty,
  };
  const path = join(outDir, `${tpl.id}.acanvas.json`);
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.log(`✓ ${tpl.id} — 노드 ${doc.nodes.length} / 엣지 ${doc.edges.length} → ${path}`);
}

console.log(`\n템플릿 ${BUILTIN_TEMPLATES.length}종을 내보냈습니다.`);
