'use client';

import { AlertTriangle, UserRoundCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Modal } from './Modal';
import { RunApiError, submitHumanResponse } from '@/run/client';
import { useAppStore } from '@/store';

/**
 * Human-in-the-loop 모달 (Spec §5.10, M3-T10).
 *
 * ⚠️ 이 모달이 떠 있는 동안 **백엔드 크루 스레드는 블로킹된 상태**다. 그래서
 *    두 가지가 UI 계약이다.
 *
 *    1. 남은 시간을 실제로 보여준다. 응답하지 않으면 백엔드가 Human 노드의
 *       `on_timeout` 설정대로 중단하거나 승인 처리한다 — 사용자가 그 사실을
 *       모르면 "왜 갑자기 실패했지"가 된다.
 *    2. 그냥 닫을 수 없다. 닫아도 백엔드는 계속 기다리는데 다시 열 방법이
 *       없어지므로, 닫기는 안내만 하고 모달을 유지한다. 정말 그만두려면
 *       헤더의 Stop(취소) 을 쓴다 — 취소는 대기 중인 스레드를 즉시 깨운다.
 *
 * 버튼이 둘인 이유(CrewAI 네이티브 계약, docs/CREWAI_RECON.md F16-b):
 * 빈 응답 = 승인하고 진행, 비어 있지 않은 응답 = 수정 요청 → 에이전트가 그
 * 피드백을 반영해 다시 실행하고 **같은 노드로 다시 물어본다**(다회차 루프).
 */
export function HumanInputModal() {
  const request = useAppStore((s) => s.humanRequest);
  const runId = useAppStore((s) => s.runId);
  const clearHumanRequest = useAppStore((s) => s.clearHumanRequest);
  const toast = useAppStore((s) => s.toast);

  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 요청이 바뀔 때마다(다회차 검토 포함) 입력값과 카운트다운 기준 시각을 초기화한다.
  useEffect(() => {
    if (!request) return;
    setFeedback('');
    setSending(false);
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [request]);

  // ⚠️ 남은 시간은 **렌더 중에 계산**한다. state 로 두면 첫 렌더의 초깃값(0)이
  //    아래 자동 닫기 effect 에 그대로 걸려 모달이 뜨자마자 사라진다(실제로 겪음).
  const remaining = request
    ? Math.max(0, Math.min(request.timeoutS, request.timeoutS - Math.floor((now - request.requestedAt) / 1000)))
    : 0;

  // 시간이 다 되면 백엔드가 이미 스스로 판단했다 — 모달을 닫아 준다.
  // (결과는 `log`/`run.failed` 이벤트로 이어서 표시된다.)
  useEffect(() => {
    if (request && remaining === 0) clearHumanRequest();
  }, [request, remaining, clearHumanRequest]);

  const send = useCallback(
    async (response: string) => {
      if (!request || !runId || sending) return;
      setSending(true);
      try {
        await submitHumanResponse(runId, request.nodeId, response);
        clearHumanRequest();
        toast('success', response.trim() === '' ? '검토를 승인했습니다.' : '수정 요청을 보냈습니다.');
      } catch (err) {
        setSending(false);
        const message =
          err instanceof RunApiError ? `[${err.code}] ${err.message}` : '응답을 전송하지 못했습니다.';
        toast('error', message, true);
        // AC-E508 = 이미 타임아웃/처리된 요청. 모달을 계속 띄워 두면 거짓말이 된다.
        if (err instanceof RunApiError && err.code === 'AC-E508') clearHumanRequest();
      }
    },
    [request, runId, sending, clearHumanRequest, toast],
  );

  if (!request) return null;

  const urgent = remaining <= 30;

  return (
    <Modal
      open
      title="사람 검토 대기 중"
      onClose={() =>
        toast('info', '응답하거나 헤더의 Stop 으로 실행을 취소해야 진행됩니다 — 백엔드가 대기 중입니다.')
      }
      footer={
        <>
          <button
            type="button"
            className="ac-btn"
            disabled={sending || !feedback.trim()}
            onClick={() => void send(feedback)}
          >
            수정 요청 보내기
          </button>
          <button
            type="button"
            className="ac-btn ac-btn-primary"
            disabled={sending}
            onClick={() => void send('')}
          >
            승인하고 계속
          </button>
        </>
      }
    >
      <div className="ac-note flex gap-2">
        <UserRoundCheck size={16} className="mt-[2px] flex-none text-human" />
        <div className="whitespace-pre-wrap text-text-dim">{request.prompt}</div>
      </div>

      <div
        className={`flex items-center gap-2 text-t11_5 ${urgent ? 'text-danger' : 'text-text-faint'}`}
        role="status"
        aria-live="polite"
      >
        {urgent && <AlertTriangle size={14} className="flex-none" />}
        <span>
          남은 시간 {formatRemaining(remaining)} — 응답이 없으면 Human Input 노드의 “시간 초과 시”
          설정대로 처리됩니다.
        </span>
      </div>

      <div>
        <label className="ac-label" htmlFor="human-feedback">
          수정 요청 (선택)
        </label>
        <textarea
          id="human-feedback"
          className="ac-textarea w-full"
          rows={4}
          placeholder="비워 두고 '승인하고 계속'을 누르면 그대로 진행합니다. 내용을 적고 '수정 요청 보내기'를 누르면 에이전트가 이 피드백을 반영해 다시 실행한 뒤 한 번 더 물어봅니다."
          value={feedback}
          disabled={sending}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}분 ${String(s).padStart(2, '0')}초` : `${s}초`;
}
