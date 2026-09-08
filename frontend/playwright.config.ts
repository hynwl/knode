import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 설정 (Spec §18 "E2E 필수 시나리오" 7종, M4-T7)
 *
 * ⚠️ **포트 3000 을 쓰지 않는다.** 이 리포는 개발 중 `next dev` 가 3000 에 떠 있는
 * 상태로 여러 세션이 붙는다 — E2E 가 3000 을 잡으면 사람이 보고 있는 화면을 뺏는다.
 *
 * ⚠️ **`.next` 를 공유하지 않는다.** `next build`/`next dev` 는 같은 distDir 를
 * 덮어써서 먼저 떠 있던 dev 서버의 코어 청크를 404 로 만든다 (이 리포에서 실제로
 * 두 번 발생 — `next.config.mjs` 상단 주석). 그래서 E2E 서버는 `NEXT_DIST_DIR`
 * 로 `.next-e2e` 를 쓰고, 그 부작용으로 Next 가 다시 써 버리는 추적 파일
 * (`tsconfig.json` · `next-env.d.ts`)은 `globalTeardown` 이 원복한다.
 *
 * dev 모드를 쓰는 이유: 프로덕션 빌드는 매 실행마다 1분 이상 걸리는 데다 위
 * 추적 파일 오염이 더 크다. 시나리오 7종은 전부 클라이언트 동작이라 dev 로 충분하다.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DIST_DIR = process.env.E2E_DIST_DIR ?? '.next-e2e';

export default defineConfig({
  testDir: './e2e',
  /** 캔버스 애니메이션·SSE 배치(50ms)·재연결 백오프(1s)가 얽혀 있어 넉넉히 준다. */
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalTeardown: './e2e/global-teardown.ts',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    /**
     * 로케일을 못 박는다. `i18n/index.ts::detectLocale` 이 `navigator.languages` 로
     * ko/en 을 고르므로, 고정하지 않으면 실행 머신에 따라 셀렉터 문자열이 바뀐다.
     * E2E 는 영어 번들을 기준으로 쓴다.
     */
    locale: 'en-US',
    timezoneId: 'UTC',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],

  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NEXT_DIST_DIR: DIST_DIR,
      // 백엔드는 전부 `page.route()` 로 모킹한다 (Spec §18 시나리오 2 "백엔드 모킹").
      // 기본값(localhost:8000)과 같지만, 실행 머신의 .env 가 다른 주소를 심어도
      // 라우트 패턴이 어긋나지 않도록 여기서 고정한다.
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:8000',
      // M5-T7 Hub — 이 값 자체는 아무 데도 존재하지 않는다. 실제 응답은 항상
      // `page.route()` 가 준다(위와 같은 이유). 값이 있다는 사실 하나만으로
      // "Hub" 탭이 렌더링되므로, 탭을 안 건드리는 다른 시나리오에도 영향 없다
      // (탭은 index.json 요청이 오프라인으로 실패하면 그냥 안 뜬다).
      NEXT_PUBLIC_HUB_REGISTRY_URL: 'https://hub.example.test/registry',
    },
  },
});
