/**
 * 게시 프리플라이트 스캐너 픽스처 테스트 (M5-T2 · WORK_PLAN §5.6 P0 검증란)
 *
 * > 픽스처: 커스텀 `base_url`, `/Users/...` 경로, 개인 이메일, 사내 도메인이 전부 걸림.
 * > 오탐 픽스처(공개 API URL)는 통과
 *
 * **오탐 픽스처가 이 파일의 절반인 게 의도다.** 게시 경고는 한 번 시끄러워지면
 * 사용자가 통째로 무시하기 시작하고, 그 순간 진짜 유출을 놓친다.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_NODE_UI, type AcNode, type CanvasDoc } from '@/types/canvas';
import type { NodeType } from '@/nodes/registry';
import { lookupExact } from '@/i18n';
import { BUILTIN_TEMPLATES } from '@/templates/builtin';
import { SECRET_PATTERNS } from './secretScanner';
import {
  MASK_TOKEN, PUBLISH_RULES, RULE_RISK, maskForPublish, scanForPublish,
  type PublishRule,
} from './publishScan';

/* ────────────────────────────── 픽스처 ────────────────────────────── */

function node(id: string, type: NodeType, data: Record<string, unknown>): AcNode {
  return { id, type, position: { x: 0, y: 0 }, data, ui: { ...DEFAULT_NODE_UI } };
}

function doc(nodes: AcNode[], extra: Partial<CanvasDoc> = {}): CanvasDoc {
  return {
    schema_version: '1.0',
    app_version: '0.1.0',
    id: 'cvs_test',
    name: 'Test Canvas',
    created_at: '2026-09-08T00:00:00.000Z',
    updated_at: '2026-09-08T00:00:00.000Z',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges: [],
    meta: { requires_keys: [] },
    ...extra,
  };
}

/** 규칙별 발견 목록 (순서 무관 단언용) */
function rules(d: CanvasDoc): PublishRule[] {
  return scanForPublish(d).findings.map((f) => f.rule).sort();
}

function findingsOf(d: CanvasDoc, rule: PublishRule) {
  return scanForPublish(d).findings.filter((f) => f.rule === rule);
}

/* ────────────────────── 계획서가 요구한 네 가지 ────────────────────── */

describe('걸려야 하는 것 (WORK_PLAN M5-T2 검증란)', () => {
  it('커스텀 base_url — 우리가 아는 공개 엔드포인트가 아니면 짚어준다', () => {
    const hits = findingsOf(
      doc([node('llm_1', 'llm', { provider: 'openai_compatible', base_url: 'https://llm.acme-corp.io/v1' })]),
      'custom_endpoint',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.params).toEqual({ host: 'llm.acme-corp.io' });
    expect(hits[0]!.field).toBe('base_url');
    expect(hits[0]!.nodeId).toBe('llm_1');
  });

  it('/Users/... 경로 — 계정 이름이 드러나므로 warn 이고, 미리보기에서 계정명이 가려진다', () => {
    const hits = findingsOf(
      doc([node('task_1', 'task', { output_file: '/Users/hyunwoo/work/report.md' })]),
      'local_path',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.risk).toBe('warn');
    expect(hits[0]!.match).toBe('/Users/hyunwoo/work/report.md');
    expect(hits[0]!.preview).toBe('/Users/h******/work/report.md');
  });

  it('개인 이메일 — 프롬프트 한복판에 있어도 잡고, 로컬파트를 가려서 보여준다', () => {
    const hits = findingsOf(
      doc([node('task_1', 'task', { description: '결과를 hong.gildong@gmail.com 으로 보내줘' })]),
      'email',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.match).toBe('hong.gildong@gmail.com');
    expect(hits[0]!.preview).toBe('ho**********@gmail.com');
  });

  it('사내 도메인 — 내부 전용 TLD 도, 점 없는 사내 호스트도 잡는다', () => {
    expect(rules(doc([node('k_1', 'knowledge', { url: 'https://wiki.acme.internal/handbook' })])))
      .toEqual(['private_host']);
    expect(rules(doc([node('k_1', 'knowledge', { url: 'http://jira:8080/browse/AC-1' })])))
      .toEqual(['private_host']);
    expect(rules(doc([node('k_1', 'knowledge', { url: 'https://build.acme.corp/' })])))
      .toEqual(['private_host']);
  });
});

/* ────────────────────────── 오탐 픽스처 ────────────────────────── */

