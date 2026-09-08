import { readFile } from 'node:fs/promises';

import { expect, test, type Browser } from '@playwright/test';

import { dialog, gotoApp, seedCanvas, type SeedEdge, type SeedNode } from './helpers';

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

/**
 * 회귀 가드 (M5-T8) — **썸네일에 엣지 선이 실제로 그려진다.**
 *
 * `html-to-image` 는 복제본에 페이지 스타일시트를 싣지 않는다(계산된 스타일을
 * 인라인으로 옮겨 심는 방식이라 SVG `stroke` 가 빠진다). 엣지 색이 `globals.css` 의
 * `.react-flow__edge-path` 규칙에만 있던 동안에는 그래서 결과 이미지에서 **선이 전부
 * 사라졌다** — 노드만 떠 있는 카드가 레지스트리에 10장 올라갈 뻔한 뒤에야 발견했다
 * (`thumbnail.ts::inlineEdgeStrokes`).
 *
 * 판정은 **차분**으로 한다. 기본 엣지색(#4b5b7c)은 노드 테두리·흐린 글자와 가까워
 * 색 매칭만으로는 오탐이 나고, 반대로 엣지를 선택하면 `AcanvasEdge` 가 stroke 를
 * 인라인으로 주기 때문에 버그가 있어도 통과해 버린다(실제로 그렇게 한 번 헛짚었다).
 * 그래서 같은 노드 배치를 엣지만 넣고/빼고 두 번 찍어, 배경이 아닌 픽셀이 실제로
 * 늘어나는지를 본다.
 */
async function nonBackgroundPixels(
  browser: Browser, nodes: SeedNode[], edges: SeedEdge[],
): Promise<number> {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await seedCanvas(page, nodes, edges, 'Edge Diff Project');
    await gotoApp(page);

    await page.getByRole('button', { name: 'Publish' }).click();
    const thumb = dialog(page, 'Preview what gets published').getByTestId('publish-thumbnail');
    await expect(thumb).toHaveAttribute('data-status', 'ready');
    const src = await thumb.locator('img').getAttribute('src');

    return page.evaluate(async (dataUrl) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl!; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // 배경(`design/tokens.ts::color.bg` = #0b0f18)과 다른 픽셀 수.
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i]! - 11) > 10 || Math.abs(data[i + 1]! - 15) > 10 || Math.abs(data[i + 2]! - 24) > 10) hits += 1;
      }
      return hits;
    }, src);
  } finally {
    await context.close();
  }
}

test('썸네일에 엣지 선이 실제로 그려진다 (스타일시트가 클론에 안 따라오는 문제)', async ({ browser }) => {
  const nodes: SeedNode[] = [
    { id: 'agent_1', type: 'agent', x: 40, y: 40, data: { name: 'A', role: 'r', goal: 'g', backstory: 'b' } },
    { id: 'task_2', type: 'task', x: 460, y: 360, data: { name: 'T', description: 'd', expected_output: 'e' } },
  ];
  const edge: SeedEdge = { source: 'agent_1', sourceHandle: 'agent', target: 'task_2', targetHandle: 'agent' };

  const withEdge = await nonBackgroundPixels(browser, nodes, [edge]);
  const withoutEdge = await nonBackgroundPixels(browser, nodes, []);

  // 두 노드 사이를 가로지르는 선 하나가 만들어 내는 픽셀. 노드는 양쪽이 동일하다.
  expect(withEdge - withoutEdge, '엣지를 넣어도 그려진 픽셀이 늘지 않았다 = 선이 빠졌다')
    .toBeGreaterThan(100);
});
