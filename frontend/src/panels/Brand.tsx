'use client';

import { Archivo } from 'next/font/google';
import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * 워드마크 전용 서체. 앱 본체의 Sora/Manrope 는 그대로 둔다.
 *
 * 같은 로크업이 **헤더에 상주**한다 — 모든 방문자가 첫 페인트에서 이 글자를
 * 보므로 preload(next/font 기본값)가 맞다. 여기 한 곳에서만 부르는 이유도
 * 같다: 파일마다 `Archivo(...)` 를 부르면 같은 폰트가 서로 다른 클래스로 두 벌
 * 실린다.
 */
const archivo = Archivo({ subsets: ['latin'], weight: '800', display: 'swap' });

/** 끈 굵기 (64 격자). 마크의 모든 획이 이 하나의 값을 쓴다 — 한 가닥이니까. */
const CORD = 7;
/**
 * 교차부의 **틈**. 끈보다 이만큼 굵게 파야 지나가는 쪽이 뒤로 넘어가 보인다.
 * 끈 굵기의 약 1.8배가 16px 에서도 메워지지 않는 실측 하한이다.
 */
const GAP_STEM = 12.5;
const GAP_ARM = 9;

export interface BrandMarkProps {
  /** 크기·여백은 호출부가 정한다 (헤더 24px / 오프닝 33~37px). */
  className?: string;
  /** 끈이 스스로 그어지며 매듭이 묶이는 등장 연출. 오프닝 화면에서만 켠다. */
  animated?: boolean;
}

/**
 * 아이콘 마크 — `Knode Mark` 아티팩트의 "K-Cross".
 *
 * 한 가닥의 끈이 세로 기둥 뒤로 넘어갔다가(위쪽 교차) 다시 앞으로 나오면서
 * (아래쪽 교차) **K** 를 그린다. 글자이자 동시에 실제로 묶인 매듭(hitch)이다.
 *
 * 마크는 **단색**이다. 위·아래가 읽히는 이유는 색이 아니라 끊김이기 때문에,
 * 흑백 팩스에서도 1비트 파비콘에서도 같은 그림이 남는다. 그래서 예전 마크의
 * 인디고→로즈 그라데이션은 여기서 빠졌고, 액센트 4색은 캔버스 위 노드에만
 * 남는다.
 *
 * 틈은 **배경색을 덧칠하지 않고** `mask` 로 진짜 구멍을 낸다 — 아티팩트는
 * 바탕색을 아는 상태에서 gap 을 칠했지만, 이 컴포넌트는 헤더(`--surface`)·
 * 오프닝 히어로 등 서로 다른 바탕 위에 올라간다. 구멍이어야 어디서든 맞는다.
 *
 * 탭 아이콘(`app/icon.svg`) 도 같은 좌표를 쓴다.
 */
