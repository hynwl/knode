import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

import { stubBackend } from '../helpers';

/**
 * Hub 시드의 `preview.png` 생성기 (M5-T8 · WORK_PLAN §5.6 P1).
 *
 * **평소에는 건너뛴다.** `HUB_SEED_ROOT` 를 줄 때만 돈다:
 *
 * ```sh
 * npm run build:hub-seeds                        # team.acanvas.json + README.md
 * HUB_SEED_ROOT=../../agentcanvas-hub \
 *   npx playwright test e2e/tools/hub-previews.spec.ts   # preview.png
 * ```
 *
 * 왜 테스트 러너 안에 있나: 썸네일은 **실제 브라우저가 캔버스 DOM 을 캡처**해야
 * 나온다(`features/publish/thumbnail.ts` 는 `html-to-image` 를 쓴다). 순수 노드
 * 스크립트로는 만들 수 없고, 여기 있으면 `playwright.config.ts` 의 webServer·
 * globalTeardown(추적 파일 원복)을 그대로 얻는다.
 *
 * 그리고 이 파일은 시드를 **앱의 게시 흐름 그대로** 만든다 — 문서를 캔버스에
 * 올리고, 헤더 Publish 를 눌러, 모달이 보여 주는 그 이미지를 받는다. 기여자가
 * CONTRIBUTING.md 를 따라 했을 때 나오는 것과 같은 파일이어야 가이드가 참말이 된다.
 */

const SEED_ROOT = process.env.HUB_SEED_ROOT;

/** `thumbnail.ts::THUMBNAIL_MAX_BYTES` — 레지스트리 카드가 무거워지지 않게 지킨다. */
const MAX_BYTES = 200 * 1024;

test('시드 팀들의 preview.png 를 앱 게시 흐름으로 만든다', async ({ browser }) => {
  test.skip(!SEED_ROOT, 'HUB_SEED_ROOT 가 없으면 시드 도구는 돌지 않는다');
  test.setTimeout(300_000);

  const teamsDir = join(SEED_ROOT!, 'teams');
  const slugs = readdirSync(teamsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  expect(slugs.length, 'teams/ 가 비어 있다 — 먼저 npm run build:hub-seeds').toBeGreaterThan(0);

  for (const slug of slugs) {
    const dir = join(teamsDir, slug);
    const doc = readFileSync(join(dir, 'team.acanvas.json'), 'utf-8');
    const png = await capturePreview(browser, doc);

    expect(png.subarray(0, 8), `${slug}: PNG 가 아니다`)
      .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.byteLength, `${slug}: preview.png 가 200KB 를 넘는다`).toBeLessThanOrEqual(MAX_BYTES);

    writeFileSync(join(dir, 'preview.png'), png);
    console.log(`[hub-preview] ${slug} — ${(png.byteLength / 1024).toFixed(1)}KB`);
  }
});

/**
 * 문서 하나를 새 컨텍스트에 올려 게시 모달의 썸네일을 받아 온다. 팀마다 컨텍스트를
 * 새로 여는 이유는 `addInitScript` 가 페이지에 **누적**되기 때문이다 — 한 페이지를
 * 재사용하면 앞 팀의 워크스페이스 시드가 계속 따라다닌다.
 */
async function capturePreview(browser: Browser, docJson: string): Promise<Buffer> {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await stubBackend(page);
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ['agentcanvas.workspace.v1', docJson],
    );
    await page.goto('/');
    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    await page.getByRole('button', { name: 'Publish' }).click();
    const thumb = page.getByTestId('publish-thumbnail');
    await expect(thumb).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

    const src = await thumb.locator('img').getAttribute('src');
    if (!src) throw new Error('썸네일 img 에 src 가 없다');
    return Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
  } finally {
    await context.close();
  }
}
