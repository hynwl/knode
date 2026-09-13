# Welcome 페이지 영상 3종 — 촬영 대본

브랜드/로고를 새로 정한 뒤 다시 찍기 위한 기록. `frontend/public/` 에 있는 영상 3개가
각각 무엇을, 어떤 절차로, 어떤 앱 상태로 찍었는지를 정리한다. 전부 **실제 앱 화면을
Playwright로 자동 조작하며 녹화**한 것이지 목업이 아니다 — 재촬영도 같은 방식을 쓰면 된다.

## 공통 촬영 인프라 (3개 전부 동일)

사용자의 실제 세션(포트 3000, Docker 백엔드)을 절대 건드리지 않기 위해 격리된
프론트엔드/백엔드를 별도 포트에 띄우고 그 위에서만 녹화한다.

```bash
# 1) 격리 백엔드 — CORS 를 녹화용 프론트 origin 에만 열어준다
cd backend
ALLOWED_ORIGINS=http://localhost:3101 .venv/bin/uvicorn app.main:app --port 8001 &

# 2) 격리 프론트엔드 — NEXT_DIST_DIR 로 .next 와 충돌 방지, 격리 백엔드를 바라보게
cd frontend
rm -rf .next-record
NEXT_DIST_DIR=.next-record NEXT_PUBLIC_API_BASE_URL=http://localhost:8001 \
  npx next dev -p 3101 &
```

- **절대 포트 3000 을 쓰지 않는다** — 사람이 쓰는 개발 세션 전용 (`frontend/playwright.config.ts` 의 규칙과 동일).
- Next dev 서버는 `NEXT_DIST_DIR`/`distDir` 를 쓰면 `tsconfig.json` / `next-env.d.ts` 를 건드린다.
  녹화가 끝나면 반드시 원복:
  ```bash
  git checkout -- frontend/next-env.d.ts frontend/tsconfig.json
  ```
- Playwright 스크립트는 `frontend/scripts/tmp-*.mjs` 로 **잠깐** 복사해서 실행한다
  (모듈 해석이 `frontend/node_modules` 를 찾아야 해서) — 끝나면 삭제.
- 녹화는 `chromium.launch()` + `context.newContext({ recordVideo: { dir, size } })` 로 뜬다.
  결과는 `<dir>/page@<hash>.webm` — 가장 최근 mtime 파일을 고르면 된다.
- webm → mp4 변환 (README/Welcome 모두 이 설정):
  ```bash
  ffmpeg -y -i page@<hash>.webm \
    -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart \
    out.mp4
  ```
  헤더 크롬을 잘라야 하면 `-vf crop=W:H:X:Y` 를 앞에 추가.
- **로고 교체 직후라면 dev 서버가 500 을 뱉는지 먼저 확인한다.** Next 의 metadata
  image loader 가 쓰는 `image-size` 는 **파일 앞 1000 바이트 안에서만** `<svg` 를
  찾는다. `frontend/src/app/icon.svg` 머리말 주석이 길어져 `<svg` 가 1000 바이트
  밖으로 밀리면 `Image import ... is not a valid image file` 로 페이지 전체가 죽는다
  (한글 주석은 글자당 3바이트라 금방 넘어간다). 긴 설명은 `<svg>` **안쪽** 주석으로
  옮길 것.
- 앱 내부 드래그(노드 이동, 소켓 연결)는 **HTML5 네이티브 드래그가 아니라 pointer 이벤트
  기반**이다. 반드시 `page.mouse.move/down/move(steps)/up` 시퀀스로 흉내내야 하고,
  `page.dragAndDrop()` 류는 동작하지 않는다.
- 온보딩/시드 데이터는 `page.addInitScript()` 로 네비게이션 전에 주입한다
  (`sessionStorage['knode.onboarding.v1'] = '1'` 로 온보딩 스킵,
  `localStorage['knode.workspace.v1']` 에 캔버스 JSON을 직접 써서 빈 캔버스로 시작 가능).
