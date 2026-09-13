import { expect, type Locator, type Page } from '@playwright/test';

/**
 * E2E 공용 도구 (Spec §18 "E2E 필수 시나리오").
 *
 * 백엔드는 **띄우지 않는다.** 스펙이 시나리오 2에 대해 "백엔드 모킹"을 명시했고,
 * CrewAI/LLM/Ollama 를 CI 에서 돌리면 API 키 없이는 재현조차 안 되기 때문이다.
 * 대신 `backend/app/routers/runs.py::stream_events` 가 내보내는 **실제 와이어
 * 포맷**(`id:` / `event:` / `data:` 3줄 + 빈 줄)과 `app/schemas/events.py` 의
 * 페이로드 필드를 그대로 흉내낸다 — 포맷이 어긋나면 `run/sse.ts` 가 못 읽으므로
 * 이 모킹 자체가 파서의 계약 테스트 역할도 한다.
 */

/** `run/client.ts` · `lib/backendStatus.ts` 가 쓰는 기본 API 베이스. */
export const API = 'http://localhost:8000/api/v1';

/**
 * `templates/hub.ts` 가 읽는 `NEXT_PUBLIC_HUB_REGISTRY_URL`
 * (`playwright.config.ts` webServer.env). 실제로 존재하는 호스트가 아니다 —
 * 이 스위트의 모든 응답은 `page.route()` 가 준다.
 */
export const HUB = 'https://hub.example.test/registry';

/* ────────────────────────── 부팅 ────────────────────────── */

/**
 * 조회성 GET 들을 전부 결정론적으로 막는다. 안 막으면 로컬에 진짜 백엔드가 떠
 * 있는지 여부에 따라 상태바·모델 목록·템플릿 갤러리가 달라져 테스트가 흔들린다.
 */
export async function stubBackend(page: Page): Promise<void> {
  await page.route(`${API}/health`, (r) => r.fulfill({ status: 503, body: '{}' }));
  await page.route(`${API}/providers`, (r) => r.fulfill({ json: { providers: [] } }));
  await page.route(`${API}/tools`, (r) => r.fulfill({ json: { tools: [] } }));
  await page.route(`${API}/templates`, (r) => r.fulfill({ json: { templates: [] } }));
  await page.route(`${API}/ollama/models**`, (r) =>
    r.fulfill({ json: { available: false, host: '', models: [], reason: 'unknown' } }));
  // Hub 는 기본이 "미설정과 동일"이어야 한다(M5 P-D3) — 값이 필요한 테스트는
  // `gotoApp(page, { hubTeams })` 로 이 기본을 덮어쓴다.
  await page.route(`${HUB}/index.json`, (r) => r.fulfill({ status: 404, body: '' }));
}

export interface HubFixtureTeam {
  slug: string;
  id: string;
  name: string;
  description?: string | null;
  tags?: string[];
  author?: string | null;
  revision?: number;
  requiresKeys?: string[];
  /** 통째로 `team.acanvas.json` 응답이 되는 문서. */
  doc: Record<string, unknown>;
}

/**
 * `${HUB}/index.json` + 팀별 `team.acanvas.json` 을 모킹한다. **`gotoApp()` 이
 * `page.goto()` 를 부르기 전에** 등록돼야 한다 — Hub 조회는 부팅 시 1회뿐이라
 * 내비게이션 이후엔 이미 늦는다(그래서 별도 export 대신 `gotoApp` 의 옵션으로만 쓴다).
 */
async function mockHubIndex(page: Page, teams: HubFixtureTeam[]): Promise<void> {
  const index = {
    schema_version: '1.0',
    generated_by: 'e2e',
    team_count: teams.length,
    teams: teams.map((t) => ({
      slug: t.slug,
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      tags: t.tags ?? [],
      author: t.author ?? null,
      license: null,
      revision: t.revision ?? 0,
      forked_from: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      meta: { requires_keys: t.requiresKeys ?? [], difficulty: null },
      path: `teams/${t.slug}/team.acanvas.json`,
      thumbnail: `teams/${t.slug}/preview.png`,
    })),
  };
  await page.route(`${HUB}/index.json`, (r) => r.fulfill({ json: index }));
  for (const t of teams) {
    await page.route(`${HUB}/teams/${t.slug}/team.acanvas.json`, (r) => r.fulfill({ json: t.doc }));
    await page.route(`${HUB}/teams/${t.slug}/preview.png`, (r) => r.fulfill({ status: 404, body: '' }));
  }
}

