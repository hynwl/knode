/**
 * SSE 프레임 → 스토어 큐 디스패치 + 연결 생명주기 반응 (Spec §10.2/§10.3).
 *
 * 실제 이벤트별 상태 반영(§10.3 매핑 표)은 `store/index.ts` 의 `applyRunEvent`
 * (50ms 배치, Spec §16.2)가 맡는다 — 이 모듈은 그 큐에 넣어주는 얇은 어댑터와,
 * `run/client.ts::connectRunEvents` 의 재연결 콜백을 토스트로 옮기는 역할만 한다.
 */

import { useAppStore } from '@/store';
import type { SSEFrame } from './sse';
import { t } from '@/i18n';

/** Spec §10.2 이벤트 카탈로그. 여기 없는 이름은 알 수 없는 이벤트로 취급해 버린다. */
const KNOWN_EVENTS = new Set([
  'run.started', 'run.completed', 'run.failed', 'run.cancelled',
  'node.status', 'task.started', 'task.completed',
  'agent.thought', 'agent.tool_use', 'agent.tool_result', 'agent.delegation',
  'token.usage', 'log', 'human.request', 'edge.active',
]);

/** `connectRunEvents` 의 `onFrame` 콜백으로 그대로 넘기면 되는 핸들러. */
export function handleRunFrame(frame: SSEFrame): void {
  if (!KNOWN_EVENTS.has(frame.event)) return; // 하트비트 등은 sse.ts 단에서 이미 걸러짐
  if (!frame.data) return;
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return; // 파싱 불가 프레임으로 UI 를 깨뜨리지 않는다
  }
  if (!payload || typeof payload !== 'object') return;
  useAppStore.getState().enqueueEvent(frame.event, payload as Record<string, unknown>);
}

export function handleReconnecting(attempt: number, maxAttempts: number): void {
  useAppStore.getState().toast('info', t('run.reconnecting', { attempt, max: maxAttempts }));
}

export function handleStreamGaveUp(): void {
  useAppStore.getState().toast(
    'error',
    t('run.streamGaveUp'),
    true,
  );
}
