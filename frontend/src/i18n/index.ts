/**
 * 다국어 (Spec §17.3 `SHOULD`) — 의존성 없는 손수 만든 로케일 레이어.
 *
 * next-intl / i18next 를 넣지 않은 이유는 `nodes/registry.ts` 를 프레임워크 없이
 * 단일 파일로 둔 것과 같다. 우리가 필요한 것은 (a) 키 → 문자열 조회, (b) `{var}`
 * 치환, (c) 로케일 전환 브로드캐스트 세 가지뿐이고, 라우팅 기반 로케일 세그먼트나
 * 복수형 규칙(ko 에는 없다)은 쓰지 않는다.
 *
 * ⚠️ 이 파일은 **React 를 import 하지 않는다.** `validation/rules.ts`,
 *    `store/index.ts` 같은 비컴포넌트 모듈이 `t()` 를 쓰기 때문이다.
 *    훅(`useT`/`useLocale`)과 UI 컨트롤은 `@/i18n/react` 에 있다.
 */

import en from './en.json';
import ko from './ko.json';

export const LOCALES = ['ko', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * 번들이 비어 있을 때의 최종 폴백. 이 프로젝트의 원본 문자열이 한국어이므로
 * `en.json` 에 아직 없는 키는 자동으로 한국어로 떨어진다 (반쪽 번역 상태에서도
 * 빈 화면이 나오지 않는다).
 */
export const DEFAULT_LOCALE: Locale = 'ko';

/** 사용자가 **명시적으로 바꿨을 때만** 기록한다. 자동 감지 결과는 저장하지 않는다. */
export const LOCALE_STORAGE_KEY = 'agentcanvas.locale.v1';

export type TranslateVars = Record<string, string | number>;

/* ────────────────────────── 번들 로딩 ────────────────────────── */

type Bundle = Record<string, string>;
type RawBundle = { [k: string]: string | RawBundle };

/** 중첩 JSON 을 `a.b.c` 평면 맵으로 편다 (편집은 중첩이, 조회는 평면이 편하다). */
function flatten(src: RawBundle, prefix = '', out: Bundle = {}): Bundle {
  for (const [k, v] of Object.entries(src)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const BUNDLES: Record<Locale, Bundle> = {
  ko: flatten(ko as RawBundle),
  en: flatten(en as RawBundle),
};

/** 테스트/도구용 — 특정 로케일의 평면화된 키 목록. */
export function bundleKeys(locale: Locale): string[] {
  return Object.keys(BUNDLES[locale]);
}

/* ────────────────────────── 로케일 상태 ────────────────────────── */

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * `navigator.languages` 를 앞에서부터 훑어 지원 로케일을 고른다.
 * 한국어 사용자가 아니면 영어가 더 나은 기본값이므로, 지원하지 않는 언어
 * (`ja`, `de` …)는 `ko` 가 아니라 `en` 으로 떨어뜨린다. 언어 정보 자체가
 * 없을 때만 `DEFAULT_LOCALE` 을 쓴다.
 */
export function detectLocale(languages?: readonly string[] | null): Locale {
  if (!languages || languages.length === 0) return DEFAULT_LOCALE;
  for (const raw of languages) {
    const tag = String(raw ?? '').toLowerCase();
    if (!tag) continue;
    const base = tag.split('-')[0]!;
    if (isLocale(base)) return base;
  }
  return 'en';
}

/** 사용자가 저장해 둔 선택. 없거나 깨졌으면 null. */
export function readStoredLocale(): Locale | null {
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null; // 프라이빗 모드/스토리지 차단 — 감지 결과로 계속 간다
  }
}

/**
 * 로케일 적용. `persist` 는 **사용자가 직접 바꾼 경우에만** true 다
 * (§17.3 "기본값은 브라우저 로케일 감지, 설정에서 변경 가능").
 */
export function applyLocale(locale: Locale, options: { persist?: boolean } = {}): void {
  if (options.persist) {
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* 저장 실패는 무시 */ }
  }
  if (currentLocale === locale) return;
  currentLocale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const fn of [...listeners]) fn();
}

/* ────────────────────────── 조회 ────────────────────────── */

const VAR_PATTERN = /\{(\w+)\}/g;

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(VAR_PATTERN, (m, name: string) => (
    name in vars ? String(vars[name]) : m
  ));
}

/** 지정한 로케일에만 있는지 조회한다 (폴백 없음). 에러 카탈로그 오버라이드용. */
export function lookupExact(locale: Locale, key: string): string | undefined {
  return BUNDLES[locale][key];
}

export function translate(locale: Locale, key: string, vars?: TranslateVars): string {
  const raw = BUNDLES[locale][key] ?? BUNDLES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(raw, vars);
}

/**
 * 현재 로케일로 번역한다. **키가 없으면 키 문자열을 그대로 돌려준다** —
 * 화면에 `header.queuePrompt` 같은 게 보이면 오타라는 뜻이고, 이건
 * `i18n/i18n.test.ts` 의 "레지스트리가 참조하는 키는 두 번들에 모두 있어야 한다"
 * 테스트가 CI 에서 먼저 잡는다.
 */
export function t(key: string, vars?: TranslateVars): string {
  return translate(currentLocale, key, vars);
}

/* ────────────────────────── 키 판별 ────────────────────────── */

/**
 * i18n 키처럼 생긴 문자열인가. `nodes/registry.ts` 의 필드 라벨은 키로 바뀌었지만
 * 같은 `FieldSpec` 타입을 `RunParametersModal` 이 **사용자가 입력한 라벨**로도
 * 채운다. 둘을 한 렌더러(`nodes/fields`)가 받으므로, "키처럼 생겼으면 번역하고
 * 아니면 그대로 쓴다" 는 규칙 하나로 양쪽을 모두 만족시킨다.
 *
 * 사용자 입력("블로그 주제", "{topic}", "gpt-4o-mini")은 이 패턴에 걸리지 않는다.
 */
const KEY_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+$/;

export function isI18nKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** 키처럼 생겼으면 번역, 아니면 원문 그대로. */
export function tk(value: string, vars?: TranslateVars): string;
export function tk(value: undefined, vars?: TranslateVars): undefined;
export function tk(value: string | undefined, vars?: TranslateVars): string | undefined;
export function tk(value: string | undefined, vars?: TranslateVars): string | undefined {
  if (value === undefined) return undefined;
  return isI18nKey(value) ? t(value, vars) : value;
}

/** 객체 값 버전 — `defaultDataFor()` 처럼 타입이 섞인 레코드를 훑을 때 쓴다. */
export function tkValue(value: unknown): unknown {
  return typeof value === 'string' ? tk(value) : value;
}
