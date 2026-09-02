'use client';

import { AlertTriangle, CheckCircle2, PanelBottom } from 'lucide-react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n/react';

export interface StatusBarProps {
  backendOnline: boolean | null;
  ollama: { available: boolean; count: number } | null;
  /** Spec §13.2 "상태바 Ollama 인디케이터 클릭 → 즉시 재탐지". */
  onOllamaClick?: () => void;
}

/** 하단 상태바 (Spec §3.6). 아티팩트에 없는 화면 → §1.4 확장 규칙으로 기존 토큰만 사용. */
export function StatusBar({ backendOnline, ollama, onOllamaClick }: StatusBarProps) {
  const t = useT();
  const issues = useAppStore((s) => s.issues);
  const zoom = useAppStore((s) => s.viewport.zoom);
  const consoleOpen = useAppStore((s) => s.consoleOpen);
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errors;

  return (
    <div className="flex h-8 flex-none items-center gap-4 border-t border-border-soft bg-surface px-3 font-mono text-t10 text-text-faint">
      <Dot
        ok={backendOnline}
        label={backendOnline === null
          ? t('statusbar.backendChecking')
          : backendOnline ? t('statusbar.backendOnline') : t('statusbar.backendOffline')}
      />
      <button
        type="button"
        onClick={onOllamaClick}
        className="hover:text-text disabled:cursor-default"
        disabled={!onOllamaClick}
        aria-label={t('statusbar.ollamaRefresh')}
      >
        <Dot
          ok={ollama?.available ?? null}
          label={ollama === null
            ? t('statusbar.ollamaChecking')
            : ollama.available ? t('statusbar.ollamaModels', { count: ollama.count }) : t('statusbar.ollamaDown')}
        />
      </button>
      <span className="flex-1" />
      {errors > 0 ? (
        <span className="flex items-center gap-1 text-danger">
          <AlertTriangle size={11} /> {t('statusbar.errors', { count: errors })}
          {warns > 0 && t('statusbar.errorsWithWarnings', { count: warns })}
        </span>
      ) : warns > 0 ? (
        <span className="flex items-center gap-1 text-amber">
          <AlertTriangle size={11} /> {t('statusbar.warnings', { count: warns })}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-emerald">
          <CheckCircle2 size={11} /> {t('statusbar.ok')}
        </span>
      )}
      <button
        type="button"
        className={cn('flex items-center gap-1 hover:text-text', consoleOpen && 'text-text-dim')}
        onClick={() => setConsoleOpen(!consoleOpen)}
      >
        <PanelBottom size={11} /> {t('statusbar.logs')}
      </button>
      <span>{t('statusbar.zoom', { percent: Math.round(zoom * 100) })}</span>
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className="flex items-center gap-[6px]">
      <span
        className="h-[6px] w-[6px] rounded-full"
        style={{ background: ok === null ? 'var(--text-faint)' : ok ? 'var(--emerald)' : 'var(--danger)' }}
      />
      {label}
    </span>
  );
}
