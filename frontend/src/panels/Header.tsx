'use client';

import { AlertTriangle, BookOpen, Check, Code2, FlaskConical, Github, LayoutTemplate, Pencil, Save, Settings, Square, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  /** 헤더 "Tutorial" → 노드 가이드 모달. */
  onOpenTutorial: () => void;
  /** 헤더 "Export Code" → 그래프를 단독 실행 가능한 crew.py 로 (Spec §8.5). */
  onOpenExport: () => void;
  /**
   * 헤더 "Publish" → 무엇이 공개되는지 보여 주고(M5-T3) 레지스트리 제출까지
   * 안내한다(M5-T8). 레지스트리가 설정되지 않은 배포에서도 남는다 — 1단계는
   * "이 그래프를 남에게 주면 뭐가 새는가"를 보는 로컬 안전장치라 그 자체로 값이 있다.
   */
  onOpenPublish: () => void;
  /**
   * 헤더 "Save" → 열어둔 템플릿을 현재 캔버스로 **바로 덮어쓴다**. 대상이 없으면
   * (백지 캔버스 등) 호출부가 이름을 묻는 모달을 연다 — 워드의 Ctrl+S 와 같다.
   */
  onSave: () => void;
  /**
   * 헤더 "Edit" → 열어둔 템플릿의 이름·설명을 고치는 모달(사본 만들기도 여기서).
   * 저장 대상이 있을 때만 보인다 — 없으면 고칠 템플릿 자체가 없다.
   */
  onOpenSave: () => void;
  /**
   * 지금 Save 가 덮어쓸 템플릿 이름. `null` 이면 아직 저장된 적 없는 캔버스라
   * Save 가 이름을 묻는다 — 버튼 툴팁이 그 차이를 미리 알려 준다.
   */
  saveTargetName: string | null;
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
    onRun, onDryRun, onStop, onOpenTemplates, onOpenTutorial, onOpenExport, onOpenPublish, onSave, onOpenSave,
    saveTargetName, onOpenSettings, onOpenKeys, onOpenBackup, savedLabel,
  } = props;
  const t = useT();
  const running = runStatus === 'running' || runStatus === 'queued';
  const [errorCursor, setErrorCursor] = useState(0);

  // 이름 칸은 **초안**으로 고친다 — 한 글자 칠 때마다 스토어(=자동 저장 문서)로
  // 새어 나가면 되돌릴 방법이 없어서, 확인 버튼(또는 Enter)을 눌러야 반영한다.
  // `null` = 편집 중 아님(스토어 값을 그대로 보여준다).
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameBoxRef = useRef<HTMLDivElement>(null);
  const editingName = nameDraft !== null;

  // 편집 중에 템플릿을 불러오는 등 밖에서 이름이 바뀌면 초안은 버린다.
  useEffect(() => { setNameDraft(null); }, [projectName]);

  function commitName() {
    const next = (nameDraft ?? '').trim();
    if (next && next !== projectName) onProjectNameChange(next);
    setNameDraft(null);
  }

  return (
    <header
      className="relative z-topbar flex h-topbar flex-none items-center gap-[14px] border-b border-border-soft bg-surface px-[14px]"
    >
      <div className="flex flex-none items-center gap-[9px] font-display text-t15 font-bold tracking-tight text-text">
        <BrandMark />
        AgentCanvas
      </div>

      <div
        ref={nameBoxRef}
        className="flex flex-none items-center gap-1"
        // 확인 버튼 밖으로 초점이 빠지면 초안을 버린다(= 취소). 버튼 자체는
        // `onMouseDown` 에서 초점 이동을 막으므로 여기로 오지 않는다.
        onBlur={(e) => {
          if (!editingName) return;
          if (nameBoxRef.current?.contains(e.relatedTarget as Node | null)) return;
          setNameDraft(null);
        }}
      >
        <input
          aria-label={t('header.projectName')}
          title={t('header.projectNameHint')}
          value={editingName ? nameDraft : projectName}
          spellCheck={false}
          onFocus={() => setNameDraft((d) => d ?? projectName)}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitName(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); setNameDraft(null); e.currentTarget.blur(); }
          }}
          className="min-w-[160px] max-w-[260px] rounded-lg border border-transparent bg-transparent px-2 py-[5px]
                     text-t13 font-medium text-text-dim outline-none
                     hover:bg-surface-3 focus:border-border focus:bg-surface-2 focus:text-text"
        />
        {editingName && (
          <button
            type="button"
            className="ac-tbtn !px-[6px]"
            disabled={!nameDraft.trim()}
            title={t('header.projectNameSave')}
            aria-label={t('header.projectNameSave')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitName}
          >
            <Check size={12} strokeWidth={2.4} />
          </button>
        )}
      </div>

      <div className="flex flex-1 items-center gap-2">
        <button type="button" className="ac-tbtn" onClick={onOpenTemplates}>
          <LayoutTemplate size={12} strokeWidth={2.2} />
          {t('header.templates')}
        </button>
        <button type="button" className="ac-tbtn" onClick={onOpenTutorial}>
          <BookOpen size={12} strokeWidth={2.2} />
          {t('header.tutorial')}
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
        <button
          type="button"
          className="ac-tbtn"
          onClick={onOpenPublish}
          title={t('header.publishTitle')}
        >
          <UploadCloud size={12} strokeWidth={2.2} />
          {t('header.publish')}
        </button>
        <button
          type="button"
          className="ac-tbtn"
          onClick={onSave}
          title={saveTargetName
            ? t('header.saveOverwriteTitle', { name: saveTargetName })
            : t('header.saveTemplateTitle')}
        >
          <Save size={12} strokeWidth={2.2} />
          {t('header.save')}
        </button>
        {saveTargetName && (
          <button
            type="button"
            className="ac-tbtn"
            onClick={onOpenSave}
            title={t('header.editTitle', { name: saveTargetName })}
          >
            <Pencil size={12} strokeWidth={2.2} />
            {t('header.edit')}
          </button>
        )}
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
          href="https://github.com/hynwl/agentcanvas"
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
