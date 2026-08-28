'use client';

import { Handle, Position } from '@xyflow/react';
import { portColor, size } from '@design/tokens';
import { cn } from '@/lib/cn';
import { PORT_TYPE_META, type PortSpec } from './types';

interface SocketProps {
  port: PortSpec;
  /** 노드 상단 기준 y 오프셋(px) */
  top: number;
  connected: boolean;
  /** 드래그 중 호환 판정: undefined = 드래그 중 아님 */
  compatible?: boolean;
}

/**
 * 아티팩트 `.port` 실측 재현: 13×13, border 2.5px, 노드 경계에서 -6.5px.
 * 타입별 모양은 Spec §6.1.
 */
export function Socket({ port, top, connected, compatible }: SocketProps) {
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
        title={`${port.label} · ${meta.label}`}
        className={cn(
          'ac-socket !absolute !z-ports !h-port !w-port !min-h-0 !min-w-0 !cursor-crosshair !transform-none',
          'transition-transform duration-fast hover:!scale-[1.35]',
          dimmed && '!opacity-30 !cursor-not-allowed',
        )}
        style={{
          top,
          [isLeft ? 'left' : 'right']: size.portOffset,
          width: size.portSize,
          height: size.portSize,
          background: connected ? color : 'var(--surface-2)',
          border: `${size.portBorder}px solid ${color}`,
          borderRadius: meta.shape === 'circle' ? '50%' : meta.shape === 'square' ? '2px' : '2px',
          transform: meta.shape.startsWith('diamond') ? 'rotate(45deg)' : undefined,
          clipPath:
            meta.shape === 'triangle' ? 'polygon(50% 0%, 100% 100%, 0% 100%)' : undefined,
        }}
      />
      <span
        className={cn(
          'pointer-events-none absolute whitespace-nowrap font-mono text-t9_5 text-text-faint',
          isLeft ? 'left-[14px]' : 'right-[14px]',
        )}
        style={{ top: top - 6 }}
      >
        {port.label}
      </span>
    </>
  );
}

/** 소켓 세로 배치: 아티팩트는 헤더(32px) 아래 48px 부터 26px 간격 */
export const SOCKET_START_Y = 48;
export const SOCKET_GAP_Y = 26;

export function socketOffsets(count: number, startY = SOCKET_START_Y): number[] {
  return Array.from({ length: count }, (_, i) => startY + i * SOCKET_GAP_Y);
}
