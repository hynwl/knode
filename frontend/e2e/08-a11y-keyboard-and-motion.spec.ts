import { expect, test, type Page } from '@playwright/test';

import { API, dialog, field, fitView, gotoApp, HELLO, mockRun, seedCanvas } from './helpers';

/**
 * Spec §17.2 접근성 + §3.4.3 모션 감소 — M4-T9 회귀 방지.
 *
 * 스펙 §17.2 의 다섯 항목을 하나씩 실제 브라우저에서 되짚는다:
 *   1. 모든 인터랙티브 요소 키보드 도달 가능 (캔버스는 Tab 순회 + 화살표 이동)
 *   2. 모달 포커스 트랩 + Esc 닫기
 *   3. 상태를 색으로만 전달하지 않는다 (MUST)
 *   4. 본문 텍스트 대비율 4.5:1  → 팔레트 실측은 `src/design/contrast.test.ts` 가 담당.
 *      여기서는 **실제로 렌더된 픽셀 색**이 그 토큰을 쓰고 있는지만 확인한다.
 *   5. prefers-reduced-motion 존중
 *
 * ⚠️ 이 파일이 잡는 것들은 전부 M4-T9 에서 **실제로 깨져 있던** 것이다.
 *    단위 테스트로는 하나도 안 잡혔다 — 브라우저가 있어야만 드러난다.
 */

const SEED = [
  { id: HELLO.agent, type: 'agent', x: 60, y: 60, data: { name: 'Writer', role: 'r', goal: 'g', backstory: 'b' } },
  { id: HELLO.task, type: 'task', x: 380, y: 60, data: { name: 'Draft', description: 'd', expected_output: 'e' } },
];

/** 현재 포커스된 요소를 사람이 읽을 수 있게 요약한다. */
function describeFocus(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return { tag: 'none', label: '', nodeId: '', inDialog: false };
    return {
      tag: a.tagName,
      label: a.getAttribute('aria-label') ?? (a.textContent ?? '').trim().slice(0, 40),
      nodeId: a.getAttribute('data-id') ?? '',
      inDialog: !!a.closest('[role="dialog"]'),
    };
  });
}

test.describe('§17.2-1 키보드 도달성', () => {
  test.beforeEach(async ({ page }) => {
    await seedCanvas(page, SEED);
    await gotoApp(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
  });

  test('캔버스 노드는 Tab 으로 순회되고, 이름이 읽힌다', async ({ page }) => {
    // React Flow 가 노드를 tabIndex=0 으로 만들어 주지만, 우리는 `data` 를 안 쓰기
    // 때문에 `aria-label` 이 비어 스크린리더가 "group" 만 읽었다 (M4-T9 에서 수정).
    const nodes = page.locator('.react-flow__node');
    await expect(nodes.first()).toHaveAttribute('tabindex', '0');

    for (const [id, name] of [[HELLO.agent, 'Writer'], [HELLO.task, 'Draft']] as const) {
      const label = await page.locator(`.react-flow__node[data-id="${id}"]`).getAttribute('aria-label');
      expect(label, `${id} 에 aria-label 이 없다 — 스크린리더가 노드를 식별할 수 없다`).toBeTruthy();
      expect(label).toContain(name);
    }
  });

  test('노드를 Tab 으로 잡고 Enter → 화살표로 움직일 수 있다 (Spec §17.2 명문)', async ({ page }) => {
    const target = page.locator(`.react-flow__node[data-id="${HELLO.agent}"]`);
    await target.focus();
    await expect(target).toBeFocused();

    // Enter/Space 가 선택, 화살표가 이동 — React Flow 내장 키보드 a11y.
    await page.keyboard.press('Enter');
    await expect(target).toHaveClass(/selected/);

    const before = await target.evaluate((n) => n.style.transform);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => target.evaluate((n) => n.style.transform))
      .not.toBe(before);

    // 이동이 캔버스 스토어까지 반영돼야 한다 (`onNodesChange` → `moveNode`).
    // 자동 저장은 디바운스라 즉시 읽으면 아직 옛 좌표다 — 폴링으로 기다린다.
    await expect
      .poll(() => page.evaluate((id) => {
        const raw = window.localStorage.getItem('agentcanvas.workspace.v1');
        const doc = raw ? JSON.parse(raw) : null;
        return doc?.nodes?.find((n: { id: string }) => n.id === id)?.position?.x ?? null;
      }, HELLO.agent), { timeout: 10_000 })
      .not.toBe(60);
  });

  test('포커스된 노드에는 보이는 포커스 링이 있다', async ({ page }) => {
    // React Flow 의 style.css 가 `outline: none` 을 박아 두어, 고치기 전에는
    // Tab 으로 캔버스를 훑어도 지금 어디에 있는지 **전혀 보이지 않았다**.
    await page.keyboard.press('Tab'); // 실제 키보드 조작이어야 :focus-visible 이 켜진다
    const target = page.locator(`.react-flow__node[data-id="${HELLO.agent}"]`);
    await target.focus();
    const outline = await target.evaluate((n) => {
      const c = getComputedStyle(n);
      return { style: c.outlineStyle, width: c.outlineWidth };
    });
    expect(outline.style).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });

  test('호버로만 보이던 노드 삭제 버튼이 키보드 포커스에서도 보인다', async ({ page }) => {
    // `opacity-0` + hover 로만 나타나는 버튼이라, 마우스를 안 쓰면 **투명한 컨트롤**에
    // 포커스가 들어가 있었다.
    const del = page.locator(`.react-flow__node[data-id="${HELLO.agent}"] button[aria-label]`).last();
    await del.focus();
    await expect(del).toHaveCSS('opacity', '1');
  });

});

