import { expect, test } from '@playwright/test';

import { dialog, gotoApp, HUB, toast, type HubFixtureTeam } from './helpers';

/**
 * M5-T7 (WORK_PLAN §5.6 P1) — 갤러리 모달의 "Hub" 탭.
 *
 * 두 가지를 확인한다:
 *  1. 레지스트리가 없거나 조회에 실패하면(테스트 하네스 기본값 — `helpers.ts::stubBackend`
 *     가 `${HUB}/index.json` 을 404 로 막아 둔다) 탭 자체가 렌더되지 않는다(P-D3).
 *  2. 레지스트리에 팀이 있으면 목록을 보고 "Fork" 로 실제 그래프를 받아와 **새** 로컬
 *     캔버스로 만든다 — 원본 계보(`forked_from`)를 기록하되 문서 id 는 새로 발급하고
 *     `revision`/`license` 는 로컬 문서 기본값으로 되돌린다(`store/index.ts::emptyDoc`
 *     과 같은 결).
 */

const FIXTURE: HubFixtureTeam = {
  slug: 'fixture-research-duo',
  id: 'cvs_hub_fixture_a',
  name: 'Fixture Research Duo',
  description: 'Two agents, one report.',
  author: 'octocat',
  requiresKeys: ['OPENAI_API_KEY'],
  doc: {
    schema_version: '1.0',
    app_version: '0.1.0',
    id: 'cvs_hub_fixture_a',
    name: 'Fixture Research Duo',
    description: 'Two agents, one report.',
    tags: ['research'],
    author: 'octocat',
    license: 'MIT',
    revision: 3,
    forked_from: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: 'agent_1', type: 'agent', position: { x: 40, y: 40 }, width: null, height: null,
        data: {}, ui: { collapsed: false, pinned: false, bypassed: false, colorOverride: null },
        parentNode: null, extent: null,
      },
      {
        id: 'task_2', type: 'task', position: { x: 340, y: 40 }, width: null, height: null,
        data: {}, ui: { collapsed: false, pinned: false, bypassed: false, colorOverride: null },
        parentNode: null, extent: null,
      },
    ],
    edges: [],
    meta: { requires_keys: ['OPENAI_API_KEY'] },
  },
};

test('레지스트리가 없으면(기본 상태) Hub 탭이 렌더되지 않는다', async ({ page }) => {
  await gotoApp(page);
  await page.getByRole('button', { name: 'Templates' }).click();
  const gallery = dialog(page, 'Template gallery');
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('tab', { name: 'Hub' })).toHaveCount(0);
});

test('Hub 탭에서 팀을 Fork 하면 새 로컬 캔버스로 열리고 forked_from 이 기록된다', async ({ page }) => {
  await gotoApp(page, { hubTeams: [FIXTURE] });

  await page.getByRole('button', { name: 'Templates' }).click();
  const gallery = dialog(page, 'Template gallery');
  await expect(gallery).toBeVisible();

  await gallery.getByRole('tab', { name: 'Hub' }).click();
  await expect(gallery.getByText(FIXTURE.name)).toBeVisible();
  await expect(gallery.getByText('by octocat')).toBeVisible();

  await gallery.getByRole('button', { name: 'Fork' }).click();
  await expect(gallery).toHaveCount(0);
  await expect(toast(page, /Forked "Fixture Research Duo"/)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  await expect(page.locator('header')).toContainText(/Saved ·/, { timeout: 15_000 });
  const stored = await page.evaluate(() => window.localStorage.getItem('knode.workspace.v1'));
  const workspace = JSON.parse(stored ?? '{}') as {
    id: string; license: string | null;
    forked_from: { id: string; revision: number; source: string; name: string } | null;
  };
  expect(workspace.id).not.toBe(FIXTURE.id); // 원본과 다른 새 로컬 id 를 발급받았다
  expect(workspace.license).toBeNull(); // 재게시 여부는 아직 사용자가 정하지 않았다 (P-D4)
  expect(workspace.forked_from).toEqual({
    id: FIXTURE.id, revision: 0, source: HUB, name: FIXTURE.name,
  });
});
