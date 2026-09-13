import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { dialog, gotoApp, seedCanvas } from './helpers';

/**
 * WORK_PLAN §5.6 M5-T8 — 헤더 "Publish" 진입점 + 제출 가이드.
 *
 * M5-T3 이 만든 1단계(무엇이 공개되는가)에 2단계(어떻게 올리는가)가 붙었다.
 * 확인해야 하는 것은 셋이다:
 *  1. 헤더에서 바로 열린다 (그전에는 커맨드 팔레트에서만 열렸다).
 *  2. 게시자·라이선스가 **번들 문서에 실제로 실린다** — 레지스트리 카드가 그 값을
 *     읽고(P-D4 "라이선스는 게시자가 고른다"), 고르지 않으면 `null` 로 남는다.
 *  3. 2단계가 제출에 필요한 것을 전부 손에 쥐어 준다 — 파일 3개(문서는 이미
 *     받았고, preview.png 는 버튼, README 는 초안), 옮기는 명령, PR 링크.
 */

const GRAPH = [
  { id: 'llm_1', type: 'llm', x: 40, y: 40, data: { name: 'GPT', provider: 'openai', model: 'gpt-4o-mini' } },
  { id: 'agent_2', type: 'agent', x: 300, y: 40, data: { name: 'Analyst', role: 'Market analyst', goal: 'Summarize', backstory: 'Ten years of desk research.' } },
  { id: 'task_3', type: 'task', x: 560, y: 40, data: { name: 'Synthesize', description: 'Write it up.', expected_output: 'A one-page report' } },
];

test('헤더 Publish → 게시자·라이선스가 번들에 실리고, 2단계가 제출 방법을 보여 준다', async ({ page }) => {
  await seedCanvas(page, GRAPH, [], 'Desk Research Crew');
  await gotoApp(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const modal = dialog(page, 'Preview what gets published');
  await expect(modal).toBeVisible();

  await modal.getByRole('textbox').fill('octocat');
  await modal.getByRole('combobox').selectOption('MIT');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('desk-research-crew.acanvas.json');

  const bundle = JSON.parse(await readFile(await download.path(), 'utf-8')) as {
    author: string; license: string | null; meta: { thumbnail?: string };
  };
  expect(bundle.author).toBe('octocat');
  expect(bundle.license).toBe('MIT');
  expect(bundle.meta.thumbnail).toMatch(/^data:image\//); // M5-T4 썸네일이 번들에 실린다

  // ── 2단계 ──────────────────────────────────────────────────────────
  const submit = dialog(page, 'Submit this team to the Hub');
  await expect(submit).toBeVisible();
  await expect(submit).toContainText('No Knode account needed');

  // 슬러그는 이름에서 유도되고, 옮기는 명령이 다운로드명 → 레지스트리 파일명
  // 변환까지 그대로 보여 준다 (이름이 셋 다 달라 말로 설명하면 반드시 틀린다).
  const slugInput = submit.getByRole('textbox');
  await expect(slugInput).toHaveValue('desk-research-crew');
  await expect(submit).toContainText('mv ~/Downloads/desk-research-crew.acanvas.json teams/desk-research-crew/team.acanvas.json');
  await expect(submit).toContainText('python3 scripts/validate_submission.py desk-research-crew');

  // 슬러그를 고치면 명령도 같이 따라간다.
  await slugInput.fill('Desk Research!!');
  await expect(slugInput).toHaveValue('desk-research-');
  await expect(submit).toContainText('teams/desk-research-/team.acanvas.json');
  await slugInput.fill('desk-research');

  // README 초안: 문서 값이 실제로 채워져 있다.
  await submit.getByText('Show the README draft').click();
  await expect(submit).toContainText('# Desk Research Crew');
  await expect(submit).toContainText('| Author | octocat |');
  await expect(submit).toContainText('| License | MIT |');
  await expect(submit).toContainText('| Analyst | Market analyst |');

  // preview.png 는 두 번째 다운로드로 받는다 — 레지스트리는 문서와 이미지를
  // 별도 파일로 요구한다(`build_index.py::REQUIRED_TEAM_FILES`).
  const [preview] = await Promise.all([
    page.waitForEvent('download'),
    submit.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(preview.suggestedFilename()).toBe('preview.png');
  const bytes = await readFile(await preview.path());
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  // PR 링크 (playwright.config.ts 가 심은 NEXT_PUBLIC_HUB_REPO_URL 기준).
  await expect(submit.getByRole('link', { name: 'Fork the registry' }))
    .toHaveAttribute('href', 'https://github.example.test/agentcanvas-hub/fork');
  await expect(submit.getByRole('link', { name: 'Open a pull request' }))
    .toHaveAttribute('href', 'https://github.example.test/agentcanvas-hub/compare');
  await expect(submit.getByRole('link', { name: 'Submission guide' }))
    .toHaveAttribute('href', 'https://github.example.test/agentcanvas-hub/blob/main/CONTRIBUTING.md');
});

/**
 * 라이선스는 **고르지 않으면 비어 있어야 한다** (P-D4). 기본값을 하나 정해 두면
 * 사용자가 고른 적 없는 조건으로 남의 팀이 공개된다.
 */
test('라이선스를 고르지 않으면 번들의 license 는 null 로 남는다', async ({ page }) => {
  await seedCanvas(page, GRAPH, [], 'Unlicensed Crew');
  await gotoApp(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const modal = dialog(page, 'Preview what gets published');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  const bundle = JSON.parse(await readFile(await download.path(), 'utf-8')) as { license: string | null };
  expect(bundle.license).toBeNull();
});
