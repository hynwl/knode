'use client';

import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n/react';
import { VAR_PATTERN } from '@/validation/rules';

interface VarHighlightTextareaProps {
  value: string;
  onChange: (v: string) => void;
  /** 캔버스의 Input 노드 `var_name` 전체. 강조 색을 정의/미정의로 나누는 기준. */
  declaredVars: Set<string>;
  placeholder?: string;
  rows?: number;
  monospace?: boolean;
  invalid?: boolean;
}

/**
 * `{var}` 보간을 실시간 하이라이팅하는 텍스트에어리어 (Spec §5.8 동작 흐름 1~2).
 * 표준 "투명 텍스트에어리어 + 배후 하이라이트 레이어" 트릭 — 실제 글자는 이
 * 오버레이 `<div>` 가 전부 그리고, 그 위(DOM 순서상 나중)에 겹친 `<textarea>`
 * 는 글자색을 투명으로 지워 캐럿/선택영역/실제 입력만 받는다. 두 레이어가
 * `.ac-input` 을 그대로 공유해야 패딩·폰트가 1px 도 안 어긋난다.
 */
export function VarHighlightTextarea({
  value, onChange, declaredVars, placeholder, rows = 3, monospace, invalid,
}: VarHighlightTextareaProps) {
  const t = useT();
  const overlayRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const undefinedVarTitle = t('field.varUndefined');

  const syncScroll = () => {
    if (!overlayRef.current || !taRef.current) return;
    overlayRef.current.scrollTop = taRef.current.scrollTop;
    overlayRef.current.scrollLeft = taRef.current.scrollLeft;
  };

  return (
    <div className="relative">
      <div
        ref={overlayRef}
        aria-hidden
        className={cn(
          'ac-input pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words',
          '!border-transparent !bg-transparent',
          monospace && 'font-mono text-t11_5',
        )}
      >
        {highlight(value, declaredVars, undefinedVarTitle)}
      </div>
      <textarea
        ref={taRef}
        className={cn(
          'ac-input relative min-h-[64px] resize-y bg-transparent leading-snug text-transparent caret-text',
          monospace && 'font-mono text-t11_5',
          invalid && '!border-danger',
        )}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
      />
    </div>
  );
}

function highlight(text: string, declaredVars: Set<string>, undefinedTitle: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(VAR_PATTERN)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const name = m[1]!;
    const defined = declaredVars.has(name);
    nodes.push(
      <span
        key={key++}
        className={cn(
          'rounded-[3px]',
          defined
            ? 'bg-indigo/25 text-indigo'
            : 'text-amber underline decoration-amber decoration-wavy underline-offset-[3px]',
        )}
        title={defined ? undefined : undefinedTitle}
      >
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
