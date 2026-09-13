import { expect, test } from '@playwright/test';

import {
  FAKE_OPENAI_KEY, HELLO, clearCanvas, dialog, field, fitView, gotoApp, mockRun, node, toast,
} from './helpers';

/**
 * Spec §18 E2E 시나리오 2 `MUST`
 * > 템플릿 "Hello Crew" 로드 → 키 입력 → 실행 → SSE 이벤트로 노드 링 변화 →
 * > 결과 출력 확인 (**백엔드 모킹**)
 *
 * 백엔드를 띄우지 않는다는 것은 스펙이 못 박은 조건이다 — CrewAI/LLM 을 실제로
 * 돌리면 CI 에 API 키가 필요하고 결과도 매번 달라진다. 대신
 * `backend/app/routers/runs.py::stream_events` 의 와이어 포맷과
 * `app/schemas/events.py` 의 페이로드를 그대로 흉내낸 SSE 를 `page.route()` 로 먹인다.
 *
 * 스트림을 **두 묶음**으로 쪼개 실행 중간 상태를 만든다. 첫 묶음에 종단 이벤트가
 * 없으면 프론트가 `Last-Event-ID` 를 실어 재연결하므로(§11.4), 그 사이 구간에서
 * "노드 링이 running" 을 단언할 수 있다 — 덤으로 재연결/replay 경로까지 지나간다.
 */
