'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';

/**
 * 토스트 종류별 아이콘 — 종류를 **색으로만** 전달하지 않기 위한 것이다
 * (Spec §17.2 MUST, 색약 대응). 이전에는 테두리/글자 색만 달랐다.
 */
const TOAST_ICON = { error: XCircle, success: CheckCircle2, info: Info } as const;

/** 아티팩트 `.toast` 이식. 우하단 스택. 에러는 수동으로 닫을 때까지 유지. */
export function ToastHost() {
  const t = useT();
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-12 left-1/2 z-toast flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => {
        const kind = toast.kind === 'error' || toast.kind === 'success' ? toast.kind : 'info';
        const Icon = TOAST_ICON[kind];
        return (
          <div
            key={toast.id}
            // 에러는 보조기술이 **즉시** 읽어야 한다 — `status`(polite)면 사용자가
            // 입력을 멈출 때까지 밀린다. 나머지는 polite 로 두어 낭독을 안 끊는다.
            role={kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-center gap-3 rounded-pill border bg-surface-3 px-4 py-[9px]',
              'text-t12_5 font-semibold shadow-toast',
              toast.kind === 'error' ? 'border-danger/50 text-danger'
                : toast.kind === 'success' ? 'border-emerald/50 text-log-ok'
                : 'border-border text-text',
            )}
          >
            <Icon size={13} strokeWidth={2.4} role="img" className="flex-none" aria-label={t(`toast.kind.${kind}`)} />
            {toast.message}
            <button type="button" onClick={() => dismiss(toast.id)} aria-label={t('toast.dismiss')} className="opacity-60 hover:opacity-100">
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
