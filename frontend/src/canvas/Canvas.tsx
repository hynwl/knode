'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow,
  useReactFlow,
  type Connection, type Edge, type EdgeChange, type FinalConnectionState, type Node, type NodeChange,
  type NodeTypes, type EdgeTypes, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { color, nodeAccent, size } from '@design/tokens';
import { AcanvasNode } from '@/nodes/AcanvasNode';
import { getPort, NODE_TYPES, type NodeType } from '@/nodes/registry';
import type { NodeAccentKey } from '@design/tokens';
import type { AcEdge, AcNode } from '@/types/canvas';
import { cn } from '@/lib/cn';
import { motionDuration } from '@/lib/reducedMotion';
import { useAppStore } from '@/store';
import { AcanvasEdge } from './AcanvasEdge';
import { AutoConnectPopup, type AutoConnectState } from './AutoConnectPopup';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { NodeHoverPreview, type HoverPreviewState } from './NodeHoverPreview';

/** Spec §3.4.5 — 호버 후 팝업이 뜨기까지의 지연 */
const HOVER_PREVIEW_DELAY_MS = 400;
/** 노드 밖으로 나가도 팝업으로 커서를 옮길 시간을 준다 (깜빡임 방지) */
const HOVER_PREVIEW_CLOSE_GRACE_MS = 150;

const nodeTypes: NodeTypes = Object.fromEntries(
  NODE_TYPES.map((t) => [t, AcanvasNode]),
) as NodeTypes;

const edgeTypes: EdgeTypes = { acanvas: AcanvasEdge };

/** RF 노드의 `data` 자리표시자 — 매 변환마다 새 `{}` 를 만들지 않기 위한 공유 상수. */
const EMPTY_NODE_DATA: Record<string, never> = Object.freeze({});

/**
 * 캔버스 노드의 `aria-label` 에 쓸 이름 (Spec §17.2).
 * BaseNode 헤더가 화면에 그리는 것과 같은 우선순위로 고른다 — 보이는 이름과
 * 스크린리더가 읽는 이름이 달라지면 안 된다.
 */
function nodeTitle(n: AcNode): string {
  const d = n.data as Record<string, unknown>;
  return String(d.name ?? d.title ?? d.label ?? n.type);
}

/**
 * `onInit` 은 Auto Layout / Group 이 노드 **실측 크기**(`node.measured`)를 읽어야
 * 해서 노출한다 — `useReactFlow()` 는 ReactFlowProvider 안에서만 쓸 수 있는데
 * 단축키 배선은 provider 바깥(page.tsx)에 있다.
 */
