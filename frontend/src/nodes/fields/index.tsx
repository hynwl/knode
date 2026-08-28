'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { FieldSpec } from '../fieldSpec';

interface FieldProps {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  /** 동적 옵션 (툴 목록 · Ollama 모델 등 서버에서 받아온 것) */
  dynamicOptions?: { value: string; label: string; hint?: string }[];
  invalid?: boolean;
}

/** 아티팩트 `.field` 를 그대로 이식한 범용 필드 렌더러. */
export function Field({ spec, value, onChange, dynamicOptions, invalid }: FieldProps) {
  const options = dynamicOptions ?? spec.options ?? [];

  if (spec.kind === 'toggle') {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-[15px] w-[15px] accent-indigo"
        />
        <span className="text-t12 font-semibold text-text-dim">{spec.label}</span>
      </label>
    );
  }

  return (
    <div>
      <label className="ac-label">
        {spec.label}
        {spec.required && <span className="ml-1 text-danger">*</span>}
      </label>
      {renderControl()}
      {spec.hint && <p className="ac-hint">{spec.hint}</p>}
    </div>
  );

  function renderControl() {
    const base = cn('ac-input', invalid && '!border-danger');
    switch (spec.kind) {
      case 'textarea':
      case 'code':
        return (
          <textarea
            className={cn(base, 'min-h-[64px] resize-y leading-snug', spec.kind === 'code' && 'font-mono text-t11_5')}
            rows={spec.rows ?? 3}
            placeholder={spec.placeholder}
            value={asText(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'select':
        return (
          <select className={base} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {!options.some((o) => o.value === String(value ?? '')) && (
              <option value={String(value ?? '')}>{String(value ?? '선택하세요')}</option>
            )}
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );

      case 'combobox':
        return <Combobox value={asText(value)} options={options} onChange={onChange} placeholder={spec.placeholder} invalid={invalid} />;

      case 'number':
        return (
          <input
            type="number"
            className={base}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            placeholder={spec.placeholder}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
        );

      case 'slider':
        return (
          <div className="flex items-center gap-[10px]">
            <input
              type="range"
              className="flex-1 accent-indigo"
              min={spec.min ?? 0}
              max={spec.max ?? 1}
              step={spec.step ?? 0.05}
              value={Number(value ?? 0)}
              onChange={(e) => onChange(Number(e.target.value))}
            />
            <span className="w-[34px] text-right font-mono text-t11_5 text-text-dim">
              {Number(value ?? 0).toFixed(2)}
            </span>
          </div>
        );

      case 'tags':
        return <TagsInput values={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;

      case 'file':
        return (
          <div className="ac-note">
            {value ? `업로드됨: ${String(value)}` : '파일 업로드는 백엔드 연결 후 사용할 수 있습니다.'}
          </div>
        );

      default:
        return (
          <input
            type="text"
            className={base}
            placeholder={spec.placeholder}
            value={asText(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  }
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

/** 프리셋 목록 + 자유 입력 (Spec §5.3 model 필드) */
function Combobox({
  value, options, onChange, placeholder, invalid,
}: {
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const filtered = options.filter((o) => o.value.toLowerCase().includes(value.toLowerCase()));
  return (
    <div className="relative">
      <input
        type="text"
        className={cn('ac-input', invalid && '!border-danger')}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-dropdown mt-1 max-h-[220px] w-full overflow-y-auto rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown">
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className="flex w-full flex-col rounded-md px-2 py-[6px] text-left text-t12 text-text-dim hover:bg-surface-2 hover:text-text"
              onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              {o.hint && <span className="font-mono text-t9_5 text-text-faint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TagsInput({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="ac-chip">
            {v}
            <button
              type="button"
              className="ml-1 text-text-faint hover:text-danger"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              aria-label={`${v} 삭제`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        className="ac-input"
        placeholder="입력 후 Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            onChange([...values, draft.trim()]);
            setDraft('');
          }
        }}
      />
    </div>
  );
}
