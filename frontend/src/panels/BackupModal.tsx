'use client';

import { Check, Copy, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useAppStore } from '@/store';
import { downloadDoc, exportDoc, importDoc } from '@/persistence/fileIO';
import { AcanvasError } from '@/persistence/migrations';
import type { SecretHit } from '@/persistence/secretScanner';
import { buildShareLink } from '@/persistence/shareLink';

/** Backup / Restore (Spec §14.3). Export 는 시크릿 스캐너를 반드시 통과해야 한다. */
export function BackupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      title="프로젝트 백업 / 복원"
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
                toast('success', '파일로 내보냈습니다.');
              } catch {
                toast('error', 'API 키가 포함되어 내보내기가 차단되었습니다.', true);
              }
            }}
          >
            파일로 내보내기
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
                    toast('info', `그래프가 커서(${(outcome.encodedBytes / 1024).toFixed(1)}KB) 링크 대신 파일로 내보냈습니다.`);
                    return;
                  }
                  setShareUrl(outcome.url);
                })
                .catch(() => toast('error', 'API 키가 포함되어 공유 링크를 만들 수 없습니다.', true));
            }}
          >
            <Link2 size={11} strokeWidth={2.4} />
            공유 링크 생성
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
                    ? `복원했습니다. 단, API 키로 보이는 값 ${redactions.length}건을 마스킹했습니다.`
                    : '프로젝트를 복원했습니다.',
                  redactions.length > 0,
                );
              } catch (err) {
                const code = err instanceof AcanvasError ? err.code : 'AC-E403';
                toast('error', `복원 실패 (${code})`, true);
              }
            }}
          >
            붙여넣은 JSON 불러오기
          </button>
        </>
      }
    >
      <div className="ac-note">
        DB도 계정도 없습니다. 이 캔버스는 브라우저에 자동 저장됩니다. 아래 JSON 을 복사해 백업하거나,
        내보낸 JSON 을 붙여 넣어 다른 기기에서 복원하세요.
      </div>

      {blocked && (
        <div className="rounded-xl border border-danger/50 bg-danger/10 p-3 text-t11_5 leading-normal text-danger">
          <b className="font-mono text-t10">AC-E404</b> 그래프에 API 키로 보이는 값이 있어 내보내기를 차단했습니다.
          <ul className="mt-2 list-disc pl-4 font-mono text-t10">
            {blocked.map((h, i) => <li key={i}>{h.path} — {h.pattern} ({h.preview})</li>)}
          </ul>
          해당 필드에서 키를 지우고 다시 시도하세요.
        </div>
      )}

      {shareUrl && (
        <div>
          <label className="ac-label">공유 링크 — 받는 사람은 서버 없이 드래그&드롭 없이도 이 링크만으로 그대로 열립니다</label>
          <div className="flex items-center gap-[6px]">
            <input readOnly className="ac-input flex-1 font-mono text-t11_5" value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="ac-btn !px-2 !py-[6px] !text-t10_5 flex items-center gap-1"
              onClick={() => navigator.clipboard.writeText(shareUrl).then(() => setCopied(true)).catch(() => setCopied(false))}
            >
              {copied ? <Check size={11} strokeWidth={2.6} className="text-emerald" /> : <Copy size={11} strokeWidth={2.4} />}
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="ac-label">현재 프로젝트 (JSON)</label>
        <textarea readOnly className="ac-input min-h-[140px] font-mono text-t11_5" value={currentJson} />
      </div>
      <div>
        <label className="ac-label">복원할 JSON 붙여넣기</label>
        <textarea
          className="ac-input min-h-[140px] font-mono text-t11_5"
          placeholder="내보낸 .acanvas.json 내용을 붙여 넣으세요…"
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
