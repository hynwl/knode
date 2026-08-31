'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow,
  useReactFlow,
  type Connection, type EdgeChange, type FinalConnectionState, type Node, type NodeChange,
  type NodeTypes, type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { color, nodeAccent, size } from '@design/tokens';
import { AcanvasNode } from '@/nodes/AcanvasNode';
import { getPort, NODE_TYPES, type NodeType } from '@/nodes/registry';
import type { NodeAccentKey } from '@design/tokens';
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

export function Canvas() {
  const nodes = useAppStore((s) => s.nodes);
  const edges = useAppStore((s) => s.edges);
  const initialViewport = useMemo(() => useAppStore.getState().viewport, []);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useAppStore((s) => s.selectedEdgeIds);
  const moveNode = useAppStore((s) => s.moveNode);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const removeEdges = useAppStore((s) => s.removeEdges);
  const selectNodes = useAppStore((s) => s.selectNodes);
  const selectEdges = useAppStore((s) => s.selectEdges);
  const connect = useAppStore((s) => s.connect);
  const setViewport = useAppStore((s) => s.setViewport);

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

  const rfNodes = useMemo(
    () => nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {},
      selected: selectedNodeIds.includes(n.id),
      dragHandle: '.ac-drag-handle',
      draggable: !n.ui.pinned,
      width: n.width ?? size.nodeWidth,
      parentId: n.parentNode ?? undefined,
      extent: n.extent ?? undefined,
    })),
    [nodes, selectedNodeIds],
  );

  const rfEdges = useMemo(
    () => edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'acanvas',
      selected: selectedEdgeIds.includes(e.id),
      data: e.data,
    })),
    [edges, selectedEdgeIds],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const selected: string[] = [];
    let touchedSelection = false;
    for (const c of changes) {
      if (c.type === 'position' && c.position) moveNode(c.id, c.position);
      else if (c.type === 'remove') removeNodes([c.id]);
      else if (c.type === 'select') {
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
  }, [moveNode, removeNodes, selectNodes]);

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
        className="bg-bg"
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
          style={{ width: 140, height: 96 }}
          className="!bottom-4 !right-4 !rounded-2xl !border !border-border !bg-surface-2 !opacity-90 hover:!opacity-100"
          maskColor={`${color.bg}99`}  /* 캔버스 배경 60% — 파생값, 신규 토큰 아님 */
          nodeColor={(n) => nodeAccent[(n.type as NodeAccentKey) ?? 'note']?.base ?? color.border}
          nodeStrokeWidth={0}
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
