'use client';

import { nodeAccent } from '@design/tokens';
import { getNodeDef, nodeLabel } from '@/nodes/registry';
import { useAppStore, useNodeState } from '@/store';
import { useT } from '@/i18n/react';

export interface HoverPreviewState {
  nodeId: string;
  /** 호버한 노드 DOM 의 뷰포트 기준 사각형 (팝업 위치 앵커) */
  anchor: { x: number; y: number; width: number; height: number };
}

/** 노드 호버 400ms 후 뜨는 역할/설정/직전 Output 미니 팝업 (Spec §3.4.5) */
export function NodeHoverPreview({
  state, onExpand, onMouseEnter, onMouseLeave,
}: {
  state: HoverPreviewState;
  onExpand: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const t = useT();
  const node = useAppStore((s) => s.nodes.find((n) => n.id === state.nodeId));
  const runState = useNodeState(state.nodeId);
  if (!node) return null;

  const def = getNodeDef(node.type);
  const accent = nodeAccent[def.accent];
  const data = node.data as Record<string, unknown>;

  const summary = def.fields
    .filter((f) => f.showOnNode && f.key !== 'name')
    .map((f) => {
      const raw = data[f.key];
      const label = t.k(f.label) ?? f.key;
      if (typeof raw === 'boolean') return raw ? { label, value: '✓' } : null;
      if (raw === undefined || raw === null || raw === '') return null;
      const value = f.kind === 'select'
        ? (t.k(f.options?.find((o) => o.value === raw)?.label) ?? String(raw))
        : truncate(String(raw), 60);
      return { label, value };
    })
    .filter((x): x is { label: string; value: string } => x !== null);

  const duration = runState?.startedAt && runState?.finishedAt
    ? runState.finishedAt - runState.startedAt
    : null;
  const tokens = runState?.usage ? runState.usage.prompt + runState.usage.completion : null;
  const preview = runState?.output ? truncate(runState.output, 200) : null;

  const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = 280;
  const left = Math.min(state.anchor.x + state.anchor.width + 10, winW - width - 12);
  const top = Math.max(12, Math.min(state.anchor.y, winH - 260));

  return (
    <div
      role="tooltip"
      className="fixed z-ctx animate-fadein rounded-2xl border border-border bg-surface-3 p-3 text-t12_5 shadow-ctxMenu"
      style={{ left, top, width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center gap-[6px]">
        <span className="h-[9px] w-[9px] flex-none rounded-xs" style={{ background: accent.base }} />
        <span className="flex-1 truncate font-display text-t12_5 font-bold text-text">
          {String(data.name ?? data.title ?? data.label ?? nodeLabel(def))}
        </span>
        <span className="flex-none font-mono text-t9_5 font-semibold uppercase tracking-wider text-text-faint">
          {nodeLabel(def)}
        </span>
      </div>

      {summary.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {summary.map((s) => (
            <div key={s.label} className="flex gap-2 text-t11 leading-snug">
              <span className="flex-none text-text-faint">{s.label}</span>
              <span className="flex-1 truncate text-text-dim">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {(duration !== null || tokens !== null) && (
        <div className="mt-2 flex gap-3 font-mono text-t10 text-text-faint">
          {duration !== null && <span>{(duration / 1000).toFixed(1)}s</span>}
          {tokens !== null && <span>{tokens.toLocaleString()} tok</span>}
        </div>
      )}

      {preview && (
        <div className="mt-2 rounded-lg border border-border-soft bg-surface-2 p-2 font-mono text-t10 leading-relaxed text-log-ok">
          {preview}
        </div>
      )}

      {runState?.output && (
        <button
          type="button"
          onClick={onExpand}
          className="mt-2 w-full rounded-md border border-border px-2 py-1 text-t11 font-semibold text-text-faint hover:border-border-light hover:text-text"
        >
          Expand
        </button>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
