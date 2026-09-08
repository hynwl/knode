import { describe, expect, it } from 'vitest';

import {
  bundleFilename,
  hubSlug,
  isValidSlug,
  normalizeSlug,
  submissionShell,
  teamReadme,
} from './submission';
import { CURRENT_SCHEMA_VERSION, APP_VERSION, DEFAULT_NODE_UI, type AcNode, type CanvasDoc } from '@/types/canvas';

function node(id: string, type: string, data: Record<string, unknown>): AcNode {
  return {
    id, type: type as AcNode['type'], position: { x: 0, y: 0 }, width: null, height: null,
    data, ui: { ...DEFAULT_NODE_UI }, parentNode: null, extent: null,
  };
}

function doc(patch: Partial<CanvasDoc> = {}): CanvasDoc {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    app_version: APP_VERSION,
    id: 'cvs_01JABCDEF',
    name: 'Market Research Crew',
    description: 'Three researchers and one analyst.',
    tags: [],
    author: 'octocat',
    license: 'MIT',
    revision: 0,
    forked_from: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      node('llm_1', 'llm', { provider: 'openai', model: 'gpt-4o-mini' }),
      node('agent_2', 'agent', { name: 'Analyst', role: 'Market analyst' }),
      node('task_3', 'task', { name: 'Synthesize', expected_output: 'A one-page report' }),
    ],
    edges: [],
    meta: { requires_keys: ['OPENAI_API_KEY'] },
    ...patch,
  };
}

describe('hubSlug', () => {
  it('영문 이름을 kebab-case 로 만든다', () => {
    expect(hubSlug('Market Research Crew')).toBe('market-research-crew');
    expect(hubSlug('  Blog & SEO Crew!  ')).toBe('blog-seo-crew');
  });

  it('발음기호는 ASCII 로 접는다', () => {
    expect(hubSlug('Résumé Tailor')).toBe('resume-tailor');
  });

  /**
   * 이게 이 함수가 `fileIO.slugify` 와 갈라진 이유다 — 저쪽은 한글을 그대로 남기지만
   * 여기 결과는 공용 리포의 디렉터리명이자 URL 경로가 된다.
   */
  it('이름이 통째로 비ASCII 면 문서 id 꼬리로 서로 다른 이름을 만든다', () => {
    expect(hubSlug('시장 조사 리포트', 'cvs_tpl_market')).toBe('team-market');
    expect(hubSlug('로컬 전용 요약봇', 'cvs_tpl_local')).toBe('team-llocal');
    expect(hubSlug('한글만', '')).toBe('team');
  });

  it('길어도 48자를 넘지 않고 하이픈으로 끝나지 않는다', () => {
    const slug = hubSlug('a'.repeat(40) + ' ' + 'b'.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('normalizeSlug / isValidSlug', () => {
  it('입력 중에도 안전한 문자만 남긴다', () => {
    expect(normalizeSlug('My Team!!')).toBe('my-team-');
    expect(normalizeSlug('--lead')).toBe('lead');
    expect(normalizeSlug('a__b')).toBe('a-b');
  });

  it('유효성은 앞뒤가 영숫자인 kebab 만 통과시킨다', () => {
    expect(isValidSlug('market-research')).toBe(true);
    expect(isValidSlug('team-')).toBe(false);
    expect(isValidSlug('-team')).toBe(false);
    expect(isValidSlug('Team')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });
});

describe('teamReadme', () => {
  it('문서 값에서 메타 표·에이전트·태스크를 채운다', () => {
    const md = teamReadme(doc());
    expect(md).toContain('# Market Research Crew');
    expect(md).toContain('| Author | octocat |');
    expect(md).toContain('| License | MIT |');
    expect(md).toContain('`OPENAI_API_KEY`');
    expect(md).toContain('`openai/gpt-4o-mini`');
    expect(md).toContain('| Analyst | Market analyst |');
    expect(md).toContain('1. **Synthesize** — expects A one-page report');
  });

  it('키가 없는 팀은 로컬 실행 안내를 준다', () => {
    const md = teamReadme(doc({ meta: { requires_keys: [] } }));
    expect(md).toContain('none — runs locally');
    expect(md).toContain('Ollama');
  });

  it('라이선스를 안 고르면 표에 빈칸이 아니라 "지정 안 함"이 남는다', () => {
    expect(teamReadme(doc({ license: null }))).toContain('| License | _not specified_ |');
  });

  /** 표 안의 파이프는 표 자체를 깨뜨린다 — 값이 사용자 입력이라 반드시 이스케이프한다. */
  it('셀 안의 파이프와 줄바꿈을 무해하게 만든다', () => {
    const md = teamReadme(doc({
      nodes: [node('agent_1', 'agent', { name: 'A|B', role: 'first line\nsecond line' })],
    }));
    expect(md).toContain('| A\\|B | first line second line |');
  });

  it('사람이 채울 자리는 자동 문장 대신 주석으로 남긴다', () => {
    expect(teamReadme(doc())).toContain('<!-- A sentence or two');
  });

  /**
   * README 는 화면이 아니라 공용 리포에 커밋되는 파일이다. UI 로케일과 무관하게
   * 영어여야 같은 리포 안에서 문서가 갈리지 않는다.
   */
  it('로케일과 무관하게 영어 헤딩을 쓴다', () => {
    const md = teamReadme(doc());
    expect(md).toContain('## Run it');
    expect(md).not.toMatch(/[가-힣]/);
  });
});

describe('submissionShell', () => {
  it('다운로드명 → 레지스트리 파일명 변환을 명령 안에서 보여 준다', () => {
    const shell = submissionShell({ slug: 'market-research', downloadedDocName: bundleFilename('market-research') });
    expect(shell).toContain('mkdir -p teams/market-research');
    expect(shell).toContain('mv ~/Downloads/market-research.acanvas.json teams/market-research/team.acanvas.json');
    expect(shell).toContain('mv ~/Downloads/preview.png teams/market-research/preview.png');
    expect(shell).toContain('python3 scripts/build_index.py');
    expect(shell).toContain('python3 scripts/validate_submission.py market-research');
  });
});
