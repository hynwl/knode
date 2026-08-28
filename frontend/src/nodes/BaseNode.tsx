'use client';

import { memo, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, X } from 'lucide-react';
import { colorExtra, nodeAccent, size } from '@design/tokens';
import { cn } from '@/lib/cn';
import { Socket, socketOffsets } from '@/ports/Socket';
import { useAppStore, useNodeIssues, useNodeState } from '@/store';
import type { AcNode } from '@/types/canvas';
import { getNodeDef } from './registry';

interface BaseNodeProps {
  node: AcNode;
  selected: boolean;
  children?: React.ReactNode;
}

/**
 * 모든 노드의 공통 셸.
 * 아티팩트 `.node` 실측: width 230, radius 9, header 32px, shadow 0 6px 20px -8px #00000090
 */
export const BaseNode = memo(function BaseNode({ node, selected, children }: BaseNodeProps) {
  const def = getNodeDef(node.type);
  const accent = nodeAccent[def.accent];
  const runState = useNodeState(node.id);
  const issues = useNodeIssues(node.id);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const toggleCollapse = useAppStore((s) => s.toggleCollapse);
  const edges = useAppStore((s) => s.edges);

  const connectedPorts = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      if (e.source === node.id) set.add(e.sourceHandle);
      if (e.target === node.id) set.add(e.targetHandle);
    }
    return set;
  }, [edges, node.id]);

  const inputOffsets = socketOffsets(def.inputs.length);
  const outputOffsets = socketOffsets(def.outputs.length);
  const socketRows = Math.max(def.inputs.length, def.outputs.length);
  const bodyPadTop = socketRows > 0 ? 48 + socketRows * 26 - 18 : 26;

  const status = runState?.status ?? 'idle';
  const hasError = issues.some((i) => i.severity === 'error');

  return (
    <div
      className={cn(
        'relative rounded-2xl border bg-surface text-t12_5 shadow-node',
        selected ? 'border-node-selected shadow-node-selected' : 'border-border',
        node.ui.bypassed && 'opacity-40 grayscale',
        status === 'running' && 'ac-state-running animate-ring-pulse',
        status === 'succeeded' && 'ac-state-succeeded',
        status === 'failed' && 'ac-state-failed',
        status === 'queued' && 'ac-state-queued',
        status === 'skipped' && 'ac-state-skipped',
        status === 'cancelled' && 'ac-state-cancelled',
      )}
      style={{ width: node.width ?? size.nodeWidth }}
      data-node-id={node.id}
      data-node-type={node.type}
    >
      {/* ---- 헤더 (아티팩트 .node-header) ---- */}
      <div
        className="ac-drag-handle flex h-node-header cursor-grab items-center gap-[6px] rounded-t-xl px-[10px]
                   font-display text-t12 font-semibold tracking-tightest text-header-text active:cursor-grabbing"
        style={{ background: `linear-gradient(90deg, ${accent.base}, ${accent.deep})` }}
      >
        <button
          type="button"
          className="flex-none opacity-80 hover:opacity-100"
          aria-label={node.ui.collapsed ? '펼치기' : '접기'}
          onClick={(e) => { e.stopPropagation(); toggleCollapse([node.id]); }}
        >
          {node.ui.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span
          className="flex-none rounded-sm px-1 py-[2px] font-mono text-t9_5 font-semibold tracking-wide text-header-mark"
          style={{ background: colorExtra.headerMarkBg }}
        >
          {def.mark}
        </span>
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {String(node.data.name ?? node.data.title ?? node.data.label ?? def.label)}
        </span>
        {hasError && (
          <AlertTriangle size={13} className="flex-none text-white" aria-label="검증 오류" />
        )}
        <span className="flex-none text-t10 font-semibold uppercase tracking-wider opacity-75">
          {def.label}
        </span>
        <button
          type="button"
          className="flex h-4 w-4 flex-none items-center justify-center rounded-sm opacity-0
                     hover:!opacity-100 hover:bg-black/20 group-hover:opacity-75 [.react-flow__node:hover_&]:opacity-75"
          aria-label="노드 삭제"
          onClick={(e) => { e.stopPropagation(); removeNodes([node.id]); }}
        >
          <X size={12} />
        </button>
      </div>

      {/* ---- 소켓 ---- */}
      {!node.ui.collapsed && def.inputs.map((p, i) => (
        <Socket key={p.id} port={p} top={inputOffsets[i]!} connected={connectedPorts.has(p.id)} />
      ))}
      {!node.ui.collapsed && def.outputs.map((p, i) => (
        <Socket key={p.id} port={p} top={outputOffsets[i]!} connected={connectedPorts.has(p.id)} />
      ))}

      {/* ---- 본문 ---- */}
      {!node.ui.collapsed && (
        <div
          className="flex flex-col gap-[6px] px-[10px] pb-3 text-text-dim"
          style={{ paddingTop: bodyPadTop }}
        >
          {children}
        </div>
      )}
    </div>
  );
});
