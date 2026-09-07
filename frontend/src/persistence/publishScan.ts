/**
 * 게시 프리플라이트 스캐너 (M5-T2 · WORK_PLAN §5.6 P0 · 리스크 R8)
 *
 * `secretScanner.ts` 와 **일부러 분리한 모듈**이다. 둘은 목적도 정책도 다르다.
 *
 * |            | `secretScanner` (Export/Import)      | `publishScan` (게시)                |
 * |------------|-------------------------------------|-------------------------------------|
 * | 찾는 것    | API 키 6종                          | 키 + 사내주소·내 경로·이메일·전화·본문 |
 * | 정책       | 하나라도 나오면 **차단**(AC-E404)    | **경고 + 개별 마스킹** 후 사용자가 결정 |
 * | 왜         | 파일이 키를 담으면 그건 사고다        | 게시는 "무엇이 공개되는지"를 보여주는 일 |
 *
 * 게시에서 더 위험한 건 키가 아니다. 키는 애초에 노드 데이터에 안 들어가고
 * (`key_ref` 는 슬롯 id 만 담는다, Spec §12.1) Export 단계가 이미 막는다. 실제로
 * 새는 건 **프롬프트에 남은 사내 도메인·내 홈 디렉터리 경로·개인 이메일**처럼
 * "키가 아니라서 아무도 안 보던" 값들이다.
 *
 * ⚠️ 이 스캐너가 못 잡는 것: **프롬프트 속 실명·사업 기밀 같은 자유 서술**.
 * 정규식으로 사람 이름을 판정하려 들면 오탐만 쌓이고 신뢰를 잃는다. 그건
 * M5-T3(공개될 내용 미리보기 모달)이 **사람 눈으로** 보게 하는 몫이고, 이 모듈은
 * 그 모달이 하이라이트할 좌표(`start`/`end`)를 넘겨주는 역할까지만 한다.
 */

import type { CanvasDoc } from '@/types/canvas';
import { SECRET_PATTERNS } from './secretScanner';

/* ────────────────────────────── 규칙 ────────────────────────────── */

export const PUBLISH_RULES = [
  'secret',
  'private_host',
  'loopback_url',
  'custom_endpoint',
  'local_path',
  'abs_path',
  'email',
  'phone',
  'inline_body',
] as const;
export type PublishRule = (typeof PUBLISH_RULES)[number];

/**
 * `block` 은 **키뿐**이다 — 키는 사용자가 "괜찮다"고 판단할 여지가 없다.
 * 나머지는 맥락을 아는 사람만 판단할 수 있으므로 막지 않고 보여준다.
 */
export type PublishRisk = 'block' | 'warn' | 'info';

export const RULE_RISK: Record<PublishRule, PublishRisk> = {
  secret: 'block',
  private_host: 'warn',
  local_path: 'warn',
  email: 'warn',
  phone: 'warn',
  loopback_url: 'info',
  custom_endpoint: 'info',
  abs_path: 'info',
  inline_body: 'info',
};

/** 마스킹 시 매치 자리에 들어갈 문자열. 규칙마다 다른 이유는 T3 미리보기에서 무엇이 지워졌는지 읽히게 하기 위해서다. */
export const MASK_TOKEN: Record<PublishRule, string> = {
  secret: '***REDACTED***',
  private_host: '[redacted:url]',
  loopback_url: '[redacted:url]',
  custom_endpoint: '[redacted:url]',
  local_path: '[redacted:path]',
  abs_path: '[redacted:path]',
  email: '[redacted:email]',
  phone: '[redacted:phone]',
  inline_body: '[redacted:text]',
};

export interface PublishFinding {
  /** 재스캔해도 같은 값 — T3 모달이 "이건 마스킹" 선택을 들고 다니는 열쇠 */
  id: string;
  rule: PublishRule;
  risk: PublishRisk;
  /** `$.nodes[2].data.base_url` */
  path: string;
  nodeId: string | null;
  nodeType: string | null;
  /** 노드 데이터 필드명 (`base_url`). 문서 최상위 값이면 `null` */
  field: string | null;
  /** 원문에서 잘라낸 매치 (하이라이트용) */
  match: string;
  /** 화면 표시용 — 키·이메일처럼 그대로 보여주면 안 되는 건 여기서 가려진다 */
  preview: string;
  /** 해당 문자열 안에서의 오프셋 */
  start: number;
  end: number;
  /** i18n 메시지에 꽂을 값. **번역된 문자열을 여기 굳혀 넣지 않는다** (M4-T4 교훈) */
  params?: Record<string, string | number>;
}

export interface PublishScanResult {
  findings: PublishFinding[];
  /** `risk === 'block'` — 이게 비어야 게시할 수 있다 */
  blocking: PublishFinding[];
  counts: Record<PublishRisk, number>;
}

