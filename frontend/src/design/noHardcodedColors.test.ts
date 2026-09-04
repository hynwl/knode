/**
 * 디자인 드리프트 가드 — AC-D2 ("컴포넌트 파일 내 하드코딩 HEX 0개", Spec §21)
 * =============================================================================
 * M0-T4 의 `design/DESIGN_AUDIT.md` 는 이 조건을 **한 번 grep 해서** 체크했는데,
 * M4-T10 최종 감사에서 그 뒤 추가된 `panels/TemplatesModal.tsx` 의 미리보기 SVG 가
 * `fill="#fff"` 를 들고 들어와 있었다 — 즉 "한 번 통과한 수용 기준"은 테스트로
 * 굳혀두지 않으면 조용히 되돌아간다. 이 파일이 그 재발을 막는다.
 *
 * 색은 전부 `design/tokens.ts`(→ Tailwind 유틸리티 / CSS 변수)에서만 나와야 한다.
 * 토큰 정의 파일 자신과 테스트는 당연히 예외다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

/** 색이 아니라 좌표/식별자인 `#` 문자열을 걸러내기 위해 HEX 문법만 정확히 본다. */
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
/** `rgb()`/`hsl()` 로 우회하는 것도 같은 위반이다. */
const FN_COLOR_RE = /\b(?:rgba?|hsla?)\(\s*\d/g;

/**
 * 예외는 **토큰 소스 자신**뿐이다. 이 목록이 늘어난다는 건 색이 토큰 밖으로
 * 새어나가고 있다는 뜻이므로, 늘리기 전에 토큰화가 가능한지 먼저 볼 것.
 */
const ALLOWED = new Set<string>([
  'design/tokens.local.ts', // 존재하지 않아도 무해 — 토큰 파일을 src 안으로 옮길 경우의 자리
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

/** 주석은 실측값을 근거로 남기는 용도라 색이 아니다 — 라인 단위로 걷어낸다. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('AC-D2 — 컴포넌트 파일에 하드코딩된 색이 없다', () => {
  const files = sourceFiles(SRC);

  it('스캔 대상이 실제로 잡힌다 (가드가 조용히 0개를 검사하는 일 방지)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((f) => [path.relative(SRC, f), f] as const))(
    '%s',
    (rel, full) => {
      if (ALLOWED.has(rel)) return;
      const code = stripComments(readFileSync(full, 'utf-8'));
      expect(
        { file: rel, hex: code.match(HEX_RE) ?? [], fn: code.match(FN_COLOR_RE) ?? [] },
      ).toEqual({ file: rel, hex: [], fn: [] });
    },
  );
});
