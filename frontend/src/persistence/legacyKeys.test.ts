// @vitest-environment jsdom
/**
 * 저장소 키 이관 가드 (`agentcanvas.*` → `knode.*`, 2026-09-14 개명).
 *
 * 이 파일이 지키는 건 스타일이 아니라 **사용자 데이터**다. 이관이 조용히 깨지면
 * 저장해 둔 캔버스·API 키·커스텀 템플릿이 브라우저에 그대로 있는데도 앱이 못 찾아
 * 전부 날아간 것처럼 보인다. 실제로 이 코드를 처음 쓸 때 일괄 치환 스크립트가
 * `LEGACY_PREFIX` 까지 `knode.` 로 바꿔 이관을 무력화한 적이 있는데, 무해한 no-op
 * 이라 테스트 없이는 아무도 모른 채 지나갔을 것이다.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { migrateLegacyStorageKeys } from './legacyKeys';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('migrateLegacyStorageKeys', () => {
  it('옛 키를 새 키로 옮기고 옛 키는 남기지 않는다', () => {
    const doc = JSON.stringify({ id: 'cvs_1', nodes: [{ id: 'n1' }] });
    window.localStorage.setItem('agentcanvas.workspace.v1', doc);

    migrateLegacyStorageKeys();

    expect(window.localStorage.getItem('knode.workspace.v1')).toBe(doc);
    expect(window.localStorage.getItem('agentcanvas.workspace.v1')).toBeNull();
  });

  it('흩어져 있는 키 전부를 접두사로 잡아낸다', () => {
    // 네 모듈에 흩어진 키들 — 목록을 손으로 들고 다니면 빠뜨리는 그 지점이다.
    const keys = [
      'agentcanvas.workspace.v1', 'agentcanvas.projects.v1', 'agentcanvas.secrets.v1',
      'agentcanvas.settings.v1', 'agentcanvas.inputs.v1', 'agentcanvas.onboarding.v1',
      'agentcanvas.templates.custom.v1', 'agentcanvas.templates.hidden.v1',
      'agentcanvas.templates.source.v1', 'agentcanvas.logPanel.height.v1',
      'agentcanvas.locale.v1',
    ];
    keys.forEach((k, i) => window.localStorage.setItem(k, `v${i}`));

    migrateLegacyStorageKeys();

    keys.forEach((k, i) => {
      const moved = `knode.${k.slice('agentcanvas.'.length)}`;
      expect(window.localStorage.getItem(moved)).toBe(`v${i}`);
      expect(window.localStorage.getItem(k)).toBeNull();
    });
  });

  it('새 키가 이미 있으면 옛 값으로 덮지 않는다', () => {
    window.localStorage.setItem('agentcanvas.locale.v1', 'en');
    window.localStorage.setItem('knode.locale.v1', 'ko');

    migrateLegacyStorageKeys();

    expect(window.localStorage.getItem('knode.locale.v1')).toBe('ko');
    expect(window.localStorage.getItem('agentcanvas.locale.v1')).toBeNull();
  });

  it('온보딩 플래그가 사는 sessionStorage 도 이관한다', () => {
    window.sessionStorage.setItem('agentcanvas.onboarding.v1', '1');

    migrateLegacyStorageKeys();

    expect(window.sessionStorage.getItem('knode.onboarding.v1')).toBe('1');
    expect(window.sessionStorage.getItem('agentcanvas.onboarding.v1')).toBeNull();
  });

  it('접두사가 다른 키는 건드리지 않는다', () => {
    window.localStorage.setItem('other.thing', 'keep');
    window.localStorage.setItem('knode.workspace.v1', 'already-new');

    migrateLegacyStorageKeys();

    expect(window.localStorage.getItem('other.thing')).toBe('keep');
    expect(window.localStorage.getItem('knode.workspace.v1')).toBe('already-new');
  });

  it('두 번 돌려도 결과가 같다 (import 가 여러 번 걸려도 안전)', () => {
    window.localStorage.setItem('agentcanvas.workspace.v1', 'doc');

    migrateLegacyStorageKeys();
    migrateLegacyStorageKeys();

    expect(window.localStorage.getItem('knode.workspace.v1')).toBe('doc');
    expect(window.localStorage.length).toBe(1);
  });
});
