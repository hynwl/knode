/**
 * Export to Python API 클라이언트 (Spec §8.5).
 *
 * `run/client.ts` 와 달리 **BYOK 헤더를 싣지 않는다** — 생성 코드는 키를
 * `os.getenv(...)` 로만 읽으므로(§8.5 MUST) 서버에 키를 줄 이유가 없고,
 * 주지 않으면 키가 생성 파일에 섞여 나갈 경로 자체가 없다.
 */

import type { CanvasDoc } from '@/types/canvas';
import { type ApiIssue, RunApiError } from '@/run/client';
import { t } from '@/i18n';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const API_PREFIX = `${API_BASE}/api/v1`;

export type ExportLanguage = 'python' | 'text' | 'dotenv';

export interface ExportFile {
  filename: string;
  language: ExportLanguage;
  content: string;
}

export interface ExportPythonResult {
  files: ExportFile[];
  warnings: ApiIssue[];
  /** 캔버스에는 있으나 단독 스크립트로 옮길 수 없는 것들에 대한 고지. */
  notes: string[];
}

async function throwApiError(res: Response): Promise<never> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* 본문 없음/파싱 불가 */ }

  if (body && typeof body === 'object' && Array.isArray((body as { errors?: unknown }).errors)) {
    const issues = (body as { errors: ApiIssue[] }).errors;
    throw new RunApiError(
      issues[0]?.message ?? t('export.notExportable'),
      issues[0]?.code ?? 'AC-E001',
      res.status,
      issues,
    );
  }
  if (body && typeof body === 'object' && (body as { error?: ApiIssue }).error) {
    const e = (body as { error: ApiIssue }).error;
    throw new RunApiError(e.message, e.code, res.status);
  }
  throw new RunApiError(t('export.failedWithStatus', { status: res.status }), 'AC-E504', res.status);
}

export async function exportPython(graph: CanvasDoc): Promise<ExportPythonResult> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/export/python`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph }),
    });
  } catch {
    throw new RunApiError(t('run.backendUnreachable'), 'AC-E504', 0);
  }
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as ExportPythonResult;
}

/**
 * 세 파일을 zip 하나로 내려받는다. 사용자는 결국 파일 3개를 한 디렉터리에 놓고
 * `python crew.py` 를 돌려야 하므로, 브라우저가 파일을 하나씩 받게 하는 것보다
 * 이쪽이 실제 사용 흐름에 맞다 (연속 다운로드는 브라우저가 막기도 한다).
 */
export async function downloadPythonZip(graph: CanvasDoc): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/export/python?format=zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph }),
    });
  } catch {
    throw new RunApiError(t('run.backendUnreachable'), 'AC-E504', 0);
  }
  if (!res.ok) await throwApiError(res);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromDisposition(res.headers.get('content-disposition')) ?? 'crew.zip';
  a.click();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
