import { expect, test } from '@playwright/test';

import { gotoApp } from './helpers';

/**
 * 오프닝 화면(`panels/Welcome.tsx`).
 *
 * 이 화면은 **처음 온 사람에게만** 뜨고, 한 번 들어가면 다시 뜨지 않아야 한다
 * (`knode.onboarding.v1`). 다른 스펙들은 `gotoApp()` 이 그 플래그를 미리
 * 심어 이 화면을 건너뛰므로, 진짜로 뜨는지 확인하는 곳은 여기뿐이다.
 *
 * 셀렉터를 `data-testid="welcome"` 안으로 좁히는 이유: 뒤의 앱이 마운트된 채로
 * 남아 있어 언어 토글 같은 컨트롤이 DOM 에 두 벌 존재한다. 실제 사용자에겐
 * `inert` 가 막아 주지만 Playwright 의 role 질의는 그걸 거르지 않는다.
 */
test.describe('오프닝 화면', () => {
  test('창을 새로 열면 매번 다시 뜬다', async ({ browser }) => {
    // 같은 브라우저의 **새 컨텍스트** = 창을 닫았다 다시 연 것. 오프닝 화면은
    // 이 앱의 현관이라 그때마다 다시 보여야 한다(세션 범위 기억).
    for (const _ of [1, 2]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await gotoApp(page, { welcome: true });
      await expect(page.getByTestId('welcome')).toBeVisible();

      await page.getByRole('button', { name: 'Get Started!' }).click();
      await expect(page.getByTestId('welcome')).toBeHidden();
      await context.close();
    }
  });

  test('첫 방문에 뜨고, 들어가면 캔버스가 열리고, 새로고침해도 다시 뜨지 않는다', async ({ page }) => {
    await gotoApp(page, { welcome: true });
    const welcome = page.getByTestId('welcome');

    const cta = welcome.getByRole('button', { name: 'Get Started!' });
    await expect(cta).toBeVisible();
    // 진짜 편집 화면 데모 영상이 히어로에 실제로 **로드**되는가. `toBeVisible()` 은
    // width/height 속성만 보고 통과하므로(로드 전에도 자리를 차지한다) 경로가
    // 깨진 것은 `videoWidth` 로만 잡힌다 — 첫 프레임 디코딩까지 기다린다.
    const clip = welcome.locator('.stage video');
    await expect(clip).toBeVisible();
    await expect
      .poll(() => clip.evaluate((el: HTMLVideoElement) => el.videoWidth))
      .toBeGreaterThan(0);

    await cta.click();
    await expect(welcome).toBeHidden();
    await expect(page.locator('.react-flow')).toBeVisible();

    await page.reload();
    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.getByTestId('welcome')).toBeHidden();
  });

  test('GitHub 링크와 Releases 링크가 올바르게 작동한다', async ({ page }) => {
    await gotoApp(page, { welcome: true });
    const welcome = page.getByTestId('welcome');

    // GitHub 링크 확인
    const ghLink = welcome.getByRole('link', { name: /Visit our GitHub/ });
    await expect(ghLink).toBeVisible();

    // Releases 링크 확인
    const releasesLink = welcome.getByRole('link', { name: /MAC OS.*Windows Download/ });
    await expect(releasesLink).toBeVisible();
  });

  test('`?welcome` 은 이미 본 사람에게도 다시 띄운다', async ({ page }) => {
    // 플래그를 심어 둔 채로(= 이미 본 사람) 연다.
    await gotoApp(page);
    await expect(page.getByTestId('welcome')).toBeHidden();

    await page.goto('/?welcome');
    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('기능 소개 섹션이 표시된다', async ({ page }) => {
    await gotoApp(page, { welcome: true });
    const welcome = page.getByTestId('welcome');

    // 기능 그리드가 있는지 확인
    const featuresSection = welcome.locator('[data-testid="features-section"]');
    await expect(featuresSection).toBeVisible();
  });

  test('Esc 로도 건너뛸 수 있다', async ({ page }) => {
    await gotoApp(page, { welcome: true });

    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('welcome')).toBeHidden();
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('화면이 떠 있는 동안 뒤의 앱은 inert 라 키보드로 닿지 않는다', async ({ page }) => {
    await gotoApp(page, { welcome: true });
    await expect(page.getByTestId('welcome')).toBeVisible();

    // 헤더의 "Templates" 는 앱 쪽 버튼이다. `inert` 구간에 있으면 초점 자체를 못 받는다.
    const appButton = page.locator('div[inert]').getByRole('button', { name: 'Templates' });
    await expect(appButton).toHaveCount(1);
    const tookFocus = await appButton.evaluate((el: HTMLElement) => {
      el.focus();
      return document.activeElement === el;
    });
    expect(tookFocus).toBe(false);
  });
});
