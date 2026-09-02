'use client';

import { AlertTriangle, Check, Copy, Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { downloadPythonZip, downloadTextFile, exportPython, type ExportPythonResult } from '@/export/client';
import { TOKEN_CLASS, tokenize } from '@/lib/syntax';
import { RunApiError } from '@/run/client';
import { useAppStore } from '@/store';
import { Modal } from './Modal';

interface ExportCodeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * `</> Export Code` 모달 (Spec §8.5).
 *
 * 렌더링은 백엔드(`POST /api/v1/export/python`)가 한다 — Jinja2 템플릿이 거기
 * 있고, 무엇보다 `requirements.txt` 의 핀 버전이 **이 크루를 실제로 실행하는
 * 서버의 설치본**이어야 의미가 있다. 그래서 다른 모달과 달리 백엔드가 꺼져
 * 있으면 열리지 않고, 그 사실을 그대로 표시한다.
 */
export function ExportCodeModal({ open, onClose }: ExportCodeModalProps) {
  const toDoc = useAppStore((s) => s.toDoc);
  const toast = useAppStore((s) => s.toast);
  const requestFocusNode = useAppStore((s) => s.requestFocusNode);

  const [result, setResult] = useState<ExportPythonResult | null>(null);
  const [error, setError] = useState<RunApiError | null>(null);
  const [active, setActive] = useState(0);
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResult(null);
    setError(null);
    setActive(0);
    exportPython(toDoc())
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof RunApiError ? e : new RunApiError('내보내기에 실패했습니다.', 'AC-E504', 0)); });
    return () => { cancelled = true; };
  }, [open, toDoc]);

  const file = result?.files[active];

  const onDownloadZip = useCallback(() => {
    setZipping(true);
    downloadPythonZip(toDoc())
      .then(() => toast('success', '코드를 zip 으로 내려받았습니다.'))
      .catch(() => toast('error', 'zip 내려받기에 실패했습니다.'))
      .finally(() => setZipping(false));
  }, [toDoc, toast]);

  return (
    <Modal
      open={open}
      wide
      title="Export to Python"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-t10_5 text-text-faint">
            AgentCanvas 없이 <code className="text-code-text">python crew.py</code> 로 그대로 돌아갑니다.
          </span>
          <button type="button" className="ac-btn" onClick={onClose}>닫기</button>
          <button
            type="button"
            className="ac-btn ac-btn-primary flex items-center gap-[6px]"
            onClick={onDownloadZip}
            disabled={!result || zipping}
          >
            {zipping ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} strokeWidth={2.4} />}
            zip 으로 받기
          </button>
        </>
      }
    >
      {!result && !error && (
        <p className="ac-hint !mt-0 flex items-center gap-2">
          <Loader2 size={13} className="animate-spin" />
          코드를 생성하는 중…
        </p>
      )}

      {error && <ExportError error={error} onFocusNode={(id) => { onClose(); requestFocusNode(id); }} />}

      {result && (
        <>
          {result.notes.length > 0 && (
            <div className="ac-note !mt-0">
              <div className="mb-1 flex items-center gap-[6px] font-semibold text-amber">
                <AlertTriangle size={11} strokeWidth={2.6} />
                스크립트로 옮겨지지 않은 것
              </div>
              <ul className="m-0 list-disc space-y-[3px] pl-4">
                {result.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-[6px]">
            {result.files.map((f, i) => (
              <button
                key={f.filename}
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={`ac-chip !px-[9px] !py-[4px] font-mono ${
                  i === active ? '!border-indigo/60 !text-text' : 'opacity-70 hover:opacity-100'
                }`}
              >
                {f.filename}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-[6px]">
              <CopyButton text={file?.content ?? ''} />
              <button
                type="button"
                className="ac-btn !px-2 !py-[4px] !text-t10_5 flex items-center gap-1"
                onClick={() => file && downloadTextFile(file.filename, file.content)}
              >
                <Download size={11} strokeWidth={2.4} />
                이 파일만
              </button>
            </div>
          </div>

          {file && <CodeBlock content={file.content} language={file.language} />}
        </>
      )}
    </Modal>
  );
}

/* ---------- 코드 블록 ---------- */

function CodeBlock({ content, language }: { content: string; language: 'python' | 'text' | 'dotenv' }) {
  const tokens = useMemo(() => tokenize(content, language), [content, language]);
  return (
    <pre
      className="m-0 max-h-[46vh] overflow-auto rounded-2xl border border-border-soft bg-code-bg p-3
                 font-mono text-t11 leading-[1.55] text-code-text"
    >
      <code>
        {tokens.map((t, i) => (
          <span key={i} className={TOKEN_CLASS[t.kind]}>{t.text}</span>
        ))}
      </code>
    </pre>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      className="ac-btn !px-2 !py-[4px] !text-t10_5 flex items-center gap-1"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false));
      }}
    >
      {copied ? <Check size={11} strokeWidth={2.6} className="text-emerald" /> : <Copy size={11} strokeWidth={2.4} />}
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

/* ---------- 실패 표시 ---------- */

function ExportError({ error, onFocusNode }: { error: RunApiError; onFocusNode: (id: string) => void }) {
  const offline = error.code === 'AC-E504';
  return (
    <div className="ac-note !mt-0 !border-danger/40">
      <div className="mb-1 flex items-center gap-[6px] font-semibold text-danger">
        <AlertTriangle size={11} strokeWidth={2.6} />
        {offline ? '백엔드가 꺼져 있습니다' : '코드로 내보낼 수 없습니다'}
      </div>
      {offline ? (
        <p className="m-0">
          코드 생성은 백엔드가 담당합니다 — <code className="text-code-text">requirements.txt</code> 의
          버전을 실제 실행 환경과 맞추기 위해서입니다. 백엔드를 켠 뒤 다시 시도하세요.
        </p>
      ) : (
        <ul className="m-0 list-disc space-y-[3px] pl-4">
          {(error.issues ?? [{ code: error.code, message: error.message, node_id: null, severity: 'error' as const }]).map(
            (issue, i) => (
              <li key={`${issue.code}-${i}`}>
                <span className="font-mono text-t10_5 text-text-faint">{issue.code}</span> {issue.message}
                {issue.node_id && (
                  <button
                    type="button"
                    className="ml-[6px] underline underline-offset-2 hover:text-text"
                    onClick={() => onFocusNode(issue.node_id!)}
                  >
                    노드 보기
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
