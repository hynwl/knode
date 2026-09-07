import { describe, expect, it } from 'vitest';
import { splitSentences } from './sentences';

describe('splitSentences', () => {
  it('마침표 + 공백에서 문장을 나눈다 (한국어)', () => {
    expect(splitSentences('첫 문장입니다. 둘째 문장입니다. 셋째입니다.'))
      .toEqual(['첫 문장입니다.', '둘째 문장입니다.', '셋째입니다.']);
  });

  it('물음표·느낌표도 문장 끝으로 본다', () => {
    expect(splitSentences('First time? Try Hello Crew. Go!'))
      .toEqual(['First time?', 'Try Hello Crew.', 'Go!']);
  });

  it('⭐ 마침표 뒤에 공백이 없으면 자르지 않는다 — 버전·소수점이 쪼개지면 안 된다', () => {
    expect(splitSentences('Router 는 v1.1 예정입니다. 비용은 $0.002 입니다.'))
      .toEqual(['Router 는 v1.1 예정입니다.', '비용은 $0.002 입니다.']);
  });

  it('줄바꿈도 공백으로 취급하고, 빈 조각은 버린다', () => {
    expect(splitSentences('하나입니다.\n  둘입니다.   ')).toEqual(['하나입니다.', '둘입니다.']);
  });

  it('문장부호가 없으면 통째로 한 덩어리', () => {
    expect(splitSentences('마침표 없는 문장')).toEqual(['마침표 없는 문장']);
  });

  it('빈 문자열은 빈 배열', () => {
    expect(splitSentences('')).toEqual([]);
  });
});
