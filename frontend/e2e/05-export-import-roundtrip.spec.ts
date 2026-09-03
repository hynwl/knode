import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { dialog, gotoApp, node, seedCanvas, toast } from './helpers';

/**
 * Spec §18 E2E 시나리오 5 `MUST`
 * > Export → 파일 다운로드 → Import → 그래프 동일성 검증 (라운드트립)
 *
 * 경로는 `persistence/fileIO.ts` 의 `exportDoc`/`downloadDoc` → `importDoc`
 * (마이그레이션 + 시크릿 마스킹 포함) 이다. 여기서는 **실제 브라우저 다운로드**를
 * 받아 파일 내용을 읽고, 그 문자열을 그대로 Restore 칸에 붙여 넣어 복원한다 —
 * 사용자가 다른 머신에서 하는 그대로.
 */
const GRAPH = [
  { id: 'llm_a', type: 'llm', x: 40, y: 40, data: { name: 'Round Trip LLM', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.42 } },
  { id: 'agent_a', type: 'agent', x: 380, y: 40, data: { name: 'Round Trip Agent', role: 'Auditor', goal: 'Verify the round trip.', backstory: 'Byte-for-byte.' } },
  { id: 'task_a', type: 'task', x: 40, y: 320, data: { name: 'Round Trip Task', description: 'Compare before and after.', expected_output: 'Identical JSON.' } },
  { id: 'crew_a', type: 'crew', x: 380, y: 320, data: { name: 'Round Trip Crew', process: 'sequential' } },
];
const EDGES = [
  { source: 'llm_a', sourceHandle: 'llm', target: 'agent_a', targetHandle: 'llm' },
  { source: 'agent_a', sourceHandle: 'agent', target: 'task_a', targetHandle: 'agent' },
  { source: 'agent_a', sourceHandle: 'agent', target: 'crew_a', targetHandle: 'agent' },
  { source: 'task_a', sourceHandle: 'task', target: 'crew_a', targetHandle: 'task' },
];

test('Export 한 .acanvas.json 을 다시 Import 하면 그래프가 동일하다', async ({ page }) => {
  await seedCanvas(page, GRAPH, EDGES, 'Round Trip Project');
  await gotoApp(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);

  /* --- Export: 실제 파일 다운로드를 받는다 --- */
  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const modal = dialog(page, 'Back up / restore project');
  await expect(modal).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Export to file' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('round-trip-project.acanvas.json');

  const path = await download.path();
  const exported = await readFile(path, 'utf-8');
  const parsed = JSON.parse(exported) as {
    schema_version: string; name: string;
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    edges: Array<{ source: string; target: string; targetHandle: string }>;
    meta: { requires_keys: string[] };
  };

  expect(parsed.schema_version).toBe('1.0');
  expect(parsed.name).toBe('Round Trip Project');
  expect(parsed.nodes.map((n) => n.id).sort()).toEqual(['agent_a', 'crew_a', 'llm_a', 'task_a']);
  expect(parsed.edges).toHaveLength(4);
  // 실행에 필요한 키는 파일에 이름만 실린다 (값은 §7.4 로 절대 안 실린다).
  expect(parsed.meta.requires_keys).toEqual(['OPENAI_API_KEY']);
  expect(exported).not.toContain('sk-');

  /* --- 캔버스를 다른 상태로 바꿔 둔다 (복원이 실제로 갈아끼우는지 보려고) --- */
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toHaveCount(0);
  await node(page, 'llm_a').getByRole('button', { name: 'Delete node' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  /* --- Import: 방금 내려받은 파일 내용을 그대로 붙여 넣는다 --- */
  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const restoreModal = dialog(page, 'Back up / restore project');
  await restoreModal.getByPlaceholder('Paste the contents of an exported .acanvas.json…').fill(exported);
  await restoreModal.getByRole('button', { name: 'Load pasted JSON' }).click();

  await expect(toast(page, 'Project restored.')).toBeVisible();
  await expect(restoreModal).toHaveCount(0);

  /* --- 동일성 검증 --- */
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
  for (const id of ['llm_a', 'agent_a', 'task_a', 'crew_a']) {
    await expect(node(page, id)).toBeVisible();
  }
  await expect(node(page, 'agent_a')).toContainText('Round Trip Agent');
  await expect(node(page, 'agent_a')).toContainText('Auditor');
  await expect(node(page, 'llm_a')).toContainText('OPENAI / gpt-4o-mini');

  /* --- 복원된 그래프를 다시 Export 하면 노드/엣지가 바이트 단위로 같다 --- */
  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const again = dialog(page, 'Back up / restore project');
  const [download2] = await Promise.all([
    page.waitForEvent('download'),
    again.getByRole('button', { name: 'Export to file' }).click(),
  ]);
  const reExported = JSON.parse(await readFile(await download2.path(), 'utf-8'));

  // `updated_at` 만 매번 새로 찍힌다 (`fileIO.ts::exportDoc`).
  expect(reExported.nodes).toEqual(parsed.nodes);
  expect(reExported.edges).toEqual(parsed.edges);
  expect(reExported.name).toEqual(parsed.name);
});

test('망가진 JSON 을 Import 하면 AC-E403 으로 거절하고 캔버스를 지키지 않는다', async ({ page }) => {
  await seedCanvas(page, GRAPH, EDGES, 'Round Trip Project');
  await gotoApp(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  await page.getByRole('button', { name: 'Backup / Restore' }).click();
  const modal = dialog(page, 'Back up / restore project');
  await modal.getByPlaceholder('Paste the contents of an exported .acanvas.json…').fill('{ not json');
  await modal.getByRole('button', { name: 'Load pasted JSON' }).click();

  // 에러 토스트는 M4-T9 부터 `role="alert"` 다 (Spec §17.2) — `toast()` 가 둘 다 받는다.
  await expect(toast(page, 'AC-E403')).toBeVisible();
  await expect(modal).toBeVisible(); // 실패하면 모달을 닫지 않는다
});
