/**
 * 백엔드 상태 프로브 — 헬스체크 / LLM 프로바이더 프리셋 / Ollama 자동 감지.
 * (M3-T5, Spec §9.2, §13.1)
 *
 * `run/client.ts` 는 `POST /runs` 실행 흐름 전담이라 이 조회성 GET 들은
 * 분리했다. 실패해도 캔버스 편집을 막지 않아야 하므로 전부 던지지 않고
 * 안전한 기본값으로 흡수한다 — 호출부(`page.tsx`)가 매번 try/catch 할
 * 필요가 없게.
 */

import type { OllamaModelInfo, ProviderModelProbe, ToolTypeInfo } from '@/store';
import { encodeSecretsHeader, SECRET_HEADER } from '@/run/client';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const API_PREFIX = `${API_BASE}/api/v1`;

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_PREFIX}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** provider → 프리셋 모델 이름 배열 (`backend/app/data/model_presets.json`). 실패 시 빈 맵. */
export async function fetchProviderPresets(): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`${API_PREFIX}/providers`);
    if (!res.ok) return {};
    const body = await res.json() as { providers?: { provider: string; models: string[] }[] };
    const map: Record<string, string[]> = {};
    for (const p of body.providers ?? []) map[p.provider] = p.models ?? [];
    return map;
  } catch {
    return {};
  }
}

/** `GET /api/v1/tools` — `tool` 노드 `tool_id` 드롭다운(Spec §5.6, 하드코딩 금지 MUST). 실패 시 빈 배열. */
export async function fetchToolTypes(): Promise<ToolTypeInfo[]> {
  try {
    const res = await fetch(`${API_PREFIX}/tools`);
    if (!res.ok) return [];
    const body = await res.json() as {
      tools?: { tool_id: string; label: string; description: string; required_keys: string[]; enabled: boolean }[];
    };
    return (body.tools ?? []).map((t) => ({
      toolId: t.tool_id,
      label: t.label,
      description: t.description,
      requiredKeys: t.required_keys ?? [],
      enabled: t.enabled,
    }));
  } catch {
    return [];
  }
}

export interface OllamaProbeResult {
  available: boolean;
  host: string;
  models: OllamaModelInfo[];
  reason: string | null;
}

/** `GET /api/v1/ollama/models`. 실패(네트워크 자체 오류)도 `available: false` 로 흡수한다. */
export async function fetchOllamaModels(host: string, force = false): Promise<OllamaProbeResult> {
  const params = new URLSearchParams({ host });
  if (force) params.set('force', 'true');
  try {
    const res = await fetch(`${API_PREFIX}/ollama/models?${params}`);
    if (!res.ok) return { available: false, host, models: [], reason: 'unknown' };
    const body = await res.json() as {
      available: boolean; host: string; reason?: string | null;
      models: { name: string; size_gb: number | null; family: string | null; context: number | null }[];
    };
    return {
      available: body.available,
      host: body.host,
      reason: body.reason ?? null,
      models: body.models.map((m) => ({ name: m.name, sizeGb: m.size_gb, family: m.family, context: m.context })),
    };
  } catch {
    return { available: false, host, models: [], reason: 'unknown' };
  }
}

/**
 * `GET /api/v1/providers/{provider}/models` — 등록된 BYOK 키로 **실제 쓸 수 있는**
 * 모델을 조회한다 (Spec §5.3 "모델은 자주 바뀐다" 의 연장선).
 *
 * 정적 프리셋(`fetchProviderPresets`)과 달리 키가 있어야 하고, 브라우저가 CORS 로
 * 직접 못 부르므로 백엔드가 대신 조회한다 — Ollama 감지와 같은 구조다. 키는
 * 실행 때와 똑같이 `X-Provider-Keys` 헤더로만 나가고 URL 에는 절대 싣지 않는다.
 */
export async function fetchProviderModels(
  provider: string,
  keyRef: string,
  secrets: Record<string, string>,
  force = false,
): Promise<Omit<ProviderModelProbe, 'keyFp'>> {
  const params = new URLSearchParams();
  if (keyRef) params.set('key_ref', keyRef);
  if (force) params.set('force', 'true');
  const qs = params.toString();
  const header = encodeSecretsHeader(secrets);
  try {
    const res = await fetch(`${API_PREFIX}/providers/${encodeURIComponent(provider)}/models${qs ? `?${qs}` : ''}`, {
      headers: header ? { [SECRET_HEADER]: header } : {},
    });
    if (!res.ok) return { status: 'failed', models: [], reason: 'unknown' };
    const body = await res.json() as { available: boolean; models?: string[]; reason?: string | null };
    return body.available
      ? { status: 'ok', models: body.models ?? [], reason: null }
      : { status: 'failed', models: [], reason: body.reason ?? 'unknown' };
  } catch {
    // 백엔드가 꺼져 있어도 편집은 계속돼야 한다 (§9.4).
    return { status: 'failed', models: [], reason: 'backend_offline' };
  }
}

export interface ExtractedDocument {
  filename: string;
  text: string;
  chars: number;
  pages: number | null;
  truncated: boolean;
}

/** 문서 추출 실패 — `code` 는 AC-E406/E407/E408 중 하나다. */
export class DocumentExtractError extends Error {
  constructor(readonly code: string, readonly hint?: string) {
    super(code);
  }
}

/**
 * `POST /api/v1/documents/extract` — PDF·DOCX·텍스트 파일에서 본문만 뽑아 온다
 * (Input 노드의 "문서에서 불러오기"). 파일은 서버에 저장되지 않는다.
 *
 * 다른 조회들과 달리 **던진다** — 여기선 사용자가 방금 파일을 고르는 명시적
 * 행동을 했으므로, 실패를 조용한 기본값으로 삼키면 아무 일도 안 일어난 것처럼
 * 보인다. 호출부가 코드별 토스트를 띄운다.
 */
export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/documents/extract`, { method: 'POST', body: form });
  } catch {
    throw new DocumentExtractError('AC-E504');
  }
  if (!res.ok) {
    let code = 'AC-E408';
    let hint: string | undefined;
    try {
      const body = await res.json() as { error?: { code?: string; hint?: string } };
      if (body.error?.code) code = body.error.code;
      hint = body.error?.hint;
    } catch { /* 본문 없음 — 기본 코드로 */ }
    throw new DocumentExtractError(code, hint);
  }
  return await res.json() as ExtractedDocument;
}
