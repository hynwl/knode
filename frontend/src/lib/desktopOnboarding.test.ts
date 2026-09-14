import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOnboardingStatus, isDesktopApp, markOnboardingSeen, revealWorkspaceFolder } from './desktopOnboarding';

afterEach(() => {
  // @ts-expect-error -- 테스트에서만 존재하는 전역, node 환경 기본값은 undefined
  delete globalThis.window;
});

describe('isDesktopApp', () => {
  it('window 자체가 없으면(SSR) false', () => {
    expect(isDesktopApp()).toBe(false);
  });

  it('브리지가 없는 웹 배포면 false', () => {
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = {};
    expect(isDesktopApp()).toBe(false);
  });

  it('브리지가 있으면 true', () => {
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = { __KNODE_ONBOARDING_BRIDGE__: { status: vi.fn(), markSeen: vi.fn(), revealWorkspace: vi.fn() } };
    expect(isDesktopApp()).toBe(true);
  });
});

describe('fetchOnboardingStatus', () => {
  it('웹 배포에서는 브리지를 호출하지 않고 null', async () => {
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = {};
    await expect(fetchOnboardingStatus()).resolves.toBeNull();
  });

  it('데스크톱에서는 브리지 결과를 그대로 반환한다', async () => {
    const status = { firstRun: true, userDataDir: '/tmp/userData', workspaceDir: '/tmp/userData/workspace' };
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = {
      __KNODE_ONBOARDING_BRIDGE__: {
        status: vi.fn().mockResolvedValue(status), markSeen: vi.fn(), revealWorkspace: vi.fn(),
      },
    };
    await expect(fetchOnboardingStatus()).resolves.toEqual(status);
  });

  it('IPC 호출이 던져도 null 로 흡수한다', async () => {
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = {
      __KNODE_ONBOARDING_BRIDGE__: {
        status: vi.fn().mockRejectedValue(new Error('boom')), markSeen: vi.fn(), revealWorkspace: vi.fn(),
      },
    };
    await expect(fetchOnboardingStatus()).resolves.toBeNull();
  });
});

describe('markOnboardingSeen / revealWorkspaceFolder', () => {
  it('웹 배포에서는 조용히 아무것도 안 한다', async () => {
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = {};
    await expect(markOnboardingSeen()).resolves.toBeUndefined();
    await expect(revealWorkspaceFolder()).resolves.toBeUndefined();
  });

  it('데스크톱에서는 각각의 브리지 메서드를 호출한다', async () => {
    const markSeen = vi.fn().mockResolvedValue(undefined);
    const revealWorkspace = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = { __KNODE_ONBOARDING_BRIDGE__: { status: vi.fn(), markSeen, revealWorkspace } };
    await markOnboardingSeen();
    await revealWorkspaceFolder();
    expect(markSeen).toHaveBeenCalledOnce();
    expect(revealWorkspace).toHaveBeenCalledOnce();
  });
});