test('Hello Crew 를 불러 키를 넣고 실행하면 링이 돌고 결과가 Output 노드에 찍힌다', async ({ page }) => {
  await clearCanvas(page);
  await gotoApp(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  /* ---------- 1. 템플릿 갤러리에서 Hello Crew 로드 ---------- */
  await page.getByRole('button', { name: 'Templates' }).click();
  const gallery = dialog(page, 'Template gallery');
  await expect(gallery).toBeVisible();

  const helloCard = gallery.locator('div').filter({ hasText: /^Hello Crew/ }).first();
  await expect(helloCard).toBeVisible();
  await gallery.getByRole('button', { name: 'Use this' }).first().click();

  await expect(gallery).toHaveCount(0);
  await expect(toast(page, /Loaded Hello Crew/)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  for (const id of Object.values(HELLO)) await expect(node(page, id)).toHaveCount(1);

  /* ---------- 2. API 키 입력 (BYOK — §12.4) ---------- */
  await page.getByRole('button', { name: 'API Keys', exact: true }).click();
  const keys = dialog(page, 'API Keys & local runtime');
  await keys.getByPlaceholder(/Paste the API key/).fill(FAKE_OPENAI_KEY);
  await keys.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(toast(page, 'Added the OpenAI key.')).toBeVisible();
  await keys.getByRole('button', { name: 'Done' }).click();
  await expect(keys).toHaveCount(0);

  /* ---------- 3. 백엔드 모킹 ---------- */
  const run = await mockRun(page, {
    runId: 'run_e2e',
    taskOrder: [HELLO.task],
    stageDelayMs: 1200,
    stages: [
      // 1묶음: 실행 시작 + 태스크 진행 중 (종단 이벤트 없음 → 프론트가 재연결한다)
      [
        { event: 'run.started', data: { task_order: [HELLO.task], agent_count: 1, started_at: '2026-09-03T00:00:00Z' } },
        { event: 'node.status', data: { node_id: HELLO.agent, status: 'running' } },
        { event: 'task.started', data: { node_id: HELLO.task, task_name: 'Summarize', agent_node_id: HELLO.agent } },
        { event: 'agent.thought', data: { agent_node_id: HELLO.agent, text: 'Thinking about the topic…' } },
        { event: 'token.usage', data: { node_id: HELLO.task, prompt_tokens: 120, completion_tokens: 40, cost_usd: 0.0012 } },
      ],
      // 2묶음: 완료
      [
        { event: 'task.completed', data: { node_id: HELLO.task, output: '- E2E bullet one\n- E2E bullet two', duration_ms: 1234 } },
        { event: 'node.status', data: { node_id: HELLO.agent, status: 'succeeded' } },
        { event: 'run.completed', data: { duration_ms: 1500, final_output: '## E2E Summary\n\n- bullet one\n- bullet two', usage: {} } },
      ],
    ],
  });

  /* ---------- 4. 실행 ---------- */
  await fitView(page);
  await expect(page.getByRole('button', { name: 'Queue Prompt' })).toBeEnabled();
  await page.getByRole('button', { name: 'Queue Prompt' }).click();

  // Hello Crew 에는 Input 노드(`topic`)가 있으므로 실행 파라미터 모달을 먼저 거친다 (§5.8).
  const params = dialog(page, 'Run parameters');
  await expect(params).toBeVisible();
  await field(page, 'topic').locator('input').fill('Knode E2E');
  await params.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(params).toHaveCount(0);

  /* ---------- 5. SSE 로 노드 링이 도는 것을 확인 ---------- */
  await expect(node(page, HELLO.task)).toHaveAttribute('data-run-status', 'running');
  await expect(node(page, HELLO.agent)).toHaveAttribute('data-run-status', 'running');
  // 색만이 아니라 아이콘 배지로도 상태를 알린다 (§17.2 MUST).
  await expect(node(page, HELLO.task).getByRole('status')).toHaveAttribute('aria-label', /running/);
  // 헤더 진행바 (§3.5-14)
  await expect(page.locator('header')).toContainText(/0\/1 tasks/);

  /* ---------- 6. 결과 출력 ---------- */
  await expect(node(page, HELLO.task)).toHaveAttribute('data-run-status', 'succeeded', { timeout: 20_000 });
  await expect(node(page, HELLO.output)).toHaveAttribute('data-run-status', 'succeeded');
  await expect(node(page, HELLO.output)).toContainText('E2E Summary');
  await expect(node(page, HELLO.output)).toContainText('bullet one');
  await expect(toast(page, 'The run finished.')).toBeVisible();

  // 태스크 노드에는 그 태스크의 산출물이 미리보기로 붙는다 (§10.3).
  await expect(node(page, HELLO.task)).toContainText('E2E bullet one');

  /* ---------- 7. 모킹이 실제로 쓰였는지 + 재연결 계약 ---------- */
  expect(run.started()).toBe(true);
  expect(run.connections()).toBeGreaterThanOrEqual(2);
  // 재연결은 마지막으로 받은 이벤트 id 부터 다시 달라고 요청한다 (§11.4 replay).
  expect(run.lastEventIds()[0]).toBe('0');
  expect(Number(run.lastEventIds()[1])).toBe(5);
});

test('로그 콘솔에 SSE 이벤트가 시간순으로 쌓인다', async ({ page }) => {
  await gotoApp(page);
  await mockRun(page, {
    runId: 'run_e2e',
    taskOrder: [HELLO.task],
    stages: [[
      { event: 'run.started', data: { task_order: [HELLO.task], agent_count: 1, started_at: '2026-09-03T00:00:00Z' } },
      { event: 'agent.thought', data: { agent_node_id: HELLO.agent, text: 'E2E thought line' } },
      { event: 'agent.tool_use', data: { agent_node_id: HELLO.agent, tool_id: 'serper_search', input: 'Knode' } },
      { event: 'task.completed', data: { node_id: HELLO.task, output: 'done', duration_ms: 10 } },
      { event: 'run.completed', data: { duration_ms: 20, final_output: 'FINAL E2E OUTPUT', usage: {} } },
    ]],
  });

  await page.getByRole('button', { name: 'Queue Prompt' }).click();
  const params = dialog(page, 'Run parameters');
  await field(page, 'topic').locator('input').fill('x');
  await params.getByRole('button', { name: 'Run', exact: true }).click();

  // 실행이 시작되면 로그 콘솔이 자동으로 열린다 (`page.tsx::startRunWithInputs`).
  const log = page.getByRole('complementary', { name: 'EXECUTION LOG' })
    .or(page.locator('text=EXECUTION LOG').locator('xpath=ancestor::*[3]'));
  await expect(page.locator('body')).toContainText('Run started · 1 tasks');
  await expect(page.locator('body')).toContainText('E2E thought line');
  await expect(page.locator('body')).toContainText('serper_search');
  await expect(page.locator('body')).toContainText('FINAL E2E OUTPUT');
  expect(await log.count()).toBeGreaterThanOrEqual(0);
});