export function Canvas({ onInit }: { onInit?: (instance: ReactFlowInstance) => void }) {
  const nodes = useAppStore((s) => s.nodes);
  const edges = useAppStore((s) => s.edges);
  const initialViewport = useMemo(() => useAppStore.getState().viewport, []);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useAppStore((s) => s.selectedEdgeIds);
  const moveNode = useAppStore((s) => s.moveNode);
  const setNodeDimensions = useAppStore((s) => s.setNodeDimensions);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const removeEdges = useAppStore((s) => s.removeEdges);
  const selectNodes = useAppStore((s) => s.selectNodes);
  const selectEdges = useAppStore((s) => s.selectEdges);
  const connect = useAppStore((s) => s.connect);
  const setViewport = useAppStore((s) => s.setViewport);
  const layoutAnimating = useAppStore((s) => s.layoutAnimating);
  const focusRequest = useAppStore((s) => s.focusRequest);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [autoConnect, setAutoConnect] = useState<AutoConnectState | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
  const hoverOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rf = useReactFlow();

  const closeHoverPreview = useCallback(() => {
    if (hoverOpenTimer.current) { clearTimeout(hoverOpenTimer.current); hoverOpenTimer.current = null; }
    if (hoverCloseTimer.current) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; }
    setHoverPreview(null);
  }, []);

  useEffect(() => closeHoverPreview, [closeHoverPreview]);

  // 에러 → 노드 카메라 포커스 (Spec §17.4 MUST #2). `token` 이 바뀔 때만 움직인다 —
  // 같은 노드를 다시 포커스해도(연속 실패 등) 다시 재생돼야 하므로 nodeId 가 아니라
  // token 을 의존성으로 둔다. BaseNode 의 `.ac-focus-flash` 링도 같은 token 을 본다.
  const lastFocusToken = useRef(0);
  useEffect(() => {
    if (!focusRequest || focusRequest.token === lastFocusToken.current) return;
    lastFocusToken.current = focusRequest.token;
    const internal = rf.getInternalNode(focusRequest.nodeId);
    if (!internal) return;
    // 그룹 프레임 자식은 `position` 이 부모 기준 상대좌표라 그대로 쓰면 엉뚱한 곳을
    // 비춘다 — 반드시 절대좌표(`internals.positionAbsolute`)를 써야 한다.
    const abs = internal.internals.positionAbsolute;
    const w = internal.measured?.width ?? internal.width ?? size.nodeWidth;
    const h = internal.measured?.height ?? internal.height ?? 120;
    void rf.setCenter(
      abs.x + w / 2,
      abs.y + h / 2,
      // duration 은 JS 숫자라 CSS 의 prefers-reduced-motion 블록이 못 잡는다 (§3.4.3).
      { zoom: Math.max(rf.getZoom(), 0.9), duration: motionDuration(500) },
    );
  }, [focusRequest, rf]);

  // 노드 호버 프리뷰 — 400ms 지연 후 역할/설정/직전 Output 팝업 (Spec §3.4.5)
  const onNodeMouseEnter = useCallback((event: React.MouseEvent, node: Node) => {
    if (hoverCloseTimer.current) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; }
    if (hoverOpenTimer.current) clearTimeout(hoverOpenTimer.current);
    const rect = event.currentTarget.getBoundingClientRect();
    hoverOpenTimer.current = setTimeout(() => {
      hoverOpenTimer.current = null;
      setHoverPreview({
        nodeId: node.id,
        anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    }, HOVER_PREVIEW_DELAY_MS);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    if (hoverOpenTimer.current) { clearTimeout(hoverOpenTimer.current); hoverOpenTimer.current = null; }
    hoverCloseTimer.current = setTimeout(() => setHoverPreview(null), HOVER_PREVIEW_CLOSE_GRACE_MS);
  }, []);

  const cancelHoverClose = useCallback(() => {
    if (hoverCloseTimer.current) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; }
  }, []);

  // 팝업의 Expand — 노드를 선택해 인스펙터에 전체 실행 결과를 띄우고 로그 콘솔을 연다.
  const onExpandHoverPreview = useCallback(() => {
    const nodeId = hoverPreview?.nodeId;
    if (!nodeId) return;
    closeHoverPreview();
    const store = useAppStore.getState();
    store.selectNodes([nodeId]);
    if (!store.rightPanelOpen) store.togglePanel('right');
    store.setConsoleOpen(true);
  }, [hoverPreview, closeHoverPreview]);

  /**
   * 스토어 노드 → React Flow 노드 변환 (Spec §16.2 성능 규칙).
   *
   * ⚠️ 여기서 매번 **모든** 노드에 새 객체를 만들면 `AcanvasNode` 의 `React.memo`
   * 가 통째로 무력화된다 — 스토어의 `nodes` 배열은 노드 하나만 바뀌어도 새 참조가
   * 되므로(immer), 노드 1개 편집이 캔버스의 모든 노드를 리렌더시킨다.
   * (M3-T11 실측: 50노드에서 `updateNodeData` 1회 → AcanvasNode 202회 렌더)
   *
   * 그래서 노드별 변환 결과를 캐시하고, 원본 `AcNode` 참조와 선택 여부가 그대로면
   * **직전 객체를 그대로 재사용**한다. immer 가 안 건드린 노드의 참조를 유지해
   * 주므로(구조적 공유) 바뀐 노드만 새 객체가 된다.
   */
  const nodeCache = useRef(new Map<string, { src: AcNode; selected: boolean; out: Node }>());
  const rfNodes = useMemo<Node[]>(() => {
    const cache = nodeCache.current;
    const selected = new Set(selectedNodeIds);
    const sorted = nodes
      // 부모(그룹 프레임)가 배열에서 자식보다 앞에 있어야 React Flow 가 부모를 찾는다
      // (@xyflow/system: "Parent node ... not found"). 그룹은 만들어진 순서상 뒤에 온다.
      .slice()
      .sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'));
    const out = sorted.map((n) => {
      const isSelected = selected.has(n.id);
      const hit = cache.get(n.id);
      if (hit && hit.src === n && hit.selected === isSelected) return hit.out;
      const rf: Node = {
        id: n.id,
        type: n.type,
        position: n.position,
        // 노드 본문은 스토어를 직접 구독하므로 RF 의 `data` 는 쓰지 않는다.
        // 매번 `{}` 리터럴을 넘기면 그것만으로 memo 비교가 깨지므로 상수를 넘긴다.
        data: EMPTY_NODE_DATA,
        // Spec §17.2 — React Flow 는 노드를 `tabIndex=0` `role="group"` 으로 만들어
        // Tab 순회 자체는 되게 해주지만, `data` 를 안 쓰는 우리 구조에서는 라벨을
        // 못 찾아 `aria-label` 이 비어버린다(M4-T9 실측: 스크린리더가 "group" 만
        // 읽음). 노드 이름 + 타입을 직접 실어준다.
        ariaLabel: `${nodeTitle(n)} (${n.type})`,
        selected: isSelected,
        dragHandle: '.ac-drag-handle',
        draggable: !n.ui.pinned,
        width: n.width ?? size.nodeWidth,
        height: n.height ?? undefined,
        parentId: n.parentNode ?? undefined,
        extent: n.extent ?? undefined,
      };
      cache.set(n.id, { src: n, selected: isSelected, out: rf });
      return rf;
    });
    // 삭제된 노드의 캐시 엔트리는 버린다 (id 재사용이 없으므로 누수만 막으면 된다).
    if (cache.size > sorted.length) {
      const alive = new Set(sorted.map((n) => n.id));
      for (const key of cache.keys()) if (!alive.has(key)) cache.delete(key);
    }
    return out;
  }, [nodes, selectedNodeIds]);

  /** 엣지도 같은 이유로 변환 결과를 캐시한다 (`AcanvasEdge` 도 memo 대상). */
  const edgeCache = useRef(new Map<string, { src: AcEdge; selected: boolean; out: Edge }>());
  const rfEdges = useMemo<Edge[]>(() => {
    const cache = edgeCache.current;
    const selected = new Set(selectedEdgeIds);
    const out = edges.map((e) => {
      const isSelected = selected.has(e.id);
      const hit = cache.get(e.id);
      if (hit && hit.src === e && hit.selected === isSelected) return hit.out;
      const rf: Edge = {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: 'acanvas',
        selected: isSelected,
        data: e.data,
      };
      cache.set(e.id, { src: e, selected: isSelected, out: rf });
      return rf;
    });
    if (cache.size > edges.length) {
      const alive = new Set(edges.map((e) => e.id));
      for (const key of cache.keys()) if (!alive.has(key)) cache.delete(key);
    }
    return out;
  }, [edges, selectedEdgeIds]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const selected: string[] = [];
    let touchedSelection = false;
    for (const c of changes) {
      if (c.type === 'position' && c.position) moveNode(c.id, c.position);
      else if (c.type === 'remove') removeNodes([c.id]);
      else if (c.type === 'dimensions' && c.dimensions) {
        setNodeDimensions(c.id, c.dimensions.width, c.dimensions.height);
      } else if (c.type === 'select') {
        touchedSelection = true;
        if (c.selected) selected.push(c.id);
      }
    }
    if (touchedSelection) {
      const keep = new Set(selected);
      for (const c of changes) if (c.type === 'select' && !c.selected) keep.delete(c.id);
      const prev = useAppStore.getState().selectedNodeIds.filter(
        (id) => !changes.some((c) => c.type === 'select' && c.id === id),
      );
      selectNodes([...new Set([...prev, ...keep])]);
    }
  }, [moveNode, removeNodes, setNodeDimensions, selectNodes]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removed: string[] = [];
    const sel: string[] = [];
    for (const c of changes) {
      if (c.type === 'remove') removed.push(c.id);
      else if (c.type === 'select' && c.selected) sel.push(c.id);
    }
    if (removed.length) removeEdges(removed);
    if (sel.length) selectEdges(sel);
  }, [removeEdges, selectEdges]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    connect({
      source: c.source, sourceHandle: c.sourceHandle,
      target: c.target, targetHandle: c.targetHandle,
    });
  }, [connect]);

  // 소켓 드래그 후 빈 공간 drop 시 호환 노드 추천 팝업 (Spec §3.4.4)
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    if (connectionState.toHandle || connectionState.toNode) return;
    const { fromNode, fromHandle } = connectionState;
    if (!fromNode || !fromHandle?.id) return;
    const port = getPort(fromNode.type as NodeType, fromHandle.id);
    if (!port) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!point) return;
    const screen = { x: point.clientX, y: point.clientY };
    setAutoConnect({
      screen,
      flow: rf.screenToFlowPosition(screen),
      fromNodeId: fromNode.id,
      fromPortId: fromHandle.id,
      fromPortType: port.type,
      fromDirection: fromHandle.type === 'source' ? 'out' : 'in',
    });
  }, [rf]);

  const openMenu = useCallback((e: React.MouseEvent, target: ContextMenuState['target']) => {
    e.preventDefault();
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({ screen: { x: e.clientX, y: e.clientY }, flow: pos, target });
  }, [rf]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        defaultViewport={initialViewport}
        onMoveEnd={(_, vp) => setViewport(vp)}
        onMoveStart={closeHoverPreview}
        onNodeDragStart={closeHoverPreview}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={() => { useAppStore.getState().clearSelection(); closeHoverPreview(); }}
        onPaneContextMenu={(e) => openMenu(e as React.MouseEvent, { kind: 'pane' })}
        onNodeContextMenu={(e, n) => openMenu(e, { kind: 'node', id: n.id })}
        onEdgeContextMenu={(e, ed) => openMenu(e, { kind: 'edge', id: ed.id })}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        panOnDrag={[0, 1]}
        selectionOnDrag
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        defaultEdgeOptions={{ type: 'acanvas' }}
        onInit={onInit}
        className={cn('bg-bg', layoutAnimating && 'ac-layout-animating')}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={size.gridSize}
          size={size.gridDotRadius}
          color={color.gridDot}
        />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          style={{ width: 168, height: 112 }}
          className="!bottom-4 !right-4 !rounded-2xl !border !border-border !bg-surface-2 !opacity-90 hover:!opacity-100"
          maskColor={`${color.bg}99`}  /* 캔버스 배경 60% — 파생값, 신규 토큰 아님 */
          nodeColor={(n) => nodeAccent[(n.type as NodeAccentKey) ?? 'note']?.base ?? color.border}
          /* 실제 노드 카드(BaseNode)의 rounded-2xl(9px)을 흉내낸다. 미니맵은 전체 그래프
             경계를 축소해 그리므로 같은 rx 값도 그래프 크기에 따라 체감 곡률이 달라지지만,
             Knode 노드 폭(230) 기준으로 봤을 때 자연스러운 곡률의 근사치다. */
          nodeBorderRadius={24}
          nodeStrokeColor={(n) => nodeAccent[(n.type as NodeAccentKey) ?? 'note']?.deep ?? color.border}
          nodeStrokeWidth={1.5}
        />
        <Controls
          className="!bottom-4 !left-4 !rounded-xl !border !border-border !bg-surface-3 [&_button]:!border-border-soft [&_button]:!bg-surface-3 [&_button]:!fill-text-dim [&_button:hover]:!bg-btn-hover"
          showInteractive={false}
        />
      </ReactFlow>

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {autoConnect && <AutoConnectPopup state={autoConnect} onClose={() => setAutoConnect(null)} />}
      {hoverPreview && (
        <NodeHoverPreview
          state={hoverPreview}
          onExpand={onExpandHoverPreview}
          onMouseEnter={cancelHoverClose}
          onMouseLeave={onNodeMouseLeave}
        />
      )}
    </div>
  );
}
