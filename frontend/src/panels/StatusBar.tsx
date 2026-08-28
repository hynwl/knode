'use client';

import { AlertTriangle, CheckCircle2, PanelBottom } from 'lucide-react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/cn';

export interface StatusBarProps {
  backendOnline: boolean | null;
  ollama: { available: boolean; count: number } | null;
}

/** 하단 상태바 (Spec §3.6). 아티팩트에 없는 화면 → §1.4 확장 규칙으로 기존 토큰만 사용. */
export function StatusBar({ backendOnline, ollama }: StatusBarProps) {
  const issues = useAppStore((s) => s.issues);
  const zoom = useAppStore((s) => s.viewport.zoom);
  const consoleOpen = useAppStore((s) => s.consoleOpen);
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errors;

  return (
    <div className="flex h-8 flex-none items-center gap-4 border-t border-border-soft bg-surface px-3 font-mono text-t10 text-text-faint">
      <Dot ok={backendOnline} label={backendOnline === null ? '백엔드 확인 중' : backendOnline ? 'Backend Connected' : 'Backend Offline · 편집은 계속 가능'} />
      <Dot
        ok={ollama?.available ?? null}
        label={ollama === null ? 'Ollama 확인 중' : ollama.available ? `Ollama: ${ollama.count} models` : 'Ollama: 미실행'}
      />
      <span className="flex-1" />
      {errors > 0 ? (
        <span className="flex items-center gap-1 text-danger">
          <AlertTriangle size={11} /> 오류 {errors}{warns > 0 && ` · 경고 ${warns}`}
        </span>
      ) : warns > 0 ? (
        <span className="flex items-center gap-1 text-amber">
          <AlertTriangle size={11} /> 경고 {warns}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-emerald">
          <CheckCircle2 size={11} /> 검증 통과
        </span>
      )}
      <button
        type="button"
        className={cn('flex items-center gap-1 hover:text-text', consoleOpen && 'text-text-dim')}
        onClick={() => setConsoleOpen(!consoleOpen)}
      >
        <PanelBottom size={11} /> 로그
      </button>
      <span>Zoom {Math.round(zoom * 100)}%</span>
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
