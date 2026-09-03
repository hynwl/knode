/**
 * `prefers-reduced-motion` 을 **JS 쪽에서** 존중하기 위한 헬퍼 (Spec §3.4.3 / §17.2).
 *
 * `globals.css` 의 `@media (prefers-reduced-motion: reduce)` 블록은 CSS 애니메이션과
 * 트랜지션만 무력화한다. 하지만 이 앱의 모션 중 일부는 **JS 가 숫자로 들고 있는
 * duration** 이라 CSS 가 손댈 수 없다 (M4-T9 전수 점검에서 확인):
 *
 *   - React Flow 카메라 이동: `setCenter(..., { duration: 500 })` — 에러 → 노드
 *     포커스(Spec §17.4)에서 화면 전체가 500ms 동안 미끄러진다. 전정기관 반응을
 *     유발하는 전형적인 "큰 화면 이동" 이라 §3.4.3 이 겨냥하는 바로 그 모션이다.
 *   - Auto Layout: `store.applyLayout` 이 `.ac-layout-animating` 을 켜서 모든 노드를
 *     260ms 동안 미끄러뜨린다. CSS 로 duration 만 0 이 돼도 되지만, 애초에 클래스를
 *     안 켜는 쪽이 rAF 한 프레임을 낭비하지 않는다.
 *
 * SSR 과 `matchMedia` 가 없는 환경(jsdom 구버전 등)에서는 `false` 로 본다 —
 * 모션을 끄는 쪽이 아니라 켜는 쪽이 기본값이어야 기존 동작이 유지된다.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 모션 감소가 켜져 있으면 0, 아니면 원래 duration(ms) 을 그대로 돌려준다. */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
