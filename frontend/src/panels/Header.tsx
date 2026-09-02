'use client';

import { AlertTriangle, Code2, FlaskConical, Github, LayoutTemplate, Settings, Square } from 'lucide-react';
import { useState } from 'react';
import { LocaleSwitcher, useT } from '@/i18n/react';

export interface HeaderProps {
  projectName: string;
  onProjectNameChange: (v: string) => void;
  runStatus: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  /** 현재/직전 실행이 Dry Run(Spec §11.3)인지 — 진행바에 배지를 다는 데만 쓴다. */
  dryRun?: boolean;
  progress?: { done: number; total: number; elapsedS: number; costUsd: number };
  canRun: boolean;
  /**
   * 검증 실패 노드 id 목록 (중복 제거됨). Spec §3.5-13 "실행 버튼은 disabled" 는
   * `canRun` 이 지키고, 이 목록은 "그럼 어디가 문제인지" 를 클릭 한 번으로 보여주는
   * 통로다 — 비활성 버튼 자체는 클릭도 호버 상세도 만들기 까다롭기 때문.
   */
  errorNodeIds: string[];
  onFocusNode: (nodeId: string) => void;
  onRun: () => void;
  /** Dry Run(Spec §11.3) — LLM 호출 없이 실행 순서 + 예상 비용만 리허설한다. */
  onDryRun: () => void;
  onStop: () => void;
  /**
   * 취소를 이미 요청한 상태. CrewAI 는 진행 중인 LLM 호출을 끊을 수 없어
   * 취소가 **태스크 경계**에서만 걸린다 — 버튼이 반응 없는 것처럼 보이면
   * 사용자가 Stop 을 연타하게 되므로(실제로 그랬다) 대기 중임을 표시한다.
   */
  stopPending?: boolean;
  /** 헤더 "Templates" → 갤러리 모달 (Spec §15.2). */
  onOpenTemplates: () => void;
  /** 헤더 "Export Code" → 그래프를 단독 실행 가능한 crew.py 로 (Spec §8.5). */
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onOpenKeys: () => void;
  onOpenBackup: () => void;
  /** 이미 로케일이 적용된 문구 (page.tsx 가 `header.saved*` 로 만든다). */
  savedLabel: string;
}

/** 아티팩트 `.topbar` 를 그대로 이식한 헤더. 높이 52px 고정. */
export function Header(props: HeaderProps) {
  const {
    projectName, onProjectNameChange, runStatus, dryRun, progress, canRun, errorNodeIds, onFocusNode, stopPending,
    onRun, onDryRun, onStop, onOpenTemplates, onOpenExport, onOpenSettings, onOpenKeys, onOpenBackup, savedLabel,
  } = props;
  const t = useT();
  const running = runStatus === 'running' || runStatus === 'queued';
  const [errorCursor, setErrorCursor] = useState(0);

  return (
    <header
      className="relative z-topbar flex h-topbar flex-none items-center gap-[14px] border-b border-border-soft bg-surface px-[14px]"
    >
      <div className="flex flex-none items-center gap-[9px] font-display text-t15 font-bold tracking-tight text-text">
        <BrandMark />
        AgentCanvas
      </div>

      <input
        aria-label={t('header.projectName')}
        value={projectName}
        spellCheck={false}
        onChange={(e) => onProjectNameChange(e.target.value)}
        className="min-w-[160px] max-w-[260px] rounded-lg border border-transparent bg-transparent px-2 py-[5px]
                   text-t13 font-medium text-text-dim outline-none
                   hover:bg-surface-3 focus:border-border focus:bg-surface-2 focus:text-text"
      />

      <div className="flex flex-1 items-center gap-2">
        <button type="button" className="ac-tbtn" onClick={onOpenTemplates}>
          <LayoutTemplate size={12} strokeWidth={2.2} />
          {t('header.templates')}
        </button>
        <button type="button" className="ac-tbtn" onClick={onOpenBackup}>
          {t('header.backup')}
        </button>
        <button
          type="button"
          className="ac-tbtn"
          onClick={onOpenExport}
          title={t('header.exportCodeTitle')}
        >
          <Code2 size={12} strokeWidth={2.2} />
          {t('header.exportCode')}
        </button>
        <span className="ml-1 select-none font-mono text-t10_5 text-text-faint">{savedLabel}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {progress && running && (
          <span className="ac-chip" aria-live="polite">
            {dryRun && <span className="mr-1 text-amber-400">{t('header.dryRunBadge')}</span>}
            {t('header.progress', {
              done: progress.done,
              total: progress.total,
              elapsed: formatElapsed(progress.elapsedS),
              cost: progress.costUsd.toFixed(3),
            })}
          </span>
        )}
        {!running && errorNodeIds.length > 0 && (
          <button
            type="button"
            className="ac-chip flex items-center gap-1 !border-danger/50 !text-danger"
            onClick={() => {
              const id = errorNodeIds[errorCursor % errorNodeIds.length]!;
              onFocusNode(id);
              setErrorCursor((c) => c + 1);
            }}
            title={t('header.errorsTitle')}
          >
            <AlertTriangle size={11} strokeWidth={2.4} />
            {t('header.errors', { count: errorNodeIds.length })}
          </button>
        )}
        <LocaleSwitcher />
        <button type="button" className="ac-tbtn" onClick={onOpenKeys}>
          {t('header.apiKeys')}
        </button>
        <button type="button" className="ac-tbtn" onClick={onOpenSettings} aria-label={t('header.settings')}>
          <Settings size={13} strokeWidth={2.2} />
        </button>
        <a
          className="ac-tbtn"
          href="https://github.com/agentcanvas/agentcanvas"
          target="_blank"
          rel="noreferrer noopener"
          aria-label={t('header.github')}
        >
          <Github size={13} strokeWidth={2.2} />
        </a>
        {running ? (
          <button
            type="button"
            className="ac-tbtn !text-danger"
            onClick={onStop}
            disabled={stopPending}
            title={stopPending ? t('header.stopTitle') : undefined}
          >
            <Square size={11} strokeWidth={3} fill="currentColor" />
            {stopPending ? t('header.stopping') : t('header.stop')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ac-tbtn"
              onClick={onDryRun}
              disabled={!canRun}
              title={t('header.dryRunTitle')}
            >
              <FlaskConical size={12} strokeWidth={2.2} />
              {t('header.dryRun')}
            </button>
            <button type="button" className="ac-run-btn" onClick={onRun} disabled={!canRun}>
              {t('header.queuePrompt')}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

/** 아티팩트 `.brand-mark` — 대각 2분할 그라디언트 + 점 2개. */
function BrandMark() {
  return (
    <span className="relative block h-[22px] w-[22px] flex-none rounded-md bg-brand-mark">
      <span
        className="absolute inset-0 rounded-md"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, var(--amber) 0 3px, transparent 3.5px),' +
            'radial-gradient(circle at 75% 70%, var(--rose) 0 3px, transparent 3.5px)',
        }}
      />
    </span>
  );
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
