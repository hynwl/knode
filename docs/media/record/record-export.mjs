// feature-export.mp4 v2 — Templates gallery -> 시장 조사 리포트 (13 nodes) -> Export Code
// -> scroll the real generated canvas.py. 1520x855 @2x, CDP frame capture.
import { chromium } from '@playwright/test';
import { startRecorder, installCursor, hideDevBadge } from './recorder.mjs';

const OUT = `${process.env.OUT_DIR ?? '/tmp/knode-record'}/exp`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1520, height: 855 }, deviceScaleFactor: 2, locale: 'ko-KR' });
const page = await context.newPage();
await installCursor(page);
await page.addInitScript(() => { window.sessionStorage.setItem('knode.onboarding.v1', '1'); });
await page.goto('http://localhost:3101/');
await page.locator('.react-flow').waitFor({ state: 'visible' });
await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
await hideDevBadge(page);
await page.mouse.move(760, 700);
await page.waitForTimeout(600);

const rec = await startRecorder(page, OUT, { format: 'png', fps: 30 });
await page.waitForTimeout(700);

// 1. Templates
const tpl = page.getByRole('button', { name: 'Templates' });
const tb = await tpl.boundingBox();
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 18 });
await page.waitForTimeout(150);
await tpl.click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ state: 'visible' });
await page.waitForTimeout(900);

// 2. 시장 조사 리포트 card -> Use this
const title = page.getByText('시장 조사 리포트', { exact: true });
await title.scrollIntoViewIfNeeded();
await page.waitForTimeout(700);
const card = page.locator('div.rounded-2xl', { has: title }).first();
const use = card.getByRole('button', { name: 'Use this' });
const ub = await use.boundingBox();
await page.mouse.move(ub.x + ub.width / 2, ub.y + ub.height / 2, { steps: 18 });
await page.waitForTimeout(250);
await use.click();
await dialog.waitFor({ state: 'hidden' });
await page.waitForTimeout(400);

// 3. show the 13-node graph, dismiss the "loaded" toast so it does not cover the export dialog
const fit = page.locator('.react-flow__controls-fitview');
if (await fit.count()) { await fit.click(); }
await page.waitForTimeout(1400);
const dismiss = page.getByRole('button', { name: '알림 닫기' });
if (await dismiss.count()) { await dismiss.first().click(); await page.waitForTimeout(300); }

// 4. Export Code
const exp = page.getByRole('button', { name: 'Export Code' });
const eb = await exp.boundingBox();
await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2, { steps: 20 });
await page.waitForTimeout(200);
await exp.click();
const exportDialog = page.getByRole('dialog');
await exportDialog.waitFor({ state: 'visible' });
await exportDialog.locator('pre code').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(300);
const pre = exportDialog.locator('pre').first();
const pb = await pre.boundingBox();
await page.mouse.move(pb.x + pb.width * 0.55, pb.y + pb.height * 0.6, { steps: 14 });
await page.waitForTimeout(900);

// 5. smooth scroll through canvas.py (ease in/out), then rewind
const max = await pre.evaluate((el) => el.scrollHeight - el.clientHeight);
const steps = 140;
for (let i = 1; i <= steps; i++) {
  const t = i / steps;
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  await pre.evaluate((el, top) => { el.scrollTop = top; }, Math.round(max * e));
  await page.waitForTimeout(55);
}
await page.waitForTimeout(1300);
await pre.evaluate((el) => { el.scrollTo({ top: 0, behavior: 'smooth' }); });
await page.waitForTimeout(1500);

console.log('scrollable px', max, await rec.stop(0.1));
await browser.close();