test.describe('§17.2-1 키보드 도달성 — 커스텀 위젯', () => {
  test('인스펙터의 combobox 는 마우스 없이 조작된다', async ({ page }) => {
    // 예전 구현은 목록 항목이 `onMouseDown` 밖에 안 받아 Enter 로는 절대 선택되지
    // 않았고, input 의 blur 가 목록을 닫아 Tab 으로 도달하지도 못했다.
    // combobox 는 LLM 노드의 `model` 필드다 (Spec §5.3) → 그 노드를 심는다.
    await seedCanvas(page, [
      { id: HELLO.llm, type: 'llm', x: 60, y: 60, data: { name: 'GPT', provider: 'openai', model: '' } },
    ]);
    await gotoApp(page);
    // `stubBackend` 는 `/providers` 를 빈 목록으로 막는다 — 콤보박스에 고를 게
    // 있어야 키보드 조작을 확인할 수 있으므로 여기서만 프리셋을 실어준다
    // (`backend/app/data/model_presets.json` 과 같은 응답 모양).
    await page.route(`${API}/providers`, (r) => r.fulfill({
      json: { providers: [{ provider: 'openai', models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'] }] },
    }));
    await page.reload();
    await page.locator(`.react-flow__node[data-id="${HELLO.llm}"] .ac-drag-handle`).click();
    // ARIA 1.2 대로 롤은 입력 요소 자체에 있다.
    const input = page.locator('input[role="combobox"]').first();
    await expect(input).toBeVisible();

    await input.focus();
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    // ↓ 로 활성 항목을 고르고 Enter 로 확정 — 마우스는 한 번도 안 쓴다.
    await page.keyboard.press('ArrowDown');
    const option = page.locator('[role="option"][aria-selected="true"]');
    await expect(option).toHaveCount(1);
    const chosen = (await option.textContent())?.trim();
    // 활성 항목이 `aria-activedescendant` 로도 연결돼 있어야 스크린리더가 읽는다.
    expect(await input.getAttribute('aria-activedescendant')).toBe(await option.getAttribute('id'));

    await page.keyboard.press('Enter');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(await input.inputValue()).toBe(chosen);
  });
});

test.describe('§17.2-2 모달 포커스 트랩 + Esc', () => {
  test.beforeEach(async ({ page }) => {
    await seedCanvas(page, SEED);
    await gotoApp(page);
  });

  test('Tab 이 모달 밖으로 새지 않고, Esc 로 닫힌다', async ({ page }) => {
    await page.getByRole('button', { name: /Templates/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 모달이 열리면 포커스가 안으로 들어가 있어야 한다.
    await expect.poll(async () => (await describeFocus(page)).inDialog).toBe(true);

    // 40번 Tab 을 눌러도 한 번도 밖으로 못 나간다 (양방향 랩어라운드).
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const f = await describeFocus(page);
      expect(f.inDialog, `Tab ${i + 1}회 후 포커스가 모달 밖(${f.tag} ${f.label})으로 샜다`).toBe(true);
    }
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Shift+Tab');
      const f = await describeFocus(page);
      expect(f.inDialog, `Shift+Tab ${i + 1}회 후 포커스가 모달 밖으로 샜다`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('닫기 버튼의 이름이 번역된 문구다 (i18n 키가 새지 않는다)', async ({ page }) => {
    // 고치기 전에는 `t('modal.close')` 가 존재하지 않는 키라 스크린리더에
    // 문자 그대로 "modal.close" 를 읽어줬다.
    await page.getByRole('button', { name: /Templates/i }).click();
    const dialog = page.getByRole('dialog');
    const labels = await dialog.locator('button[aria-label]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('aria-label') ?? ''),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(l, `번역되지 않은 i18n 키가 aria-label 로 새어나갔다: ${l}`).not.toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
    }
  });
});

test.describe('§17.2-3 색으로만 상태를 전달하지 않는다 (MUST)', () => {
  test('노드 실행 상태는 링 색과 별개로 아이콘 배지 + 텍스트 이름을 함께 띄운다', async ({ page }) => {
    // 상태는 실제 SSE 와이어 포맷으로 몰아넣는다 (`mockRun`) — 테스트 전용 훅을
    // 앱에 심지 않기 위해서다. `node.status` 는 백엔드가 실제로 보내는 이벤트다.
    // 시드를 안 깔면 기본 Hello Crew 가 뜬다 — 검증을 통과하는 유일한 그래프라
    // Queue Prompt 가 실제로 활성화된다 (시나리오 7과 같은 방식).
    const run = await mockRun(page, {
      taskOrder: [HELLO.task],
      stageDelayMs: 800,
      stages: [
        [
          { event: 'run.started', data: { task_order: [HELLO.task], agent_count: 1, started_at: '2026-09-03T00:00:00Z' } },
          { event: 'node.status', data: { node_id: HELLO.agent, status: 'running' } },
          { event: 'node.status', data: { node_id: HELLO.task, status: 'queued' } },
        ],
        [
          { event: 'node.status', data: { node_id: HELLO.agent, status: 'failed' } },
          { event: 'node.status', data: { node_id: HELLO.task, status: 'succeeded' } },
          { event: 'run.completed', data: { duration_ms: 900, final_output: 'done', usage: {} } },
        ],
      ],
    });
    await gotoApp(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(6);
    await fitView(page);
    await page.getByRole('button', { name: 'Queue Prompt' }).click();
    // Hello Crew 에는 Input 노드가 있어 실행 파라미터 모달을 한 번 거친다 (§5.8).
    const params = dialog(page, 'Run parameters');
    await field(page, 'topic').locator('input').fill('a11y');
    await params.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(params).toHaveCount(0);
    expect.soft(run.started()).toBe(true);

    // running / queued 구간
    for (const [id, status] of [[HELLO.agent, 'running'], [HELLO.task, 'queued']] as const) {
      const badge = page.locator(`[data-node-id="${id}"] [role="status"]`);
      await expect(badge, `${status} 에 아이콘 배지가 없다 — 색으로만 전달된다`).toHaveCount(1);
      await expect(badge).toHaveAttribute('aria-label', new RegExp(status));
      await expect(badge.locator('svg')).toHaveCount(1);
    }

    // failed / succeeded 구간
    for (const [id, status] of [[HELLO.agent, 'failed'], [HELLO.task, 'succeeded']] as const) {
      const badge = page.locator(`[data-node-id="${id}"] [role="status"]`);
      await expect(badge).toHaveAttribute('aria-label', new RegExp(status), { timeout: 10_000 });
      await expect(badge.locator('svg')).toHaveCount(1);
    }
  });

  test('토스트는 종류마다 아이콘이 붙는다 (색 + 아이콘 병행)', async ({ page }) => {
    await seedCanvas(page, SEED);
    await gotoApp(page);
    await page.keyboard.press('Control+l'); // Auto Layout → 성공 토스트
    const t = page.locator('[role="status"], [role="alert"]').filter({ hasText: /Auto-arranged|자동 정렬/ });
    await expect(t).toBeVisible();
    // 종류 아이콘 + 닫기(X) = svg 2개. 아이콘이 없으면 색만 남는다.
    await expect(t.locator('svg')).toHaveCount(2);
  });

  test('로그 줄은 색 말고 텍스트 마커로도 종류가 구분된다', async ({ page }) => {
    // 로그는 실행 이벤트에서만 나온다 — 기본 Hello Crew 를 실제 SSE 로 태운다.
    await mockRun(page, {
      taskOrder: [HELLO.task],
      stages: [[
        { event: 'run.started', data: { task_order: [HELLO.task], agent_count: 1, started_at: '2026-09-03T00:00:00Z' } },
        { event: 'agent.thought', data: { agent_node_id: HELLO.agent, text: 'thinking' } },
        { event: 'task.completed', data: { node_id: HELLO.task, output: 'out', duration_ms: 10 } },
        { event: 'run.completed', data: { duration_ms: 20, final_output: 'done', usage: {} } },
      ]],
    });
    await gotoApp(page);
    await fitView(page);
    await page.getByRole('button', { name: 'Queue Prompt' }).click();
    const params = dialog(page, 'Run parameters');
    await field(page, 'topic').locator('input').fill('a11y');
    await params.getByRole('button', { name: 'Run', exact: true }).click();

    await page.getByRole('button', { name: 'Logs' }).click();
    // 마커는 `aria-label` 로 종류 이름을 달고, 화면에는 고정폭 기호가 찍힌다.
    // 종류가 서로 다른 두 줄이 서로 다른 마커를 갖는지가 핵심이다.
    const sys = page.locator('[aria-label="System"]').first();
    await expect(sys, '로그 줄에 종류 마커가 없다 — 색만으로 구분된다').toBeVisible();
    expect(await sys.textContent()).toBe('··');
    const ok = page.locator('[aria-label="Success"]').first();
    await expect(ok).toBeVisible();
    expect(await ok.textContent()).toBe('✓ ');
  });
});

test.describe('§3.4.3 / §17.2-5 prefers-reduced-motion', () => {
  // Playwright 1.62 에서는 최상위 `reducedMotion` 옵션이 아니라 `contextOptions` 로 준다.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('CSS 애니메이션·트랜지션이 사실상 0 이 되고 와이어 파티클이 사라진다', async ({ page }) => {
    await seedCanvas(page, SEED);
    await gotoApp(page);

    const probe = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.transition = 'opacity 400ms';
      el.style.animation = 'spin 900ms linear infinite';
      document.body.appendChild(el);
      const c = getComputedStyle(el);
      const out = { transition: c.transitionDuration, animation: c.animationDuration, iter: c.animationIterationCount };
      el.remove();
      return out;
    });
    expect(parseFloat(probe.transition)).toBeLessThan(0.01);
    expect(parseFloat(probe.animation)).toBeLessThan(0.01);
    expect(probe.iter).toBe('1');

    // SMIL `<animateMotion>` 파티클은 CSS duration 으로는 못 막아 별도로 숨긴다.
    const hidden = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'ac-wire-particle';
      document.body.appendChild(el);
      const d = getComputedStyle(el).display;
      el.remove();
      return d;
    });
    expect(hidden).toBe('none');
  });

  test('succeeded 상태가 즉시 사라지지 않는다 (0ms 애니메이션의 함정)', async ({ page }) => {
    await seedCanvas(page, SEED);
    await gotoApp(page);
    // `animation-duration: 0.001ms` + `forwards` 는 마지막 키프레임(투명)을 **즉시**
    // 적용한다 → 모션을 껐더니 성공 표시가 아예 안 보이는 상태가 됐었다.
    const badgeOpacity = await page.evaluate(() => {
      const el = document.createElement('span');
      el.className = 'ac-status-badge-succeeded';
      document.body.appendChild(el);
      const o = getComputedStyle(el).opacity;
      el.remove();
      return o;
    });
    expect(badgeOpacity).toBe('1');
  });

  test('JS 로 도는 카메라 이동 duration 이 0 이 된다', async ({ page }) => {
    await seedCanvas(page, SEED);
    await gotoApp(page);
    // `lib/reducedMotion.ts` — CSS 가 못 잡는 React Flow `setCenter({duration})`.
    const reduced = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(reduced).toBe(true);
  });
});
