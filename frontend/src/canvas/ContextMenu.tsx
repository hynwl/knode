'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { nodeAccent } from '@design/tokens';
import { cn } from '@/lib/cn';
import {
  NODE_CATEGORIES, searchNodes, type NodeCategory, type NodeDefinition, type NodeType,
} from '@/nodes/registry';
import { useAppStore } from '@/store';

export interface ContextMenuState {
  screen: { x: number; y: number };
  flow: { x: number; y: number };
  target: { kind: 'pane' } | { kind: 'node'; id: string } | { kind: 'edge'; id: string };
}

/**
 * ComfyUI 우클릭 메뉴 (Spec §3.4.1)
 *  - 빈 캔버스: 카테고리 계층 + 검색 인풋 자동 포커스 + 퍼지 매칭
 *  - Enter 로 첫 결과 추가, Esc 로 닫기
 */
export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const addNode = useAppStore((s) => s.addNode);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const removeEdges = useAppStore((s) => s.removeEdges);
  const duplicateNodes = useAppStore((s) => s.duplicateNodes);
  const toggleBypass = useAppStore((s) => s.toggleBypass);
  const toggleCollapse = useAppStore((s) => s.toggleCollapse);
  const togglePin = useAppStore((s) => s.togglePin);

  const target = state.target;
  const isPane = target.kind === 'pane';
  const targetId = target.kind === 'pane' ? '' : target.id;
  const results = useMemo(() => (isPane ? searchNodes(query) : []), [isPane, query]);

  useEffect(() => {
    if (isPane) inputRef.current?.focus();
  }, [isPane]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const add = (type: NodeType) => { addNode(type, state.flow); onClose(); };

  const grouped = useMemo(() => {
    const map = new Map<NodeCategory, NodeDefinition[]>();
    for (const def of results) {
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return NODE_CATEGORIES.map((c) => [c, map.get(c) ?? []] as const).filter(([, l]) => l.length);
  }, [results]);

  const style = {
    left: Math.min(state.screen.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 260),
    top: Math.min(state.screen.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 340),
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-ctx min-w-[240px] rounded-2xl border border-border bg-surface-3 p-[6px] text-t12_5 shadow-ctxMenu"
      style={style}
    >
      {isPane ? (
        <>
          <input
            ref={inputRef}
            value={query}
            placeholder="노드 검색…"
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); add(results[cursor]!.type); }
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            }}
            className="mb-[6px] w-full rounded-md border border-border bg-surface-2 px-[10px] py-2
                       text-t12_5 text-text outline-none placeholder:text-text-faint focus:border-indigo"
          />
          <div className="max-h-[340px] overflow-y-auto">
            {grouped.map(([category, defs]) => (
              <div key={category}>
                <div className="px-[10px] pb-1 pt-2 font-mono text-t9_5 font-semibold uppercase tracking-widest text-text-faint">
                  {category}
                </div>
                {defs.map((def) => {
                  const index = results.indexOf(def);
                  return (
                    <MenuItem
                      key={def.type}
                      active={index === cursor}
                      swatch={nodeAccent[def.accent].base}
                      label={def.label}
                      hint={def.description}
                      onClick={() => add(def.type)}
                    />
                  );
                })}
              </div>
            ))}
            {!results.length && (
              <div className="px-[10px] py-3 text-t11_5 text-text-faint">검색 결과가 없습니다.</div>
            )}
          </div>
        </>
      ) : target.kind === 'node' ? (
        <>
          <MenuItem label="복제" hint="Ctrl+D" onClick={() => { duplicateNodes([targetId]); onClose(); }} />
          <MenuItem label="접기 / 펼치기" onClick={() => { toggleCollapse([targetId]); onClose(); }} />
          <MenuItem label="바이패스 (실행 제외)" hint="Ctrl+B" onClick={() => { toggleBypass([targetId]); onClose(); }} />
          <MenuItem label="위치 고정 / 해제" onClick={() => { togglePin([targetId]); onClose(); }} />
          <Separator />
          <MenuItem danger label="노드 삭제" hint="Delete" onClick={() => { removeNodes([targetId]); onClose(); }} />
        </>
      ) : (
        <MenuItem danger label="연결 삭제" hint="Delete" onClick={() => { removeEdges([targetId]); onClose(); }} />
      )}
    </div>
  );
}

function MenuItem({
  label, hint, swatch, danger, active, onClick,
}: {
  label: string; hint?: string; swatch?: string; danger?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-[9px] rounded-md px-[10px] py-2 text-left font-semibold text-text-dim',
        'hover:bg-surface-2 hover:text-text',
        active && 'bg-surface-2 text-text',
        danger && 'hover:!text-danger',
      )}
    >
      {swatch && <span className="h-[9px] w-[9px] flex-none rounded-xs" style={{ background: swatch }} />}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="flex-none font-mono text-t9_5 text-text-faint">{hint}</span>}
    </button>
  );
}

function Separator() {
  return <div className="mx-[2px] my-[5px] h-px bg-border-soft" />;
}
