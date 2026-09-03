import { expect, test } from '@playwright/test';

import { FAKE_OPENAI_KEY, dialog, field, gotoApp, seedCanvas, selectNode, toast } from './helpers';

/**
 * Spec §18 E2E 시나리오 6 `MUST`
 * > 키가 포함된 그래프 Export 시도 → 스캐너 차단 확인
 *
 * `.acanvas.json` 에는 API 키가 **절대** 들어가지 않는다 (§7.4 / AC-S1).
 * Export 는 `persistence/secretScanner.ts::scanForSecrets` 를 통과해야만 하고,
 * 걸리면 `AC-E404` 로 **차단**한다 (Import 는 차단이 아니라 마스킹 — 아래에서 함께 확인).
 */
const GRAPH = [
  { id: 'agent_a', type: 'agent', x: 40, y: 40, data: { name: 'Leaky Agent', role: 'r', goal: 'g', backstory: 'b' } },
  { id: 'crew_a', type: 'crew', x: 380, y: 40, data: { name: 'Crew', process: 'sequential' } },
];

test('노드 필드에 API 키를 넣으면 Export 가 AC-E404 로 차단된다', async ({ page }) => {
  await seedCanvas(page, GRAPH, [], 'Leaky Project');
  await gotoApp(page);

  /* --- 사용자가 실수로 backstory 에 키를 붙여 넣는다 --- */
  await selectNode(page, 'agent_a');
  await field(page, 'backstory').locator('textarea').fill(`My key is ${FAKE_OPENAI_KEY}`);

  /* --- Backup 모달: 차단 배너 + Export 버튼 비활성화 --- */
  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const modal = dialog(page, 'Back up / restore project');
  await expect(modal).toBeVisible();

  await expect(modal).toContainText('AC-E404');
  await expect(modal).toContainText('Export blocked — the graph holds values that look like API keys.');
  // 어느 경로에 걸렸는지 + 마스킹된 미리보기를 보여줘야 사용자가 고칠 수 있다 (§17.4).
  await expect(modal).toContainText('OpenAI');
  await expect(modal).toContainText('backstory');
  // 화면에 원본 키를 그대로 다시 뿌리지 않는다.
  await expect(modal).not.toContainText(FAKE_OPENAI_KEY);

  await expect(modal.getByRole('button', { name: 'Export to file' })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Create share link' })).toBeDisabled();
  // 미리보기(현재 프로젝트 JSON) 도 비워 둬 복사조차 못 하게 한다.
  await expect(modal.locator('textarea').first()).toHaveValue('');
});

test('키를 지우면 Export 가 다시 열린다', async ({ page }) => {
  await seedCanvas(page, GRAPH, [], 'Leaky Project');
  await gotoApp(page);

  await selectNode(page, 'agent_a');
  await field(page, 'backstory').locator('textarea').fill(`My key is ${FAKE_OPENAI_KEY}`);

  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const modal = dialog(page, 'Back up / restore project');
  await expect(modal.getByRole('button', { name: 'Export to file' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await field(page, 'backstory').locator('textarea').fill('No secrets here.');

  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const reopened = dialog(page, 'Back up / restore project');
  await expect(reopened).not.toContainText('AC-E404');
  await expect(reopened.getByRole('button', { name: 'Export to file' })).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    reopened.getByRole('button', { name: 'Export to file' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('leaky-project.acanvas.json');
});

test('키가 든 파일을 Import 하면 차단이 아니라 마스킹 후 고지한다 (§7.4)', async ({ page }) => {
  await seedCanvas(page, GRAPH, [], 'Clean Project');
  await gotoApp(page);

  const dirty = JSON.stringify({
    schema_version: '1.0',
    app_version: '0.1.0',
    id: 'cvs_dirty',
    name: 'Imported Dirty',
    created_at: '2026-09-03T00:00:00Z',
    updated_at: '2026-09-03T00:00:00Z',
    viewport: { x: 40, y: 40, zoom: 1 },
    nodes: [{
      id: 'agent_x', type: 'agent', position: { x: 40, y: 40 },
      data: { name: 'Imported', role: 'r', goal: 'g', backstory: `leaked ${FAKE_OPENAI_KEY}` },
    }],
    edges: [],
    meta: { requires_keys: [] },
  });

  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const modal = dialog(page, 'Back up / restore project');
  await modal.getByPlaceholder('Paste the contents of an exported .acanvas.json…').fill(dirty);
  await modal.getByRole('button', { name: 'Load pasted JSON' }).click();

  // 그래프는 들어오되, 키는 마스킹되고 그 사실을 sticky 토스트로 알린다.
  await expect(toast(page, /masked 1 value/)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  await selectNode(page, 'agent_x');
  const backstory = field(page, 'backstory').locator('textarea');
  await expect(backstory).toHaveValue('leaked ***REDACTED***');
  await expect(backstory).not.toHaveValue(new RegExp(FAKE_OPENAI_KEY));
});
