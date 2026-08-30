/**
 * `fetch` + `ReadableStream` 기반 SSE 파서 (Spec §4.3 MUST).
 *
 * `EventSource` 는 GET 전용·커스텀 헤더 불가라 BYOK 키를 실어 보낼 수 없다
 * (`X-Provider-Keys`, `Last-Event-ID`). 그래서 이 프로젝트는 표준 SSE 프레이밍
 * (`id:`/`event:`/`data:`, 빈 줄로 이벤트 구분, `:` 로 시작하면 코멘트/하트비트)
 * 을 직접 파싱한다. 백엔드 포맷은 `backend/app/routers/runs.py` 의
 * `stream_events()` 와 1:1 대응 (Spec §10.1).
 */

export interface SSEFrame {
  /** `id:` 필드. 없으면 서버가 안 보낸 것(하트비트 등) — 재연결 지점 갱신에 쓰지 않는다. */
  id: number | null;
  event: string;
  data: string;
}

/**
 * 응답 바디를 읽어 SSE 프레임 단위로 콜백한다. 코멘트 전용 블록(`: heartbeat`)은
 * `event`/`data` 가 비어 있으므로 호출측에서 하트비트로 식별해 걸러낸다.
 */
export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SSEFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abort);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseBlock(block);
        if (frame) onFrame(frame);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function parseBlock(block: string): SSEFrame | null {
  let id: number | null = null;
  let event = 'message';
  const dataLines: string[] = [];
  let hasContent = false;

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue; // 코멘트/하트비트 라인
    const sep = line.indexOf(':');
    const field = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1).replace(/^ /, '');

    if (field === 'id') {
      const n = Number(value);
      if (Number.isFinite(n)) id = n;
      hasContent = true;
    } else if (field === 'event') {
      event = value;
      hasContent = true;
    } else if (field === 'data') {
      dataLines.push(value);
      hasContent = true;
    }
  }

  if (!hasContent) return null; // 순수 하트비트 블록
  return { id, event, data: dataLines.join('\n') };
}
