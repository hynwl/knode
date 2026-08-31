/**
 * 백엔드 상태 프로브 — 헬스체크 / LLM 프로바이더 프리셋 / Ollama 자동 감지.
 * (M3-T5, Spec §9.2, §13.1)
 *
 * `run/client.ts` 는 `POST /runs` 실행 흐름 전담이라 이 조회성 GET 들은
 * 분리했다. 실패해도 캔버스 편집을 막지 않아야 하므로 전부 던지지 않고
 * 안전한 기본값으로 흡수한다 — 호출부(`page.tsx`)가 매번 try/catch 할
 * 필요가 없게.
 */

import type { OllamaModelInfo, ToolTypeInfo } from '@/store';

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
