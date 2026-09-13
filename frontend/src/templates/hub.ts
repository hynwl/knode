/**
 * Hub 레지스트리 클라이언트 (M5-T7 · WORK_PLAN §5.6 P1).
 *
 * `knode-hub` 같은 별도 public 리포가 `scripts/build_index.py` 로 만든
 * `index.json` + `teams/<slug>/{team.acanvas.json,preview.png}` 를 정적으로
 * 서빙한다 — 백엔드가 아니라 raw 파일이므로 CORS 는 저장소 호스팅이 이미 허용한다
 * (GitHub raw 콘텐츠 기준).
 *
 * P-D3: self-host 는 레지스트리 없이 100% 동작해야 한다. `NEXT_PUBLIC_HUB_REGISTRY_URL`
 * 이 비어 있으면 네트워크를 아예 두드리지 않고 즉시 `available:false` 를 돌려준다 —
 * 호출부(TemplatesModal)는 이 값 하나로 "Hub" 탭 자체를 렌더링에서 뺀다.
 */

import type { CanvasDoc, ForkOrigin } from '@/types/canvas';

const RAW_URL = (process.env.NEXT_PUBLIC_HUB_REGISTRY_URL ?? '').replace(/\/$/, '') || null;
const REPO_URL_ENV = (process.env.NEXT_PUBLIC_HUB_REPO_URL ?? '').replace(/\/$/, '') || null;

/**
 * 레지스트리 **저장소**(사람이 PR 을 여는 곳) 주소. `RAW_URL` 은 정적 파일이
 * 놓인 위치라 그대로는 PR 을 열 수 없다.
 *
 * 배포자가 `NEXT_PUBLIC_HUB_REPO_URL` 을 주면 그 값을 쓰고, 안 줬어도 레지스트리가
 * GitHub raw 형태(`raw.githubusercontent.com/<owner>/<repo>/<ref>`)면 거기서
 * 유도한다 — `.env.example` 이 권하는 기본 설정이 정확히 그 꼴이라, 설정 하나로
 * 게시 가이드까지 따라오게 하려는 것이다. 유도도 실패하면 `null` 이고, 그때는
 * 게시 가이드가 링크 없이 텍스트 단계만 보여 준다 (M5-T8).
 */
export function hubRepoUrl(): string | null {
  if (REPO_URL_ENV) return REPO_URL_ENV;
  if (!RAW_URL) return null;
  const m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)(?:\/|$)/.exec(RAW_URL);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

export interface HubTeamEntry {
  slug: string;
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  author: string | null;
  license: string | null;
  revision: number;
  forked_from: ForkOrigin | null;
  created_at: string;
  updated_at: string;
  meta: { requires_keys: string[]; difficulty: 1 | 2 | 3 | null };
  /** `index.json` 기준 상대 경로 — `team.acanvas.json` */
  path: string;
  /** 〃 — `preview.png` */
  thumbnail: string;
}

export interface HubIndexResult {
  available: boolean;
  teams: HubTeamEntry[];
}

const UNAVAILABLE: HubIndexResult = { available: false, teams: [] };

/** `build_index.py` 의 `_load_team()` 이 항상 채우는 필드만 방어적으로 확인한다. */
function isHubTeamEntry(v: unknown): v is HubTeamEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.slug === 'string' && typeof o.id === 'string' && typeof o.name === 'string'
    && typeof o.path === 'string' && typeof o.thumbnail === 'string';
}

export function isHubConfigured(): boolean {
  return RAW_URL !== null;
}

export async function fetchHubIndex(): Promise<HubIndexResult> {
  if (!RAW_URL) return UNAVAILABLE;
  try {
    const res = await fetch(`${RAW_URL}/index.json`);
    if (!res.ok) return UNAVAILABLE;
    const body = await res.json() as { teams?: unknown };
    const teams = Array.isArray(body.teams) ? body.teams.filter(isHubTeamEntry) : [];
    return { available: true, teams };
  } catch {
    return UNAVAILABLE;
  }
}

/** 카드 썸네일 — index.json 에는 데이터가 아니라 `teams/<slug>/preview.png` 경로만 있다. */
export function hubThumbnailUrl(entry: HubTeamEntry): string | null {
  return RAW_URL ? `${RAW_URL}/${entry.thumbnail}` : null;
}

/**
 * Fork 클릭 시에만 부른다 — 목록 조회(`fetchHubIndex`)는 썸네일 URL만 갖고 있고
 * 실제 그래프(`team.acanvas.json`)는 카드 100장을 한꺼번에 내려받지 않도록 지연 로드한다.
 * 실패하면 그대로 throw — 호출부(`page.tsx`)가 토스트로 알린다.
 */
export async function fetchHubTeamDoc(entry: HubTeamEntry): Promise<CanvasDoc> {
  if (!RAW_URL) throw new Error('hub registry is not configured');
  const res = await fetch(`${RAW_URL}/${entry.path}`);
  if (!res.ok) throw new Error(`hub team fetch failed (${res.status})`);
  return await res.json() as CanvasDoc;
}

/** fork 계보(`ForkOrigin.source`)에 남길 출처 문자열. */
export function hubSourceUrl(): string | null {
  return RAW_URL;
}