/**
 * 첫 방문자에게만 뜨는 오프닝 화면(`panels/Welcome.tsx`)을 건너뛴다.
 *
 * 이 화면은 `fixed inset-0` 로 앱 전체를 덮으므로, 남겨 두면 캔버스가 **보이기는
 * 해도**(Playwright 의 가시성 판정은 가림을 안 본다) 모든 클릭이 오버레이에
 * 가로막힌다. 오프닝 화면 자체를 검증하는 스펙만 이 옵션을 끈다.
 */
async function skipWelcome(page: Page): Promise<void> {
  // sessionStorage 다 — 오프닝 화면은 탭 수명 동안만 기억한다
  // (`persistence/localStorage.ts` 의 `SESSION_KEYS`).
  await page.addInitScript((key) => {
    window.sessionStorage.setItem(key as string, '1');
  }, 'knode.onboarding.v1');
}

/** 앱을 열고 캔버스가 마운트될 때까지 기다린다. */
export async function gotoApp(
  page: Page,
  opts?: { hubTeams?: HubFixtureTeam[]; welcome?: boolean },
): Promise<void> {
  await stubBackend(page);
  if (opts?.hubTeams) await mockHubIndex(page, opts.hubTeams);
  if (!opts?.welcome) await skipWelcome(page);
  await page.goto('/');
  if (opts?.welcome) return;
  await expect(page.locator('.react-flow')).toBeVisible();
}

/**
 * 저장된 워크스페이스가 없으면 `page.tsx` 가 Hello Crew 템플릿을 띄운다
 * (`input_1` `llm_2` `agent_3` `task_4` `crew_5` `output_6` — `templates/builtin.ts`
 * 의 Builder 가 생성 순서대로 붙이는 결정적 id).
 */
export const HELLO = {
  input: 'input_1',
  llm: 'llm_2',
  agent: 'agent_3',
  task: 'task_4',
  crew: 'crew_5',
  output: 'output_6',
} as const;

export interface SeedNode {
  id: string;
  type: string;
  x: number;
  y: number;
  data?: Record<string, unknown>;
}
export interface SeedEdge {
  source: string; sourceHandle: string; target: string; targetHandle: string;
}

/**
 * 워크스페이스를 LocalStorage 에 직접 심어 캔버스를 원하는 모양으로 시작시킨다
 * (`persistence/localStorage.ts::STORAGE_KEYS.workspace`).
 *
 * 소켓 드래그가 필요한 시나리오는 이걸 써야 한다 — Hello Crew 템플릿은 x 좌표가
 * 1400 까지 벌어져 있어 1440px 뷰포트에서 오른쪽 노드가 패널 뒤로 잘린다.
 * 좌표를 좁게 심으면 스크롤/줌 조작 없이 두 소켓이 항상 화면 안에 있다.
 *
 * 가용 캔버스 폭은 **884px** 다 (뷰포트 1440 − 노드 라이브러리 `w-64`=256 −
 * 인스펙터 300). 시드 뷰포트가 `x: 40, zoom: 1` 이므로 노드 x 는 **560 이하**로
 * 둔다 (노드 폭 230 → 오른쪽 소켓이 830px 지점, 패널에 안 가린다).
 *
 * ⚠️ `gotoApp()` 보다 **먼저** 불러야 한다 (`addInitScript` 는 다음 내비게이션부터 적용).
 */
export async function seedCanvas(
  page: Page, nodes: SeedNode[], edges: SeedEdge[] = [], name = 'E2E Canvas',
): Promise<void> {
  const doc = {
    schema_version: '1.0',
    app_version: '0.1.0',
    id: 'cvs_e2e',
    name,
    description: '',
    tags: [],
    author: 'e2e',
    created_at: '2026-09-03T00:00:00Z',
    updated_at: '2026-09-03T00:00:00Z',
    viewport: { x: 40, y: 40, zoom: 1 },
    nodes: nodes.map((n) => ({
      id: n.id, type: n.type, position: { x: n.x, y: n.y }, width: null, height: null,
      data: n.data ?? {},
      ui: { collapsed: false, pinned: false, bypassed: false, colorOverride: null },
      parentNode: null, extent: null,
    })),
    edges: edges.map((e, i) => ({
      id: `e_seed_${i + 1}`, ...e, type: 'acanvas', data: { port_type: e.targetHandle },
    })),
    meta: { requires_keys: [] },
  };
  // ⚠️ 시드는 **첫 내비게이션에서 한 번만** 적용한다. `addInitScript` 는 새로고침에도
  // 다시 돌기 때문에, 무조건 덮어쓰면 "새로고침 후 복원" 시나리오(§18-1)가 방금 저장한
  // 워크스페이스를 시드로 되돌려 버려 자동 저장을 검증할 수 없게 된다.
  await page.addInitScript(
    ([key, value, guard]) => {
      if (window.localStorage.getItem(guard as string)) return;
      window.localStorage.setItem(guard as string, '1');
      window.localStorage.setItem(key as string, value as string);
    },
    ['knode.workspace.v1', JSON.stringify(doc), '__e2e_seeded'],
  );
}

