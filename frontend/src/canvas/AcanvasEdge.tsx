'use client';

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { canvas as canvasTokens, portColor } from '@design/tokens';
import { useAppStore } from '@/store';
import type { PortType } from '@/ports/types';

/**
 * 아티팩트 엣지 실측 재현 + 실행 중 파티클 (Spec §3.4.3)
 * 성능 가드: 화면 내 활성 엣지가 30개를 넘으면 파티클을 끄고 밝기 변화로 대체한다.
 */
export function AcanvasEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } = props;
  const activeEdges = useAppStore((s) => s.activeEdges);
  const isActive = activeEdges.includes(id);
  const particlesAllowed = activeEdges.length <= canvasTokens.maxAnimatedEdges;

  const [path] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    curvature: 0.35,
  });

  const rawPortType = (data as { port_type?: PortType } | undefined)?.port_type;
  // 옛 문서 호환: Task 의 `depends on` 은 예전에 `context` 타입이었다. 지금은 `task` 로
  // 통합됐지만 이미 저장된 캔버스·공유 링크·백업 파일에는 'context' 가 그대로 남아 있어,
  // 그대로 두면 같은 연결인데 실행 중 엣지 색만 달라진다.
  const portType = rawPortType === 'context' ? 'task' : rawPortType;
  const accent = portType ? portColor[portType] : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: selected ? 'var(--run-a)' : isActive && accent ? accent : undefined,
          strokeWidth: selected ? canvasTokens.edgeWidthSelected : canvasTokens.edgeWidth,
          filter: isActive && !particlesAllowed ? 'brightness(1.9)' : undefined,
        }}
      />
      {isActive && particlesAllowed && (
        <circle className="ac-wire-particle" r={3} fill={accent ?? 'var(--run-a)'}>
          <animateMotion dur="1.1s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}
