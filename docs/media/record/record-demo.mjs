// demo.mp4 v2 — Template gallery -> "Blog & SEO Crew" (custom override of the builtin
// blog template: no tool nodes, LLM = local Ollama llama3) -> inspect LLM / Task ->
// Queue Prompt -> 실행 파라미터 -> live SSE run until 실행이 완료되었습니다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { startRecorder, installCursor, hideDevBadge } from './recorder.mjs';

const OUT = `${process.env.OUT_DIR ?? '/tmp/knode-record'}/demo`;
const seed = JSON.parse(fs.readFileSync(process.env.DEMO_SEED ?? '/tmp/knode-record/demo-seed.json', 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR' });
const page = await context.newPage();
await installCursor(page);
await page.addInitScript((doc) => {
  window.sessionStorage.setItem('knode.onboarding.v1', '1');
  // 내장 blog 템플릿을 같은 id 의 커스텀 저장본으로 덮어쓴다 — 갤러리의 같은 자리에
  // "Blog & SEO Crew" 로 뜨고, Use this 가 키 없이 도는 Ollama 버전을 불러온다.
  window.localStorage.setItem('knode.templates.custom.v1', JSON.stringify([{
    id: 'blog', name: 'Blog & SEO Crew', description: '리서치 → 작성 → 교정 (순차) · 로컬 Ollama 로 무료 실행',
    doc, createdAt: '2026-09-14T00:00:00Z',
  }]));
}, seed);

const nodeHandle = (id) => page.locator(`[data-node-id="${id}"] .ac-drag-handle`);
async function moveTo(locator, steps = 18) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
  await page.waitForTimeout(180);
}
async function clickAt(locator, steps = 18) { await moveTo(locator, steps); await locator.click(); }
// 노드를 클릭한 뒤 커서를 인스펙터 쪽으로 옮긴다 — 노드 위에 머물면 hover 카드가
// 떠서 인스펙터/이웃 노드를 가린다.
async function inspect(id, restY) {
  await clickAt(nodeHandle(id), 22);
  await page.waitForTimeout(350);
  await page.mouse.move(1450, restY, { steps: 16 }); // 인스펙터(1300..1600) 안
}

await page.goto('http://localhost:3101/');
await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
await hideDevBadge(page);
await page.mouse.move(800, 600);
await page.waitForTimeout(500);

const rec = await startRecorder(page, OUT, { format: 'png', fps: 30 });
await page.waitForTimeout(600);

// 1. gallery
await clickAt(page.getByRole('button', { name: 'Templates' }));
const dialog = page.getByRole('dialog');
await dialog.waitFor({ state: 'visible' });
await page.waitForTimeout(1600);

// 2. Use this on Blog & SEO Crew
const card = page.locator('div.rounded-2xl', { has: page.getByText('Blog & SEO Crew', { exact: true }) }).first();
await clickAt(card.getByRole('button', { name: 'Use this' }));
await dialog.waitFor({ state: 'hidden' });
await page.waitForTimeout(500);
const dismiss = page.getByRole('button', { name: '알림 닫기' });
if (await dismiss.count()) await dismiss.first().click();

// 3. make room: collapse the node library, fit the 10-node graph
await clickAt(page.getByRole('button', { name: '패널 접기' }), 12);
await page.waitForTimeout(400);
await page.locator('.react-flow__controls-fitview').click();
await page.waitForTimeout(1500);

// 4. inspect LLM (Ollama · free) and the Write Blog Post task
await inspect('llm_2', 300);
await page.waitForTimeout(2600);
await inspect('task_9', 330);
await page.waitForTimeout(2600);

// 5. Queue Prompt -> 실행 파라미터 -> 실행
await clickAt(page.getByRole('button', { name: 'Queue Prompt' }), 24);
const params = page.getByRole('dialog');
await params.waitFor({ state: 'visible' });
await page.waitForTimeout(1300);
await clickAt(params.getByRole('button', { name: '실행', exact: true }), 14);
await params.waitFor({ state: 'hidden' });
// 실행 로그 패널이 열리며 캔버스가 줄어든다 — 그래프를 다시 맞춘다
await page.waitForTimeout(900);
await clickAt(page.locator('.react-flow__controls-fitview'), 16);
await page.mouse.move(900, 200, { steps: 20 });

// 6. wait for the real run to finish (Ollama llama3, 3 tasks)
const t0 = Date.now();
const done = page.getByText('실행이 완료되었습니다.').first();
const failed = page.getByText('실행 중 오류가 발생했습니다.').first();
while (true) {
  if (await done.count()) break;
  if (await failed.count()) { console.error('RUN FAILED'); await page.screenshot({ path: OUT + '-failed.png' }); break; }
  if (Date.now() - t0 > 300_000) { console.error('RUN TIMEOUT'); break; }
  await page.waitForTimeout(500);
}
console.log('run seconds', ((Date.now() - t0) / 1000).toFixed(1));
await page.waitForTimeout(2500);

// 7. show the finished post on the Output node
await inspect('output_12', 560);
await page.waitForTimeout(6000);

console.log(await rec.stop(0.1));
await browser.close();
