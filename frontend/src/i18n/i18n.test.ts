// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyLocale, bundleKeys, DEFAULT_LOCALE, detectLocale, getLocale, isI18nKey, LOCALES,
  LOCALE_STORAGE_KEY, lookupExact, readStoredLocale, tk, translate,
} from '.';
import { ISSUE_CATALOG, issue, issueText } from '@/validation/issues';
import { NODE_DEFINITIONS, defaultDataFor } from '@/nodes/registry';
import { PORT_TYPE_META } from '@/ports/types';
import { REJECTION_MESSAGE_KEY } from '@/ports/matrix';
import { BUILTIN_TEMPLATES, type TemplateMeta } from '@/templates/builtin';

/** 모듈 전역 로케일을 건드리는 테스트가 다음 테스트로 새지 않게 한다. */
afterEach(() => {
  window.localStorage.clear();
  applyLocale(DEFAULT_LOCALE);
});

const HANGUL = /[가-힣]/;

/* ────────────────────────── 감지 · 폴백 ────────────────────────── */

describe('detectLocale', () => {
  it('브라우저 언어의 기본 태그로 지원 로케일을 고른다', () => {
    expect(detectLocale(['ko-KR', 'en-US'])).toBe('ko');
    expect(detectLocale(['en-GB'])).toBe('en');
    expect(detectLocale(['ko'])).toBe('ko');
  });

  it('지원하지 않는 언어는 ko 가 아니라 en 으로 떨어진다', () => {
    // 일본어 사용자에게 한국어를 들이미는 것보다 영어가 낫다.
    expect(detectLocale(['ja-JP', 'zh-CN'])).toBe('en');
  });

  it('앞에서부터 훑어 처음 지원하는 언어를 쓴다', () => {
    expect(detectLocale(['ja-JP', 'ko-KR'])).toBe('ko');
  });

  it('언어 정보 자체가 없으면 기본 로케일', () => {
    expect(detectLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(detectLocale(null)).toBe(DEFAULT_LOCALE);
    expect(detectLocale([])).toBe(DEFAULT_LOCALE);
  });
});

describe('translate', () => {
  it('없는 키는 키 문자열을 그대로 돌려준다 (오타가 화면에 드러나도록)', () => {
    expect(translate('ko', 'nope.not.here')).toBe('nope.not.here');
    expect(translate('en', 'nope.not.here')).toBe('nope.not.here');
  });

  it('{var} 를 치환하고, 값이 없는 자리는 원문 그대로 둔다', () => {
    expect(translate('en', 'statusbar.zoom', { percent: 75 })).toBe('Zoom 75%');
    expect(translate('en', 'statusbar.zoom', {})).toBe('Zoom {percent}%');
    // vars 를 아예 안 넘기면 치환 자체를 하지 않는다 — placeholder 안의 `{topic}` 이
    // 사라지면 안 되기 때문(`field.agent.goalPlaceholder`).
    expect(translate('en', 'field.agent.goalPlaceholder')).toContain('{topic}');
  });

  it('en 에 없는 키는 기본 로케일(ko)로 폴백한다', () => {
    // `errors.*` 는 의도적으로 en 에만 있다 — 반대 방향(ko 에만 있는 키)이
    // 생겨도 화면이 비지 않는다는 것을 이 규칙이 보장한다.
    expect(lookupExact('ko', 'errors.AC-E101.message')).toBeUndefined();
    expect(translate('ko', 'errors.AC-E101.message')).toBe('errors.AC-E101.message');
  });
});

describe('isI18nKey / tk', () => {
  it('키처럼 생긴 문자열만 번역한다', () => {
    expect(isI18nKey('field.llm.modelLabel')).toBe(true);
    expect(isI18nKey('errors.AC-E101.message')).toBe(true);
    // 사용자가 Input 노드에 직접 넣는 라벨들 — 번역 대상이 아니다.
    expect(isI18nKey('블로그 주제')).toBe(false);
    expect(isI18nKey('{topic}')).toBe(false);
    expect(isI18nKey('gpt-4o-mini')).toBe(false);
    expect(isI18nKey('OpenAI')).toBe(false);
    expect(isI18nKey('https://api.example.com/v1')).toBe(false);
  });

  it('tk 는 키가 아닌 값을 원문 그대로 통과시킨다', () => {
    applyLocale('en');
    expect(tk('field.llm.modelLabel')).toBe('Model');
    expect(tk('블로그 주제')).toBe('블로그 주제');
    expect(tk(undefined)).toBeUndefined();
  });
});

/* ────────────────────────── 저장 ────────────────────────── */

describe('로케일 저장', () => {
  it('자동 감지 결과는 저장하지 않고, 사용자가 바꿨을 때만 남긴다', () => {
    applyLocale('en'); // 감지 경로 (persist 없음)
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    applyLocale('ko', { persist: true }); // 설정 UI 경로
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ko');
    expect(readStoredLocale()).toBe('ko');
  });

  it('저장값이 깨져 있으면 무시하고 감지로 돌아간다', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(readStoredLocale()).toBeNull();
  });

  it('적용하면 문서 언어 속성도 따라간다', () => {
    applyLocale('en');
    expect(document.documentElement.lang).toBe('en');
    expect(getLocale()).toBe('en');
  });
});

