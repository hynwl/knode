// LR-T4 — README 정지 컷 4장 재촬영 (canvas / dryrun / keys / export). 커서 없음.
//   실행: welcome-video-scripts.md 의 "공통 촬영 인프라" 대로 격리 백엔드(8001, CORS 3101) +
//   격리 프런트(3101) 를 띄우고 frontend/scripts/ 에 복사해 `node scripts/shoot-stills.mjs`.
//   포트 3000 은 사람 세션 전용이라 쓰지 않는다. Dry Run·Export 는 백엔드가 필요하다.
//   부득이 Docker 백엔드(8000)를 쓰면 `OLLAMA_VIA_DOCKER=1` — 컨테이너는 localhost:11434 를
//   못 보므로 Ollama 프로브를 host.docker.internal 로 보낸다(아래 open()).
import { chromium } from '@playwright/test';

const OUT = process.env.OUT ?? new URL('..', import.meta.url).pathname;
const URL = process.env.APP_URL ?? 'http://localhost:3101/';
const now = '2026-09-14T00:00:00.000Z';
const ui = { collapsed: false, pinned: false, bypassed: false, colorOverride: null };
const N = (id, type, x, y, data) => ({ id, type, position: { x, y }, width: null, height: null, data, ui, parentNode: null, extent: null });
const E = (i, source, sh, target, th) => ({ id: `e_${i}`, source, sourceHandle: sh, target, targetHandle: th, type: 'acanvas', data: { port_type: sh } });
const agent = (name, role, goal, backstory) => ({ name, role, goal, backstory, allow_delegation: false, verbose: true, max_iter: 20, max_rpm: null, cache: true, respect_context_window: true, max_execution_time: null, allow_code_execution: false });
const task = (name, description, expected_output) => ({ name, description, expected_output, async_execution: false, human_input: false, markdown: true, output_file: null, max_retries: null });

const doc = {
  schema_version: '1.0', app_version: '0.1.0', id: 'cvs_release_notes', name: 'Release Notes Crew',
  description: 'Commit log → grouped themes → release notes, on a local model.', tags: ['ollama', 'free'], author: 'Knode',
  created_at: now, updated_at: now, viewport: { x: 0, y: 0, zoom: 1 }, license: null, revision: 1, forked_from: null,
  nodes: [
    N('input_1', 'input', 0, 0, { var_name: 'commit_log', label: 'Commit log', input_type: 'textarea', default_value: 'feat: add dry run\nfix: keep keys out of the graph file\nrefactor: rename to Knode', options: [], required: true, description: 'Commit log since last release — required' }),
    N('agent_2', 'agent', 340, 0, agent('Analyst', 'Release note analyst', 'Group raw commits into the themes a user would actually notice.', 'You have read ten thousand commit messages and know which ones matter.')),
    N('task_3', 'task', 680, 0, task('Group commits', 'Group these commits into 3 themes:\n\n{commit_log}', 'Three themes, each with its commits listed under it.')),
    N('crew_7', 'crew', 1020, 250, { name: 'Release Crew', process: 'sequential', verbose: true, memory: false, cache: true, planning: false, max_rpm: null }),
    N('output_8', 'output', 1360, 250, { title: 'Release notes', render_as: 'markdown', allow_download: true }),
    N('llm_4', 'llm', 0, 430, { name: 'Local Llama', provider: 'ollama', model: 'llama3:latest', temperature: 0.3, max_tokens: null, top_p: 1, base_url: null, timeout_s: 120, key_ref: '' }),
    N('agent_5', 'agent', 340, 430, agent('Writer', 'Release note writer', 'Turn grouped changes into notes a busy developer will read.', 'You write changelogs people finish reading.')),
    N('task_6', 'task', 680, 430, task('Write notes', 'Write release notes from the grouped themes. Keep every line short.', 'Markdown release notes: one heading per theme, one line per change.')),
  ],
  edges: [
    E(1, 'llm_4', 'llm', 'agent_2', 'llm'), E(2, 'llm_4', 'llm', 'agent_5', 'llm'),
    E(3, 'agent_2', 'agent', 'task_3', 'agent'), E(4, 'agent_5', 'agent', 'task_6', 'agent'),
    E(5, 'task_3', 'task', 'task_6', 'context'),
    E(6, 'agent_2', 'agent', 'crew_7', 'agent'), E(7, 'agent_5', 'agent', 'crew_7', 'agent'),
    E(8, 'task_3', 'task', 'crew_7', 'task'), E(9, 'task_6', 'task', 'crew_7', 'task'),
    E(10, 'crew_7', 'result', 'output_8', 'result'),
  ],
  meta: { requires_keys: [] },
};

