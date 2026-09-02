'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useAppStore, type LogKind } from '@/store';
import { useT } from '@/i18n/react';

const KIND_CLASS: Record<LogKind, string> = {
  sys: 'text-text-dim',
  agent: 'text-log-agent',
  tool: 'text-log-tool',
  think: 'italic text-text-faint',
  ok: 'text-log-ok',
  warn: 'text-log-warn',
  err: 'text-log-err',
  final: 'font-semibold text-log-final',
};

/**
 * 하단 실행 로그 콘솔 — 아티팩트 `.console` 이식 (height 230, transition .18s).
 * 성능 규칙: `logs` 배열 전체를 구독하는 컴포넌트는 이것 하나뿐이어야 한다. (Spec §16.2)
 */
export function LogPanel() {
  const t = useT();
  const open = useAppStore((s) => s.consoleOpen);
  const logs = useAppStore((s) => s.logs);
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen);
  const clearLogs = useAppStore((s) => s.clearLogs);
  const runStatus = useAppStore((s) => s.runStatus);
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [logs.length, autoScroll]);

  return (
    <div
      className={cn(
        'flex flex-none flex-col overflow-hidden border-t border-border-soft bg-surface-2',
        'transition-[height] duration-[180ms] ease-out',
      )}
      style={{ height: open ? 230 : 0 }}
      aria-hidden={!open}
    >
      <div className="flex h-[34px] flex-none items-center gap-[10px] border-b border-border-soft px-[14px]">
        <span
          className="h-[7px] w-[7px] rounded-full shadow-consoleDot"
          style={{ background: runStatus === 'failed' ? 'var(--danger)' : 'var(--emerald)' }}
        />
        <span className="font-mono text-t11_5 font-semibold tracking-normal text-text-dim">
          {t('log.title')}
        </span>
        <span className="flex-1" />
        <label className="flex select-none items-center gap-1 font-mono text-t10 text-text-faint">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3 accent-indigo"
          />
          {t('log.autoScroll')}
        </label>
        <button type="button" className="rounded-md border border-border px-[9px] py-1 text-t11 font-semibold text-text-faint hover:border-border-light hover:text-text" onClick={clearLogs}>
          {t('log.clear')}
        </button>
        <button type="button" className="rounded-md border border-border px-[9px] py-1 text-t11 font-semibold text-text-faint hover:border-border-light hover:text-text" onClick={() => setConsoleOpen(false)}>
          {t('log.hide')}
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto px-[14px] pb-[14px] pt-[10px] font-mono text-t12 leading-loose">
        {logs.map((l) => (
          <div key={l.id} className={cn('animate-fadein whitespace-pre-wrap break-words', KIND_CLASS[l.kind])}>
            <span className="mr-2 text-text-faint">[{formatTime(l.ts)}]</span>
            {l.nodeId && (
              <button
                type="button"
                onClick={() => useAppStore.getState().requestFocusNode(l.nodeId!)}
                title={t('log.gotoNode')}
                className="mr-2 rounded-sm bg-surface-3 px-1 py-[1px] font-mono text-t10 text-text-faint hover:text-text hover:underline"
              >
                {l.nodeId}
              </button>
            )}
            {l.text}
          </div>
        ))}
        {!logs.length && (
          <div className="text-text-faint">{t('log.empty')}</div>
        )}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
