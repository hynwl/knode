'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { useAppStore, type LogKind } from '@/store';
import { useT } from '@/i18n/react';
import { readJson, writeJson } from '@/persistence/localStorage';

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
 * 로그 줄의 종류를 **색으로만** 전달하지 않기 위한 텍스트 마커 (Spec §17.2 MUST).
 * 콘솔은 고정폭 폰트라 2글자 마커가 열을 이뤄 정렬된다 — 색약 사용자는 물론
 * 흑백 캡처/터미널 복붙에서도 종류가 그대로 남는다.
 * 종류 이름 자체는 로케일과 무관한 로그 문법이므로 i18n 대상이 아니다
 * (`log.kind.*` 로 읽어주는 `aria-label` 만 번역한다).
 */
const KIND_MARK: Record<LogKind, string> = {
  sys: '··',
  agent: '@ ',
  tool: '⚙ ',
  think: '~ ',
  ok: '✓ ',
  warn: '! ',
  err: '✕ ',
  final: '★ ',
};

const DEFAULT_HEIGHT = 230;
const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.7; // 뷰포트의 70% 이상은 캔버스를 다 가려버린다.
const HEIGHT_STORAGE_KEY = 'knode.logPanel.height.v1';

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
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const saved = readJson<number>(HEIGHT_STORAGE_KEY, DEFAULT_HEIGHT);
    if (Number.isFinite(saved) && saved >= MIN_HEIGHT) setHeight(saved);
  }, []);

  useEffect(() => {
    if (!autoScroll || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [logs.length, autoScroll]);

  // 위쪽 가장자리를 드래그해 콘솔 높이를 조절한다(y축 리사이즈). 값은 localStorage 에
  // 남겨 새로고침해도 유지된다 — 실행할 때마다 다시 늘릴 이유가 없다.
  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const next = startHeight + (startY - ev.clientY);
      setHeight(Math.min(maxHeight, Math.max(MIN_HEIGHT, next)));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setHeight((h) => {
        writeJson(HEIGHT_STORAGE_KEY, h);
        return h;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={cn(
        'relative flex flex-none flex-col overflow-hidden border-t border-border-soft bg-surface-2',
        !resizing && 'transition-[height] duration-[180ms] ease-out',
      )}
      style={{ height: open ? height : 0 }}
      aria-hidden={!open}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('log.resize')}
          onPointerDown={onHandlePointerDown}
          className="absolute -top-[3px] left-0 right-0 z-10 h-[6px] cursor-ns-resize touch-none"
        />
      )}
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
            {/* 색만으로 종류를 구분하지 않는다 (Spec §17.2 MUST) */}
            <span className="mr-1 select-none" aria-label={t(`log.kind.${l.kind}`)}>{KIND_MARK[l.kind]}</span>
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
