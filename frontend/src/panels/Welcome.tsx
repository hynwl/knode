'use client';

import { ArrowRight, Code2, Coins, Github, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { Yellowtail } from 'next/font/google';
import { useEffect, useId } from 'react';
import { cn } from '@/lib/cn';
import { LocaleSwitcher, useT } from '@/i18n/react';

/**
 * 워드마크 "Canvas" 전용 브러시 스크립트. 앱 본체의 Sora/Manrope 는 그대로 둔다.
 *
 * `preload: false` 인 이유: 이 화면은 **첫 방문자만** 본다. 기본값(preload)은
 * `layout.tsx` 의 본문 폰트들처럼 문서 <head> 에 preload 링크를 박아, 오프닝
 * 화면을 볼 일이 없는 재방문자까지 이 폰트를 내려받게 만든다. 끄면 실제로
 * 이 글자가 렌더될 때만 가져온다.
 */
const yellowtail = Yellowtail({ subsets: ['latin'], weight: '400', display: 'swap', preload: false });

const REPO_URL = 'https://github.com/hynwl/agentcanvas';

export interface WelcomeProps {
  onEnter: () => void;
}

/**
 * 첫 방문자용 오프닝 화면.
 *
 * 구성은 **비대칭 스플릿**이다 — 왼쪽에 로고·헤드라인·CTA, 오른쪽에 진짜 편집
 * 화면 스크린샷(`public/canvas.png`). 가운데 정렬 히어로는 어느 제품에나 붙는
 * 기본값이라 이 제품이 무엇인지 한 장으로 보여 주지 못한다. 스크린샷은 그려낸
 * 가짜 UI 가 아니라 실제 앱을 찍은 것이고, 그 뒤에 깔리는 점 격자도 캔버스가
 * 실제로 쓰는 배경(`bg-dot-grid`)이다.
 *
 * 캔버스는 이미 뒤에서 마운트돼 있으므로 `onEnter` 는 이 화면을 걷어내기만 한다.
 */
export function Welcome({ onEnter }: WelcomeProps) {
  const t = useT();

  useEffect(() => {
    // Esc 로 건너뛴다. Enter 는 일부러 듣지 않는다 — 전역에서 가로채면
    // (preventDefault) 언어 전환 버튼·GitHub 링크의 키보드 활성화까지 막힌다.
    // CTA 에 자동 초점도 주지 않는다: 첫 화면에 포커스 링부터 그려지면 인쇄
    // 오류처럼 보이고, 모달과 달리 이 화면은 Tab 으로 충분히 닿는다.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEnter(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEnter]);

  return (
    // `break-keep`(word-break: keep-all) 이 없으면 한국어가 **어절 한가운데서**
    // 줄바꿈된다 ("실제로 실 / 행하세요"). 영어는 원래 공백에서만 끊기므로 영향 없다.
    // `data-testid` 는 E2E 셀렉터 전용이다 — 뒤에 깔린 앱에도 같은 언어 토글이
    // 있어(`inert` 라 실제 사용자에겐 안 잡히지만 Playwright 의 role 질의는 그걸
    // 거르지 않는다) 이 화면 안으로 범위를 좁힐 손잡이가 필요하다.
    <div
      data-testid="welcome"
      className="fixed inset-0 z-welcome overflow-y-auto overflow-x-hidden break-keep bg-bg"
    >
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1360px] flex-col px-5 pb-7 sm:px-8 sm:pb-9">
        <header className="flex flex-none items-center justify-end gap-2 py-4 sm:py-5">
          <a
            className="ac-tbtn"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Github size={13} strokeWidth={2} />
            {t('welcome.source')}
          </a>
          <LocaleSwitcher />
        </header>

        {/* 히어로와 아래 요점을 **한 덩어리로** 세로 가운데 정렬한다. 히어로만
            늘리면 큰 화면에서 로고 뭉치가 화면 한가운데 떠 있고 요점은 바닥에
            붙어 버려, 여백이 의도가 아니라 사고처럼 보인다. */}
        <div className="flex flex-1 flex-col justify-center">
        <main className="grid items-center gap-10 py-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14 lg:py-8">
          <div className="flex flex-col items-start">
            <BrandLockup />

            <h1
              className="animate-rise mt-7 max-w-[20ch] text-balance font-display text-t26 font-extrabold
                         leading-[1.12] tracking-tight text-text sm:text-t34 lg:text-t42"
              style={{ animationDelay: '120ms' }}
            >
              {t('welcome.headline')}
            </h1>

            <p
              className="animate-rise mt-4 max-w-[46ch] text-t14_5 leading-relaxed text-text-dim"
              style={{ animationDelay: '200ms' }}
            >
              {t('welcome.sub')}
            </p>

            <div
              className="animate-rise mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: '280ms' }}
            >
              <button
                type="button"
                className="ac-run-btn group !px-5 !py-[11px] !text-t15"
                onClick={onEnter}
              >
                {t('welcome.cta')}
                <ArrowRight
                  size={15}
                  strokeWidth={2.4}
                  className="transition-transform duration-fast group-hover:translate-x-[3px]"
                />
              </button>
            </div>

            {/* 편집기는 좌우 패널을 동시에 펼치는 화면이라 휴대폰에서는 제대로
                쓰기 어렵다. 들어가기 전에 미리 말해 준다(작은 화면에서만). */}
            <p
              className="animate-rise mt-4 text-t11_5 text-text-faint lg:hidden"
              style={{ animationDelay: '340ms' }}
            >
              {t('welcome.desktopNote')}
            </p>
          </div>

          <div className="animate-rise relative" style={{ animationDelay: '220ms' }}>
            <div
              aria-hidden="true"
              // 컨테이너 좌우 패딩(px-5 / sm:px-8)보다 작게 물려야 가로 스크롤이 안 생긴다.
              className="absolute -inset-4 bg-dot-grid opacity-60 [background-size:22px_22px] sm:-inset-7"
            />
            <Image
              src="/canvas.png"
              alt={t('welcome.shotAlt')}
              width={1290}
              height={790}
              priority
              sizes="(max-width: 1024px) 92vw, 620px"
              className="relative h-auto w-full rounded-4xl border border-border-soft shadow-modal"
            />
          </div>
        </main>

        <section
          className="animate-rise mt-2 grid flex-none gap-7 border-t border-border-soft pt-8
                     md:grid-cols-[1.05fr_1fr_1.15fr] md:gap-10 lg:pt-9"
          style={{ animationDelay: '400ms' }}
        >
          <Point icon={<ShieldCheck size={15} strokeWidth={2} />} title={t('welcome.point1Title')}>
            {t('welcome.point1Body')}
          </Point>
          <Point icon={<Coins size={15} strokeWidth={2} />} title={t('welcome.point2Title')}>
            {t('welcome.point2Body')}
          </Point>
          <Point icon={<Code2 size={15} strokeWidth={2} />} title={t('welcome.point3Title')}>
            {t('welcome.point3Body')}
          </Point>
        </section>
        </div>
      </div>
    </div>
  );
}

/** 아이콘 마크 + 워드마크. `AgentCanvas Mark` 아티팩트의 Stroke & Node + Split lockup. */
function BrandLockup() {
  const gradientId = useId();

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 64 64" fill="none" className="h-9 w-9 flex-none sm:h-10 sm:w-10" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--indigo)' }} />
            <stop offset="1" style={{ stopColor: 'var(--rose)' }} />
          </linearGradient>
        </defs>
        {/* `pathLength` 로 길이를 48 로 고정해 두면 실제 곡선 길이와 무관하게
            dash 계산이 맞아떨어진다 — 붓질이 스스로 그어지는 연출의 전부다. */}
        <path
          className="animate-stroke-draw"
          d="M14 50 C 18 34 27 25 37 22"
          stroke={`url(#${gradientId})`}
          strokeWidth={9}
          strokeLinecap="round"
          pathLength={48}
          strokeDasharray={48}
        />
        <circle
          className="animate-rise stroke-socket"
          style={{ animationDelay: '520ms' }}
          cx={46}
          cy={19}
          r={6.5}
          fill="var(--indigo)"
          strokeWidth={2}
        />
      </svg>

      <div className="flex items-baseline">
        <span className="font-display text-t20 font-bold tracking-tight text-text sm:text-t24">Agent</span>
        <span
          className={cn(
            yellowtail.className,
            'ml-[2px] bg-gradient-to-r from-indigo to-rose bg-clip-text text-t26 leading-none text-transparent sm:text-t32',
          )}
        >
          Canvas
        </span>
      </div>
    </div>
  );
}

function Point({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-[6px]">
      <span className="flex items-center gap-2 font-display text-t12_5 font-bold text-text">
        <span className="text-indigo">{icon}</span>
        {title}
      </span>
      <p className="m-0 max-w-[42ch] text-t12_5 leading-relaxed text-text-dim">{children}</p>
    </div>
  );
}
