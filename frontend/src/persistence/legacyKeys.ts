/**
 * `agentcanvas.*` → `knode.*` 저장소 키 이관 (2026-09-14 개명).
 *
 * 표시용 문자열과 달리 저장소 키는 **이미 나가 있는 데이터와의 계약**이다. 키만
 * 갈아끼우면 사용자가 저장해 둔 캔버스·API 키·커스텀 템플릿이 그 자리에 그대로
 * 있는데도 앱이 못 찾아 전부 사라진 것처럼 보인다. 그래서 새 키로 읽기 전에
 * 옛 키를 **옮긴다**.
 *
 * 개별 키 목록이 아니라 **접두사**로 훑는 이유: 키는 `localStorage.ts` ·
 * `templates/custom.ts` · `panels/LogPanel.tsx` · `i18n/index.ts` 네 군데에
 * 흩어져 있어서 목록을 들고 다니면 하나 빠뜨린 게 조용한 데이터 손실이 된다.
 * 접두사로 쓸면 빠뜨릴 키가 없다.
 *
 * **복사가 아니라 이동**이다. 이 앱은 LocalStorage 쿼터가 실제 제약이라
 * (`QuotaError` / `AC-E405`) 큰 워크스페이스를 두 벌 두면 다음 자동 저장이
 * 터진다.
 *
 * 모듈을 import 하는 것만으로 1회 실행된다 — 키를 읽는 네 모듈이 각자 맨 위에서
 * import 하므로, 어느 경로로 앱이 시작되든 첫 읽기보다 먼저 끝나 있다.
 * (ES 모듈은 몇 번을 import 해도 본문이 한 번만 평가된다.)
 */

const LEGACY_PREFIX = 'agentcanvas.';
const PREFIX = 'knode.';

function migrate(store: Storage): void {
  // 순회 중에 지우면 인덱스가 밀리므로 먼저 대상만 모은다.
  const legacy: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key);
  }

  for (const oldKey of legacy) {
    const newKey = PREFIX + oldKey.slice(LEGACY_PREFIX.length);
    try {
      // 새 키가 이미 있으면 그쪽이 최신이다 — 옛 값으로 덮지 않고 흔적만 치운다.
      if (store.getItem(newKey) === null) {
        const value = store.getItem(oldKey);
        if (value !== null) store.setItem(newKey, value);
      }
      store.removeItem(oldKey);
    } catch {
      /* 쿼터·프라이빗 모드로 실패하면 옛 키를 그대로 남긴다 — 다음 실행에 다시 시도한다. */
    }
  }
}

export function migrateLegacyStorageKeys(): void {
  if (typeof window === 'undefined') return;
  // 온보딩 플래그는 sessionStorage 에 산다 (`SESSION_KEYS` 주석 참조).
  for (const get of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      migrate(get());
    } catch {
      /* 저장소 접근 자체가 막힌 환경(사파리 프라이빗 등) — 이관할 것도 없다. */
    }
  }
}

migrateLegacyStorageKeys();
