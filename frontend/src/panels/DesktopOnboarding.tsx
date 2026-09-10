'use client';

import { Copy, FolderOpen, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Modal } from './Modal';
import { useT } from '@/i18n/react';
import { revealWorkspaceFolder } from '@/lib/desktopOnboarding';

export interface DesktopOnboardingProps {
  open: boolean;
  workspaceDir: string;
  ollama: { available: boolean; count: number } | null;
  onClose: () => void;
  onBrowseTemplates: () => void;
}

/**
 * 데스크톱 앱 첫 실행 안내(M6-T7). `Welcome`(오프닝 랜딩 화면)과는 목적이 다르다 —
 * `Welcome`은 세션(탭) 범위로 매번 뜨는 마케팅 화면이고, 이건 **설치당 정확히
 * 한 번**만 떠야 하는 실무 정보(데이터 위치 · 무료 로컬 실행 경로)라 별도
 * 마커(`desktop/onboarding/firstRun.ts`)로 판정한다. 그래서 새 풀스크린을 만드는
 * 대신 기존 `Modal` 셸을 재사용해 다른 설정 창들과 같은 무게감으로 둔다.
 */
export function DesktopOnboarding({ open, workspaceDir, ollama, onClose, onBrowseTemplates }: DesktopOnboardingProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      open={open}
      title={t('desktop.onboardTitle')}
      onClose={onClose}
      footer={<button type="button" className="ac-btn ac-btn-primary" onClick={onClose}>{t('desktop.onboardDone')}</button>}
    >
      <div className="ac-note flex gap-2">
        <ShieldCheck size={16} className="mt-[2px] flex-none text-emerald" />
        <div className="flex flex-1 flex-col gap-2">
          <div>
            <b className="text-text-dim">{t('desktop.onboardDataTitle')}</b>
            <br />
            {t('desktop.onboardDataBody')}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(workspaceDir);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch { /* 클립보드 접근이 막힌 환경 — 조용히 무시 */ }
              }}
              className="flex flex-1 items-center justify-between gap-2 truncate rounded-md border border-border-soft bg-surface-2 px-2 py-1 font-mono text-t11 text-text hover:bg-surface-3"
            >
              <span className="truncate">{workspaceDir}</span>
              <Copy size={11} className={copied ? 'flex-none text-emerald' : 'flex-none text-text-faint'} />
            </button>
            <button
              type="button"
              onClick={() => void revealWorkspaceFolder()}
              className="ac-btn flex-none !px-2 !py-1"
              aria-label={t('desktop.onboardOpenFolder')}
              title={t('desktop.onboardOpenFolder')}
            >
              <FolderOpen size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="ac-note flex gap-2">
        <Sparkles size={16} className="mt-[2px] flex-none text-run-a" />
        <div className="flex flex-1 flex-col gap-2">
          <div>
            <b className="text-text-dim">{t('desktop.onboardOllamaTitle')}</b>
            <br />
            {ollama?.available
              ? t('desktop.onboardOllamaAvailable', { count: ollama.count })
              : t('desktop.onboardOllamaMissing')}
          </div>
          {!ollama?.available && (
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="w-fit text-t11_5 font-semibold underline underline-offset-2 hover:opacity-80"
            >
              {t('inspector.ollamaInstall')}
            </a>
          )}
          <button type="button" onClick={onBrowseTemplates} className="ac-btn w-fit">
            {t('desktop.onboardBrowseTemplates')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
