import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { fontSize } from '@design/tokens';

/**
 * 커스텀 폰트 크기 유틸리티 이름 (`text-t11_5` …).
 *
 * `tailwind.config.ts` 가 `design/tokens.ts` 의 `fontSize` 키에서 만드는 것과
 * **같은 규칙**으로 여기서도 만든다. 손으로 적으면 토큰이 하나 늘어날 때마다
 * 조용히 드리프트한다 (`cn.test.ts` 가 이 동일성을 지킨다).
 */
export const FONT_SIZE_UTILITIES: string[] = Object.keys(fontSize).map(
  (k) => `t${k.replace('.', '_')}`,
);

/**
 * Tailwind 클래스 병합 헬퍼.
 *
 * ⚠️ `extendTailwindMerge` 로 커스텀 폰트 크기를 **반드시** 등록해야 한다.
 *
 * tailwind-merge 는 `text-*` 하나를 보고 "폰트 크기냐 글자색이냐"를 자기 내장
 * 목록으로 판정한다. `t11_5` 는 그 목록에 없으므로 **글자색으로 오인**되고,
 * 그러면 `cn('text-t11_5', 'text-amber')` 에서 뒤에 온 `text-amber` 가 같은 그룹의
 * 앞선 클래스라며 `text-t11_5` 를 **지워 버린다**. 크기 지정이 통째로 사라져
 * 상속된 16px 이 그대로 나온다 — 인스펙터 검증 블록이 실제로 그렇게 깨져 있었다
 * (§17.4 에러 표시가 주변 UI 보다 1.4배 크게 렌더링되고 박스를 넘쳤다).
 *
 * 이건 `text-t*` 와 `text-<색>` 을 **같은 `cn()` 호출에** 넣은 모든 지점에
 * 해당하는 전역 결함이라, 호출부를 하나씩 고치는 대신 여기서 끊는다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZE_UTILITIES }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
