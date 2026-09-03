'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Loader2, SkipForward, X, XCircle,
} from 'lucide-react';
import { colorExtra, nodeAccent, size } from '@design/tokens';
import { cn } from '@/lib/cn';
import { Socket, socketOffsets } from '@/ports/Socket';
import { useAppStore, useConnectedPorts, useNodeFocusToken, useNodeIssues, useNodeState } from '@/store';
import type { AcNode, NodeStatus } from '@/types/canvas';
import { useT } from '@/i18n/react';
import { issueText } from '@/validation/issues';
import { getNodeDef, nodeLabel } from './registry';

/** `.ac-focus-flash` 애니메이션(globals.css) 지속 시간과 맞춘다. */
const FOCUS_FLASH_MS = 1300;

/**
 * 상태를 색으로만 전달하지 않기 위한 아이콘 배지 (Spec §3.3 / §17.2 MUST).
 * `idle` 은 배지 없음.
 */
const STATUS_BADGE: Partial<Record<NodeStatus, { Icon: typeof Loader2; className: string; spin?: boolean }>> = {
  queued: { Icon: Clock, className: 'text-text-dim' },
  running: { Icon: Loader2, className: 'text-indigo', spin: true },
  succeeded: { Icon: CheckCircle2, className: 'text-emerald ac-status-badge-succeeded' },
  failed: { Icon: XCircle, className: 'text-danger' },
  skipped: { Icon: SkipForward, className: 'text-text-faint' },
  cancelled: { Icon: Ban, className: 'text-amber' },
};

/**
 * 접힌 노드는 헤더만 남으므로 소켓을 세로로 펼칠 자리가 없다 — 헤더 중앙에
 * 겹쳐 쌓아 ComfyUI 처럼 좌우 점 하나로 보이게 한다.
 *
 * ⚠️ 접었다고 소켓을 언마운트하면 안 된다. React Flow 의 엣지 렌더러가 핸들을
 * id 로 찾지 못해 `Couldn't create edge for source/target handle id` 경고를
 * 연결된 엣지 수만큼, 스토어가 갱신될 때마다 반복해서 뱉는다.
 */
function collapsedOffsets(collapsed: boolean, count: number): number[] {
  if (!collapsed) return socketOffsets(count);
  return Array.from({ length: count }, () => size.nodeHeaderHeight / 2);
}

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
  // `useT()` 는 컨텍스트가 아니라 외부 스토어 구독이라 이 memo 경계를 넘어 온다 —
  // 언어를 바꾸면 캔버스에 떠 있는 노드들도 부모 리렌더 없이 스스로 다시 그린다.
  const t = useT();
  const def = getNodeDef(node.type);
  const accent = nodeAccent[def.accent];
  const runState = useNodeState(node.id);
  const issues = useNodeIssues(node.id);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const toggleCollapse = useAppStore((s) => s.toggleCollapse);
  const connectedPorts = useConnectedPorts(node.id);

  // 에러 → 노드 카메라 포커스 (Spec §17.4 MUST #2) — Canvas 가 카메라를 옮기는 동안
  // 이 노드는 잠깐 링을 두 번 펄스시켜 "여기" 를 알려준다.
  const focusToken = useNodeFocusToken(node.id);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (focusToken == null) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), FOCUS_FLASH_MS);
    return () => clearTimeout(t);
  }, [focusToken]);

  const collapsed = node.ui.collapsed;
  const inputOffsets = collapsedOffsets(collapsed, def.inputs.length);
  const outputOffsets = collapsedOffsets(collapsed, def.outputs.length);
  const socketRows = Math.max(def.inputs.length, def.outputs.length);
  const bodyPadTop = socketRows > 0 ? 48 + socketRows * 26 - 18 : 26;

  const status = runState?.status ?? 'idle';
  const errorIssues = useMemo(() => issues.filter((i) => i.severity === 'error'), [issues]);
  const hasError = errorIssues.length > 0;
  const badge = STATUS_BADGE[status];
  // Spec §3.5-13 "빨간 뱃지 + 마우스오버 시 사유" — 코드+메시지+힌트를 한 줄씩.
  const errorTooltip = useMemo(
    () => errorIssues.map((i) => {
      const { message, hint } = issueText(i);
      return `[${i.code}] ${message}${hint ? ` — ${hint}` : ''}`;
    }).join('\n'),
    [errorIssues, t],
  );

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
        flashing && 'ac-focus-flash',
      )}
      style={{ width: node.width ?? size.nodeWidth }}
      data-node-id={node.id}
      data-node-type={node.type}
      data-run-status={status}
    >
      {/* ---- 실행 상태 배지: 색만으로 상태를 전달하지 않기 위한 아이콘 (Spec §17.2 MUST) ---- */}
      {badge && (
        <span
          key={status}
          className={cn(
            'absolute -right-[6px] -top-[6px] z-10 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-surface shadow-node',
            badge.className,
          )}
          role="status"
          aria-label={t('nodeBody.status', { status })}
          title={status}
        >
          <badge.Icon size={11} className={badge.spin ? 'animate-spin' : undefined} />
        </span>
      )}

      {/* ---- 헤더 (아티팩트 .node-header) ---- */}
      <div
        className="ac-drag-handle flex h-node-header cursor-grab items-center gap-[6px] rounded-t-xl px-[10px]
                   font-display text-t12 font-semibold tracking-tightest text-header-text active:cursor-grabbing"
        style={{ background: `linear-gradient(90deg, ${accent.base}, ${accent.deep})` }}
      >
        <button
          type="button"
          className="flex-none opacity-80 hover:opacity-100"
          aria-label={node.ui.collapsed ? t('nodeBody.expand') : t('nodeBody.collapse')}
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
          {String(node.data.name ?? node.data.title ?? node.data.label ?? nodeLabel(def))}
        </span>
        {hasError && (
          <span title={errorTooltip} className="flex-none">
            <AlertTriangle size={13} className="text-white" aria-label={t('nodeBody.error', { detail: errorTooltip })} />
          </span>
        )}
        <span className="flex-none text-t10 font-semibold uppercase tracking-wider opacity-75">
          {nodeLabel(def)}
        </span>
        <button
          type="button"
          // `opacity-0` + 호버로만 나타나는 버튼이라, 키보드로 Tab 하면 **보이지 않는
          // 컨트롤에 포커스가 들어간다**(M4-T9 실측). `focus-visible` 로 같이 띄운다. (Spec §17.2)
          className="flex h-4 w-4 flex-none items-center justify-center rounded-sm opacity-0
                     hover:!opacity-100 hover:bg-black/20 group-hover:opacity-75
                     focus-visible:!opacity-100 [.react-flow__node:hover_&]:opacity-75"
          aria-label={t('nodeBody.delete')}
          onClick={(e) => { e.stopPropagation(); removeNodes([node.id]); }}
        >
          <X size={12} />
        </button>
      </div>

      {/* ---- 소켓 (접어도 남는다 — Spec §3.5-6 "본문 접힘, 소켓만 남음") ---- */}
      {def.inputs.map((p, i) => (
        <Socket key={p.id} port={p} top={inputOffsets[i]!} connected={connectedPorts.has(p.id)} compact={collapsed} />
      ))}
      {def.outputs.map((p, i) => (
        <Socket key={p.id} port={p} top={outputOffsets[i]!} connected={connectedPorts.has(p.id)} compact={collapsed} />
      ))}

      {/* ---- 본문 ---- */}
      {!collapsed && (
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
