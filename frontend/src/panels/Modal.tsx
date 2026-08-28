'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** 아티팩트 `.overlay` / `.modal` 이식. Esc 닫기 + 포커스 트랩 (Spec §17.2). */
export function Modal({ open, title, wide, onClose, children, footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const focusables = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-overlay backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'flex max-h-[84vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-4xl',
          'border border-border bg-surface shadow-modal',
          wide && 'w-[760px]',
        )}
      >
        <div className="flex flex-none items-center gap-[10px] border-b border-border-soft px-5 py-4">
          <h3 className="m-0 font-display text-t15 font-bold text-text">{title}</h3>
          <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto p-1 text-text-faint hover:text-text">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-[14px] overflow-y-auto px-5 py-[18px]">{children}</div>
        {footer && (
          <div className="flex flex-none justify-end gap-[10px] border-t border-border-soft px-5 py-[14px]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
