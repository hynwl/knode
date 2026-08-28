/** `.acanvas.json` Import / Export (Spec §14.3) */

import { CURRENT_SCHEMA_VERSION, type CanvasDoc } from '@/types/canvas';
import { AcanvasError, migrate } from './migrations';
import { redactSecrets, scanForSecrets, type SecretHit } from './secretScanner';
import { issue } from '@/validation/issues';

export function slugify(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^\w가-힣\s-]/g, '').replace(/[\s_]+/g, '-');
  return s || 'canvas';
}

export interface ExportResult {
  json: string;
  filename: string;
}

/**
 * Export. 시크릿이 하나라도 발견되면 **차단**한다. (Spec §7.4 `MUST` / AC-S1)
 * @throws AcanvasError AC-E404
 */
export function exportDoc(doc: CanvasDoc): ExportResult {
  const hits = scanForSecrets(doc);
  if (hits.length) {
    const err = new AcanvasError('AC-E404', issue('AC-E404').message);
    (err as AcanvasError & { hits: SecretHit[] }).hits = hits;
    throw err;
  }
  const payload: CanvasDoc = {
    ...doc,
    schema_version: CURRENT_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
  };
  return {
    json: JSON.stringify(payload, null, 2),
    filename: `${slugify(doc.name)}.acanvas.json`,
  };
}

export function downloadDoc(doc: CanvasDoc): void {
  const { json, filename } = exportDoc(doc);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  doc: CanvasDoc;
  redactions: SecretHit[];
}

/** Import. 시크릿은 차단이 아니라 마스킹 후 고지한다. (Spec §7.4) */
export function importDoc(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AcanvasError('AC-E403', issue('AC-E403').message);
  }
  const migrated = migrate(parsed);
  const { value, hits } = redactSecrets(migrated);
  return { doc: value, redactions: hits };
}

export async function readFileAsText(file: File): Promise<string> {
  return await file.text();
}