- **로고/브랜드가 바뀌면 다시 찍어야 하는 이유**: 헤더의 워드마크가 좌상단에 고정돼
  프레임 내내 노출된다. 캔버스 배경·노드 색상은 브랜드와 무관하지만, **Export 코드
  다이얼로그 안의 문구는 제품명을 그대로 쓴다** (푸터 "Knode 없이 `python canvas.py`
  로 그대로 돌아갑니다") — 그래서 §2 도 반드시 다시 찍어야 한다.

  ⚠️ **2026-09-13 실측 정정**: 직전 버전(AgentCanvas)의 `feature-assemble.mp4` /
  `feature-export.mp4` 는 둘 다 **헤더를 크롭으로 잘라내** 워드마크가 한 프레임도
  안 보였다. 이번 재촬영부터는 반대로 **헤더를 살리고 하단 상태바를 버린다**
  (아래 각 절의 crop 참조). 출력 해상도는 Welcome 카드 레이아웃이 깨지지 않도록
  기존과 동일하게 유지했다.

---

## 1. `feature-assemble.mp4` — "캔버스에서 크루 조립" 블록

**위치**: `frontend/src/panels/Welcome.tsx` features 그리드, 블록 1 (`.feature-card-media` 첫 번째).
**보여주는 것**: 완전히 빈 캔버스에서 노드 라이브러리로 6개 노드(Input → LLM → Agent →
Task → Crew → Output)를 하나씩 추가·배치하고, 소켓 5개를 실제로 드래그 연결해서
input-to-output 전체 파이프라인을 조립하는 전 과정. 마지막에 fit-view로 전체 그래프를
한 화면에 담는 샷으로 끝난다.

**핵심 함정과 해결책** (재촬영 시 꼭 지킬 것):
1. 노드를 라이브러리에서 추가(`onClick`)하면 **항상 같은 고정 화면 좌표**에 스폰된다
   (`NodeLibrary.tsx` 의 `dropPosition()` 이 뷰포트가 안 바뀌면 매번 flow 좌표
   `(420, 200)` 을 반환 — 대략 화면 `(676, 250)`). 이 지점 근처를 최종 배치 좌표로
   쓰면 다음 노드가 이전 노드 위에 겹쳐 스폰되어 드래그가 이전 노드를 붙잡거나
   빗나간다. **모든 최종 배치 좌표를 이 스폰 지점에서 멀리 (예: x ≥ 900) 둔다.**
2. 노드가 스폰된 직후 위치가 트랜지션 애니메이션 중이라 `boundingBox()` 를 바로 읽으면
   중간 값을 읽어 드래그 시작점이 어긋난다. 핸들의 bounding box 가 연속 두 번 같은
   값이 나올 때까지 폴링(`stableBox()`)한 뒤 드래그를 시작한다.
3. **`WARN drag missed` 는 대부분 거짓 경보다.** 스크립트의 검증이 `finalBox`(핸들
   **좌상단**)를 `target`(마우스가 찍은 **중심점**)과 그냥 비교해서, 핸들 크기
   228×32 의 절반만큼 항상 어긋나 보인다. `finalBox.x + width/2` 로 비교해야 실제
   오차가 나온다 — 2026-09-13 재촬영에서는 6개 전부 오차 6px 이내로 정확히 안착했다.
4. **최종본은 2.5배속이다.** 위 대본을 그대로 돌리면 52초가 나오는데, 직전 버전
   `feature-assemble.mp4` 는 20.68초였다 — Welcome 카드에서 루프로 도는 영상이라
   실시간 길이는 너무 늘어진다. 변환 때 `setpts=PTS/2.5` 를 걸면 20.96초로 맞는다.

**재현 스크립트** (`record-pipeline.mjs` — 2000×1000 으로 녹화한 뒤 1400×652 로 제작):

```js
// Records the full Input -> LLM -> Agent -> Task -> Crew -> Output pipeline being
// assembled live on the canvas, node by node, fully connected at the end.
import { chromium } from '@playwright/test';

const OUT_DIR = '<scratchpad>/video';

function p(box) { return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }

/** 스폰 직후 위치 전환(transition)이 끝날 때까지 boundingBox 가 안정될 때까지 기다린다. */
async function stableBox(locator) {
  let prev = null;
  for (let i = 0; i < 15; i++) {
    const box = await locator.boundingBox();
    if (!box) { await new Promise((r) => setTimeout(r, 100)); continue; }
    if (prev && Math.abs(prev.x - box.x) < 0.5 && Math.abs(prev.y - box.y) < 0.5) return box;
    prev = box;
    await new Promise((r) => setTimeout(r, 120));
  }
  return prev;
}

async function dragNode(page, nodeId, to) {
  const handle = page.locator(`[data-node-id="${nodeId}"] .ac-drag-handle`);
  const box = await stableBox(handle);
  const from = p(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function dragSocket(page, from, to) {
  const srcBox = await page.locator(`.react-flow__node[data-id="${from.node}"] .react-flow__handle[data-handleid="${from.handle}"]`).boundingBox();
  const dstBox = await page.locator(`.react-flow__node[data-id="${to.node}"] .react-flow__handle[data-handleid="${to.handle}"]`).boundingBox();
  const a = p(srcBox);
  const b = p(dstBox);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 12 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 2000, height: 1000 },
    locale: 'ko-KR',
    recordVideo: { dir: OUT_DIR, size: { width: 2000, height: 1000 } },
  });
  const page = await context.newPage();

  await page.addInitScript(([guard]) => {
    window.sessionStorage.setItem('knode.onboarding.v1', '1');
    // 완전히 빈 캔버스로 시작 — Hello Crew 자동 로드를 막는다.
    if (window.localStorage.getItem(guard)) return;
    window.localStorage.setItem(guard, '1');
    const doc = {
      schema_version: '1.0', app_version: '0.1.0', id: 'cvs_pipeline', name: 'Demo',
      description: '', tags: [], author: 'record',
      created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z',
      viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], meta: { requires_keys: [] },
    };
    window.localStorage.setItem('knode.workspace.v1', JSON.stringify(doc));
  }, ['__pipeline_seeded']);

  await page.goto('http://localhost:3101/');
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  await expectCount(page, 0);
  await page.waitForTimeout(700);

  const search = page.getByPlaceholder('노드 검색').or(page.getByPlaceholder('Search nodes…'));
  const deselect = () => page.mouse.click(1000, 950); // 모든 타깃 위치와 안 겹치는 구석

  async function addAndPlace(term, nameRe, target) {
    const before = await ids(page);
    await search.click();
    await search.fill('');
    await search.fill(term);
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: nameRe }).first().click();
    // 스폰 직후 전환 애니메이션이 끝나길 기다린다 — 안 그러면 드래그 핸들의
    // boundingBox 를 전환 중간 값으로 읽어 드래그가 빗나간다.
    await page.waitForTimeout(650);
    const after = await ids(page);
    const newId = after.find((id) => !before.includes(id));
    await dragNode(page, newId, target);
    await page.waitForTimeout(300);
    const finalBox = await page.locator(`[data-node-id="${newId}"] .ac-drag-handle`).boundingBox();
    const dist = Math.hypot(finalBox.x - target.x, finalBox.y - target.y);
    if (dist > 60) console.warn(`WARN drag missed: ${newId} target=${JSON.stringify(target)} got=${JSON.stringify(finalBox)}`);
    await deselect();
    await page.waitForTimeout(300);
    return newId;
  }

  // 모든 노드가 처음 스폰되는 고정 지점(뷰포트 0,0 기준 flow 420,200 ≈ 화면 676,250)
  // 과 절대 겹치지 않는 x=900 오른쪽에만 배치한다.
  const inputId = await addAndPlace('input', /^Input$/, { x: 950, y: 220 });
  const llmId = await addAndPlace('llm', /^LLM$/, { x: 950, y: 520 });
  const agentId = await addAndPlace('agent', /^Agent$/, { x: 1300, y: 220 });
  const taskId = await addAndPlace('task', /^Task$/, { x: 1300, y: 520 });
  const crewId = await addAndPlace('crew', /^Crew$/, { x: 1650, y: 220 });
  const outputId = await addAndPlace('output', /^Output$/, { x: 1650, y: 520 });

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
  await page.waitForTimeout(200);
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(2200);

  await context.close();
  await browser.close();
  console.log('DONE', { inputId, llmId, agentId, taskId, crewId, outputId });
}

async function ids(page) {
  return page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
}
async function expectCount(page, n) {
  const c = (await ids(page)).length;
  if (c !== n) throw new Error(`expected ${n} nodes, got ${c}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**최종 mp4 변환** (헤더를 남기고 하단 상태바를 버리는 크롭 + 2.5배속):

```bash
ffmpeg -y -i page@<hash>.webm \
  -vf "scale=1400:700,crop=1400:652:0:0,setpts=PTS/2.5" -an \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart \
  feature-assemble.mp4
```

**참고**: Input 노드의 `text` 출력 포트는 이 앱에서 다른 어떤 노드에도 엣지로 연결되지
않는다(같은 타입끼리만 연결되는 `CONNECTION_MATRIX` 상, `text` 포트 타입을 받는 입력이
없음 — Input은 `{var_name}` 문자열 치환으로만 쓰인다). 그래서 Input 노드는 캔버스에
배치만 하고 실제 엣지는 LLM→Agent→Task→Crew→Output 5개만 긋는다. 이건 버그가 아니라
앱의 실제 동작이므로 재촬영 때도 그대로 반영하면 된다.

---

## 2. `feature-export.mp4` — "언제든 코드로 탈출" 블록

**위치**: `frontend/src/panels/Welcome.tsx` features 그리드, 블록 2.
**보여주는 것**: 템플릿 갤러리에서 **내장 템플릿 중 노드 수가 가장 많은(13개) "시장
조사 리포트"(`market_research`)** 템플릿을 실제로 불러온 뒤, 헤더의 `Export Code` 를
눌러 백엔드가 그 자리에서 생성한 진짜 CrewAI 파이썬 코드(`canvas.py`)를 처음부터
끝까지 천천히 스크롤해서 보여준다.

**왜 이 템플릿인가**: `frontend/src/templates/builtin.ts` 기준 노드 수 비교 —
`market_research` 13개(에이전트 4 · 태스크 4 · 도구 1 · llm 1 · input 1 · crew 1 · output 1)
> `blog` 12개 > `youtube` 11개 > `hello`/`local` 6개. 코드도 가장 길어서(에이전트 4개 +
`Process.sequential` + `SerperDevTool`) "복잡한 크루도 결국 평범한 파이썬"이라는 메시지가
가장 잘 산다.

**Export Code 는 백엔드가 렌더링한다** (`POST /api/v1/export/python`, Jinja2) — 프론트
목업이 아니라 실제 응답. 그래서 녹화 프론트가 격리 백엔드(8001)를 CORS 허용 상태로
바라보고 있어야 로딩 스피너에서 안 멈춘다.

**재현 스크립트** (`record-export2.mjs`):

```js
// Records: open Templates gallery -> pick the most complex builtin template
// (시장 조사 리포트/market_research, 13 nodes) -> Export Code -> scroll through
// the real generated Python continuously.
import { chromium } from '@playwright/test';

const OUT_DIR = '<scratchpad>/video';

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1180, height: 800 },
    locale: 'ko-KR',
    recordVideo: { dir: OUT_DIR, size: { width: 1180, height: 800 } },
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    window.sessionStorage.setItem('knode.onboarding.v1', '1');
  });

  await page.goto('http://localhost:3101/');
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(500);

  // 1. Templates 갤러리 열기
  await page.getByRole('button', { name: 'Templates' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForTimeout(500);

  // 2. 가장 복잡한 템플릿(시장 조사 리포트, 13 노드) 카드로 스크롤해서 보여준 뒤 Use this
  await page.getByText('시장 조사 리포트', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  // 카드 안의 "Use this" 버튼을 정확히 집는다 (onUse 가 모달을 직접 닫는다 — 별도 확인창 없음).
  const marketCard = page.locator('div.rounded-2xl', { has: page.getByText('시장 조사 리포트', { exact: true }) }).first();
  await marketCard.getByRole('button', { name: 'Use this' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);

  // 3. 캔버스에 13개 노드 그래프가 로드된 걸 한 번 fit-view로 보여준다
  const fitBtn = page.locator('.react-flow__controls-fitview');
  if (await fitBtn.count()) {
    await fitBtn.click();
    await page.waitForTimeout(1200);
  }

  // 4. Export Code
  await page.getByRole('button', { name: 'Export Code' }).click();
  const exportDialog = page.getByRole('dialog');
  await exportDialog.waitFor({ state: 'visible' });
  await exportDialog.locator('pre code').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(900);

  // 5. 생성된 코드를 아래로 천천히 스크롤하면서 쭉 보여준다
  const pre = exportDialog.locator('pre').first();
  const scrollHeight = await pre.evaluate((el) => el.scrollHeight - el.clientHeight);
  const steps = 60;
  for (let i = 1; i <= steps; i++) {
    const y = Math.round((scrollHeight * i) / steps);
    await pre.evaluate((el, top) => { el.scrollTop = top; }, y);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(1000);
  await pre.evaluate((el) => { el.scrollTop = 0; }); // 맨 위로 되감기
  await page.waitForTimeout(1000);

  await context.close();
  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**최종 mp4 변환**: 녹화 프레임은 1180×800 이고 최종본은 **1180×756** 이다 —
즉 44px 을 잘라낸다. 직전 버전은 그 44px 을 **위에서** 잘라 헤더(워드마크)를 날렸는데,
이번부터는 **아래에서** 잘라 헤더를 남기고 상태바를 버린다. 해상도는 그대로라 Welcome
카드 레이아웃에는 영향이 없다.

```bash
ffmpeg -y -i page@<hash>.webm -vf "crop=1180:756:0:0" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart \
  feature-export.mp4
```

---

## 3. `demo.mp4` — Welcome "Quick Demo" 라이브 플레이어 + README GIF 원본

**위치**: `frontend/src/panels/Welcome.tsx` 의 `#watch` 섹션 (`.player .stage` 안 `<video>`),
그리고 `docs/media/demo.mp4` → `docs/media/demo.gif` 로 변환해 GitHub README 에도 쓰인다
(GitHub는 `<video>` 태그를 못 그려서 GIF가 필요 — 커밋 `2c0b2d7`).

**참고**: 이 영상은 이번 세션 이전(2026-09-10)에 만들어진 것이라 원본 Playwright 스크립트가
남아있지 않다 — 아래는 68.7초 영상을 프레임 단위로 역추적해 재구성한 샷 리스트다.
**촬영 당시 영어(EN) 로케일**로 찍혔고, 그 후 커밋 `2118d76` 에서 언어 스위처 자체가
제거되고 Welcome 전체가 한국어로 고정됐다 — 그래서 재촬영 시에는 **한국어 UI로 다시
찍어야 화면이 지금 버전과 일치한다** (Templates 모달 카드 문구도 그 사이 리디자인됨,
아래 §2 의 현재 `TemplatesModal.tsx` 구조를 따를 것).

**보여주는 것** (실제 실행 + SSE 스트리밍 — 앱에서 가장 화려한 기능이라 히어로 영상으로 씀):

1. **(0~4s)** Template Gallery 모달 오픈 상태에서 시작. 카드: Hello Crew / Blog & SEO Crew /
   Market Research Report / YouTube Script Pipeline / Local-only Summarizer.
2. **(~4~8s)** "Blog & SEO Crew" 카드의 `Use this` 클릭 → 캔버스에 10개 노드
   (Input, LLM, Trend Researcher/Content Writer/SEO Specialist 3 Agent,
   Research Trends/Write Blog Post/SEO Optimize 3 Task, Crew, Output) 로드.
3. **(~8~20s)** 노드 몇 개를 클릭해서 우측 Property Inspector 를 보여준다:
   - LLM 노드 → Provider 를 **Ollama (local · free)**, Model `llama3:latest` 로 설정된
     상태 (`API KEY` 드롭다운은 "No key needed (runs locally)") — **무료로 실제 실행
     가능하다**는 메시지.
   - Task 노드("Write Blog Post") → Task Description / Expected Output / Connections
     (Agent in: Content Writer, Depends on: Research Trends, Task out: SEO Optimize) 표시.
4. **(~28s)** 우상단 **"Queue Prompt"**(Run) 버튼 클릭.
5. **(~28~58s) 실행 스트리밍 — 이 영상의 핵심 장면**:
   - 헤더가 `1/3 tasks · 00:13 · ~$0.000` 진행률 + 빨간 **Stop** 버튼으로 바뀐다.
   - 캔버스 위 엣지가 실행 중인 경로를 따라 색이 들어오며 애니메이션.
   - 화면 하단에 **Execution Log** 패널이 열리고 실시간으로 로그 라인이 흐른다
     (`[00:40:49] Run started · 3 tasks`, `task_8 ▶ Research Trends started`,
     `task_8 ✓ done (11471ms) — # Trending Topics in Local-first AI Agent Tools Niche`,
     `task_9 ▶ Write Blog Post started` 등 — 실제 Ollama 로컬 모델이 생성한 진짜 텍스트).
6. **(~58~68s) 완료**: `The run finished.` 토스트, 캔버스의 Output 노드가 완성된 블로그
   포스트를 인라인으로 미리 보여주고, Execution Log 에는 SEO 최적화까지 끝난 최종
   마크다운 전문이 스크롤된다.

**재현 시 필요한 조건**:
- Ollama가 실제로 로컬에서 돌고 있어야 한다 (`llama3` 모델 설치 상태) — 이 장면은
  **키 없이 무료로 진짜 실행되는 모습**이 메시지의 핵심이라 mock 이나 정지화면으로
  대체하면 안 된다.
- 캔버스 헤더 문서 이름이 `Blog & SEO Crew` 로 뜨도록 그 템플릿을 그대로 쓴다
  (Welcome 페이지의 player-bar 자체가 `localhost:3000 — blog_seo_crew.acanvas.json`
  텍스트를 하드코딩해서 보여주므로, 실행 화면과 라벨을 맞추려면 템플릿을 바꾸지 말 것).
- 촬영 뷰포트는 1600×900 (원본 해상도 기준).
- 실행이 끝날 때까지 폴링해서 종료 시점을 잡는다. **한국어 UI 기준 완료 문구는
  `실행이 완료되었습니다.` / 실패는 `실행 중 오류가 발생했습니다.`** 다
  (`log.runSucceeded` / `log.runFailed`). 영어 문구(`The run finished.`)로 폴링하면
  영원히 안 잡힌다 — 2026-09-11 커밋 `2118d76` 이후 UI 는 한국어 고정이다.

**시드 그래프 — 갤러리에서 "Use this" 로 불러오면 안 되는 이유** (2026-09-13 실측):

내장 `blog` 템플릿을 그대로 불러오면 **키가 없어서 못 돈다**. 이 템플릿은 LLM 이
`openai / gpt-4o-mini` 이고, 툴 노드 2개(`serper_search`, `scrape_website`)가 각각
Trend Researcher / SEO Specialist 에 물려 있어 `meta.requires_keys` 가
`["OPENAI_API_KEY", "SERPER_API_KEY"]` 다.

§3 샷 리스트가 세는 노드가 **10개**(Input · LLM · Agent 3 · Task 3 · Crew · Output)
인데 템플릿 원본은 12개라는 게 힌트다 — 원본 데모도 **툴 노드 2개를 빼고** 찍었다.
그래서 갤러리를 거치지 말고 `backend/app/data/templates/blog.acanvas.json` 을 변형해
`localStorage['knode.workspace.v1']` 에 직접 시드한다:

1. `tool_3` · `tool_4` 노드와 그 엣지(`e_7`, `e_8`)를 제거 → 10 노드 / 15 엣지
2. `llm_2.data` 를 `{ name: 'Local Llama', provider: 'ollama', model: 'llama3:latest' }` 로
3. `meta.requires_keys` 를 `[]` 로

`id`(`cvs_tpl_blog_seo_crew`)와 `name`(`Blog & SEO Crew`)은 그대로 둔다 — player-bar 의
`blog_seo_crew.acanvas.json` 라벨과 헤더 문서명이 어긋나면 안 된다. 이 상태로 띄우면
상태바가 `검증 통과` 로 뜨고 Queue Prompt 가 바로 활성화된다.

**⚠️ Queue Prompt 는 바로 실행되지 않는다**: Input 노드 값을 받는 **"실행 파라미터"**
모달이 먼저 뜬다(`블로그 주제 / 니치` 필드 + `취소`/`실행`). 기본값이 템플릿에서 채워져
있으므로 `실행` 버튼만 누르면 된다. 모달을 **Escape 로 닫으면 실행이 취소된다** — 자동화
스크립트에 "떠 있는 모달은 닫고 본다" 류의 방어 로직을 넣어뒀다면 이 모달만은 예외
처리할 것 (그렇지 않으면 아무 일도 안 일어난 채 완료 문구만 하염없이 기다리게 된다).

**변환 + GIF 파생**:
```bash
ffmpeg -y -i page@<hash>.webm \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart \
  demo.mp4

# GitHub README 용 GIF (README는 <video> 미지원)
# ⚠️ 위 한 줄짜리 명령은 **실제로 쓰인 적이 없다** — 이대로 뽑으면 960×540 / 797프레임 /
# 12MB 가 나온다. 실제 산출물(2026-09-10)은 680×383 이었다. 팔레트를 따로 뽑아야
# 어두운 UI 의 그라디언트가 안 띠고, 로그가 계속 흐르는 영상이라 프레임레이트가
# 용량을 그대로 좌우한다. 2026-09-13 기준 8fps / 680폭 = 4.9MB (직전 5.3MB 보다 작고
# 직전의 3.6fps 보다 부드럽다).
ffmpeg -y -i demo.mp4 \
  -vf "fps=8,scale=680:-1:flags=lanczos,palettegen=stats_mode=full" palette.png
ffmpeg -y -i demo.mp4 -i palette.png \
  -lavfi "fps=8,scale=680:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 demo.gif
```
두 산출물 모두 `docs/media/` 와 `frontend/public/` 양쪽에 배치해야 한다
(README는 `docs/media/demo.gif`, Welcome 페이지는 `frontend/public/demo.mp4`).
`frontend/public/demo.gif` 는 현재 **아무도 참조하지 않지만** 같이 갱신한다 — 안 그러면
이전 브랜드가 박힌 파일이 리포에 남는다.

---

## 재촬영 체크리스트 (로고 교체 후)

0. `frontend/src/app/icon.svg` 를 건드렸다면 dev 서버가 200 을 주는지 먼저 확인
   (위 "공통 촬영 인프라"의 1000 바이트 함정).
1. 위 "공통 촬영 인프라"로 격리 프론트(3101)/백엔드(8001) 기동.
2. `feature-assemble.mp4` — `record-pipeline.mjs` 그대로 재실행 (앱 로직 안 바뀌면 좌표도
   그대로 유효). 변환 때 crop + `setpts=PTS/2.5` 를 잊지 말 것.
3. `feature-export.mp4` — `record-export2.mjs` 그대로 재실행. 단, `templates/builtin.ts` 의
   템플릿 목록/노드 수가 바뀌었으면 "가장 복잡한 템플릿" 재계산부터. 변환 때
   `crop=1180:756:0:0`.
4. `demo.mp4` — §3 의 시드 그래프를 만들어 `localStorage` 에 주입한 뒤 실행 녹화
   (Ollama 로컬 실행 필요, "실행 파라미터" 모달에서 `실행` 클릭, 한국어 완료 문구로 폴링).
   완료 후 `demo.gif` 파생본도 같이 갱신.
5. **출력 해상도는 기존과 동일하게 유지한다** — Welcome 카드/플레이어가 종횡비에 맞춰
   레이아웃돼 있다: assemble 1400×652 · export 1180×756 · demo 1600×900.
6. 세 mp4를 `frontend/public/`, `demo.mp4`/`demo.gif`는 `docs/media/` 에도 반영.
7. 임시 스크립트(`frontend/scripts/tmp-*.mjs`) 삭제, `frontend/next-env.d.ts` /
   `tsconfig.json` 원복, 격리 서버 종료, `.next-record` 삭제.
8. 사용자의 실제 `localhost:3000` 세션에서 Welcome 페이지 스크린샷으로 최종 확인.
