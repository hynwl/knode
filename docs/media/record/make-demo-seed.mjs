// demo.mp4 용 시드 그래프 생성 — 내장 blog 템플릿(SEO 블로그 작성팀)을 실제 앱에서
// 불러온 뒤 툴 노드 2개(+엣지)를 빼고 LLM 을 로컬 Ollama 로 바꿔 키 없이 도는
// 10노드/15엣지 "Blog & SEO Crew" 를 만든다. record-demo.mjs 가 이 JSON 을
// `knode.templates.custom.v1` 에 같은 id('blog') 로 덮어써 갤러리 자리에 띄운다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.env.DEMO_SEED ?? '/tmp/knode-record/demo-seed.json';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ko-KR' })).newPage();
await page.addInitScript(() => { window.sessionStorage.setItem('knode.onboarding.v1', '1'); });
await page.goto('http://localhost:3101/');
await page.locator('.react-flow__node').first().waitFor();
await page.getByRole('button', { name: 'Templates' }).click();
const card = page.locator('div.rounded-2xl', { has: page.getByText('SEO 블로그 작성팀', { exact: true }) }).first();
await card.getByRole('button', { name: 'Use this' }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden' });
await page.waitForTimeout(2500); // 워크스페이스 저장은 1초 디바운스
const doc = JSON.parse(await page.evaluate(() => localStorage.getItem('knode.workspace.v1')));
const toolIds = new Set(doc.nodes.filter((n) => n.type === 'tool').map((n) => n.id));
doc.nodes = doc.nodes.filter((n) => !toolIds.has(n.id));
doc.edges = doc.edges.filter((e) => !toolIds.has(e.source) && !toolIds.has(e.target));
const llm = doc.nodes.find((n) => n.type === 'llm');
llm.data = { ...llm.data, name: 'Local Llama', provider: 'ollama', model: 'llama3:latest' };
doc.meta = { ...doc.meta, requires_keys: [] };
fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc));
console.log(OUT, doc.id, doc.name, doc.nodes.length, 'nodes', doc.edges.length, 'edges');
await browser.close();
