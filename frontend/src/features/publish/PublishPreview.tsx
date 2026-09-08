'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, AlertTriangle, Check, Copy, Download, ExternalLink, Info, ShieldCheck } from 'lucide-react';
import type { ReactFlowInstance } from '@xyflow/react';

import { Modal } from '@/panels/Modal';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';
import { isHubConfigured, hubRepoUrl } from '@/templates/hub';
import {
  maskForPublish,
  scanForPublish,
  type PublishFinding,
  type PublishRisk,
} from '@/persistence/publishScan';
import { generateThumbnail, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from './thumbnail';
import {
  bundleFilename,
  hubSlug,
  isValidSlug,
  normalizeSlug,
  submissionShell,
  teamReadme,
  TEAM_DOC_FILENAME,
  TEAM_PREVIEW_FILENAME,
  TEAM_README_FILENAME,
} from './submission';
import { LICENSE_IDS, type CanvasDoc, type LicenseId } from '@/types/canvas';
import type { TFunction } from '@/i18n/react';

type ThumbnailStatus = 'generating' | 'ready' | 'skipped' | 'failed';
type Step = 'review' | 'submit';

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
 * 게시 모달 — 2단계 (M5-T3 + M5-T8 · WORK_PLAN §5.6 P0/P1 · 리스크 R8).
 *
 * **1단계 "무엇이 공개되는가"**: `scanForPublish()` 가 찾은 값을 필드 단위로 보여
 * 주고 위험도별로 마스킹 여부를 고르게 한다. `block`(API 키)은 고를 여지 없이 항상
 * 마스킹된다 — §12 BYOK 원칙상 게시물에 키가 남는 건 사용자 판단의 영역이 아니다.
 * 여기서 게시자(author)와 게시물 라이선스(P-D4)도 고른다 — 문서에 값이 실려야
 * 레지스트리 카드가 그걸 표시할 수 있고, 라이선스는 **게시자만** 정할 수 있다.
 *
 * **2단계 "어떻게 올리는가"**(M5-T8): 계정이 없으므로(P-D1) 제출은 PR 이다. 파일
 * 3개(`team.acanvas.json`/`preview.png`/`README.md`)를 손에 쥐어 주고, 옮기는
 * 명령과 PR 링크까지 한 화면에 둔다.
 *
 * ⚠️ 2단계는 **레지스트리 URL 이 설정된 배포에서만** 렌더된다(P-D3/R12). 미설정
 * 인스턴스에서는 1단계 확인 = 번들 다운로드로 끝난다 — self-host 가 존재하지도
 * 않는 레지스트리로 PR 을 보내라는 안내를 받는 일은 없어야 한다.
 */
export function PublishPreview({
  open, onClose, getFlow,
}: {
  open: boolean;
  onClose: () => void;
  /** 썸네일 캡처용 — 현재 마운트된 캔버스의 RF 인스턴스. 아직 준비 전이면 `null`. */
  getFlow: () => ReactFlowInstance | null;
}) {
  const t = useT();
  const toDoc = useAppStore((s) => s.toDoc);
  const setDocMeta = useAppStore((s) => s.setDocMeta);
  const toast = useAppStore((s) => s.toast);
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [thumbnailStatus, setThumbnailStatus] = useState<ThumbnailStatus>('generating');
  const [step, setStep] = useState<Step>('review');
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState<LicenseId | ''>('');
  const [slug, setSlug] = useState('');
  const [bundle, setBundle] = useState<CanvasDoc | null>(null);

  // 모달을 열 때 문서를 한 번 스냅샷 뜬다 — 열려 있는 동안 캔버스가 바뀌어도
  // 미리보기가 흔들리지 않게 하기 위해서다. 썸네일도 이 시점의 DOM 을 캡처한다
  // (M5-T4) — 캔버스가 그대로 뒤에 마운트돼 있으니 모달을 덮어도 캡처는 된다.
  useEffect(() => {
    if (!open) { setDoc(null); setThumbnail(null); setBundle(null); return; }
    const snapshot = toDoc();
    setDoc(snapshot);
    const scan = scanForPublish(snapshot);
    setSelected(new Set(scan.blocking.map((f) => f.id)));
    setStep('review');
    setBundle(null);
    setAuthor(snapshot.author && snapshot.author !== 'anonymous' ? snapshot.author : '');
    setLicense(snapshot.license ?? '');
    setSlug(hubSlug(snapshot.name, snapshot.id));

    let cancelled = false;
    setThumbnail(null);
    setThumbnailStatus('generating');
    const rf = getFlow();
    if (!rf) {
      setThumbnailStatus('skipped');
    } else {
      generateThumbnail(rf)
        .then((result) => {
          if (cancelled) return;
          if (result) { setThumbnail(result); setThumbnailStatus('ready'); } else { setThumbnailStatus('skipped'); }
        })
        .catch(() => { if (!cancelled) setThumbnailStatus('failed'); });
    }
    return () => { cancelled = true; };
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
    const trimmedAuthor = author.trim();
    const published: CanvasDoc = {
      ...masked,
      ...(trimmedAuthor ? { author: trimmedAuthor } : {}),
      license: license || null,
      ...(thumbnail ? { meta: { ...masked.meta, thumbnail } } : {}),
    };
    // 고른 값은 로컬 문서에도 남긴다 — 같은 팀을 다시 게시할 때 라이선스를 매번
    // 새로 고르게 하면 판마다 라이선스가 달라진다.
    setDocMeta({ license: license || null, ...(trimmedAuthor ? { author: trimmedAuthor } : {}) });

    downloadText(JSON.stringify(published, null, 2), bundleFilename(slug), 'application/json');
    setBundle(published);
    toast('success', t('publish.preview.downloaded'));

    if (isHubConfigured()) setStep('submit'); else onClose();
  }

  const title = step === 'review' ? t('publish.preview.title') : t('publish.submit.title');

  return (
    <Modal open={open} wide title={title} onClose={onClose}
      footer={step === 'review' ? (
        <>
          <button type="button" className="ac-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="ac-btn ac-btn-primary" onClick={confirm}>
            {t('publish.preview.confirm')}
          </button>
        </>
      ) : (
        <button type="button" className="ac-btn ac-btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      )}
    >
      {step === 'review' ? (
        <ReviewStep
          scan={scan}
          selected={selected}
          onToggle={toggle}
          thumbnail={thumbnail}
          thumbnailStatus={thumbnailStatus}
          author={author}
          onAuthorChange={setAuthor}
          license={license}
          onLicenseChange={setLicense}
        />
      ) : (
        bundle && (
          <SubmitStep
            bundle={bundle}
            thumbnail={thumbnail}
            slug={slug}
            onSlugChange={(v) => setSlug(normalizeSlug(v))}
          />
        )
      )}
    </Modal>
  );
}

/* ────────────────────────── 1단계: 무엇이 공개되는가 ────────────────────────── */

function ReviewStep({
  scan, selected, onToggle, thumbnail, thumbnailStatus,
  author, onAuthorChange, license, onLicenseChange,
}: {
  scan: ReturnType<typeof scanForPublish> | null;
  selected: Set<string>;
  onToggle: (f: PublishFinding) => void;
  thumbnail: string | null;
  thumbnailStatus: ThumbnailStatus;
  author: string;
  onAuthorChange: (v: string) => void;
  license: LicenseId | '';
  onLicenseChange: (v: LicenseId | '') => void;
}) {
  const t = useT();
  return (
    <>
      <div className="ac-note">{t('publish.preview.intro')}</div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-t11_5 font-semibold text-text-dim">{t('publish.preview.thumbnail.label')}</div>
          <div
            data-testid="publish-thumbnail"
            data-status={thumbnailStatus}
            className="flex w-full max-w-[320px] items-center justify-center self-start overflow-hidden rounded-xl border border-border-soft bg-surface-2"
            style={{ aspectRatio: `${THUMBNAIL_WIDTH} / ${THUMBNAIL_HEIGHT}`, width: 320 }}
          >
            {thumbnailStatus === 'ready' && thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URI, Next Image 최적화 대상 아님
              <img
                src={thumbnail}
                alt={t('publish.preview.thumbnail.alt')}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className={`px-3 text-center text-t10_5 ${thumbnailStatus === 'failed' ? 'text-danger' : 'text-text-faint'}`}>
                {t(`publish.preview.thumbnail.${thumbnailStatus}`)}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-[220px] flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-t10_5 font-semibold text-text-dim">{t('publish.meta.author')}</span>
            <input
              type="text"
              className="ac-input"
              value={author}
              placeholder={t('publish.meta.authorPlaceholder')}
              onChange={(e) => onAuthorChange(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-t10_5 font-semibold text-text-dim">{t('publish.meta.license')}</span>
            <select
              className="ac-input"
              value={license}
              onChange={(e) => onLicenseChange(e.target.value as LicenseId | '')}
            >
              <option value="">{t('publish.meta.licenseNone')}</option>
              {LICENSE_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            <span className="ac-hint !mt-0">{t('publish.meta.licenseHint')}</span>
          </label>
        </div>
      </div>

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
                        onChange={() => onToggle(f)}
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
    </>
  );
}

/* ────────────────────────── 2단계: 어떻게 올리는가 ────────────────────────── */

function SubmitStep({
  bundle, thumbnail, slug, onSlugChange,
}: {
  bundle: CanvasDoc;
  thumbnail: string | null;
  slug: string;
  onSlugChange: (v: string) => void;
}) {
  const t = useT();
  const repo = hubRepoUrl();
  const readme = useMemo(() => teamReadme(bundle), [bundle]);
  const shell = useMemo(
    () => submissionShell({ slug: slug || 'my-team', downloadedDocName: bundleFilename(slug || 'my-team') }),
    [slug],
  );
  const slugOk = isValidSlug(slug);

  return (
    <>
      <div className="ac-note">{t('publish.submit.intro')}</div>
      <div className="flex items-start gap-2 rounded-xl border border-emerald/40 bg-emerald/10 p-3 text-t11_5 leading-normal text-emerald">
        <ShieldCheck size={16} className="mt-[1px] flex-none" />
        {t('publish.submit.noAccount')}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-t10_5 font-semibold text-text-dim">{t('publish.submit.slugLabel')}</span>
        <input
          type="text"
          className="ac-input font-mono"
          value={slug}
          spellCheck={false}
          aria-invalid={!slugOk}
          onChange={(e) => onSlugChange(e.target.value)}
        />
        <span className={`ac-hint !mt-0 ${slugOk ? '' : '!text-danger'}`}>
          {slugOk ? t('publish.submit.slugHint', { slug }) : t('publish.submit.slugInvalid')}
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <div className="text-t11_5 font-semibold text-text-dim">{t('publish.submit.filesLabel')}</div>
        <FileRow
          name={TEAM_DOC_FILENAME}
          note={t('publish.submit.fileDoc', { file: bundleFilename(slug || 'my-team') })}
          done
        />
        <FileRow
          name={TEAM_PREVIEW_FILENAME}
          note={thumbnail ? t('publish.submit.filePreview') : t('publish.submit.filePreviewMissing')}
          action={thumbnail ? (
            <button
              type="button"
              className="ac-btn !px-3 !py-[4px] !text-t10_5"
              onClick={() => downloadDataUrl(thumbnail, TEAM_PREVIEW_FILENAME)}
            >
              <Download size={12} strokeWidth={2.4} />
              {t('publish.submit.download')}
            </button>
          ) : undefined}
        />
        <FileRow
          name={TEAM_README_FILENAME}
          note={t('publish.submit.fileReadme')}
          action={<CopyButton value={readme} label={t('publish.submit.copy')} />}
        />
      </div>

      <details className="rounded-xl border border-border-soft bg-surface-2 p-3">
        <summary className="cursor-pointer text-t11_5 font-semibold text-text-dim">
          {t('publish.submit.readmePreview')}
        </summary>
        <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-t10_5 text-text-faint">
          {readme}
        </pre>
      </details>

      <div className="flex flex-col gap-2">
        <div className="text-t11_5 font-semibold text-text-dim">{t('publish.submit.stepsLabel')}</div>
        <ol className="m-0 flex list-decimal flex-col gap-[6px] pl-5 text-t11_5 leading-normal text-text-dim">
          <li>{t('publish.submit.step1')}</li>
          <li>{t('publish.submit.step2', { slug: slug || 'my-team' })}</li>
          <li>{t('publish.submit.step3')}</li>
          <li>{t('publish.submit.step4')}</li>
        </ol>
        <div className="relative">
          <pre className="m-0 overflow-x-auto rounded-xl border border-border-soft bg-surface-2 p-3 font-mono text-t10_5 leading-relaxed text-text-dim">
            {shell}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton value={shell} label={t('publish.submit.copy')} />
          </div>
        </div>
      </div>

      {repo && (
        <div className="flex flex-wrap gap-2">
          <a className="ac-btn" href={`${repo}/fork`} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={12} strokeWidth={2.4} />
            {t('publish.submit.openFork')}
          </a>
          <a className="ac-btn" href={`${repo}/compare`} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={12} strokeWidth={2.4} />
            {t('publish.submit.openPr')}
          </a>
          <a className="ac-btn" href={`${repo}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={12} strokeWidth={2.4} />
            {t('publish.submit.openGuide')}
          </a>
        </div>
      )}
    </>
  );
}

function FileRow({ name, note, action, done }: {
  name: string; note: string; action?: React.ReactNode; done?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface-2 p-[10px] text-t11_5">
      {done && <Check size={14} strokeWidth={2.6} className="flex-none text-emerald" />}
      <span className="flex-none font-mono text-text">{name}</span>
      <span className="min-w-0 flex-1 truncate text-text-faint">{note}</span>
      {action}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ac-btn !px-3 !py-[4px] !text-t10_5"
      onClick={() => {
        void navigator.clipboard?.writeText(value)
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
          .catch(() => { /* 클립보드 권한 없음 — 아래 미리보기에서 직접 긁으면 된다 */ });
      }}
    >
      {copied ? <Check size={12} strokeWidth={2.6} /> : <Copy size={12} strokeWidth={2.4} />}
      {label}
    </button>
  );
}

/* ────────────────────────── 공용 ────────────────────────── */

function locationOf(f: PublishFinding, t: TFunction): string {
  if (f.nodeType) return t('publish.preview.locationNode', { nodeType: f.nodeType, field: f.field ?? f.path });
  const field = f.path.replace(/^\$\.?/, '');
  return t('publish.preview.locationDoc', { field });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type }), filename);
}

/**
 * data URI → 파일. 썸네일이 JPEG 로 폴백된 경우(200KB 초과 그래프,
 * `thumbnail.ts::JPEG_QUALITY_STEPS`)에도 레지스트리가 요구하는 이름은
 * `preview.png` 하나뿐이라(`build_index.py::REQUIRED_TEAM_FILES`) 캔버스로 한 번
 * 다시 그려 **진짜 PNG** 로 바꿔 준다. 확장자만 png 인 JPEG 를 커밋하게 두면
 * 언젠가 이미지 파이프라인 하나가 조용히 깨진다.
 */
function downloadDataUrl(dataUrl: string, filename: string): void {
  if (dataUrl.startsWith('data:image/png')) {
    downloadBlob(dataUrlToBlob(dataUrl), filename);
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      downloadBlob(dataUrlToBlob(canvas.toDataURL('image/png')), filename);
    } catch {
      downloadBlob(dataUrlToBlob(dataUrl), filename); // 최후: 원본 그대로
    }
  };
  img.onerror = () => downloadBlob(dataUrlToBlob(dataUrl), filename);
  img.src = dataUrl;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head = '', body = ''] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bytes = atob(body);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}