/** 캔버스를 완전히 비운다 — 빈 캔버스에서 시작하는 시나리오용. */
export async function clearCanvas(page: Page): Promise<void> {
  await seedCanvas(page, [], [], 'E2E Empty');
}

/* ────────────────────────── 셀렉터 ────────────────────────── */

export function node(page: Page, id: string): Locator {
  return page.locator(`[data-node-id="${id}"]`);
}

/** React Flow 핸들은 `data-nodeid` / `data-handleid` 를 자동으로 단다. */
export function socket(page: Page, nodeId: string, handleId: string): Locator {
  return page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`);
}

/**
 * 토스트. 에러 토스트는 `role="alert"`, 나머지는 `role="status"` 다 —
 * 색으로만 종류를 알리지 않기 위해 M4-T9 에서 나눴다 (Spec §17.2). 둘 다 받는다.
 */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: text });
}

export function dialog(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name });
}

/** 인스펙터의 필드 컨트롤 (`nodes/fields/index.tsx` 의 `data-testid`). */
export function field(page: Page, key: string): Locator {
  return page.getByTestId(`field-${key}`);
}

/** 캔버스의 엣지 개수 — 연결 성공/차단 판정에 쓴다. */
export async function edgeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__edge').count();
}

/* ────────────────────────── 조작 ────────────────────────── */

/** 노드를 클릭해 선택한다(인스펙터가 그 노드를 그리게 한다). */
export async function selectNode(page: Page, id: string): Promise<void> {
  await node(page, id).locator('.ac-drag-handle').click();
  await expect(page.locator(`.react-flow__node[data-id="${id}"].selected`)).toHaveCount(1);
}

/**
 * 소켓 → 소켓 드래그. React Flow 는 pointer 이벤트로 연결을 만들기 때문에
 * `locator.dragTo()`(HTML5 DnD 흉내)가 아니라 실제 마우스 이동이어야 한다.
 * 중간 지점을 한 번 거치는 이유도 같다 — 한 번에 순간이동하면 React Flow 가
 * 연결 중 상태로 들어가기 전에 pointerup 이 도착한다.
 */
export async function dragSocket(
  page: Page, from: { node: string; handle: string }, to: { node: string; handle: string },
): Promise<void> {
  const src = await socket(page, from.node, from.handle).boundingBox();
  const dst = await socket(page, to.node, to.handle).boundingBox();
  if (!src || !dst) throw new Error(`소켓을 찾지 못했다: ${JSON.stringify({ from, to })}`);
  const p = (b: { x: number; y: number; width: number; height: number }) =>
    ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const a = p(src);
  const b = p(dst);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * 캔버스 빈 곳 우클릭 → 노드 추가 컨텍스트 메뉴 (Spec §3.4.1).
 * 좌표를 직접 줘야 하므로 `locator.click({position})` 이 아니라 마우스를 쓴다.
 */
export async function openPaneMenu(page: Page, at = { x: 700, y: 520 }): Promise<Locator> {
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** 캔버스 전체가 화면에 들어오도록 맞춘다 (React Flow Controls 의 fit-view 버튼). */
export async function fitView(page: Page): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(300);
}

/* ────────────────────── SSE / 실행 모킹 ────────────────────── */

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * `backend/app/routers/runs.py` 의 와이어 포맷 그대로:
 *   `id: {seq}\nevent: {name}\ndata: {json}\n\n`
 * 마지막에 하트비트 코멘트(`: heartbeat`)를 붙여 파서가 코멘트를 건너뛰는지도 확인한다.
 */
export function sseBody(events: SseEvent[], startId = 1, runId = 'run_e2e'): string {
  let out = ': heartbeat\n\n';
  events.forEach((e, i) => {
    const payload = { run_id: runId, seq: startId + i, ts: new Date().toISOString(), ...e.data };
    out += `id: ${startId + i}\nevent: ${e.event}\ndata: ${JSON.stringify(payload)}\n\n`;
  });
  return out;
}

export interface RunMockHandle {
  /** `POST /runs` 가 실제로 호출됐는지. */
  started(): boolean;
  /** `POST /runs/{id}/cancel` 이 호출됐는지. */
  cancelled(): boolean;
  /** `GET /runs/{id}/events` 가 몇 번 열렸는지 (재연결 포함). */
  connections(): number;
  /** 각 `GET /events` 요청이 실어 온 `X-Last-Event-Id` (§11.4 replay 검증용). */
  lastEventIds(): string[];
}

export interface RunMockOptions {
  runId?: string;
  taskOrder?: string[];
  /**
   * `GET /events` 호출 순서대로 내보낼 이벤트 묶음.
   * 마지막 묶음에 종단 이벤트(`run.completed`/`failed`/`cancelled`)가 없으면
   * 프론트가 재연결을 시도하고 그 다음 묶음이 나간다 (`run/client.ts` §11.4).
   */
  stages: SseEvent[][];
  /**
   * `true` 면 마지막 묶음은 `POST /cancel` 이 들어올 때까지 응답을 붙들고 있는다.
   * 시나리오 7("실행 중 Stop")에서 "아직 안 끝난 실행" 을 재현하는 용도.
   */
  holdLastUntilCancel?: boolean;
  /**
   * 두 번째 이후 묶음을 내보내기 전에 기다릴 시간(ms). 앞 묶음이 만든 중간 상태
   * (예: 노드가 `running` 링을 두르고 있는 구간)를 단언할 여유를 만든다.
   */
  stageDelayMs?: number;
}

/**
 * `POST /runs` + SSE 스트림 + 취소를 통째로 모킹한다.
 *
 * Playwright 의 `route.fulfill()` 은 바디를 **한 번에** 보내므로 한 응답 안에서
 * 이벤트를 시차를 두고 흘릴 수 없다. 대신 응답을 여러 단계로 쪼개고, 종단
 * 이벤트가 없으면 프론트가 알아서 재연결한다는 성질(§11.4)을 이용해 "실행 중"
 * 상태를 만든다.
 */
export async function mockRun(page: Page, options: RunMockOptions): Promise<RunMockHandle> {
  const runId = options.runId ?? 'run_e2e';
  const taskOrder = options.taskOrder ?? [];
  let started = false;
  let cancelled = false;
  let connections = 0;
  let seq = 1;
  const lastEventIds: string[] = [];

  await page.route(`${API}/runs`, async (route) => {
    started = true;
    await route.fulfill({
      status: 202,
      json: {
        run_id: runId,
        status: 'queued',
        task_order: taskOrder,
        warnings: [],
        events_url: `/api/v1/runs/${runId}/events`,
      },
    });
  });

  await page.route(`${API}/runs/${runId}/cancel`, async (route) => {
    cancelled = true;
    await route.fulfill({ status: 202, json: { run_id: runId, status: 'cancelling' } });
  });

  await page.route(`${API}/runs/${runId}/events`, async (route) => {
    const index = connections++;
    lastEventIds.push(route.request().headers()['x-last-event-id'] ?? '');
    const isLast = index >= options.stages.length - 1;
    const stage = options.stages[Math.min(index, options.stages.length - 1)] ?? [];

    if (index > 0 && options.stageDelayMs) {
      await new Promise((r) => setTimeout(r, options.stageDelayMs));
    }

    if (isLast && options.holdLastUntilCancel) {
      // 취소가 들어올 때까지 붙들고 있다가 그때 종단 이벤트를 내보낸다.
      const deadline = Date.now() + 30_000;
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const body = sseBody(stage, seq, runId);
    seq += stage.length;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body,
    });
  });

  return {
    started: () => started,
    cancelled: () => cancelled,
    connections: () => connections,
    lastEventIds: () => [...lastEventIds],
  };
}

/** API 키처럼 보이는 값 — `persistence/secretScanner.ts` 의 OpenAI 패턴에 걸린다. */
export const FAKE_OPENAI_KEY = 'sk-e2eFAKEkeyNOTreal0123456789abcdef';