export function BrandMark({ className, animated = false }: BrandMarkProps) {
  const uid = useId();
  const stemGapId = `${uid}-stem`;
  const armGapId = `${uid}-arm`;

  /* `pathLength` 로 길이를 48 로 고정해 두면 실제 획 길이와 무관하게 dash
     계산이 맞아떨어진다 — 끈이 스스로 그어지는 연출의 전부다. 지연을 줘서
     그어지는 **순서** 자체가 매듭이 묶이는 순서가 되게 한다. */
  const draw = (delay: number) =>
    animated
      ? {
          className: 'animate-stroke-draw',
          style: { animationDelay: `${delay}ms` },
          pathLength: 48,
          strokeDasharray: 48,
        }
      : {};

  return (
    <svg viewBox="0 0 64 64" fill="none" className={cn('flex-none', className)} aria-hidden="true">
      {/* `white`/`black` 은 색이 아니라 **휘도 마스크의 채널값**이다 — 흰 곳은
          남기고 검은 곳은 뚫는다는 스텐실의 on/off 이지 화면에 칠해지는 페인트가
          아니다. 그래서 `design/tokens.ts` 로 표현할 수 있는 값이 애초에 없고,
          `design/noHardcodedColors.test.ts` 가 막으려는 "토큰 밖으로 새는 색"도
          아니다. (HEX 로 쓰면 그 가드에 잡힌다 — 여기서만큼은 키워드가 맞다.) */}
      <defs>
        {/* 기둥이 지나가는 자리 — 끈(꺾쇠)에서 이만큼을 파낸다. */}
        <mask id={stemGapId} maskUnits="userSpaceOnUse" x={-8} y={-8} width={80} height={80}>
          <rect x={-8} y={-8} width={80} height={80} fill="white" />
          <path d="M21 9 V55" stroke="black" strokeWidth={GAP_STEM} />
        </mask>
        {/* 아래쪽 팔이 다시 앞으로 나오는 자리 — 기둥에서 그만큼을 파낸다. */}
        <mask id={armGapId} maskUnits="userSpaceOnUse" x={-8} y={-8} width={80} height={80}>
          <rect x={-8} y={-8} width={80} height={80} fill="white" />
          <path d="M21 32 L21 44" stroke="black" strokeWidth={GAP_ARM} />
        </mask>
      </defs>

      {/* 1. 꺾쇠 — K 의 두 팔. 기둥이 지나가는 두 자리가 모두 끊겨 있다. */}
      <path
        {...draw(0)}
        d="M54 8 L10 32 L54 56"
        mask={`url(#${stemGapId})`}
        stroke="var(--cord)"
        strokeWidth={CORD}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 2. 기둥 — 위쪽 교차에서는 팔 **위로** 지나가고, 아래쪽에서는 끊긴다. */}
      <path
        {...draw(240)}
        d="M21 9 V55"
        mask={`url(#${armGapId})`}
        stroke="var(--cord)"
        strokeWidth={CORD}
        strokeLinecap="round"
      />
      {/* 3. 아래쪽 팔이 기둥 앞으로 다시 나온다 — 교차가 번갈아야 매듭이 된다. */}
      <path
        {...draw(520)}
        d="M13 33.64 L29 42.36"
        stroke="var(--cord)"
        strokeWidth={CORD}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 워드마크의 **o** — 글자 하나만 제품의 언어로 바꾼다.
 *
 * 획은 하나도 깎지 않고 속만 포트로 채웠다: 캔버스에서 노드끼리 물리는 바로
 * 그 소켓 형태(`ports/Socket.tsx` 의 링 + 코어). 커스텀 글리프는 이 하나뿐이고
 * 바깥 윤곽이 그대로라 어떤 크기에서도 o 로 읽힌다. 헤더 17px 기준 링 지름
 * 약 9.9px · 코어 3.1px — 두 겹이 분리돼 보이는 최소 크기 위다.
 */
function SocketO() {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className="inline-block flex-none"
      /* em 단위여야 글자 크기를 따라간다 — 로크업은 헤더/히어로에서 크기가 다르다. */
      style={{
        width: '0.58em',
        height: '0.58em',
        margin: '0 0.015em',
        transform: 'translateY(0.045em)',
      }}
    >
      <circle cx={20} cy={20} r={16} stroke="var(--text)" strokeWidth={8} />
      <circle cx={20} cy={20} r={5} fill="var(--cord)" />
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

/** 아이콘 마크 + 워드마크. `Knode Mark` 아티팩트의 K-Cross + 포트 o 로크업. */
export function BrandLockup({ size = 'hero' }: BrandLockupProps) {
  const header = size === 'header';

  return (
    <div className={cn('flex flex-none items-center', header ? 'gap-[6px]' : 'gap-[10px]')}>
      <BrandMark
        // 마크는 64 격자 안에서 사방 여백을 두고 그려진다 — 헤더에서 아티팩트의
        // 22px 타일과 같은 **먹는 크기**로 읽히려면 상자를 그만큼 키워야 한다.
        className={header ? 'h-[24px] w-[24px]' : 'h-[33px] w-[33px] sm:h-[37px] sm:w-[37px]'}
        animated={!header}
      />

      {/* o 가 SVG 라 그대로 두면 보조기술이 "Knde" 로 읽는다 — 통째로 이름을 준다. */}
      <span
        role="img"
        aria-label="Knode"
        className={cn(
          archivo.className,
          'flex items-baseline font-extrabold leading-none tracking-[-0.035em] text-text',
          header ? 'text-t17' : 'text-t30 sm:text-t36',
        )}
      >
        <span aria-hidden="true">Kn</span>
        <SocketO />
        <span aria-hidden="true">de</span>
      </span>
    </div>
  );
}
