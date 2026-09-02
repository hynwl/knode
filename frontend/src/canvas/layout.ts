'use client';

/**
 * 캔버스 기하 계산 (Spec §3.5-10 Group Frame / §3.5-12 Auto Layout).
 *
 * 스토어와 분리한 이유: 두 기능 다 **렌더된 노드의 실측 크기**가 있어야 제대로
 * 계산되는데(접힌 노드와 펼친 노드의 높이가 다르다), 스토어는 React Flow 인스턴스를
 * 모른다. 여기서 순수 계산만 하고 스토어에는 결과 좌표만 넘긴다.
 */

import dagre from 'dagre';

import { size } from '@design/tokens';
import type { AcEdge, AcNode, XYPosition } from '@/types/canvas';

export interface NodeSize { width: number; height: number; }

/** React Flow 가 실측한 크기(`node.measured`). 아직 렌더 전이면 undefined. */
export type SizeLookup = (nodeId: string) => NodeSize | undefined;

/** 그룹 프레임이 자식을 감쌀 때의 여백. 상단은 프레임 헤더 높이를 더 준다. */
export const GROUP_PADDING = 24;

/** 실측 높이를 못 구했을 때의 폴백 (레지스트리에 최소높이가 없는 타입용) */
const FALLBACK_HEIGHT = 140;

const NODE_MIN_HEIGHT = size.nodeMinHeight as Record<string, number | undefined>;

function fallbackSize(node: AcNode): NodeSize {
  const width = node.width ?? size.nodeWidth;
  // 접힌 노드는 헤더만 남는다 (BaseNode.tsx)
  if (node.ui.collapsed) return { width, height: size.nodeHeaderHeight };
  return { width, height: node.height ?? NODE_MIN_HEIGHT[node.type] ?? FALLBACK_HEIGHT };
}

export function sizeOf(node: AcNode, measured: SizeLookup): NodeSize {
  return measured(node.id) ?? fallbackSize(node);
}

/**
 * dagre 위상 배치. 반환값은 **실제로 옮길 노드만** 담은 좌표 맵이다.
 *
 * - 그룹 자식은 좌표가 부모 상대값이라 대상에서 뺀다 — 프레임이 움직이면 따라온다.
 *   대신 자식에 물린 엣지는 그 프레임의 엣지로 접어서 위상에 반영한다.
 * - 고정(pin)된 노드는 옮기지 않는다 (`store.moveNode` 가 수동 드래그를 막는 것과 동일).
 */
export function autoLayoutPositions(
  nodes: AcNode[],
  edges: AcEdge[],
  measured: SizeLookup,
): Record<string, XYPosition> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const frameOf = (id: string): string => byId.get(id)?.parentNode ?? id;

  const targets = nodes.filter((n) => !n.parentNode);
  if (targets.length < 2) return {};

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 42, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map(targets.map((n) => [n.id, sizeOf(n, measured)]));
  for (const n of targets) g.setNode(n.id, { ...sizes.get(n.id)! });
  for (const e of edges) {
    const source = frameOf(e.source);
    const target = frameOf(e.target);
    if (source === target || !g.hasNode(source) || !g.hasNode(target)) continue;
    g.setEdge(source, target);
  }
  dagre.layout(g);

  const placed = targets.map((n) => {
    const center = g.node(n.id);
    const s = sizes.get(n.id)!;
    return { node: n, x: center.x - s.width / 2, y: center.y - s.height / 2 };
  });

  // 그래프가 캔버스 딴 곳으로 순간이동하지 않도록 기존 바운딩박스 좌상단에 맞춘다.
  const dx = Math.min(...targets.map((n) => n.position.x)) - Math.min(...placed.map((p) => p.x));
  const dy = Math.min(...targets.map((n) => n.position.y)) - Math.min(...placed.map((p) => p.y));

  const out: Record<string, XYPosition> = {};
  for (const p of placed) {
    if (p.node.ui.pinned) continue;
    const x = Math.round(p.x + dx);
    const y = Math.round(p.y + dy);
    if (x !== p.node.position.x || y !== p.node.position.y) out[p.node.id] = { x, y };
  }
  return out;
}

export interface GroupBounds {
  ids: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `Ctrl+G` 로 묶을 대상과 프레임 사각형.
 * 이미 그룹에 든 노드와 그룹 프레임 자신은 제외한다 (중첩 그룹 미지원).
 * 대상이 2개 미만이면 null.
 */
export function groupBoundsFor(
  nodes: AcNode[],
  selectedIds: string[],
  measured: SizeLookup,
): GroupBounds | null {
  const selected = new Set(selectedIds);
  const members = nodes.filter((n) => selected.has(n.id) && !n.parentNode && n.type !== 'group');
  if (members.length < 2) return null;

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const n of members) {
    const s = sizeOf(n, measured);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + s.width);
    maxY = Math.max(maxY, n.position.y + s.height);
  }

  return {
    ids: members.map((n) => n.id),
    x: Math.round(minX - GROUP_PADDING),
    y: Math.round(minY - GROUP_PADDING - size.nodeHeaderHeight),
    width: Math.round(maxX - minX + GROUP_PADDING * 2),
    height: Math.round(maxY - minY + GROUP_PADDING * 2 + size.nodeHeaderHeight),
  };
}
