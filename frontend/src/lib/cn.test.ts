/**
 * `cn()` 이 커스텀 폰트 크기를 글자색으로 오인하지 않는지.
 *
 * 회귀 대상: tailwind-merge 기본 설정에서 `text-t11_5` 는 크기 목록에 없어
 * **글자색**으로 분류되고, 뒤에 오는 `text-amber` 가 같은 그룹이라며 그것을
 * 지워 버렸다. 인스펙터의 검증 이슈 블록이 상속 16px 로 렌더링되며 박스를
 * 넘치던 원인이다.
 */

import { describe, expect, it } from 'vitest';
import { fontSize } from '@design/tokens';
import { cn, FONT_SIZE_UTILITIES } from './cn';

describe('cn()', () => {
  it('크기 토큰과 색 토큰이 서로를 지우지 않는다', () => {
    const out = cn('text-t11_5 leading-normal', 'text-amber');
    expect(out).toContain('text-t11_5');
    expect(out).toContain('text-amber');
  });

  it('디자인 토큰의 모든 폰트 크기에 대해 성립한다', () => {
    for (const util of FONT_SIZE_UTILITIES) {
      const out = cn(`text-${util}`, 'text-danger');
      expect(out, `text-${util} 가 text-danger 에 지워졌다`).toContain(`text-${util}`);
      expect(out).toContain('text-danger');
    }
  });

  it('크기끼리는 여전히 뒤에 온 것이 이긴다', () => {
    expect(cn('text-t10', 'text-t15')).toBe('text-t15');
  });

  it('색끼리도 여전히 뒤에 온 것이 이긴다', () => {
    expect(cn('text-amber', 'text-danger')).toBe('text-danger');
  });

  it('유틸리티 목록이 tailwind.config.ts 의 생성 규칙과 같다', () => {
    // tailwind.config.ts: Object.entries(fontSize).map(([k]) => `t${k.replace('.', '_')}`)
    expect(FONT_SIZE_UTILITIES).toEqual(
      Object.keys(fontSize).map((k) => `t${k.replace('.', '_')}`),
    );
    expect(FONT_SIZE_UTILITIES).toContain('t11_5');
  });
});
