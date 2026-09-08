'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import {
  applyLocale, DEFAULT_LOCALE, detectLocale, getLocale, LOCALES, readStoredLocale,
  subscribeLocale, t as translateNow, tk as translateKeyish,
  type Locale, type TranslateVars,
} from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * `@/i18n` 의 React 바인딩.
 *
 * 컨텍스트 대신 `useSyncExternalStore` 를 쓴다 — 프로바이더로 감쌀 필요가 없고,
 * 무엇보다 `React.memo` 경계를 넘어간다. 캔버스 노드는 M3-T11 에서 memo 로
 * 감싸 두었기 때문에(50노드 편집 시 202회 리렌더 문제), 부모 리렌더에 기대는
 * 방식이었다면 언어를 바꿔도 노드 라벨이 옛 언어로 남는다.
 *
 * 규칙: **번역 문자열을 렌더하는 컴포넌트는 반드시 `useT()` 를 호출한다.**
 * 그래야 그 컴포넌트가 로케일 변경을 구독한다.
 */

/** SSR 스냅샷은 항상 기본 로케일 — 하이드레이션 불일치를 만들지 않기 위함. */
const getServerSnapshot = (): Locale => DEFAULT_LOCALE;

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getServerSnapshot);
}

export interface TFunction {
  (key: string, vars?: TranslateVars): string;
  /**
   * 키처럼 생긴 문자열만 번역한다 (사용자 입력 라벨이 섞이는 자리용).
   *
   * 오버로드를 모듈 쪽 `tk` 와 맞춘다 — 하나로 뭉뚱그리면 `string` 을 넣어도
   * `string | undefined` 가 나와, 번역이 필요한 자리마다 `?? ''` 를 달게 된다.
   */
  k: {
    (value: string, vars?: TranslateVars): string;
    (value: undefined, vars?: TranslateVars): undefined;
    (value: string | undefined, vars?: TranslateVars): string | undefined;
  };
}

/**
 * 현재 로케일의 번역 함수. 반환되는 함수 자체는 로케일이 바뀔 때마다 새 참조가
 * 되므로 `useMemo`/`useCallback` 의존성에 넣으면 자동으로 다시 계산된다.
 */
export function useT(): TFunction {
  const locale = useLocale();
  return useMemo(() => {
    // `locale` 은 모듈 전역과 항상 동기화되어 있다. 의존성에 남겨 두는 이유는
    // 로케일이 바뀌면 새 함수 참조를 만들어 하위 useMemo 들을 무효화하기 위함이다.
    void locale;
    const fn = ((key: string, vars?: TranslateVars) => translateNow(key, vars)) as TFunction;
    fn.k = translateKeyish;
    return fn;
  }, [locale]);
}

export function useSetLocale(): (locale: Locale) => void {
  return useCallback((locale: Locale) => applyLocale(locale, { persist: true }), []);
}

/**
 * `useLayoutEffect` 는 서버에서 경고를 뱉으므로 환경에 따라 고른다.
 * 모듈 로드 시점에 한 번 결정되므로 훅 순서는 환경 안에서 항상 일정하다.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * 첫 로드 시 로케일 결정 (§17.3 "기본값은 브라우저 로케일 감지").
 *
 * SSR HTML 은 항상 `DEFAULT_LOCALE` 로 그려지므로 감지는 클라이언트에서만
 * 할 수 있다. paint 전에 끝내려고 layout effect 를 쓴다 — `useEffect` 로 두면
 * 영어 사용자에게 한국어 헤더가 한 프레임 스쳐 지나간다.
 */
export function I18nBootstrap() {
  useIsomorphicLayoutEffect(() => {
    const stored = readStoredLocale();
    if (stored) {
      applyLocale(stored);
      return;
    }
    const langs = typeof navigator === 'undefined'
      ? null
      : (navigator.languages?.length ? navigator.languages : [navigator.language]);
    applyLocale(detectLocale(langs));
  }, []);
  return null;
}

const LOCALE_SHORT: Record<Locale, string> = { ko: 'KO', en: 'EN' };

/**
 * 헤더의 언어 토글 (§17.3 "설정에서 변경 가능").
 *
 * M0-T8 의 디자인 규칙상 아티팩트 원본에 없는 아이콘을 새로 들이지 않는다 —
 * 그래서 다른 헤더 버튼과 같은 `.ac-tbtn` 위에 `KO`/`EN` 두 글자만 얹었다.
 */
export function LocaleSwitcher() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <div className="flex items-center" role="group" aria-label={t('header.language.aria')}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className={cn(
            'ac-tbtn !px-[7px] font-mono',
            l === locale ? '!text-text' : 'opacity-55 hover:opacity-100',
          )}
          aria-pressed={l === locale}
          title={t('header.language.title')}
          onClick={() => setLocale(l)}
        >
          {LOCALE_SHORT[l]}
        </button>
      ))}
    </div>
  );
}
