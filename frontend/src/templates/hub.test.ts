/**
 * `hub.ts` — 특히 "URL 미설정이면 네트워크를 아예 안 두드린다"(M5 P-D3)를
 * 회귀 가드한다. `NEXT_PUBLIC_HUB_REGISTRY_URL` 은 모듈 로드 시점에 한 번만
 * 읽히므로, 케이스마다 `vi.resetModules()` 로 다시 불러온다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubTeamEntry } from './hub';

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_HUB_REGISTRY_URL;
const ORIGINAL_REPO_ENV = process.env.NEXT_PUBLIC_HUB_REPO_URL;

async function loadHub() {
  vi.resetModules();
  return import('./hub');
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_HUB_REGISTRY_URL;
  else process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = ORIGINAL_ENV;
  if (ORIGINAL_REPO_ENV === undefined) delete process.env.NEXT_PUBLIC_HUB_REPO_URL;
  else process.env.NEXT_PUBLIC_HUB_REPO_URL = ORIGINAL_REPO_ENV;
});

const FULL_ENTRY: HubTeamEntry = {
  slug: 'research-duo',
  id: 'cvs_hub_a',
  name: 'Research Duo',
  description: 'Two agents, one report.',
  tags: ['research'],
  author: 'octocat',
  license: 'MIT',
  revision: 2,
  forked_from: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
  meta: { requires_keys: ['OPENAI_API_KEY'], difficulty: 2 },
  path: 'teams/research-duo/team.acanvas.json',
  thumbnail: 'teams/research-duo/preview.png',
};

describe('fetchHubIndex()', () => {
  it('레지스트리 URL 미설정이면 fetch 를 호출하지 않고 즉시 unavailable', async () => {
    delete process.env.NEXT_PUBLIC_HUB_REGISTRY_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { fetchHubIndex, isHubConfigured } = await loadHub();

    expect(isHubConfigured()).toBe(false);
    expect(await fetchHubIndex()).toEqual({ available: false, teams: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('정상 index.json 을 팀 목록으로 파싱하고 구조가 불완전한 항목은 걸러낸다', async () => {
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://example.test/hub';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ teams: [FULL_ENTRY, { slug: 'broken' }] }),
    }));
    const { fetchHubIndex } = await loadHub();

    const result = await fetchHubIndex();
    expect(result).toEqual({ available: true, teams: [FULL_ENTRY] });
  });

  it('HTTP 실패는 unavailable 로 흡수한다', async () => {
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://example.test/hub';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { fetchHubIndex } = await loadHub();

    expect(await fetchHubIndex()).toEqual({ available: false, teams: [] });
  });

  it('네트워크 예외도 unavailable 로 흡수한다', async () => {
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://example.test/hub';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { fetchHubIndex } = await loadHub();

    expect(await fetchHubIndex()).toEqual({ available: false, teams: [] });
  });
});

describe('hubThumbnailUrl()', () => {
  it('base URL 끝 슬래시를 정규화하고 상대 경로를 이어붙인다', async () => {
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://example.test/hub/';
    const { hubThumbnailUrl } = await loadHub();

    expect(hubThumbnailUrl(FULL_ENTRY)).toBe('https://example.test/hub/teams/research-duo/preview.png');
  });

  it('미설정이면 null', async () => {
    delete process.env.NEXT_PUBLIC_HUB_REGISTRY_URL;
    const { hubThumbnailUrl } = await loadHub();

    expect(hubThumbnailUrl(FULL_ENTRY)).toBeNull();
  });
});

describe('fetchHubTeamDoc()', () => {
  it('미설정이면 fetch 없이 곧바로 throw', async () => {
    delete process.env.NEXT_PUBLIC_HUB_REGISTRY_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { fetchHubTeamDoc } = await loadHub();

    await expect(fetchHubTeamDoc(FULL_ENTRY)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('경로를 base URL 에 이어붙여 문서를 가져온다', async () => {
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://example.test/hub';
    const doc = { id: 'cvs_hub_a', name: 'Research Duo' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => doc });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchHubTeamDoc } = await loadHub();

    await expect(fetchHubTeamDoc(FULL_ENTRY)).resolves.toEqual(doc);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/hub/teams/research-duo/team.acanvas.json');
  });

  it('HTTP 실패는 throw 로 전달한다(호출부가 토스트로 알린다)', async () => {
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://example.test/hub';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { fetchHubTeamDoc } = await loadHub();

    await expect(fetchHubTeamDoc(FULL_ENTRY)).rejects.toThrow();
  });
});

/**
 * 게시 가이드(M5-T8)가 PR 을 열 주소. 레지스트리 URL 은 **정적 파일이 놓인 자리**라
 * 그대로는 PR 을 열 수 없어서, 배포자가 준 값 → GitHub raw 형태에서 유도 → 없음
 * 순으로 결정한다.
 */
describe('hubRepoUrl()', () => {
  it('GitHub raw 레지스트리에서는 리포 주소를 유도한다', async () => {
    delete process.env.NEXT_PUBLIC_HUB_REPO_URL;
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://raw.githubusercontent.com/hynwl/knode-hub/main';
    const { hubRepoUrl } = await loadHub();

    expect(hubRepoUrl()).toBe('https://github.com/hynwl/knode-hub');
  });

  it('명시 설정이 있으면 유도보다 우선한다', async () => {
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://raw.githubusercontent.com/hynwl/knode-hub/main';
    process.env.NEXT_PUBLIC_HUB_REPO_URL = 'https://git.example.test/teams/hub/';
    const { hubRepoUrl } = await loadHub();

    expect(hubRepoUrl()).toBe('https://git.example.test/teams/hub');
  });

  it('유도할 수 없는 호스트면 null — 가이드가 링크 없이 단계만 보여 준다', async () => {
    delete process.env.NEXT_PUBLIC_HUB_REPO_URL;
    process.env.NEXT_PUBLIC_HUB_REGISTRY_URL = 'https://cdn.example.test/hub';
    const { hubRepoUrl } = await loadHub();

    expect(hubRepoUrl()).toBeNull();
  });

  it('레지스트리 자체가 미설정이면 null', async () => {
    delete process.env.NEXT_PUBLIC_HUB_REPO_URL;
    delete process.env.NEXT_PUBLIC_HUB_REGISTRY_URL;
    const { hubRepoUrl } = await loadHub();

    expect(hubRepoUrl()).toBeNull();
  });
});