const browser = await chromium.launch();
async function open(scale, ollamaViaDocker = process.env.OLLAMA_VIA_DOCKER === '1') {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: scale, locale: 'en-US', timezoneId: 'UTC' });
  const page = await ctx.newPage();
  await page.addInitScript(([d, viaDocker]) => {
    window.sessionStorage.setItem('knode.onboarding.v1', '1');
    window.localStorage.setItem('knode.workspace.v1', JSON.stringify(d));
    // 백엔드가 Docker 안에서 돌고 있어 localhost:11434 가 안 닿는다 — 호스트 경유로 프로브
    if (viaDocker) window.localStorage.setItem('knode.secrets.v1', JSON.stringify({ version: 2, slots: [], ollamaHost: 'http://host.docker.internal:11434' }));
  }, [doc, ollamaViaDocker]);
  await page.goto(URL);
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.locator('.react-flow__controls-fitview').click();
  await page.mouse.click(1000, 120); // deselect, cursor on empty canvas
  await page.mouse.move(1000, 120);
  await page.waitForTimeout(1200);
  return { ctx, page };
}
async function shootDialog(page, name, file) {
  const dlg = page.getByRole('dialog', { name });
  await dlg.waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  const b = await dlg.boundingBox();
  const pad = 36;
  await page.screenshot({ path: file, clip: { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad } });
}

// 1. canvas
{
  const { ctx, page } = await open(1);
  await page.screenshot({ path: `${OUT}/canvas.png`, clip: { x: 0, y: 0, width: 1600, height: 790 } });
  // 2. dry run — 같은 세션에서 이어서
  await page.getByRole('button', { name: 'Dry Run' }).click();
  const params = page.getByRole('dialog');
  await params.waitFor({ state: 'visible' });
  await params.getByRole('button', { name: 'Start Dry Run' }).click();
  await page.getByText('The run finished.').waitFor({ timeout: 60_000 });
  await page.locator('.react-flow__controls-fitview').click(); // 로그 패널이 열려 캔버스가 줄었다 — 다시 맞춘다
  await page.mouse.move(1000, 110);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/dryrun.png` });
  await ctx.close();
}
// 3. keys (2x)
{
  const { ctx, page } = await open(2, false);
  await page.getByRole('button', { name: 'API Keys' }).click();
  await shootDialog(page, 'API Keys & local runtime', `${OUT}/keys.png`);
  await ctx.close();
}
// 4. export (2x) — Agent 조립 코드가 보이도록 스크롤
{
  const { ctx, page } = await open(2);
  await page.getByRole('button', { name: 'Export Code' }).click();
  const dlg = page.getByRole('dialog', { name: 'Export to Python' });
  await dlg.waitFor({ state: 'visible' });
  await dlg.getByText('Generating code…').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await dlg.getByText('Release note writer').first().waitFor({ timeout: 30_000 });
  await dlg.getByText('Release note writer').first().evaluate((el) => { el.scrollIntoView({ block: 'start' }); let p = el.parentElement; while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement; if (p) p.scrollTop -= 34; });
  await page.waitForTimeout(400);
  await shootDialog(page, 'Export to Python', `${OUT}/export.png`);
  await ctx.close();
}
await browser.close();
console.log('done');
