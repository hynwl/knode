'use client';

import { Yellowtail } from 'next/font/google';
import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * 워드마크 "Canvas" 전용 브러시 스크립트. 앱 본체의 Sora/Manrope 는 그대로 둔다.
 *
 * 오프닝 화면 전용이던 시절엔 `preload: false` 였지만, 지금은 같은 로크업이
 * **헤더에 상주**한다 — 모든 방문자가 첫 페인트에서 이 글자를 보므로 preload
 * (next/font 기본값)가 맞다. 여기 한 곳에서만 부르는 이유도 같다: 파일마다
 * `Yellowtail(...)` 을 부르면 같은 폰트가 서로 다른 클래스로 두 벌 실린다.
 */
const yellowtail = Yellowtail({ subsets: ['latin'], weight: '400', display: 'swap' });

export interface BrandMarkProps {
  /** 크기·여백은 호출부가 정한다 (헤더 22px / 오프닝 36~40px). */
  className?: string;
  /** 붓질이 스스로 그어지는 등장 연출. 오프닝 화면에서만 켠다. */
  animated?: boolean;
}

/**
 * 아이콘 마크 — `AgentCanvas Mark` 아티팩트의 "Stroke & Node".
 * 캔버스에 그은 붓질 한 획과 그 끝에 붙는 노드 하나. 탭 아이콘
 * (`app/icon.svg`) 도 같은 좌표를 쓴다.
 */
export function BrandMark({ className, animated = false }: BrandMarkProps) {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 64 64" fill="none" className={cn('flex-none', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--indigo)' }} />
          <stop offset="1" style={{ stopColor: 'var(--rose)' }} />
        </linearGradient>
      </defs>
      {/* `pathLength` 로 길이를 48 로 고정해 두면 실제 곡선 길이와 무관하게
          dash 계산이 맞아떨어진다 — 붓질이 스스로 그어지는 연출의 전부다. */}
      <path
        className={animated ? 'animate-stroke-draw' : undefined}
        d="M14 50 C 18 34 27 25 37 22"
        stroke={`url(#${gradientId})`}
        strokeWidth={9}
        strokeLinecap="round"
        pathLength={48}
        strokeDasharray={animated ? 48 : undefined}
      />
      <circle
        className={animated ? 'animate-rise' : undefined}
        style={animated ? { animationDelay: '520ms' } : undefined}
        cx={46}
        cy={19}
        r={6.5}
        fill="var(--indigo)"
      />
    </svg>
  );
}

export interface BrandLockupProps {
  /**
   * `header` = 앱 상단바(52px)에 들어가는 축소판, `hero` = 오프닝 화면용.
   * 그림·비율은 같고 크기와 등장 연출만 다르다.
   */
  size?: 'header' | 'hero';
}

/** 아이콘 마크 + 워드마크. `AgentCanvas Mark` 아티팩트의 Stroke & Node + Split lockup. */
export function BrandLockup({ size = 'hero' }: BrandLockupProps) {
  const header = size === 'header';

  return (
    <div className={cn('flex flex-none items-center', header ? 'gap-[9px]' : 'gap-3')}>
      <BrandMark
        // 마크는 64 격자 안에서 사방 여백을 두고 그려진다 — 헤더에서 아티팩트의
        // 22px 타일과 같은 **먹는 크기**로 읽히려면 상자를 그만큼 키워야 한다.
        className={header ? 'h-[26px] w-[26px]' : 'h-9 w-9 sm:h-10 sm:w-10'}
        animated={!header}
      />

      <div className="flex items-baseline">
        <span
          className={cn(
            'font-display font-bold tracking-tight text-text',
            header ? 'text-t15' : 'text-t20 sm:text-t24',
          )}
        >
          Agent
        </span>
        {/* 브러시 스크립트는 x-height 가 낮아 "Agent" 보다 1.3배 키워야 같은 크기로 읽힌다. */}
        <span
          className={cn(
            yellowtail.className,
            'ml-[2px] bg-gradient-to-r from-indigo to-rose bg-clip-text leading-none text-transparent',
            header ? 'text-t19_5' : 'text-t26 sm:text-t32',
          )}
        >
          Canvas
        </span>
      </div>
    </div>
  );
}
