// feature-assemble.mp4 v2 — 1520x855 viewport @2x, inspector collapsed, 5-column
// diamond layout at zoom 0.8 so the fixed spawn point (screen 676..860 x 250..282)
// is never covered by an already-placed node. Captured via CDP screenshots (lossless).
import { chromium } from '@playwright/test';
import { startRecorder, installCursor, hideDevBadge } from './recorder.mjs';

const OUT = `${process.env.OUT_DIR ?? '/tmp/knode-record'}/asm`;
const p = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function stableBox(locator) {
  let prev = null;
  for (let i = 0; i < 20; i++) {
    const box = await locator.boundingBox();
    if (!box) { await new Promise((r) => setTimeout(r, 100)); continue; }
    if (prev && Math.abs(prev.x - box.x) < 0.5 && Math.abs(prev.y - box.y) < 0.5) return box;
    prev = box;
    await new Promise((r) => setTimeout(r, 120));
  }
  return prev;
}

async function glide(page, a, b, steps = 14) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 6, a.y + 3, { steps: 3 }); // nudge so the drag/connection registers
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps });
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function dragNode(page, nodeId, to) {
  const handle = page.locator(`[data-node-id="${nodeId}"] .ac-drag-handle`);
  const box = await stableBox(handle);
  await glide(page, p(box), to);
}

async function dragSocket(page, from, to) {
  const src = await page.locator(`.react-flow__node[data-id="${from.node}"] .react-flow__handle[data-handleid="${from.handle}"]`).boundingBox();
  const dst = await page.locator(`.react-flow__node[data-id="${to.node}"] .react-flow__handle[data-handleid="${to.handle}"]`).boundingBox();
  await glide(page, p(src), p(dst));
  // 커서가 노드 위에 머물면 hover 카드가 떠서 다음 소켓을 덮는다 — 빈 캔버스로 치워 둔다
  await page.mouse.move(700, 790, { steps: 8 });
  await page.waitForTimeout(450);
}

const ids = (page) => page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1520, height: 855 }, deviceScaleFactor: 2, locale: 'ko-KR' });
const page = await context.newPage();
await installCursor(page);
await page.addInitScript(([guard]) => {
  window.sessionStorage.setItem('knode.onboarding.v1', '1');
  if (window.localStorage.getItem(guard)) return;
  window.localStorage.setItem(guard, '1');
  const doc = {
    schema_version: '1.0', app_version: '0.1.0', id: 'cvs_pipeline', name: 'Demo',
    description: '', tags: [], author: 'record',
    created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z',
    viewport: { x: 0, y: 0, zoom: 0.8 }, nodes: [], edges: [], meta: { requires_keys: [] },
  };
  window.localStorage.setItem('knode.workspace.v1', JSON.stringify(doc));
}, ['__pipeline_seeded']);

await page.goto('http://localhost:3101/');
await page.locator('.react-flow').waitFor({ state: 'visible' });
await hideDevBadge(page);
if ((await ids(page)).length !== 0) throw new Error('canvas not empty');
await page.getByRole('button', { name: '인스펙터 접기' }).click();
await page.waitForTimeout(600);

const search = page.getByPlaceholder('노드 검색');
const deselect = () => page.mouse.click(700, 790); // empty canvas, clear of controls/minimap
const rec = await startRecorder(page, OUT, { format: 'png', fps: 30 });
await page.waitForTimeout(800);

async function addAndPlace(term, nameRe, target) {
  const before = await ids(page);
  await search.click();
  await search.fill(term);
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: nameRe }).first().click();
  await page.waitForTimeout(650);
  const newId = (await ids(page)).find((id) => !before.includes(id));
  await dragNode(page, newId, target);
  await page.waitForTimeout(300);
  const fb = await page.locator(`[data-node-id="${newId}"] .ac-drag-handle`).boundingBox();
  const dist = Math.hypot(fb.x + fb.width / 2 - target.x, fb.y + fb.height / 2 - target.y);
  console.log(newId, 'placed, error px', dist.toFixed(1));
  await deselect();
  await page.waitForTimeout(300);
  return newId;
}

// columns A..E (handle centres); row1 y=110 (short nodes only), row2 y=330
const A = 388, B = 638, C = 888, D = 1138, E = 1388;
const inputId = await addAndPlace('input', /^Input$/, { x: A, y: 110 });
const llmId = await addAndPlace('llm', /^LLM$/, { x: A, y: 330 });
const agentId = await addAndPlace('agent', /^Agent$/, { x: B, y: 330 });
const taskId = await addAndPlace('task', /^Task$/, { x: C, y: 110 });
const crewId = await addAndPlace('crew', /^Crew$/, { x: D, y: 330 });
const outputId = await addAndPlace('output', /^Output$/, { x: E, y: 330 });
await search.fill('');

await page.waitForTimeout(300);
await dragSocket(page, { node: llmId, handle: 'llm' }, { node: agentId, handle: 'llm' });
await page.waitForTimeout(500);
await dragSocket(page, { node: agentId, handle: 'agent' }, { node: taskId, handle: 'agent' });
await page.waitForTimeout(500);
await dragSocket(page, { node: agentId, handle: 'agent' }, { node: crewId, handle: 'agent' });
await page.waitForTimeout(500);
await dragSocket(page, { node: taskId, handle: 'task' }, { node: crewId, handle: 'task' });
await page.waitForTimeout(500);
await dragSocket(page, { node: crewId, handle: 'result' }, { node: outputId, handle: 'result' });
await page.waitForTimeout(600);
await deselect();
await page.waitForTimeout(300);
console.log('edges', await page.locator('.react-flow__edge').count());
await page.locator('.react-flow__controls-fitview').click();
await page.waitForTimeout(2500);

console.log(await rec.stop(0.1));
await browser.close();