/* ────────────────────────── 번들 정합성 ────────────────────────── */

/** `errors.*` 는 ko 카탈로그를 en 에서 덮어쓰는 용도라 en 에만 존재한다. */
const isErrorOverride = (k: string) => k.startsWith('errors.');

describe('번들 정합성', () => {
  it('ko 와 en 의 키 집합이 같다 (errors 오버라이드 제외)', () => {
    const ko = bundleKeys('ko').filter((k) => !isErrorOverride(k)).sort();
    const en = bundleKeys('en').filter((k) => !isErrorOverride(k)).sort();
    expect(en).toEqual(ko);
  });

  it('ko 번들에는 errors 오버라이드가 없다 (한국어 원문은 ISSUE_CATALOG 가 정본)', () => {
    expect(bundleKeys('ko').filter(isErrorOverride)).toEqual([]);
  });

  it('en 의 errors 오버라이드는 ISSUE_CATALOG 의 모든 코드를 정확히 덮는다', () => {
    const covered = new Set(
      bundleKeys('en').filter(isErrorOverride).map((k) => k.split('.')[1]!),
    );
    expect([...covered].sort()).toEqual(Object.keys(ISSUE_CATALOG).sort());
    for (const code of Object.keys(ISSUE_CATALOG)) {
      expect(lookupExact('en', `errors.${code}.message`)).toBeTruthy();
      expect(lookupExact('en', `errors.${code}.hint`)).toBeTypeOf('string');
    }
  });

  it('영어 번들에 한글이 남아 있지 않다', () => {
    const leaked = bundleKeys('en').filter((k) => HANGUL.test(translate('en', k)));
    // app 설명처럼 의도적으로 두 언어를 함께 담는 문자열은 여기에 없어야 한다.
    expect(leaked).toEqual([]);
  });
});

/* ────────────────── 레지스트리가 참조하는 키가 실재하는지 ────────────────── */

/**
 * 화면에 `field.llm.modelLabel` 같은 키가 그대로 새어 나가는 사고를 막는 가드.
 * `t()` 는 없는 키를 조용히 키 문자열로 돌려주므로, 그 조용함을 여기서 깬다.
 */
function collectKeys(): string[] {
  const keys: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && isI18nKey(v)) keys.push(v); };

  for (const def of Object.values(NODE_DEFINITIONS)) {
    push(def.labelKey);
    push(def.descriptionKey);
    for (const p of [...def.inputs, ...def.outputs]) push(p.descriptionKey);
    for (const f of def.fields) {
      push(f.label); push(f.placeholder); push(f.hint);
      for (const o of f.options ?? []) { push(o.label); push(o.hint); }
    }
    for (const v of Object.values(def.defaults)) push(v);
  }
  for (const meta of Object.values(PORT_TYPE_META)) push(meta.labelKey);
  for (const k of Object.values(REJECTION_MESSAGE_KEY)) push(k);
  return [...new Set(keys)];
}

