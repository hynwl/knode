/**
 * 백엔드 실행 API 클라이언트 (Spec §9.2~§9.4, §10.1, §11.4).
 *
 * `POST /runs` → SSE 이벤트 스트림 연결까지 이 모듈이 전담한다.
 * 에러 봉투는 `backend/app/core/errors.py` 를 그대로 따른다:
 *  - 일반 에러: `{"error": {code,message,...}, "request_id"}`
 *  - 그래프 검증 실패(422, `POST /runs` 전용): `{"errors": Issue[], "request_id"}`
 */

import type { CanvasDoc } from '@/types/canvas';
import { type SSEFrame, parseSSEStream } from './sse';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const API_PREFIX = `${API_BASE}/api/v1`;

/** `X-Provider-Keys` 헤더 이름 (`backend/app/core/secrets.py` 와 동일). */
const SECRET_HEADER = 'X-Provider-Keys';

export interface RunWarning {
  code: string;
  node_id: string | null;
  message: string;
}

export interface StartRunResult {
  run_id: string;
  status: 'queued';
  task_order: string[];
  warnings: RunWarning[];
  events_url: string;
}

export interface ApiIssue {
  code: string;
  severity: 'error' | 'warn';
  message: string;
  hint?: string | null;
  node_id?: string | null;
  edge_id?: string | null;
  field?: string | null;
}

/** 백엔드 에러 봉투를 그대로 실어 나르는 예외. */
export class RunApiError extends Error {
  code: string;
  status: number;
  /** `POST /runs` 그래프 검증 실패(422)일 때만 채워진다. */
  issues?: ApiIssue[];

  constructor(message: string, code: string, status: number, issues?: ApiIssue[]) {
    super(message);
    this.name = 'RunApiError';
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

/** `X-Provider-Keys: Base64(JSON)` — `backend/app/core/secrets.py::_decode_header` 와 대응. */
function encodeSecretsHeader(secrets: Record<string, string>): string | null {
  const entries = Object.entries(secrets).filter(([, v]) => Boolean(v));
  if (!entries.length) return null;
  const json = JSON.stringify(Object.fromEntries(entries));
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json, 'utf-8').toString('base64');
}

async function throwApiError(res: Response): Promise<never> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* 본문 없음/파싱 불가 */ }

  if (body && typeof body === 'object' && Array.isArray((body as { errors?: unknown }).errors)) {
    const issues = (body as { errors: ApiIssue[] }).errors;
    throw new RunApiError(
      issues[0]?.message ?? '그래프 검증에 실패했습니다.',
      issues[0]?.code ?? 'AC-E001',
      res.status,
      issues,
    );
  }
  if (body && typeof body === 'object' && (body as { error?: ApiIssue }).error) {
    const e = (body as { error: ApiIssue }).error;
    throw new RunApiError(e.message, e.code, res.status);
  }
  throw new RunApiError(`요청이 실패했습니다 (${res.status})`, 'AC-E504', res.status);
}

async function postJson<T>(path: string, body: unknown, secrets: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secretHeader = encodeSecretsHeader(secrets);
  if (secretHeader) headers[SECRET_HEADER] = secretHeader;

  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new RunApiError('백엔드에 연결할 수 없습니다.', 'AC-E504', 0);
  }
  if (!res.ok) await throwApiError(res);
  return (await res.json()) as T;
}

export async function startRun(
  graph: CanvasDoc,
  inputs: Record<string, unknown>,
  secrets: Record<string, string>,
  options?: { dryRun?: boolean },
): Promise<StartRunResult> {
  return postJson<StartRunResult>(
    '/runs',
    { graph, inputs, options: { dry_run: Boolean(options?.dryRun) } },
    secrets,
  );
}

export async function cancelRun(runId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/runs/${runId}/cancel`, { method: 'POST' });
  if (!res.ok && res.status !== 404) await throwApiError(res);
}

/* ---------------- SSE 재연결 클라이언트 (Spec §11.4: 지수 백오프 최대 5회) ---------------- */

const RECONNECT_BASE_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;
const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled']);

export interface RunEventsHandle {
  stop(): void;
}

export interface RunEventsHandlers {
  onFrame(frame: SSEFrame): void;
  /** 재연결 시도 직전 호출 (UI 토스트 등에 사용). */
  onReconnecting?(attempt: number, maxAttempts: number): void;
  /** 스트림이 완전히 끝났을 때 한 번 호출된다. */
  onClosed?(reason: 'terminal' | 'stopped' | 'gave-up'): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `GET /runs/{id}/events` 를 열고, 끊기면 `Last-Event-ID` 를 실어 재연결한다.
 * `run.completed`/`failed`/`cancelled` 중 하나를 보면 재연결하지 않고 종료한다.
 */
export function connectRunEvents(runId: string, handlers: RunEventsHandlers): RunEventsHandle {
  let stopped = false;
  let controller: AbortController | null = null;
  let lastEventId = 0;
  let attempt = 0;

  async function connectOnce(): Promise<'terminal' | 'aborted' | 'error'> {
    controller = new AbortController();
    let sawTerminal = false;
    try {
      const res = await fetch(`${API_PREFIX}/runs/${runId}/events`, {
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Last-Event-Id': String(lastEventId),
        },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return 'error';

      attempt = 0; // 연결 성공 → 백오프 카운터 리셋
      await parseSSEStream(
        res.body,
        (frame) => {
          if (frame.id !== null) lastEventId = frame.id;
          handlers.onFrame(frame);
          if (TERMINAL_EVENTS.has(frame.event)) sawTerminal = true;
        },
        controller.signal,
      );
      return sawTerminal ? 'terminal' : 'error';
    } catch {
      return controller?.signal.aborted ? 'aborted' : 'error';
    }
  }

  async function loop() {
    while (!stopped) {
      const result = await connectOnce();
      if (stopped || result === 'aborted') break;
      if (result === 'terminal') {
        handlers.onClosed?.('terminal');
        return;
      }
      attempt += 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        handlers.onClosed?.('gave-up');
        return;
      }
      handlers.onReconnecting?.(attempt, MAX_RECONNECT_ATTEMPTS);
      const delay = RECONNECT_BASE_MS * 2 ** (attempt - 1) + Math.random() * 300;
      await sleep(delay);
    }
    handlers.onClosed?.('stopped');
  }

  void loop();

  return {
    stop() {
      stopped = true;
      controller?.abort();
    },
  };
}
