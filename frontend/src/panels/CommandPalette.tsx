'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { nodeAccent } from '@design/tokens';
import { cn } from '@/lib/cn';
import { NODE_DEFINITIONS, nodeDescription, nodeLabel } from '@/nodes/registry';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';
import type { TemplateMeta } from '@/templates/builtin';

interface Command {
  id: string;
  group: 'actions' | 'addNode' | 'templates';
  label: string;
  hint?: string;
  swatch?: string;
  disabled?: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  canRun: boolean;
  running: boolean;
  onRun: () => void;
  onDryRun: () => void;
  onStop: () => void;
  onExport: () => void;
  onOpenBackup: () => void;
  onOpenTemplates: () => void;
  onOpenSettings: () => void;
  onOpenExportCode: () => void;
  onOpenPublish: () => void;
  onAutoLayout: () => void;
  onGroupSelection: () => void;
  onUngroupSelection: () => void;
  templates: TemplateMeta[];
  onSelectTemplate: (id: string) => void;
}

/**
 * `Ctrl+K` 커맨드 팔레트 (Spec §3.5-16). 노드 추가·템플릿 열기·설정·실행을
 * 전부 키보드로 하기 위한 단일 입구 — `ContextMenu` 의 검색+퍼지매칭+키보드
 * 네비게이션 패턴을 그대로 재사용한다.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const {
    open, onClose, canRun, running, onRun, onDryRun, onStop, onExport,
    onOpenBackup, onOpenTemplates, onOpenSettings, onOpenExportCode, onOpenPublish,
    onAutoLayout, onGroupSelection, onUngroupSelection, templates, onSelectTemplate,
  } = props;
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const addNode = useAppStore((s) => s.addNode);
  const viewport = useAppStore((s) => s.viewport);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const togglePanel = useAppStore((s) => s.togglePanel);

  const dropPosition = () => ({
    x: (-viewport.x + 420) / viewport.zoom,
    y: (-viewport.y + 200) / viewport.zoom,
  });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    inputRef.current?.focus();
  }, [open]);

  // `Esc` 는 전역 단축키(`hotkeys.ts`)가 실행 중단으로 쓴다 — 팔레트가 열려 있을 땐
  // 그 대신 팔레트를 닫아야 하므로, window 로 버블링하기 전에(document 단계) 가로챈다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const commands = useMemo<Command[]>(() => {
    const run = (fn: () => void) => () => { fn(); onClose(); };
    const actions: Command[] = [
      { id: 'run', group: 'actions', label: t('commandPalette.run'), hint: '⌃/⌘+Enter', disabled: !canRun, run: run(onRun) },
      { id: 'dryRun', group: 'actions', label: t('commandPalette.dryRun'), disabled: !canRun, run: run(onDryRun) },
      ...(running
        ? [{ id: 'stop', group: 'actions' as const, label: t('commandPalette.stop'), hint: 'Esc', run: run(onStop) }]
        : []),
      { id: 'export', group: 'actions', label: t('commandPalette.export'), hint: '⌃/⌘+S', run: run(onExport) },
      { id: 'backup', group: 'actions', label: t('commandPalette.backup'), hint: '⌃/⌘+O', run: run(onOpenBackup) },
      { id: 'autoLayout', group: 'actions', label: t('commandPalette.autoLayout'), hint: '⌃/⌘+L', run: run(onAutoLayout) },
      ...(selectedNodeIds.length >= 2
        ? [{ id: 'group', group: 'actions' as const, label: t('commandPalette.group'), hint: '⌃/⌘+G', run: run(onGroupSelection) }]
        : []),
      { id: 'ungroup', group: 'actions', label: t('commandPalette.ungroup'), run: run(onUngroupSelection) },
      { id: 'openTemplates', group: 'actions', label: t('commandPalette.openTemplates'), run: run(onOpenTemplates) },
      { id: 'openSettings', group: 'actions', label: t('commandPalette.openSettings'), run: run(onOpenSettings) },
      { id: 'openExportCode', group: 'actions', label: t('commandPalette.openExportCode'), run: run(onOpenExportCode) },
      { id: 'openPublish', group: 'actions', label: t('commandPalette.openPublish'), run: run(onOpenPublish) },
      { id: 'toggleLeft', group: 'actions', label: t('commandPalette.toggleLeftPanel'), run: run(() => togglePanel('left')) },
      { id: 'toggleRight', group: 'actions', label: t('commandPalette.toggleRightPanel'), run: run(() => togglePanel('right')) },
    ];

    const addNodeCommands: Command[] = Object.values(NODE_DEFINITIONS).map((def) => ({
      id: `add:${def.type}`,
      group: 'addNode',
      label: t('commandPalette.addNode', { name: nodeLabel(def) }),
      hint: def.disabledInV1 ? 'v1.1' : nodeDescription(def),
      swatch: nodeAccent[def.accent].base,
      run: run(() => addNode(def.type, dropPosition())),
    }));

    const templateCommands: Command[] = templates.map((tpl) => ({
      id: `tpl:${tpl.id}`,
      group: 'templates',
      label: tpl.name,
      hint: tpl.requiresKeys.length ? tpl.requiresKeys.join(', ') : undefined,
      run: run(() => onSelectTemplate(tpl.id)),
    }));

    return [...actions, ...addNodeCommands, ...templateCommands];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, canRun, running, selectedNodeIds.length, templates]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const score = (c: Command): number => {
      const hay = [c.label, c.hint ?? ''].map((s) => s.toLowerCase());
      if (hay.some((h) => h === q)) return 0;
      if (hay.some((h) => h.startsWith(q))) return 1;
      if (hay.some((h) => h.includes(q))) return 2;
      return Number.POSITIVE_INFINITY;
    };
    return commands.map((c) => [c, score(c)] as const).filter(([, s]) => Number.isFinite(s)).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }, [commands, query]);

  const clampedCursor = Math.max(0, Math.min(cursor, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [clampedCursor]);

  if (!open) return null;

  const groups: { key: Command['group']; title: string }[] = [
    { key: 'actions', title: t('commandPalette.groupActions') },
    { key: 'addNode', title: t('commandPalette.groupAddNode') },
    { key: 'templates', title: t('commandPalette.groupTemplates') },
  ];

  return (
    <div
      className="fixed inset-0 z-modal flex items-start justify-center bg-overlay pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette.groupActions')}
        className="flex max-h-[60vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-4xl border border-border bg-surface-3 shadow-modal"
      >
        <div className="flex flex-none items-center gap-2 border-b border-border-soft px-4 py-3">
          <Search size={15} className="text-text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[clampedCursor]) {
                e.preventDefault();
                if (!results[clampedCursor]!.disabled) results[clampedCursor]!.run();
              }
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            }}
            placeholder={t('commandPalette.placeholder')}
            className="w-full bg-transparent text-t13 text-text outline-none placeholder:text-text-faint"
          />
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto p-[6px]">
          {groups.map(({ key, title }) => {
            const items = results.filter((c) => c.group === key);
            if (!items.length) return null;
            return (
              <div key={key}>
                <div className="px-[10px] pb-1 pt-2 font-mono text-t9_5 font-semibold uppercase tracking-widest text-text-faint">
                  {title}
                </div>
                {items.map((c) => {
                  const index = results.indexOf(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-active={index === clampedCursor}
                      disabled={c.disabled}
                      onClick={() => { if (!c.disabled) c.run(); }}
                      onMouseEnter={() => setCursor(index)}
                      className={cn(
                        'flex w-full items-center gap-[9px] rounded-md px-[10px] py-2 text-left text-t12_5 font-semibold text-text-dim',
                        'hover:bg-surface-2 hover:text-text',
                        index === clampedCursor && 'bg-surface-2 text-text',
                        c.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-text-dim',
                      )}
                    >
                      {c.swatch && <span className="h-[9px] w-[9px] flex-none rounded-xs" style={{ background: c.swatch }} />}
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="flex-none truncate pl-2 font-mono text-t9_5 text-text-faint">{c.hint}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!results.length && (
            <div className="px-[10px] py-3 text-t11_5 text-text-faint">{t('commandPalette.noResults')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
