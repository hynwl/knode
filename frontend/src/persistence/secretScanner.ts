/**
 * 시크릿 스캐너 (Spec §7.4)
 * `.acanvas.json` 에는 API 키가 **절대** 들어가지 않는다.
 * Export 직전과 Import 직후 양쪽에서 실행한다.
 */

export interface SecretHit {
  path: string;
  pattern: string;
  preview: string;
}

/**
 * ⚠️ 이 목록은 `publishScan.ts`(게시 프리플라이트)도 그대로 쓴다 — 게시 스캐너가
 * Export 스캐너보다 약해지는 일이 없도록 **한 곳에서만** 정의한다.
 * `publishScan.test.ts` 의 드리프트 가드가 이 관계를 지킨다.
 */
export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'OpenAI', re: /sk-[a-zA-Z0-9_-]{20,}/ },
  { name: 'Anthropic', re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'Google', re: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'Groq', re: /gsk_[a-zA-Z0-9]{20,}/ },
  { name: 'GitHub', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'Bearer', re: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/ },
];

export const REDACTED = '***REDACTED***';

/** 문서 전체를 순회하며 문자열 필드를 스캔한다. */
export function scanForSecrets(value: unknown, path = '$'): SecretHit[] {
  const hits: SecretHit[] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === 'string') {
      for (const { name, re } of SECRET_PATTERNS) {
        const m = re.exec(v);
        if (m) hits.push({ path: p, pattern: name, preview: mask(m[0]) });
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((item, i) => walk(item, `${p}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) walk(item, `${p}.${k}`);
    }
  };
  walk(value, path);
  return hits;
}

/** Import 시 사용: 발견된 시크릿을 마스킹한 복사본을 돌려준다. */
export function redactSecrets<T>(value: T): { value: T; hits: SecretHit[] } {
  const hits = scanForSecrets(value);
  if (!hits.length) return { value, hits };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = v;
      for (const { re } of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, 'g'), REDACTED);
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, walk(item)]));
    }
    return v;
  };
  return { value: walk(value) as T, hits };
}

function mask(s: string): string {
  if (s.length <= 10) return `${s.slice(0, 3)}***`;
  return `${s.slice(0, 6)}***${s.slice(-4)}`;
}