/* ─────────────────────────── 판정 데이터 ─────────────────────────── */

/**
 * 공개 LLM 엔드포인트. 여기 있으면 `base_url` 이 채워져 있어도 조용히 통과한다
 * (오탐 픽스처가 요구하는 "공개 API URL 은 통과").
 * ⚠️ `*.openai.azure.com` 은 **일부러 뺐다** — 조직마다 다른 호스트라 그 자체가
 * 조직 식별자다.
 */
const PUBLIC_ENDPOINT_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.perplexity.ai',
  'api.cohere.com',
  'api.x.ai',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'integrate.api.nvidia.com',
]);

/** 조직 내부 전용 TLD. `.test`/`.example`/`.invalid` 는 RFC 2606 문서용이라 뺀다. */
const INTERNAL_TLDS = ['local', 'internal', 'intranet', 'corp', 'lan', 'home', 'private'];

/** RFC 2606 문서용 도메인 — 여기로 가는 이메일은 실제 사람이 아니다. */
const EXAMPLE_DOMAINS = ['example.com', 'example.net', 'example.org', 'example.edu'];

/** 경로 값을 담는 필드. 여기서는 평범한 절대경로도 (info 로) 짚어준다. */
const PATH_FIELDS = new Set(['output_file', 'storage_path', 'file_ref']);

/** 커스텀 엔드포인트 필드 — 스킴이 없어도 호스트로 읽어 준다. */
const ENDPOINT_FIELDS = new Set(['base_url']);

/** 이 길이를 넘는 knowledge 본문은 "그대로 공개된다"고 알린다. */
const INLINE_BODY_MIN = 120;

/* ────────────────────────────── 순회 ────────────────────────────── */

interface StringSite {
  path: string;
  value: string;
  nodeId: string | null;
  nodeType: string | null;
  field: string | null;
}

/**
 * 문서의 **사람이 쓴 문자열만** 훑는다. 방문자가 문자열을 돌려주면 그 자리에 써 넣는다
 * (스캔과 마스킹이 같은 순회를 쓰게 해서 둘이 어긋날 수 없게 만든 것).
 *
 * 건드리지 않는 것: `viewport`/`position`/`ui`(좌표·플래그), `edges`(id 뿐),
 * `id`/`schema_version`/`app_version`/타임스탬프(기계값), 그리고 **`meta.thumbnail`**
 * — 200KB 짜리 data: URI 를 정규식 9종에 태울 이유가 없다.
 */
function walkDoc(doc: CanvasDoc, visit: (site: StringSite) => string | void): void {
  const walk = (
    container: Record<string, unknown> | unknown[],
    key: string | number,
    path: string,
    ctx: Omit<StringSite, 'path' | 'value'>,
  ): void => {
    const value = (container as Record<string | number, unknown>)[key];
    if (typeof value === 'string') {
      if (!value) return;
      const replacement = visit({ path, value, ...ctx });
      if (typeof replacement === 'string' && replacement !== value) {
        (container as Record<string | number, unknown>)[key] = replacement;
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((_, i) => walk(value, i, `${path}[${i}]`, ctx));
      return;
    }
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) {
        walk(value as Record<string, unknown>, k, `${path}.${k}`, ctx);
      }
    }
  };

  const root = doc as unknown as Record<string, unknown>;
  const bare = { nodeId: null, nodeType: null, field: null };
  for (const k of ['name', 'description', 'author', 'tags']) walk(root, k, `$.${k}`, bare);
  if (doc.forked_from) {
    const fork = doc.forked_from as unknown as Record<string, unknown>;
    for (const k of ['source', 'name']) walk(fork, k, `$.forked_from.${k}`, bare);
  }

  doc.nodes?.forEach((node, i) => {
    const data = node.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return;
    const nodeId = node.id ?? null;
    const nodeType = (node.type as string | undefined) ?? null;
    for (const field of Object.keys(data)) {
      walk(data, field, `$.nodes[${i}].data.${field}`, { nodeId, nodeType, field });
    }
  });
}

/* ────────────────────────────── 탐지기 ────────────────────────────── */

type Hit = { rule: PublishRule; start: number; end: number; match: string; params?: PublishFinding['params'] };

function detect(site: StringSite): Hit[] {
  return [
    ...detectSecrets(site.value),
    ...detectUrls(site),
    ...detectPaths(site),
    ...detectEmails(site.value),
    ...detectPhones(site.value),
    ...detectInlineBody(site),
  ];
}

function detectSecrets(value: string): Hit[] {
  const hits: Hit[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const g = new RegExp(re.source, 'g');
    for (const m of value.matchAll(g)) {
      hits.push({
        rule: 'secret',
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
        params: { pattern: name },
      });
    }
  }
  return hits;
}

