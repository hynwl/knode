/**
 * API_BASE 계산 — `backendStatus.ts`/`run/client.ts`/`export/client.ts`/
 * `templates/remote.ts` 4곳에 흩어져 있던 동일 로직(M6-T3)을 한 곳으로 모았다.
 *
 * `window.__AGENTCANVAS_API_BASE__` 가 있으면 그걸 쓴다 — Electron `preload`
 * 가 백엔드 사이드카의 실제 포트(포트 8000 점유 시 8001... 로 재시도, M6-T5)를
 * 렌더러에 주입하는 통로다. `NEXT_PUBLIC_API_BASE_URL` 은 Next 빌드 타임에
 * 값이 인라인돼 정적 export 산출물은 런타임에 포트를 바꿀 수 없으므로, 이
 * 재시도에는 대응하지 못한다. 둘 다 없으면 기존 기본값을 그대로 쓴다.
 *
 * 값을 상수로 캐싱하지 않고 매 호출마다 계산한다 — preload 가 페이지 스크립트
 * 실행 전에 `window.__AGENTCANVAS_API_BASE__` 를 심어 주는 게 보통이지만,
 * 그 타이밍을 모듈 로드 순서에 기대지 않기 위함이다.
 */

declare global {
  interface Window {
    __AGENTCANVAS_API_BASE__?: string;
  }
}

function runtimeOverride(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__AGENTCANVAS_API_BASE__;
}

export function getApiBase(): string {
  const base = runtimeOverride() ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
  return base.replace(/\/$/, '');
}

export function getApiPrefix(): string {
  return `${getApiBase()}/api/v1`;
}
