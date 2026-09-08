import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { FAKE_OPENAI_KEY, dialog, gotoApp, seedCanvas } from './helpers';

/**
 * WORK_PLAN §5.6 M5-T3 — "공개될 내용 미리보기" 모달.
 *
 * `persistence/publishScan.ts` 가 찾아낸 값을 `features/publish/PublishPreview.tsx`
 * 가 사람이 읽을 수 있게 보여주고, 위험도별로 마스킹 여부를 고르게 한다.
 * `warn`(이메일 등)은 사용자가 판단하고, `block`(API 키)은 선택지 없이 항상 마스킹된다.
 */
const EMAIL_GRAPH = [
  { id: 'agent_a', type: 'agent', x: 40, y: 40, data: { name: 'Contact Agent', role: 'r', goal: 'g', backstory: 'Reach me at jane.doe@acme.io for questions.' } },
];

test('프롬프트 속 이메일은 경고로 뜨고, 마스킹하면 게시 번들에서 지워진다', async ({ page }) => {
  await seedCanvas(page, EMAIL_GRAPH, [], 'Contact Project');
  await gotoApp(page);

  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: 'Preview what gets published' }).click();

  const modal = dialog(page, 'Preview what gets published');
  await expect(modal).toBeVisible();

  // 경고: 이메일이 findings 로 뜬다 — 원문을 그대로 노출하지 않는다.
  await expect(modal).toContainText('Email address');
  await expect(modal).toContainText('Needs a look');
  await expect(modal).toContainText('agent node · backstory');
  await expect(modal).toContainText('ja******@acme.io');
  await expect(modal).not.toContainText('jane.doe@acme.io');

  // 마스킹 전: 확인 버튼은 항상 눌러도 되지만(경고는 차단이 아니다), 먼저 체크박스를 켠다.
  const maskBox = modal.getByRole('checkbox');
  await expect(maskBox).not.toBeChecked();
  await maskBox.check();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('contact-project.acanvas.json');

  const path = await download.path();
  const bundle = JSON.parse(await readFile(path, 'utf-8')) as {
    nodes: Array<{ data: Record<string, unknown> }>;
  };
  const backstory = String(bundle.nodes[0]!.data.backstory);
  expect(backstory).toContain('[redacted:email]');
  expect(backstory).not.toContain('jane.doe@acme.io');
});

test('마스킹하지 않고 내려받으면 경고 항목은 원문 그대로 나간다 (경고는 차단이 아니다)', async ({ page }) => {
  await seedCanvas(page, EMAIL_GRAPH, [], 'Contact Project');
  await gotoApp(page);

  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: 'Preview what gets published' }).click();
  const modal = dialog(page, 'Preview what gets published');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  const path = await download.path();
  const bundle = JSON.parse(await readFile(path, 'utf-8')) as {
    nodes: Array<{ data: Record<string, unknown> }>;
  };
  expect(String(bundle.nodes[0]!.data.backstory)).toContain('jane.doe@acme.io');
});

test('API 키는 선택지 없이 항상 마스킹된다 (block 은 사용자 판단 대상이 아니다)', async ({ page }) => {
  const graph = [
    { id: 'agent_a', type: 'agent', x: 40, y: 40, data: { name: 'Leaky Agent', role: 'r', goal: 'g', backstory: `My key is ${FAKE_OPENAI_KEY}` } },
  ];
  await seedCanvas(page, graph, [], 'Leaky Project');
  await gotoApp(page);

  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: 'Preview what gets published' }).click();
  const modal = dialog(page, 'Preview what gets published');

  await expect(modal).toContainText('API key');
  await expect(modal).toContainText('Blocked');
  await expect(modal).toContainText('API keys are always masked.');
  // block 항목엔 체크박스 자체가 없다 — 고를 수 없다는 뜻이다.
  await expect(modal.getByRole('checkbox')).toHaveCount(0);
  await expect(modal).not.toContainText(FAKE_OPENAI_KEY);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  const path = await download.path();
  const bundle = JSON.parse(await readFile(path, 'utf-8')) as {
    nodes: Array<{ data: Record<string, unknown> }>;
  };
  expect(String(bundle.nodes[0]!.data.backstory)).toContain('***REDACTED***');
  expect(String(bundle.nodes[0]!.data.backstory)).not.toContain(FAKE_OPENAI_KEY);
});

test('위험한 값이 없으면 "문제 없음" 안내만 뜨고 그대로 내려받을 수 있다', async ({ page }) => {
  const graph = [
    { id: 'agent_a', type: 'agent', x: 40, y: 40, data: { name: 'Clean Agent', role: 'Analyst', goal: 'Summarize.', backstory: 'No secrets here.' } },
  ];
  await seedCanvas(page, graph, [], 'Clean Project');
  await gotoApp(page);

  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: 'Preview what gets published' }).click();
  const modal = dialog(page, 'Preview what gets published');

  await expect(modal).toContainText('Nothing risky found.');
  await expect(modal.getByRole('checkbox')).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('clean-project.acanvas.json');
});