const URL_RE = /\bhttps?:\/\/[^\s"'`<>)\]}]+/gi;
/** 스킴 없이 적힌 엔드포인트 (`localhost:11434`, `llm.corp:8000/v1`) */
const BARE_HOST_RE = /^[A-Za-z0-9._-]+(?::\d{2,5})?(?:\/[^\s]*)?$/;

function detectUrls(site: StringSite): Hit[] {
  const hits: Hit[] = [];
  const isEndpoint = site.field !== null && ENDPOINT_FIELDS.has(site.field);

  const classify = (host: string, start: number, end: number, match: string) => {
    const kind = hostKind(host);
    if (kind === 'loopback') {
      hits.push({ rule: 'loopback_url', start, end, match, params: { host } });
    } else if (kind === 'private') {
      hits.push({ rule: 'private_host', start, end, match, params: { host } });
    } else if (isEndpoint && !PUBLIC_ENDPOINT_HOSTS.has(host)) {
      hits.push({ rule: 'custom_endpoint', start, end, match, params: { host } });
    }
  };

  for (const m of site.value.matchAll(URL_RE)) {
    // 문장 끝에 붙은 구두점까지 URL 로 먹으면 하이라이트 범위가 한 칸 넘치고,
    // `https://wiki.acme.internal.` 처럼 **끝점 때문에 TLD 판정이 빗나간다**.
    const raw = m[0].replace(/[.,;:!?'"]+$/, '');
    const host = hostOf(raw);
    if (host) classify(host, m.index, m.index + raw.length, raw);
  }

  // 스킴 없는 값은 URL 정규식이 못 잡는다. 엔드포인트 필드에 한해 한 번 더 본다.
  if (isEndpoint && !/^https?:\/\//i.test(site.value) && BARE_HOST_RE.test(site.value.trim())) {
    const trimmed = site.value.trim();
    const host = hostOf(`http://${trimmed}`);
    if (host && (host.includes('.') || host === 'localhost' || /:\d/.test(trimmed))) {
      const start = site.value.indexOf(trimmed);
      classify(host, start, start + trimmed.length, trimmed);
    }
  }
  return hits;
}

function hostOf(url: string): string | null {
  try {
    // 후행 점(FQDN 표기)은 벗긴다 — `acme.internal.` 의 마지막 라벨이 빈 문자열이 되면
    // 내부 TLD 판정을 통째로 빠져나간다.
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** `public` = 외부에서 접근 가능한 이름. 나머지는 게시하면 남이 못 쓰거나, 조직 내부를 드러낸다. */
function hostKind(host: string): 'loopback' | 'private' | 'public' {
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host)) return 'loopback';
  if (host.endsWith('.localhost')) return 'loopback';

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 169 && b === 254) return 'private';
    return 'public';
  }
  // IPv6 유니크 로컬(fc00::/7) · 링크 로컬(fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return 'private';

  const labels = host.split('.');
  const tld = labels[labels.length - 1]!;
  if (INTERNAL_TLDS.includes(tld)) return 'private';
  // 점이 없는 호스트 = 사내 DNS 로만 풀리는 이름 (`http://jira/`, `http://wiki:8080`)
  if (labels.length === 1) return 'private';
  return 'public';
}

/** 사용자명이 박히는 경로 — 이건 그 자체로 PII 다. */
const HOME_PATH_RES: RegExp[] = [
  /\/Users\/[^/\s"'`,;]+(?:\/[^\s"'`,;]*)*/g,
  /\/home\/[^/\s"'`,;]+(?:\/[^\s"'`,;]*)*/g,
  /\/Volumes\/[^\s"'`,;]+/g,
  /[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"'`,;]*/g,
];

function detectPaths(site: StringSite): Hit[] {
  const hits: Hit[] = [];
  for (const re of HOME_PATH_RES) {
    for (const m of site.value.matchAll(new RegExp(re.source, 'g'))) {
      hits.push({ rule: 'local_path', start: m.index, end: m.index + m[0].length, match: m[0] });
    }
  }
  // 경로 필드에 들어 있는 그 밖의 절대경로 (`/data/out.md`, `D:\work\out.md`).
  // 사용자명은 안 드러나지만 게시본을 받은 사람 머신에는 없는 자리다.
  if (site.field && PATH_FIELDS.has(site.field) && !hits.length) {
    const v = site.value.trim();
    if (/^(\/[^/]|[A-Za-z]:[\\/])/.test(v)) {
      const start = site.value.indexOf(v);
      hits.push({ rule: 'abs_path', start, end: start + v.length, match: v });
    }
  }
  return hits;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;

function detectEmails(value: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of value.matchAll(EMAIL_RE)) {
    const domain = m[0].split('@')[1]!.toLowerCase();
    if (EXAMPLE_DOMAINS.includes(domain)) continue;
    if (/\.(example|invalid|test)$/.test(domain)) continue;
    hits.push({ rule: 'email', start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  return hits;
}

/**
 * 전화번호. 구분자 두 개를 **요구**해서 날짜(`2026-09-08`)·버전·토큰 숫자열과 갈라놓는다.
 * 뒤에 숫자가 더 붙는 긴 숫자열도 제외한다.
 */
const PHONE_RE = /(?:\+\d{1,3}[ -])?(?:0\d{1,2}|\(0?\d{1,3}\))[ -]\d{3,4}[ -]\d{4}/g;

function detectPhones(value: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of value.matchAll(PHONE_RE)) {
    const before = value[m.index - 1] ?? '';
    const after = value[m.index + m[0].length] ?? '';
    if (/[\d-]/.test(before) || /[\d-]/.test(after)) continue;
    hits.push({ rule: 'phone', start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  return hits;
}

function detectInlineBody(site: StringSite): Hit[] {
  if (site.nodeType !== 'knowledge' || site.field !== 'content') return [];
  if (site.value.length < INLINE_BODY_MIN) return [];
  return [{
    rule: 'inline_body',
    start: 0,
    end: site.value.length,
    match: site.value,
    params: { chars: site.value.length },
  }];
}

/* ────────────────────────────── 공개 API ────────────────────────────── */

/** 게시 직전 프리플라이트. 문서를 **바꾸지 않는다**. */
export function scanForPublish(doc: CanvasDoc): PublishScanResult {
  const findings: PublishFinding[] = [];
  walkDoc(doc, (site) => {
    for (const hit of detect(site)) {
      findings.push({
        id: `${site.path}|${hit.rule}|${hit.start}`,
        rule: hit.rule,
        risk: RULE_RISK[hit.rule],
        path: site.path,
        nodeId: site.nodeId,
        nodeType: site.nodeType,
        field: site.field,
        match: hit.match,
        preview: previewOf(hit.rule, hit.match),
        start: hit.start,
        end: hit.end,
        ...(hit.params ? { params: hit.params } : {}),
      });
    }
  });

  const counts: Record<PublishRisk, number> = { block: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.risk] += 1;
  return { findings, blocking: findings.filter((f) => f.risk === 'block'), counts };
}

/**
 * 고른 발견 항목만 마스킹한 **사본**을 돌려준다 (원본 문서는 그대로).
 * `ids` 를 생략하면 전부 마스킹한다.
 */
export function maskForPublish<T extends CanvasDoc>(
  doc: T,
  findings: PublishFinding[],
  ids?: Iterable<string>,
): T {
  const selected = ids ? new Set(ids) : new Set(findings.map((f) => f.id));
  const byPath = new Map<string, PublishFinding[]>();
  for (const f of findings) {
    if (!selected.has(f.id)) continue;
    const list = byPath.get(f.path);
    if (list) list.push(f); else byPath.set(f.path, [f]);
  }
  const clone = JSON.parse(JSON.stringify(doc)) as T;
  if (!byPath.size) return clone;

  walkDoc(clone, (site) => {
    const list = byPath.get(site.path);
    if (!list) return;
    // 뒤에서부터 바꿔야 앞 매치의 오프셋이 밀리지 않는다. 겹치는 매치는 뒤엣것만 쓴다.
    let out = site.value;
    let lastStart = out.length + 1;
    for (const f of [...list].sort((a, b) => b.start - a.start)) {
      if (f.end > lastStart) continue;
      if (out.slice(f.start, f.end) !== f.match) continue;
      out = out.slice(0, f.start) + MASK_TOKEN[f.rule] + out.slice(f.end);
      lastStart = f.start;
    }
    return out;
  });
  return clone;
}

/** 화면에 그대로 띄우면 안 되는 값은 여기서 가린다. */
function previewOf(rule: PublishRule, match: string): string {
  if (rule === 'secret') {
    return match.length <= 10 ? `${match.slice(0, 3)}***` : `${match.slice(0, 6)}***${match.slice(-4)}`;
  }
  if (rule === 'email') {
    const [local = '', domain = ''] = match.split('@');
    const head = local.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
  }
  if (rule === 'phone') return `${match.slice(0, 4)}***${match.slice(-2)}`;
  if (rule === 'local_path') {
    // 경로에서 위험한 건 사용자명 한 칸이다. 나머지 구조는 보여야 판단이 된다.
    return match.replace(/^((?:\/Users|\/home)\/)([^/]+)/, (_, head: string, user: string) =>
      `${head}${user.slice(0, 1)}${'*'.repeat(Math.max(1, user.length - 1))}`);
  }
  if (match.length <= 80) return match;
  return `${match.slice(0, 77)}…`;
}
