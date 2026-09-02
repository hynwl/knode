'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { nodeAccent } from '@design/tokens';
import { cn } from '@/lib/cn';
import { canConnectTypes } from '@/ports/matrix';
import type { PortDirection, PortSpec, PortType } from '@/ports/types';
import { NODE_DEFINITIONS, nodeLabel, type NodeDefinition } from '@/nodes/registry';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';

export interface AutoConnectState {
  screen: { x: number; y: number };
  flow: { x: number; y: number };
  fromNodeId: string;
  fromPortId: string;
  fromPortType: PortType;
  /** 드래그를 시작한 소켓의 방향. 'out' 이면 새 노드의 입력을, 'in' 이면 새 노드의 출력을 찾는다 */
  fromDirection: PortDirection;
}

interface Candidate {
  def: NodeDefinition;
  /** 새로 생성될 노드에서 드래그 시작 소켓과 실제로 연결될 포트 */
  port: PortSpec;
}

/** 드래그 시작 소켓과 호환되는 노드 타입만 필터링 (Spec §3.4.4 — 포트 타입 §6 기반) */
function findCandidates(fromPortType: PortType, fromDirection: PortDirection): Candidate[] {
  const out: Candidate[] = [];
  for (const def of Object.values(NODE_DEFINITIONS)) {
    if (!def.compilable) continue;
    const ports = fromDirection === 'out' ? def.inputs : def.outputs;
    const port = ports.find((p) => (
      fromDirection === 'out' ? canConnectTypes(fromPortType, p.type) : canConnectTypes(p.type, fromPortType)
    ));
    if (port) out.push({ def, port });
  }
  return out;
}

/** 소켓 드래그 후 빈 캔버스에 drop 시 뜨는 호환 노드 추천 팝업 (Spec §3.4.4) */
export function AutoConnectPopup({ state, onClose }: { state: AutoConnectState; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const addNode = useAppStore((s) => s.addNode);
  const connect = useAppStore((s) => s.connect);

  const candidates = useMemo(
    () => findCandidates(state.fromPortType, state.fromDirection),
    [state.fromPortType, state.fromDirection],
  );

  const pick = (c: Candidate) => {
    const newId = addNode(c.def.type, state.flow);
    if (state.fromDirection === 'out') {
      connect({ source: state.fromNodeId, sourceHandle: state.fromPortId, target: newId, targetHandle: c.port.id });
    } else {
      connect({ source: newId, sourceHandle: c.port.id, target: state.fromNodeId, targetHandle: state.fromPortId });
    }
    onClose();
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, candidates.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      if (e.key === 'Enter' && candidates[cursor]) { e.preventDefault(); pick(candidates[cursor]!); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, candidates, cursor]);

  if (!candidates.length) return null;

  const style = {
    left: Math.min(state.screen.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240),
    top: Math.min(state.screen.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 280),
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-ctx min-w-[220px] rounded-2xl border border-border bg-surface-3 p-[6px] text-t12_5 shadow-ctxMenu"
      style={style}
    >
      <div className="px-[10px] pb-1 pt-1 font-mono text-t9_5 font-semibold uppercase tracking-widest text-text-faint">
        {t('autoconnect.title')}
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {candidates.map((c, i) => (
          <button
            key={c.def.type}
            type="button"
            role="menuitem"
            onClick={() => pick(c)}
            className={cn(
              'flex w-full items-center gap-[9px] rounded-md px-[10px] py-2 text-left font-semibold text-text-dim',
              'hover:bg-surface-2 hover:text-text',
              i === cursor && 'bg-surface-2 text-text',
            )}
          >
            <span className="h-[9px] w-[9px] flex-none rounded-xs" style={{ background: nodeAccent[c.def.accent].base }} />
            <span className="flex-1 truncate">{nodeLabel(c.def)}</span>
            <span className="flex-none font-mono text-t9_5 text-text-faint">{c.port.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
