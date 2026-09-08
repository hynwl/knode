'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from 'lucide-react';

import { Modal } from '@/panels/Modal';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';
import { slugify } from '@/persistence/fileIO';
import {
  maskForPublish,
  scanForPublish,
  type PublishFinding,
  type PublishRisk,
} from '@/persistence/publishScan';
import type { CanvasDoc } from '@/types/canvas';
import type { TFunction } from '@/i18n/react';

const RISK_ORDER: PublishRisk[] = ['block', 'warn', 'info'];

const RISK_ICON: Record<PublishRisk, typeof AlertOctagon> = {
  block: AlertOctagon,
  warn: AlertTriangle,
  info: Info,
};

const RISK_CLASS: Record<PublishRisk, string> = {
  block: 'border-danger/50 bg-danger/10 text-danger',
  warn: 'border-amber-400/50 bg-amber-400/10 text-amber-400',
  info: 'border-border-soft bg-surface-2 text-text-faint',
};

/**
 * "공개될 내용 미리보기" 모달 (M5-T3 · WORK_PLAN §5.6 P0 · 리스크 R8).
 *
 * `scanForPublish()` 가 찾은 값을 필드 단위로 보여주고, 위험도별로 마스킹
 * 여부를 사용자가 고른다. `block`(API 키)은 고를 여지 없이 항상 마스킹된다 —
 * §12 BYOK 원칙상 게시물에 키가 남는 건 사용자 판단의 영역이 아니다.
 *
 * 이 모달이 끝에 하는 일(마스킹된 문서를 `.acanvas.json` 로 내려받기)은 임시다.
 * 실제 게시 경로(허브 제출 · 계정)는 P1/P2(M5-T5~)에서 이 결과물을 이어받는다.
 */
export function PublishPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toDoc = useAppStore((s) => s.toDoc);
  const toast = useAppStore((s) => s.toast);
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 모달을 열 때 문서를 한 번 스냅샷 뜬다 — 열려 있는 동안 캔버스가 바뀌어도
  // 미리보기가 흔들리지 않게 하기 위해서다.
  useEffect(() => {
    if (!open) { setDoc(null); return; }
    const snapshot = toDoc();
    setDoc(snapshot);
    const scan = scanForPublish(snapshot);
    setSelected(new Set(scan.blocking.map((f) => f.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scan = useMemo(() => (doc ? scanForPublish(doc) : null), [doc]);

  function toggle(finding: PublishFinding) {
    if (finding.risk === 'block') return; // 강제 마스킹 — 선택지가 아니다.
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(finding.id)) next.delete(finding.id); else next.add(finding.id);
      return next;
    });
  }

  function confirm() {
    if (!doc || !scan) return;
    const masked = maskForPublish(doc, scan.findings, selected);
    downloadPublishBundle(masked);
    toast('success', t('publish.preview.downloaded'));
    onClose();
  }

  return (
    <Modal open={open} wide title={t('publish.preview.title')} onClose={onClose}
      footer={
        <>
          <button type="button" className="ac-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="ac-btn ac-btn-primary" onClick={confirm}>
            {t('publish.preview.confirm')}
          </button>
        </>
      }
    >
      <div className="ac-note">{t('publish.preview.intro')}</div>

      {scan && scan.findings.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald/40 bg-emerald/10 p-3 text-t11_5 text-emerald">
          <ShieldCheck size={16} className="flex-none" />
          {t('publish.preview.clean')}
        </div>
      )}

      {scan && RISK_ORDER.map((risk) => {
        const items = scan.findings.filter((f) => f.risk === risk);
        if (!items.length) return null;
        const Icon = RISK_ICON[risk];
        return (
          <div key={risk} className="flex flex-col gap-2">
            {items.map((f) => (
              <div key={f.id} className={`flex items-start gap-2 rounded-xl border p-3 text-t11_5 leading-normal ${RISK_CLASS[risk]}`}>
                <Icon size={15} className="mt-[1px] flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <b>{t(`publish.rule.${f.rule}.label`)}</b>
                    <span className="font-mono text-t9_5 uppercase tracking-wide opacity-80">
                      {t(`publish.risk.${f.risk}`)}
                    </span>
                    <span className="text-text-faint">{locationOf(f, t)}</span>
                  </div>
                  <div className="mt-1 text-text-dim">{t(`publish.rule.${f.rule}.desc`, f.params)}</div>
                  <div className="mt-1 truncate font-mono text-t10_5 text-text-faint" title={f.preview}>{f.preview}</div>
                </div>
                <label className="flex flex-none items-center gap-[6px] font-semibold">
                  {f.risk === 'block' ? (
                    <span className="text-t9_5 opacity-80">{t('publish.preview.forced')}</span>
                  ) : (
                    <>
                      <input
                        type="checkbox"
                        checked={selected.has(f.id)}
                        onChange={() => toggle(f)}
                      />
                      {t('publish.preview.mask')}
                    </>
                  )}
                </label>
              </div>
            ))}
          </div>
        );
      })}
    </Modal>
  );
}

function locationOf(f: PublishFinding, t: TFunction): string {
  if (f.nodeType) return t('publish.preview.locationNode', { nodeType: f.nodeType, field: f.field ?? f.path });
  const field = f.path.replace(/^\$\.?/, '');
  return t('publish.preview.locationDoc', { field });
}

/** T4(썸네일)가 붙기 전까지의 임시 산출 경로 — 파일명만 "게시 번들" 임을 드러낸다. */
function downloadPublishBundle(doc: CanvasDoc): void {
  const json = JSON.stringify(doc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(doc.name)}.acanvas.json`;
  a.click();
  URL.revokeObjectURL(url);
}
