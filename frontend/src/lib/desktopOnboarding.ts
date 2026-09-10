/**
 * `desktop/onboarding/firstRun.ts`(M6-T7)가 preload 로 심어 두는 IPC 브리지의
 * 프론트 쪽 접근자. 웹 배포에는 `window.__AGENTCANVAS_ONBOARDING_BRIDGE__` 가
 * 아예 없으므로 그 부재 자체가 "Electron 이 아니다" 판정이다 — 별도 환경 플래그가
 * 필요 없다(`lib/apiBase.ts`, `store/secrets.ts` 의 Electron 감지와 같은 패턴).
 */

export interface OnboardingStatus {
  firstRun: boolean;
  userDataDir: string;
  workspaceDir: string;
}

interface OnboardingBridge {
  status: () => Promise<OnboardingStatus>;
  markSeen: () => Promise<void>;
  revealWorkspace: () => Promise<void>;
}

declare global {
  interface Window {
    __AGENTCANVAS_ONBOARDING_BRIDGE__?: OnboardingBridge;
  }
}

function bridge(): OnboardingBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__AGENTCANVAS_ONBOARDING_BRIDGE__;
}

export function isDesktopApp(): boolean {
  return bridge() !== undefined;
}

/** 웹 배포에서는 즉시 `null` — 호출부가 매번 `isDesktopApp()` 을 먼저 물을 필요가 없다. */
export async function fetchOnboardingStatus(): Promise<OnboardingStatus | null> {
  const b = bridge();
  if (!b) return null;
  try {
    return await b.status();
  } catch {
    return null;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  await bridge()?.markSeen().catch(() => {});
}

export async function revealWorkspaceFolder(): Promise<void> {
  await bridge()?.revealWorkspace().catch(() => {});
}