describe('통과해야 하는 것 (오탐 방지)', () => {
  it('공개 API URL 은 base_url 에 그대로 있어도 조용하다', () => {
    for (const url of [
      'https://api.openai.com/v1',
      'https://api.anthropic.com',
      'https://openrouter.ai/api/v1',
      'https://generativelanguage.googleapis.com/v1beta',
    ]) {
      expect(rules(doc([node('llm_1', 'llm', { base_url: url })]))).toEqual([]);
    }
  });

  it('프롬프트 속 공개 웹사이트 링크는 발견이 아니다 (엔드포인트 필드가 아니다)', () => {
    expect(rules(doc([node('task_1', 'task', {
      description: '참고: https://docs.crewai.com/concepts/agents 와 https://github.com/hynwl/agentcanvas',
    })]))).toEqual([]);
  });

  it('문서용 예약 도메인 이메일(example.com 등)은 실제 사람이 아니다', () => {
    expect(rules(doc([node('task_1', 'task', {
      description: 'you@example.com, someone@example.org, dev@my.example, qa@acme.invalid 로 보낸다',
    })]))).toEqual([]);
  });

  it('날짜·버전·긴 숫자열을 전화번호로 오인하지 않는다', () => {
    expect(rules(doc([node('task_1', 'task', {
      description: '2026-09-08 릴리스, 버전 1.15.18, 주문번호 0123-4567-8901-2345',
    })]))).toEqual([]);
  });

  it('상대 경로 산출물은 짚지 않는다 (게시본을 받은 쪽에서도 성립한다)', () => {
    expect(rules(doc([node('task_1', 'task', { output_file: 'output/report.md' })]))).toEqual([]);
  });

  it('짧은 Knowledge 본문은 알리지 않는다 — 본문 노드는 원래 본문을 담는 자리다', () => {
    expect(rules(doc([node('k_1', 'knowledge', { source_type: 'text', content: '요약 규칙 3줄' })]))).toEqual([]);
  });

  it('좌표·플래그·엣지·타임스탬프는 아예 훑지 않는다', () => {
    const d = doc([{ ...node('n1', 'note', { text: 'ok' }), position: { x: 127.0, y: 10 } }], {
      edges: [{ id: '/Users/x', source: 'a', sourceHandle: 'o', target: 'b', targetHandle: 'i' }],
      created_at: '/Users/nope/created',
    });
    expect(rules(d)).toEqual([]);
  });

  it('meta.thumbnail(200KB data: URI)은 스캔 대상이 아니다', () => {
    const thumbnail = `data:image/png;base64,${'A'.repeat(200_000)}`;
    const d = doc([node('n1', 'note', { text: 'ok' })], { meta: { requires_keys: [], thumbnail } });
    const started = performance.now();
    expect(rules(d)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

/* ────────────────────────── 규칙별 세부 ────────────────────────── */

describe('URL 분류', () => {
  it('루프백은 유출이 아니라 이식성 문제라 info 다 (Ollama 기본값이 여기 해당한다)', () => {
    const d = doc([node('llm_1', 'llm', { provider: 'ollama', base_url: 'http://localhost:11434' })]);
    const [hit, ...rest] = scanForPublish(d).findings;
    expect(rest).toEqual([]);
    expect(hit!.rule).toBe('loopback_url');
    expect(hit!.risk).toBe('info');
  });

  it('스킴 없이 적은 엔드포인트도 호스트로 읽는다', () => {
    expect(rules(doc([node('llm_1', 'llm', { base_url: 'localhost:11434' })]))).toEqual(['loopback_url']);
    expect(rules(doc([node('llm_1', 'llm', { base_url: 'ollama.acme.internal:11434' })]))).toEqual(['private_host']);
  });

  it('사설 IP 대역은 private, 공인 IP 는 아니다', () => {
    for (const host of ['10.0.0.5', '192.168.1.10', '172.20.3.4', '169.254.1.1']) {
      expect(rules(doc([node('k_1', 'knowledge', { url: `http://${host}/doc` })]))).toEqual(['private_host']);
    }
    expect(rules(doc([node('k_1', 'knowledge', { url: 'http://8.8.8.8/doc' })]))).toEqual([]);
  });

  it('문장 끝 구두점을 URL 에 먹지 않는다 (하이라이트 범위 + TLD 판정)', () => {
    const d = doc([node('t_1', 'task', { description: '자료는 https://wiki.acme.internal. 에 있다.' })]);
    const [hit] = scanForPublish(d).findings;
    expect(hit!.rule).toBe('private_host');
    expect(hit!.match).toBe('https://wiki.acme.internal');
    expect(hit!.params).toEqual({ host: 'wiki.acme.internal' });
  });

  it('마크다운 링크 안의 URL 도 괄호를 먹지 않는다', () => {
    const d = doc([node('t_1', 'task', { description: '[핸드북](https://wiki.acme.internal/hb) 참고' })]);
    const [hit] = scanForPublish(d).findings;
    expect(hit!.match).toBe('https://wiki.acme.internal/hb');
  });

  it('127.0.0.1 은 사설이 아니라 루프백으로 분류한다', () => {
    expect(rules(doc([node('llm_1', 'llm', { base_url: 'http://127.0.0.1:1234/v1' })]))).toEqual(['loopback_url']);
  });
});

describe('경로', () => {
  it('윈도우 사용자 경로도 잡는다', () => {
    expect(rules(doc([node('m_1', 'memory', { storage_path: 'C:\\Users\\hyunwoo\\ac\\memory' })])))
      .toEqual(['local_path']);
  });

  it('경로 필드의 그 밖의 절대경로는 info 로만 알린다 (계정명이 없다)', () => {
    const hits = findingsOf(doc([node('m_1', 'memory', { storage_path: '/var/data/ac' })]), 'abs_path');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.risk).toBe('info');
  });

  it('경로 필드가 아닌 자유 서술의 /var 같은 경로까지 짚지는 않는다', () => {
    expect(rules(doc([node('task_1', 'task', { description: '로그는 /var/log 에 쌓인다' })]))).toEqual([]);
  });
});

describe('Knowledge 본문', () => {
  it('긴 본문은 글자 수와 함께 알린다', () => {
    const content = '사'.repeat(300);
    const hits = findingsOf(doc([node('k_1', 'knowledge', { source_type: 'text', content })]), 'inline_body');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.params).toEqual({ chars: 300 });
    expect(hits[0]!.preview.endsWith('…')).toBe(true);
  });

  it('같은 길이라도 Knowledge 가 아닌 노드의 본문은 대상이 아니다', () => {
    expect(rules(doc([node('n_1', 'note', { text: '메'.repeat(300) })]))).toEqual([]);
  });
});

/* ────────────────────────── 키 = 유일한 차단 ────────────────────────── */

describe('시크릿', () => {
  it('키는 block 이고, 그것만 block 이다', () => {
    const d = doc([node('llm_1', 'llm', { base_url: `https://api.acme.internal/v1?token=sk-${'a'.repeat(32)}` })]);
    const res = scanForPublish(d);
    expect(res.blocking.map((f) => f.rule)).toEqual(['secret']);
    expect(res.counts.block).toBe(1);
    expect(res.findings.some((f) => f.rule === 'private_host')).toBe(true);
    expect(res.findings.filter((f) => f.risk === 'block')).toEqual(res.blocking);
  });

  it('미리보기에 키 원문이 남지 않는다', () => {
    const key = `sk-ant-${'b'.repeat(40)}`;
    const [hit] = findingsOf(doc([node('t_1', 'task', { description: `키는 ${key} 야` })]), 'secret');
    expect(hit!.preview).not.toContain(key);
    expect(hit!.preview).toContain('***');
  });

  /**
   * 드리프트 가드 — Export 스캐너에 패턴이 하나 늘었는데 게시 스캐너는 그대로면,
   * "파일로는 못 내보내는 키가 게시로는 나가는" 구멍이 생긴다.
   */
  it('Export 스캐너의 키 패턴 전량을 게시 스캐너도 잡는다', () => {
    const samples: Record<string, string> = {
      OpenAI: `sk-${'a'.repeat(32)}`,
      Anthropic: `sk-ant-${'a'.repeat(32)}`,
      Google: `AIza${'a'.repeat(35)}`,
      Groq: `gsk_${'a'.repeat(32)}`,
      GitHub: `ghp_${'a'.repeat(32)}`,
      Bearer: `Bearer ${'a'.repeat(32)}`,
    };
    expect(Object.keys(samples).sort()).toEqual(SECRET_PATTERNS.map((p) => p.name).sort());
    for (const [name, sample] of Object.entries(samples)) {
      const hits = findingsOf(doc([node('t_1', 'task', { description: sample })]), 'secret');
      expect(hits.map((h) => h.params?.pattern)).toContain(name);
    }
  });
});

/* ────────────────────────────── 마스킹 ────────────────────────────── */

describe('maskForPublish', () => {
  const sample = () => doc([
    node('t_1', 'task', { description: '보고서를 kim@acme.co.kr 로, 사본은 /Users/hyunwoo/out.md 에' }),
    node('llm_1', 'llm', { base_url: 'https://llm.acme.internal/v1' }),
  ]);

  it('원본 문서를 건드리지 않는다', () => {
    const d = sample();
    const before = JSON.stringify(d);
    maskForPublish(d, scanForPublish(d).findings);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('전부 마스킹하면 재스캔에서 발견이 사라진다', () => {
    const d = sample();
    const masked = maskForPublish(d, scanForPublish(d).findings);
    expect(scanForPublish(masked).findings).toEqual([]);
    expect(masked.nodes[0]!.data.description)
      .toBe(`보고서를 ${MASK_TOKEN.email} 로, 사본은 ${MASK_TOKEN.local_path} 에`);
  });

  it('고른 것만 마스킹한다 — 나머지는 원문 그대로 남는다', () => {
    const d = sample();
    const { findings } = scanForPublish(d);
    const email = findings.find((f) => f.rule === 'email')!;
    const masked = maskForPublish(d, findings, [email.id]);
    expect(masked.nodes[0]!.data.description).toContain(MASK_TOKEN.email);
    expect(masked.nodes[0]!.data.description).toContain('/Users/hyunwoo/out.md');
    expect(masked.nodes[1]!.data.base_url).toBe('https://llm.acme.internal/v1');
  });

  it('한 문자열에 여러 발견이 있어도 오프셋이 밀리지 않는다', () => {
    const d = doc([node('t_1', 'task', {
      description: 'a@acme.co.kr / b@acme.co.kr / /Users/u/x.md / c@acme.co.kr',
    })]);
    const masked = maskForPublish(d, scanForPublish(d).findings);
    expect(masked.nodes[0]!.data.description).toBe(
      `${MASK_TOKEN.email} / ${MASK_TOKEN.email} / ${MASK_TOKEN.local_path} / ${MASK_TOKEN.email}`,
    );
  });

  it('id 는 재스캔해도 같다 (모달이 선택을 들고 다닐 수 있어야 한다)', () => {
    const d = sample();
    expect(scanForPublish(d).findings.map((f) => f.id))
      .toEqual(scanForPublish(sample()).findings.map((f) => f.id));
  });

  it('아무것도 안 고르면 사본만 돌려준다', () => {
    const d = sample();
    const out = maskForPublish(d, scanForPublish(d).findings, []);
    expect(out).toEqual(d);
    expect(out).not.toBe(d);
  });
});

/* ────────────────────────── 문서 최상위 메타 ────────────────────────── */

describe('노드 밖 필드', () => {
  it('author·description·tags·forked_from 도 게시된다 — 같이 훑는다', () => {
    const d = doc([node('n1', 'note', { text: 'ok' })], {
      author: 'hong@acme.co.kr',
      description: '사내 위키: https://wiki.acme.internal',
      tags: ['/Users/hyunwoo/private'],
      forked_from: { id: 'x', revision: 1, source: 'http://hub.acme.internal/teams/x' },
    });
    expect(rules(d)).toEqual(['email', 'local_path', 'private_host', 'private_host']);
  });
});

/* ────────────────────────── i18n 드리프트 가드 ────────────────────────── */

describe('i18n', () => {
  it('모든 규칙이 ko/en 양쪽에 라벨과 설명을 갖는다', () => {
    for (const rule of PUBLISH_RULES) {
      for (const locale of ['ko', 'en'] as const) {
        expect(lookupExact(locale, `publish.rule.${rule}.label`), `${locale}:${rule}.label`).toBeTruthy();
        expect(lookupExact(locale, `publish.rule.${rule}.desc`), `${locale}:${rule}.desc`).toBeTruthy();
      }
    }
  });

  it('모든 위험도가 ko/en 양쪽에 이름을 갖는다', () => {
    for (const risk of new Set(Object.values(RULE_RISK))) {
      expect(lookupExact('ko', `publish.risk.${risk}`)).toBeTruthy();
      expect(lookupExact('en', `publish.risk.${risk}`)).toBeTruthy();
    }
  });

  it('규칙마다 마스킹 토큰과 위험도가 빠짐없이 정의돼 있다', () => {
    for (const rule of PUBLISH_RULES) {
      expect(MASK_TOKEN[rule]).toBeTruthy();
      expect(RULE_RISK[rule]).toBeTruthy();
    }
    expect(Object.keys(MASK_TOKEN).sort()).toEqual([...PUBLISH_RULES].sort());
    expect(Object.keys(RULE_RISK).sort()).toEqual([...PUBLISH_RULES].sort());
  });
});

/* ────────────────────── 우리가 실을 시드 콘텐츠 ────────────────────── */

/**
 * P1(M5-T8)의 시드 10종은 이 스캐너를 통과한 채로 올라가야 한다. 우리가 만든
 * 템플릿이 게시 화면에서 빨갛게 뜨면 사용자는 그 경고를 신뢰하지 않게 된다.
 */
describe('내장 템플릿 5종', () => {
  it('경고·차단이 하나도 없다 (로컬 모델의 루프백 안내만 허용)', () => {
    for (const meta of BUILTIN_TEMPLATES) {
      const res = scanForPublish(meta.build());
      expect(res.counts.block, meta.id).toBe(0);
      expect(res.counts.warn, meta.id).toBe(0);
      expect(res.findings.map((f) => f.rule).filter((r) => r !== 'loopback_url'), meta.id).toEqual([]);
    }
  });
});
