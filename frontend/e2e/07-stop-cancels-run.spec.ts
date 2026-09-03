import { expect, test } from '@playwright/test';

import { HELLO, dialog, field, fitView, gotoApp, mockRun, node, toast } from './helpers';

/**
 * Spec §18 E2E 시나리오 7 `MUST`
 * > 실행 중 Stop → `cancelled` 상태 전이 확인
 *
 * `mockRun`의 `holdLastUntilCancel`을 쓴다 — 마지막 SSE 묶음은 `POST
 * /runs/{id}/cancel`이 도착할 때까지 응답을 붙들고 있다가, 그때서야 `run.cancelled`
 * (+ 실행 중이던 태스크 노드의 `node.status: cancelled`)를 흘려보낸다. 이렇게 하면
 * "Stop을 누르기 전까지는 확실히 실행 중"이라는 전제를 실제로 보장하면서 취소
 * 전이를 검증할 수 있다. 백엔드가 취소를 태스크 경계에서만 받아들이는 실제 동작
 * (RECON F16)과 프론트의 "취소 요청됨" 낙관적 표시(`stopPending`,
 * `header.stopping`)를 그대로 재현한다.
 */
test('실행 중 Stop 을 누르면 cancelled 로 전이하고 Stop 버튼이 Run 으로 돌아온다', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(6);

  const run = await mockRun(page, {
    runId: 'run_e2e_stop',
    taskOrder: [HELLO.task],
    holdLastUntilCancel: true,
    stages: [
      // 1묶음: 실행 시작 + 태스크 진행 중 (종단 이벤트 없음 → 재연결)
      [
        { event: 'run.started', data: { task_order: [HELLO.task], agent_count: 1, started_at: '2026-09-03T00:00:00Z' } },
        { event: 'node.status', data: { node_id: HELLO.agent, status: 'running' } },
        { event: 'task.started', data: { node_id: HELLO.task, task_name: 'Summarize', agent_node_id: HELLO.agent } },
      ],
      // 2묶음 (마지막): Stop 이 눌려 cancel 이 들어올 때까지 붙들려 있다가 나간다.
      [
        { event: 'node.status', data: { node_id: HELLO.task, status: 'cancelled' } },
        { event: 'node.status', data: { node_id: HELLO.agent, status: 'cancelled' } },
        { event: 'run.cancelled', data: {} },
      ],
    ],
  });

  await fitView(page);
  await page.getByRole('button', { name: 'Queue Prompt' }).click();
  const params = dialog(page, 'Run parameters');
  await field(page, 'topic').locator('input').fill('AgentCanvas E2E stop');
  await params.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(params).toHaveCount(0);

  /* ---------- 실행 중임을 먼저 확인한다 (Stop 이 실제로 "실행 중"에 눌린다는 전제) ---------- */
  await expect(node(page, HELLO.task)).toHaveAttribute('data-run-status', 'running');
  const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stopButton).toBeVisible();

  /* ---------- Stop ---------- */
  await stopButton.click();
  await expect(toast(page, 'Cancellation requested')).toBeVisible();
  // 취소 요청 직후 잠깐 "Stopping…" 으로 바뀐다 (연타 방지, Header.tsx).
  await expect(page.getByRole('button', { name: 'Stopping…' })).toBeVisible();

  /* ---------- 서버가 태스크 경계에서 취소를 받아들이고 종단 이벤트를 보낸다 ---------- */
  await expect(node(page, HELLO.task)).toHaveAttribute('data-run-status', 'cancelled', { timeout: 20_000 });
  await expect(node(page, HELLO.agent)).toHaveAttribute('data-run-status', 'cancelled');
  await expect(toast(page, 'Run cancelled.')).toBeVisible();

  /* ---------- Stop 버튼이 사라지고 다시 Run 버튼으로 돌아온다 ---------- */
  await expect(stopButton).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Queue Prompt' })).toBeVisible();

  expect(run.cancelled()).toBe(true);
});
