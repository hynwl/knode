/**
 * 접근성 드리프트 가드 — 대비율 (Spec §17.2 "다크 배경 대비 본문 텍스트 대비율 4.5:1 이상")
 * =============================================================================
 * M4-T9 에서 눈대중이 아니라 WCAG 2.1 상대휘도 공식으로 팔레트를 **전수 실측**했다.
 * 이 파일은 그 실측을 테스트로 굳혀, 나중에 누가 `design/tokens.ts` 를 만졌을 때
 * 대비율이 조용히 무너지는 걸 잡는다 (`docs/ERRORS.md` + `test_errors_doc.py` 와
 * 같은 "생성기 + 드리프트 가드" 패턴).
 *
 * 실측에서 실제로 잡아낸 위반 2건 (둘 다 이 커밋에서 수정됨):
 *   1. `--text-faint` #5b6785 → 네 배경 전부 2.71~3.32 (미달). `.ac-hint`/`.ac-note`/
 *      `.ac-label`/상태바/로그 등 **본문·라벨 텍스트** 79곳에 쓰이고 있었다.
 *   2. `.ac-markdown a` 의 `--indigo` #6366f1 → 3.42~4.05 (미달). Output 노드
 *      마크다운의 본문 링크다.
 */
import { describe, expect, it } from 'vitest';
import { color, colorExtra } from '@design/tokens';

/** WCAG 2.1 상대휘도 — https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 대비율 — https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 본문 텍스트가 실제로 얹히는 배경 전량 (`globals.css` 실사용 기준). */
const BACKGROUNDS = {
  bg: color.bg,
  surface: color.surface,
  'surface-2': color.surface2,
  'surface-3': color.surface3,
  'code-bg': colorExtra.codeBg,
} as const;

/**
 * 본문/라벨 텍스트로 쓰이는 전경색 전량.
 * 여기 없는 색(보더·배경·액센트)은 텍스트가 아니라 판정 대상이 아니다.
 */
const BODY_TEXT = {
  '--text': color.text,
  '--text-dim': color.textDim,
  '--text-faint': color.textFaint,
  'code-text': colorExtra.codeText,
  'raw-text': colorExtra.rawText,
  'link (.ac-markdown a)': colorExtra.linkText,
  // 로그 콘솔 줄 색 (Spec §3.3 과 별개, 콘솔 전용) — 전부 본문 텍스트다.
  'log-agent': colorExtra.logAgent,
  'log-tool': colorExtra.logTool,
  'log-ok': colorExtra.logOk,
  'log-warn': colorExtra.logWarn,
  'log-err': colorExtra.logErr,
  'log-final': colorExtra.logFinal,
  // 배지 텍스트
  'badge-indigo': colorExtra.badgeIndigoText,
  'badge-emerald': colorExtra.badgeEmeraldText,
  'badge-amber': colorExtra.badgeAmberText,
  'badge-rose': colorExtra.badgeRoseText,
  // 상태 텍스트/아이콘에 쓰이는 색 (StatusBar · 검증 배지 · 노드 상태 배지)
  danger: color.danger,
  emerald: color.emerald,
  amber: color.amber,
  rose: color.rose,
} as const;

const AA_NORMAL = 4.5;

describe('WCAG 대비율 (Spec §17.2)', () => {
  it('공식 자체가 맞다 — 알려진 기준점으로 검산', () => {
    // 흑/백은 정확히 21:1, 같은 색끼리는 1:1.
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0b1220', '#0b1220')).toBeCloseTo(1, 5);
    // WebAIM 이 공표한 표본값.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  for (const [fgName, fg] of Object.entries(BODY_TEXT)) {
    for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
      it(`${fgName} on ${bgName} ≥ ${AA_NORMAL}:1`, () => {
        const ratio = contrastRatio(fg, bg);
        expect(
          ratio,
          `${fgName}(${fg}) on ${bgName}(${bg}) = ${ratio.toFixed(2)}:1 — `
          + 'WCAG AA 본문 기준 미달이다. 토큰을 밝히거나, 이 조합을 본문 텍스트로 '
          + '쓰지 않도록 컴포넌트를 고쳐라 (Spec §17.2).',
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }

  it('--text-faint 는 --text-dim 과 여전히 구분된다 (위계 유지)', () => {
    // 접근성 때문에 밝혔지만 두 단계가 같은 색이 돼버리면 디자인이 무너진다.
    expect(color.textFaint).not.toBe(color.textDim);
    expect(relativeLuminance(color.textFaint)).toBeLessThan(relativeLuminance(color.textDim));
  });

  it('link 색은 새 값이 아니라 badgeIndigoText 의 별칭이다 (§1.4 확장토큰 카운트 제외)', () => {
    expect(colorExtra.linkText).toBe(colorExtra.badgeIndigoText);
  });

  /**
   * 아래는 **미달이지만 이번 범위에서 고치지 않기로 한 것**을 명시적으로 고정한다.
   * 값이 바뀌면 테스트가 깨져서 재검토를 강제한다 — "몰라서 놓친 것" 과
   * "알고 남겨둔 것" 을 구분하기 위한 장치다.
   */
  describe('알고 남겨둔 미달 (재검토 강제용 스냅샷)', () => {
    it('노드 헤더 텍스트 vs 액센트 그라디언트 — 일부 조합이 4.5 미만', () => {
      // 헤더 타이틀은 다크 배경이 아니라 **채도 높은 액센트 그라디언트** 위에 있다.
      // 이걸 통과시키려면 Spec §3.1/§3.2 가 지정한 노드 액센트 12종을 전부 바꿔야
      // 하는데, 그건 a11y 패스가 아니라 디자인 SSoT 재작성이다 (design/DESIGN_AUDIT.md
      // §1.3 "아티팩트 값 조정 금지"). 측정값만 남기고 사용자 판단으로 넘긴다.
      const worst = contrastRatio(colorExtra.headerText, '#d97706'); // tool 액센트
      expect(worst).toBeLessThan(AA_NORMAL);
      expect(worst).toBeGreaterThan(2.5);
    });

    it('Queue Prompt 버튼 잉크 vs 그라디언트 끝 — 4.25:1', () => {
      // 그라디언트 시작(runA)에서는 10.50:1 로 넉넉하고, 끝(runB)에서만 4.25 다.
      // 13px bold 디스플레이 폰트 + 버튼 라벨이라 본문 텍스트가 아니다.
      expect(contrastRatio(colorExtra.runInk, color.runB)).toBeCloseTo(4.25, 1);
      expect(contrastRatio(colorExtra.runInk, color.runA)).toBeGreaterThan(AA_NORMAL);
    });
  });
});
