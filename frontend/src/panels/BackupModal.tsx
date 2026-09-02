'use client';

import { Check, Copy, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useAppStore } from '@/store';
import { downloadDoc, exportDoc, importDoc } from '@/persistence/fileIO';
import { AcanvasError } from '@/persistence/migrations';
import type { SecretHit } from '@/persistence/secretScanner';
import { buildShareLink } from '@/persistence/shareLink';
import { useT } from '@/i18n/react';

/** Backup / Restore (Spec §14.3). Export 는 시크릿 스캐너를 반드시 통과해야 한다. */
export function BackupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toDoc = useAppStore((s) => s.toDoc);
  const replaceDoc = useAppStore((s) => s.replaceDoc);
  const toast = useAppStore((s) => s.toast);
  const [raw, setRaw] = useState('');
  const [blocked, setBlocked] = useState<SecretHit[] | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) { setShareUrl(''); setCopied(false); }
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const currentJson = (() => {
    try {
      setTimeoutSafe(() => setBlocked(null));
      return exportDoc(toDoc()).json;
    } catch (err) {
      if (err instanceof AcanvasError && err.code === 'AC-E404') {
        const hits = (err as AcanvasError & { hits?: SecretHit[] }).hits ?? [];
        setTimeoutSafe(() => setBlocked(hits));
        return '';
      }
      return '';
    }
  })();

  return (
    <Modal
      open={open}
      wide
      title={t('backup.title')}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="ac-btn"
            disabled={Boolean(blocked)}
            onClick={() => {
              try {
                downloadDoc(toDoc());
                toast('success', t('backup.exported'));
              } catch {
                toast('error', t('backup.exportBlocked'), true);
              }
            }}
          >
            {t('backup.exportFile')}
          </button>
          <button
            type="button"
            className="ac-btn flex items-center gap-1"
            disabled={Boolean(blocked)}
            onClick={() => {
              buildShareLink(toDoc())
                .then((outcome) => {
                  if (outcome.kind === 'too-large') {
                    setShareUrl('');
                    downloadDoc(toDoc());
                    toast('info', t('backup.shareTooLarge', { kb: (outcome.encodedBytes / 1024).toFixed(1) }));
                    return;
                  }
                  setShareUrl(outcome.url);
                })
                .catch(() => toast('error', t('backup.shareBlocked'), true));
            }}
          >
            <Link2 size={11} strokeWidth={2.4} />
            {t('backup.shareLink')}
          </button>
          <button
            type="button"
            className="ac-btn ac-btn-primary"
            onClick={() => {
              if (!raw.trim()) return;
              try {
                const { doc, redactions } = importDoc(raw);
                replaceDoc(doc);
                onClose();
                toast(
                  redactions.length ? 'error' : 'success',
                  redactions.length
                    ? t('backup.restoredRedacted', { count: redactions.length })
                    : t('backup.restored'),
                  redactions.length > 0,
                );
              } catch (err) {
                const code = err instanceof AcanvasError ? err.code : 'AC-E403';
                toast('error', t('backup.restoreFailed', { code }), true);
              }
            }}
          >
            {t('backup.importJson')}
          </button>
        </>
      }
    >
      <div className="ac-note">{t('backup.intro')}</div>

      {blocked && (
        <div className="rounded-xl border border-danger/50 bg-danger/10 p-3 text-t11_5 leading-normal text-danger">
          <b className="font-mono text-t10">AC-E404</b> {t('backup.blockedBody')}
          <ul className="mt-2 list-disc pl-4 font-mono text-t10">
            {blocked.map((h, i) => <li key={i}>{h.path} — {h.pattern} ({h.preview})</li>)}
          </ul>
          {t('backup.blockedAction')}
        </div>
      )}

      {shareUrl && (
        <div>
          <label className="ac-label">{t('backup.shareLabel')}</label>
          <div className="flex items-center gap-[6px]">
            <input readOnly className="ac-input flex-1 font-mono text-t11_5" value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="ac-btn !px-2 !py-[6px] !text-t10_5 flex items-center gap-1"
              onClick={() => navigator.clipboard.writeText(shareUrl).then(() => setCopied(true)).catch(() => setCopied(false))}
            >
              {copied ? <Check size={11} strokeWidth={2.6} className="text-emerald" /> : <Copy size={11} strokeWidth={2.4} />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="ac-label">{t('backup.currentLabel')}</label>
        <textarea readOnly className="ac-input min-h-[140px] font-mono text-t11_5" value={currentJson} />
      </div>
      <div>
        <label className="ac-label">{t('backup.restoreLabel')}</label>
        <textarea
          className="ac-input min-h-[140px] font-mono text-t11_5"
          placeholder={t('backup.restorePlaceholder')}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/** 렌더 중 setState 를 피하기 위한 지연 실행 */
function setTimeoutSafe(fn: () => void) {
  if (typeof window !== 'undefined') window.setTimeout(fn, 0);
}
