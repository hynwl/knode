'use client';

import { Handle, Position } from '@xyflow/react';
import { portColor, size } from '@design/tokens';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n/react';
import { PORT_TYPE_META, type PortSpec, type SocketShape as SocketShapeKind } from './types';

interface SocketProps {
  port: PortSpec;
  /** 노드 상단 기준 y 오프셋(px) */
  top: number;
  connected: boolean;
  /** 드래그 중 호환 판정: undefined = 드래그 중 아님 */
  compatible?: boolean;
  /** 접힌 노드 — 라벨을 숨기고 소켓만 남긴다 (Spec §3.5-6) */
  compact?: boolean;
}

/**
 * 아티팩트 `.port` 실측 재현: 13×13, border 2.5px, 노드 경계에서 -6.5px.
 * 타입별 모양은 Spec §6.1. 연결 전엔 **비어있는(hollow) 윤곽선**, 연결되면 색이 찬다 —
 * 모양은 SVG로 그린다 (이전엔 `border` + `clip-path` 조합이었는데, 삼각형처럼 축이 안
 * 맞는 모양에서 테두리가 일그러져 보이는 문제가 있었다).
 */
export function Socket({ port, top, connected, compatible, compact }: SocketProps) {
  const t = useT();
  const meta = PORT_TYPE_META[port.type];
  const color = portColor[meta.colorKey];
  const isLeft = port.direction === 'in';
  const dimmed = compatible === false;

  return (
    <>
      <Handle
        id={port.id}
        type={isLeft ? 'target' : 'source'}
        position={isLeft ? Position.Left : Position.Right}
        title={`${port.label} · ${t(meta.labelKey)}`}
        className={cn(
          'ac-socket group !absolute !z-ports !h-port !w-port !min-h-0 !min-w-0 !cursor-crosshair !transform-none',
          dimmed && '!opacity-30 !cursor-not-allowed',
        )}
        style={{
          top,
          [isLeft ? 'left' : 'right']: size.portOffset,
          width: size.portSize,
          height: size.portSize,
        }}
      >
        <SocketGlyph shape={meta.shape} color={color} filled={connected} />
      </Handle>
      {!compact && (
        <span
          className={cn(
            'pointer-events-none absolute whitespace-nowrap font-mono text-t9_5 text-text-faint',
            isLeft ? 'left-[14px]' : 'right-[14px]',
          )}
          style={{ top: top - 6 }}
        >
          {port.label}
        </span>
      )}
    </>
  );
}

/** 소켓 모양별 SVG. `viewBox` 는 `size.portSize`(13) 기준, 선 굵기는 `size.portBorder`. */
function SocketGlyph({
  shape, color, filled,
}: {
  shape: SocketShapeKind;
  color: string;
  filled: boolean;
}) {
  const box = size.portSize;
  const inset = size.portBorder / 2;
  const shared = { stroke: color, strokeWidth: size.portBorder, fill: filled ? color : 'transparent' };
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      className="pointer-events-none absolute inset-0 h-full w-full transition-transform duration-fast group-hover:scale-[1.35]"
    >
      {shape === 'circle' && (
        <circle cx={box / 2} cy={box / 2} r={box / 2 - inset} {...shared} />
      )}
      {shape === 'square' && (
        <rect x={inset} y={inset} width={box - inset * 2} height={box - inset * 2} rx={2} {...shared} />
      )}
      {(shape === 'diamond' || shape === 'diamond-hollow') && (() => {
        // 회전된 정사각형의 대각선이 box 를 넘지 않도록 변 길이를 역산한다.
        const dSide = (box / 2 - inset) * Math.SQRT2;
        const dOffset = (box - dSide) / 2;
        return (
          <rect
            x={dOffset} y={dOffset} width={dSide} height={dSide} rx={1.1}
            transform={`rotate(45 ${box / 2} ${box / 2})`}
            {...shared}
            fill={shape === 'diamond-hollow' ? 'transparent' : shared.fill}
          />
        );
      })()}
      {shape === 'triangle' && (
        <polygon
          points={`${box / 2},${inset} ${box - inset},${box - inset} ${inset},${box - inset}`}
          strokeLinejoin="round"
          {...shared}
        />
      )}
    </svg>
  );
}

/** 소켓 세로 배치: 아티팩트는 헤더(32px) 아래 48px 부터 26px 간격 */
export const SOCKET_START_Y = 48;
export const SOCKET_GAP_Y = 26;

export function socketOffsets(count: number, startY = SOCKET_START_Y): number[] {
  return Array.from({ length: count }, (_, i) => startY + i * SOCKET_GAP_Y);
}
