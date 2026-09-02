/**
 * URL 공유 링크 (Spec §14.3 SHOULD).
 * 그래프를 gzip 압축 → base64url → `#share=` 프래그먼트에 담는다.
 * `#` 프래그먼트는 서버로 전송되지 않으므로 서버 없이도 프라이버시 안전하게 공유된다.
 */

import type { CanvasDoc } from '@/types/canvas';
import { exportDoc } from './fileIO';
import { AcanvasError, migrate } from './migrations';
import { redactSecrets, type SecretHit } from './secretScanner';
import { issue } from '@/validation/issues';

/** 이 크기를 넘으면 링크가 실용적이지 않다고 보고 파일 폴백으로 넘어간다 (Spec §14.3). */
export const SHARE_LINK_MAX_BYTES = 3 * 1024;

export const SHARE_HASH_PREFIX = '#share=';

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

export type ShareLinkOutcome =
  | { kind: 'link'; url: string; encodedBytes: number }
  | { kind: 'too-large'; encodedBytes: number };

/**
 * 공유 링크를 만든다. `exportDoc()`과 동일하게 시크릿이 있으면 AC-E404 로 막는다
 * — 공유 링크는 URL 이라 파일 Export 보다 더 쉽게 퍼진다, 검사 기준을 낮출 이유가 없다.
 * @throws AcanvasError AC-E404 (시크릿 포함)
 */
export async function buildShareLink(doc: CanvasDoc): Promise<ShareLinkOutcome> {
  const { json } = exportDoc(doc);
  const compressed = await gzip(json);
  const encoded = toBase64Url(compressed);
  if (encoded.length > SHARE_LINK_MAX_BYTES) {
    return { kind: 'too-large', encodedBytes: encoded.length };
  }
  const { origin, pathname, search } = window.location;
  return { kind: 'link', url: `${origin}${pathname}${search}${SHARE_HASH_PREFIX}${encoded}`, encodedBytes: encoded.length };
}

export interface ShareImportResult {
  doc: CanvasDoc;
  redactions: SecretHit[];
}

/**
 * `#share=...` 프래그먼트로부터 그래프를 복원한다. Import 와 동일하게 시크릿은
 * 차단이 아니라 마스킹 후 고지한다(§7.4) — 링크는 발신자가 이미 통제할 수 없는
 * 채널에 뿌려진 뒤이므로, 여기서 막아봐야 이미 늦다.
 * @throws AcanvasError AC-E403 (형식 오류 또는 파싱 실패)
 */
export async function importFromShareHash(hash: string): Promise<ShareImportResult> {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) {
    throw new AcanvasError('AC-E403', issue('AC-E403').message);
  }
  const encoded = hash.slice(SHARE_HASH_PREFIX.length);
  let json: string;
  try {
    json = await gunzip(fromBase64Url(encoded));
  } catch {
    throw new AcanvasError('AC-E403', issue('AC-E403').message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AcanvasError('AC-E403', issue('AC-E403').message);
  }
  const migrated = migrate(parsed);
  const { value, hits } = redactSecrets(migrated);
  return { doc: value, redactions: hits };
}
