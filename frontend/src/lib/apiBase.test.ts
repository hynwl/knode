import { afterEach, describe, expect, it } from 'vitest';
import { getApiBase, getApiPrefix } from './apiBase';

const ENV_KEY = 'NEXT_PUBLIC_API_BASE_URL';

afterEach(() => {
  delete process.env[ENV_KEY];
  // @ts-expect-error -- 테스트에서만 존재하는 전역, node 환경 기본값은 undefined
  delete globalThis.window;
});

describe('getApiBase', () => {
  it('env 도 window 오버라이드도 없으면 기본값을 쓴다', () => {
    expect(getApiBase()).toBe('http://localhost:8000');
  });

  it('NEXT_PUBLIC_API_BASE_URL 이 있으면 그걸 쓴다 (끝 슬래시 제거)', () => {
    process.env[ENV_KEY] = 'https://api.example.com/';
    expect(getApiBase()).toBe('https://api.example.com');
  });

  it('window.__KNODE_API_BASE__ 가 있으면 env 보다 우선한다', () => {
    process.env[ENV_KEY] = 'https://build-time.example.com';
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = { __KNODE_API_BASE__: 'http://127.0.0.1:8001/' };
    expect(getApiBase()).toBe('http://127.0.0.1:8001');
  });

  it('window 는 있지만 __KNODE_API_BASE__ 가 없으면 env/기본값으로 흡수한다', () => {
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = {};
    expect(getApiBase()).toBe('http://localhost:8000');
  });
});

describe('getApiPrefix', () => {
  it('base 뒤에 /api/v1 을 붙인다', () => {
    expect(getApiPrefix()).toBe('http://localhost:8000/api/v1');
  });

  it('런타임 오버라이드에도 동일하게 적용된다', () => {
    // @ts-expect-error -- node 테스트 환경에 window 를 직접 주입
    globalThis.window = { __KNODE_API_BASE__: 'http://127.0.0.1:8002' };
    expect(getApiPrefix()).toBe('http://127.0.0.1:8002/api/v1');
  });
});