describe('레지스트리 · 포트 정의', () => {
  it('참조하는 i18n 키가 두 번들 모두에 실재한다', () => {
    const missing: string[] = [];
    for (const key of collectKeys()) {
      for (const locale of LOCALES) {
        if (lookupExact(locale, key) === undefined) missing.push(`${locale}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('⭐ 튜토리얼 층위 설명이 실재하는 포트 라벨을 가리킨다 (라벨 rename 드리프트 방지)', () => {
    // 실제로 났던 사고: Task 출력 라벨을 `next` → `task` 로 바꾸면서 튜토리얼 문구를
    // 같이 안 고쳐, 다이어그램이 **화면에 없는 소켓 이름**을 안내하고 있었다.
    // 유닛테스트도 E2E 도 이걸 못 잡았다 — 양쪽 다 초록인 채로 문서만 낡는 유형이다.
    const task = NODE_DEFINITIONS.task;
    const outLabel = task.outputs[0]!.label;
    const dependsLabel = task.inputs.find((p) => p.id === 'context')!.label;
    for (const locale of LOCALES) {
      const desc = translate(locale, 'tutorial.layer3Desc');
      expect(desc, `${locale} 의 layer3Desc 가 출력 포트 라벨 '${outLabel}' 을 안 가리킨다`)
        .toContain(outLabel);
      expect(desc, `${locale} 의 layer3Desc 가 입력 포트 라벨 '${dependsLabel}' 을 안 가리킨다`)
        .toContain(dependsLabel);
    }
  });

  it('사람이 읽는 문자열에 한글 리터럴이 직접 박혀 있지 않다', () => {
    const leaked: string[] = [];
    const check = (where: string, v: unknown) => {
      if (typeof v === 'string' && HANGUL.test(v)) leaked.push(`${where}=${v}`);
    };
    for (const def of Object.values(NODE_DEFINITIONS)) {
      check(`${def.type}.labelKey`, def.labelKey);
      check(`${def.type}.descriptionKey`, def.descriptionKey);
      for (const f of def.fields) {
        check(`${def.type}.${f.key}.label`, f.label);
        check(`${def.type}.${f.key}.placeholder`, f.placeholder);
        check(`${def.type}.${f.key}.hint`, f.hint);
        for (const o of f.options ?? []) check(`${def.type}.${f.key}.${o.value}`, o.label);
      }
      // `keywords` 는 검색어라 한글을 일부러 남긴다 — 검사 대상이 아니다.
    }
    expect(leaked).toEqual([]);
  });

  it('노드 기본 데이터는 생성 시점 로케일로 굳는다', () => {
    applyLocale('en');
    expect(defaultDataFor('output').title).toBe('Run result');
    expect(defaultDataFor('note').text).toContain('## Note');
    // 키가 아닌 기본값은 손대지 않는다.
    expect(defaultDataFor('llm').model).toBe('gpt-4o-mini');

    applyLocale('ko');
    expect(defaultDataFor('output').title).toBe('실행 결과');
  });
});

/* ────────────────── 에러 카탈로그 오버라이드 (§17.3) ────────────────── */

describe('issueText', () => {
  it('ko 는 ISSUE_CATALOG 원문을 그대로 쓴다', () => {
    applyLocale('ko');
    const { message, hint } = issueText(issue('AC-E101'));
    expect(message).toBe(ISSUE_CATALOG['AC-E101']!.message);
    expect(hint).toBe(ISSUE_CATALOG['AC-E101']!.hint);
  });

  it('en 은 같은 코드를 영어 오버라이드로 바꾼다', () => {
    applyLocale('en');
    const { message, hint } = issueText(issue('AC-E101'));
    expect(message).toBe('There is no Crew node');
    expect(hint).toBe('Right-click → Flow → Crew to add one.');
  });

  it('백엔드가 내려준 이슈도 코드만 맞으면 번역된다', () => {
    applyLocale('en');
    // 백엔드는 한국어 원문을 보낸다 — 카탈로그와 같으면 오버라이드가 이긴다.
    const fromBackend = { code: 'AC-E504', message: ISSUE_CATALOG['AC-E504']!.message };
    expect(issueText(fromBackend).message).toBe('Cannot reach the backend');
  });

  it('호출부가 문구를 갈아끼운 이슈는 오버라이드로 덮지 않는다', () => {
    applyLocale('en');
    const custom = { code: 'AC-E101', message: 'something very specific' };
    expect(issueText(custom).message).toBe('something very specific');
  });

  it('동적 메시지는 messageKey + params 로 번역된다', () => {
    // `validation/rules.ts` 가 실제로 넣는 모양 그대로 — params 값도 **키**다.
    const dynamic = issue('AC-E201', {
      message: 'Agent: "역할 (Role)" 이(가) 비어 있습니다',
      messageKey: 'validation.requiredEmpty',
      params: { node: 'node.agent.label', field: 'field.agent.roleLabel' },
    });

    applyLocale('en');
    expect(issueText(dynamic).message).toBe('Agent: "Role" is empty');

    applyLocale('ko');
    expect(issueText(dynamic).message).toBe('Agent: "역할 (Role)" 이(가) 비어 있습니다');
  });

  it('params 는 렌더 시점에 풀린다 — 검증은 로케일이 바뀔 때 다시 돌지 않으므로', () => {
    // 검증을 ko 에서 돌린 뒤 언어만 바꾼 상황. 값이 이미 번역된 문자열로
    // 굳어 있었다면 메시지 틀만 영어가 되고 필드 이름은 한국어로 남는다.
    applyLocale('ko');
    const frozen = issue('AC-E201', {
      message: 'x',
      messageKey: 'validation.requiredEmpty',
      params: { node: 'node.agent.label', field: 'field.agent.backstoryLabel' },
    });
    expect(issueText(frozen).message).toBe('Agent: "배경 (Backstory)" 이(가) 비어 있습니다');

    applyLocale('en');
    expect(issueText(frozen).message).toBe('Agent: "Backstory" is empty');
  });

  it('키가 아닌 params 값은 그대로 둔다', () => {
    applyLocale('en');
    const undef = issue('AC-W301', {
      message: '정의되지 않은 변수 {topic} 를 참조합니다',
      messageKey: 'validation.undefinedVar',
      params: { name: '{topic}' },
    });
    expect(issueText(undef).message).toBe('References the undefined variable {topic}');
  });

  it('빈 hint 는 undefined 로 정리된다 (AC-E505)', () => {
    applyLocale('en');
    expect(issueText(issue('AC-E505')).hint).toBeUndefined();
  });
});

/* ────────────────── 내장 템플릿 (§15.1 · §17.3) ────────────────── */

describe('내장 템플릿', () => {
  /** 문서에 실제로 박히는 사람 말만 훑는다 (id·모델명·변수명은 대상이 아니다). */
  const HUMAN_FIELDS = [
    'label', 'default_value', 'role', 'goal', 'backstory',
    'description', 'expected_output', 'title',
  ];

  function humanStrings(doc: ReturnType<TemplateMeta['build']>): string[] {
    // `description` 은 옵셔널이라 그대로 담으면 `(string|undefined)[]` 가 된다.
    const out: string[] = [doc.name, doc.description ?? ''];
    for (const n of doc.nodes) {
      for (const f of HUMAN_FIELDS) {
        const v = (n.data as Record<string, unknown>)[f];
        if (typeof v === 'string' && v) out.push(v);
      }
    }
    return out;
  }

  it('갤러리 이름·설명이 두 번들에 실재하는 키다', () => {
    const missing: string[] = [];
    for (const tpl of BUILTIN_TEMPLATES) {
      for (const value of [tpl.name, tpl.description]) {
        expect(isI18nKey(value), `${tpl.id}: '${value}' 가 키 꼴이 아니다`).toBe(true);
        for (const locale of LOCALES) {
          if (lookupExact(locale, value) === undefined) missing.push(`${locale}:${value}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('⭐ EN 로케일로 만든 템플릿에는 한글이 남지 않는다', () => {
    // 실제로 났던 문제: 영어 UI 에서 템플릿을 열면 갤러리 카드도, 캔버스에 깔린
    // 역할·목표·태스크 설명도 전부 한국어였다. 백엔드 문구(§17.3)를 고친 뒤에도
    // 여기만 남아 있었다 — 번들에 키만 있고 build() 가 안 쓰면 조용히 재발한다.
    applyLocale('en');
    const leaked: string[] = [];
    for (const tpl of BUILTIN_TEMPLATES) {
      for (const s of humanStrings(tpl.build())) {
        if (HANGUL.test(s)) leaked.push(`${tpl.id}: ${s}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('KO 로케일에서는 한국어가 그대로 나온다 (회귀 아님)', () => {
    applyLocale('ko');
    const hello = BUILTIN_TEMPLATES.find((x) => x.id === 'hello')!.build();
    const agent = hello.nodes.find((n) => n.type === 'agent')!;
    expect(agent.data.role).toBe('만능 리서치 어시스턴트');
  });

  it('⭐ 문서 id 는 로케일과 무관하고 템플릿끼리 겹치지 않는다', () => {
    // id 를 이름 슬러그에서 뽑던 시절엔 (a) 한글 이름이 통째로 `_` 로 접혀
    // `시장 조사 리포트` 와 `로컬 전용 요약봇` 이 둘 다 `cvs_tpl__` 이었고,
    // (b) 이름이 로케일마다 달라진 지금은 같은 템플릿이 언어별로 다른 id 가 된다.
    const idsFor = (locale: (typeof LOCALES)[number]) => {
      applyLocale(locale);
      return BUILTIN_TEMPLATES.map((tpl) => tpl.build().id);
    };
    const ko = idsFor('ko');
    const en = idsFor('en');
    expect(en).toEqual(ko);
    expect(new Set(ko).size).toBe(ko.length);
  });

  it('캔버스 변수는 번역을 통과해도 살아남는다', () => {
    applyLocale('en');
    const hello = BUILTIN_TEMPLATES.find((x) => x.id === 'hello')!.build();
    const task = hello.nodes.find((n) => n.type === 'task')!;
    expect(String(task.data.description)).toContain('{topic}');
  });
});
