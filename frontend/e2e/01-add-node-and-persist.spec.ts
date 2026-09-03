import { expect, test } from '@playwright/test';

import { clearCanvas, field, gotoApp, node, openPaneMenu, selectNode } from './helpers';

/**
 * Spec §18 E2E 시나리오 1 `MUST`
 * > 빈 캔버스 → 우클릭 → Agent 추가 → 필드 입력 → 저장 → 새로고침 → 복원 확인
 *
 * "저장" 은 별도 버튼이 아니라 **1초 디바운스 자동 저장**이다 (Spec §14.2 —
 * `store/index.ts::schedulePersist`). 그래서 헤더의 `Saved · …` 표기가 뜨는 것을
 * 저장 완료 신호로 삼고, 그 다음에 새로고침한다.
 */
test('빈 캔버스에 Agent 를 추가하고 값을 채우면 새로고침 후에도 복원된다', async ({ page }) => {
  await clearCanvas(page);
  await gotoApp(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  /* --- 우클릭 → 검색 → Agent 추가 --- */
  const menu = await openPaneMenu(page);
  await expect(menu.getByPlaceholder('Search nodes…')).toBeFocused();
  await menu.getByPlaceholder('Search nodes…').fill('agent');
  await menu.getByRole('menuitem', { name: 'Agent', exact: false }).first().click();

  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const created = await page.locator('.react-flow__node').first().getAttribute('data-id');
  expect(created).toMatch(/^agent_/);
  await expect(node(page, created!)).toHaveAttribute('data-node-type', 'agent');

  /* --- 인스펙터에서 필드 입력 --- */
  // 추가 직후 이미 선택 상태지만, 시나리오대로 "노드를 클릭해 편집" 경로를 탄다.
  await selectNode(page, created!);
  await field(page, 'name').locator('input').fill('E2E Analyst');
  await field(page, 'role').locator('input').fill('Senior QA Analyst');
  await field(page, 'goal').locator('textarea').fill('Prove the canvas survives a reload.');
  await field(page, 'backstory').locator('textarea').fill('Ten years of regression hunting.');

  // 노드 본문에도 즉시 반영된다 (스토어 단일 진실 공급원).
  await expect(node(page, created!)).toContainText('Senior QA Analyst');

  /* --- 자동 저장(디바운스 1초) 완료를 기다린다 --- */
  await expect(page.locator('header')).toContainText(/Saved ·/, { timeout: 15_000 });

  /* --- 새로고침 → 복원 --- */
  await page.reload();
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  const restored = node(page, created!);
  await expect(restored).toBeVisible();
  await expect(restored).toContainText('E2E Analyst');
  await expect(restored).toContainText('Senior QA Analyst');

  await selectNode(page, created!);
  await expect(field(page, 'role').locator('input')).toHaveValue('Senior QA Analyst');
  await expect(field(page, 'goal').locator('textarea')).toHaveValue('Prove the canvas survives a reload.');
  await expect(field(page, 'backstory').locator('textarea')).toHaveValue('Ten years of regression hunting.');
});
