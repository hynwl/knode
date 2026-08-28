'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store';

/** 아티팩트 `.toast` 이식. 우하단 스택. 에러는 수동으로 닫을 때까지 유지. */
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-12 left-1/2 z-toast flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-center gap-3 rounded-pill border bg-surface-3 px-4 py-[9px]',
            'text-t12_5 font-semibold shadow-toast',
            t.kind === 'error' ? 'border-danger/50 text-danger'
              : t.kind === 'success' ? 'border-emerald/50 text-log-ok'
              : 'border-border text-text',
          )}
        >
          {t.message}
          <button type="button" onClick={() => dismiss(t.id)} aria-label="알림 닫기" className="opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
