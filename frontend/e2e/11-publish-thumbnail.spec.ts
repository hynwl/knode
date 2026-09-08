import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { dialog, gotoApp, seedCanvas, type SeedNode } from './helpers';

/**
 * WORK_PLAN §5.6 M5-T4 — 카드용 프리뷰 이미지 생성 (`features/publish/thumbnail.ts`).
 *
 * DoD: 노드 20개 그래프 기준 **2초 내 생성 + 200KB 이하**. `html-to-image` 는
 * 실제 레이아웃/스타일 계산이 필요한 DOM 캡처라 jsdom(vitest) 으로는 의미 있게
 * 검증할 수 없어 이 파일에서만 실브라우저로 확인한다 — 순수 계산부
 * (`computeThumbnailViewport`/`dataUrlByteSize`/품질 폴백 루프)는 `thumbnail.test.ts`.
 */
function grid(n: number): SeedNode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `note_${i + 1}`,
    type: 'note',
    x: (i % 5) * 120,
    y: Math.floor(i / 5) * 100,
    data: { text: `Node ${i + 1}` },
  }));
}

test('모달을 열면 20노드 캔버스 썸네일이 자동 생성되고 게시 번들의 meta.thumbnail 에 실린다', async ({ page }) => {
  await seedCanvas(page, grid(20), [], 'Thumbnail Project');
  await gotoApp(page);

  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: 'Preview what gets published' }).click();
  const modal = dialog(page, 'Preview what gets published');
  await expect(modal).toBeVisible();

  const thumb = modal.getByTestId('publish-thumbnail');
  const start = Date.now();
  await expect(thumb).toHaveAttribute('data-status', 'ready', { timeout: 5000 });
  // eslint-disable-next-line no-console -- DoD 실측치를 CI 로그에 남긴다 (WORK_PLAN §5.6 M5-T4)
  console.log(`[M5-T4] thumbnail generation took ${Date.now() - start}ms`);
  expect(Date.now() - start).toBeLessThan(2000);
  await expect(thumb.locator('img')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  const path = await download.path();
  const bundle = JSON.parse(await readFile(path, 'utf-8')) as { meta: { thumbnail?: string } };

  expect(bundle.meta.thumbnail).toMatch(/^data:image\/(png|jpeg);base64,/);
  const base64 = bundle.meta.thumbnail!.split(',')[1]!;
  const bytes = Math.floor((base64.length * 3) / 4);
  expect(bytes).toBeLessThanOrEqual(200 * 1024);
});

test('빈 캔버스에서는 썸네일 생성을 건너뛰고 게시 번들에 meta.thumbnail 이 없다', async ({ page }) => {
  await seedCanvas(page, [], [], 'Empty Project');
  await gotoApp(page);

  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: 'Preview what gets published' }).click();
  const modal = dialog(page, 'Preview what gets published');

  const thumb = modal.getByTestId('publish-thumbnail');
  await expect(thumb).toHaveAttribute('data-status', 'skipped');
  await expect(modal).toContainText('No preview available');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: 'Download publish bundle' }).click(),
  ]);
  const path = await download.path();
  const bundle = JSON.parse(await readFile(path, 'utf-8')) as { meta: Record<string, unknown> };
  expect(bundle.meta.thumbnail ?? null).toBeNull();
});
