import { expect, test } from '@playwright/test';

import { dragSocket, gotoApp, seedCanvas, toast } from './helpers';

/**
 * Spec §18 E2E 시나리오 4 `MUST`
 * > context 사이클 연결 시도 → 차단 + 토스트 확인
 *
 * 사이클 판정은 **`context` 타입 엣지에만** 적용된다 (§6.5) — Agent 하나를 여러
 * Task 가 공유하는 것 같은 정상 그래프까지 막으면 안 되기 때문이다.
 * 판정 함수는 `validation/rules.ts::wouldCreateCycle`, 호출부는 `store::connect`.
 */
test.beforeEach(async ({ page }) => {
  await seedCanvas(
    page,
    [
      { id: 'task_a', type: 'task', x: 40, y: 40, data: { name: 'A', description: 'a', expected_output: 'a' } },
      { id: 'task_b', type: 'task', x: 380, y: 40, data: { name: 'B', description: 'b', expected_output: 'b' } },
      // ⚠️ x 는 560 을 넘기지 않는다 — 캔버스 가용 폭은 1440 − 라이브러리 256 − 인스펙터 300
      // = 884px 이라, 더 오른쪽에 두면 소켓이 인스펙터 패널 뒤로 들어가 드래그가 안 잡힌다.
      { id: 'task_c', type: 'task', x: 40, y: 340, data: { name: 'C', description: 'c', expected_output: 'c' } },
    ],
    // A → B 는 미리 이어 둔다. 남은 두 손으로 사이클을 만들어 본다.
    [{ source: 'task_a', sourceHandle: 'task', target: 'task_b', targetHandle: 'context' }],
  );
  await gotoApp(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('2단계 사이클(B → A)은 차단되고 토스트가 뜬다', async ({ page }) => {
  await dragSocket(page, { node: 'task_b', handle: 'task' }, { node: 'task_a', handle: 'context' });

  await expect(toast(page, 'That would create a dependency cycle. Check the Task context links.')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('3단계 사이클(A → B → C → A)도 마지막 연결에서 막힌다', async ({ page }) => {
  // B → C 는 정상.
  await dragSocket(page, { node: 'task_b', handle: 'task' }, { node: 'task_c', handle: 'context' });
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // C → A 를 이으면 A→B→C→A 순환.
  await dragSocket(page, { node: 'task_c', handle: 'task' }, { node: 'task_a', handle: 'context' });
  await expect(toast(page, 'dependency cycle')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('사이클이 아닌 context 연결은 정상적으로 붙는다 (대조군)', async ({ page }) => {
  await dragSocket(page, { node: 'task_a', handle: 'task' }, { node: 'task_c', handle: 'context' });
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.locator('[role="status"]').filter({ hasText: 'cycle' })).toHaveCount(0);
});

test('토스트는 닫기 버튼으로 사라진다', async ({ page }) => {
  await dragSocket(page, { node: 'task_b', handle: 'task' }, { node: 'task_a', handle: 'context' });
  const t = toast(page, 'dependency cycle');
  await expect(t).toBeVisible();
  await t.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(t).toHaveCount(0);
});
