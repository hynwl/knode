import { expect, test } from '@playwright/test';
import { dragSocket, edgeCount, gotoApp, seedCanvas, toast } from './helpers';

test('smoke: 소켓 드래그로 연결이 만들어지는가', async ({ page }) => {
  await seedCanvas(page, [
    { id: 'llm_a', type: 'llm', x: 40, y: 60, data: { name: 'L', provider: 'openai', model: 'gpt-4o-mini' } },
    { id: 'agent_a', type: 'agent', x: 380, y: 60, data: { name: 'A', role: 'r', goal: 'g', backstory: 'b' } },
  ]);
  await gotoApp(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(await edgeCount(page)).toBe(0);

  await dragSocket(page, { node: 'llm_a', handle: 'llm' }, { node: 'agent_a', handle: 'llm' });
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('smoke: 비호환 드래그는 차단 + 토스트', async ({ page }) => {
  await seedCanvas(page, [
    { id: 'llm_a', type: 'llm', x: 40, y: 60, data: { name: 'L' } },
    { id: 'agent_a', type: 'agent', x: 380, y: 60, data: { name: 'A' } },
  ]);
  await gotoApp(page);
  await dragSocket(page, { node: 'llm_a', handle: 'llm' }, { node: 'agent_a', handle: 'tool' });
  await page.waitForTimeout(600);
  await expect(toast(page, /Incompatible/i)).toBeVisible();
});
