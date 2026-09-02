'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useT, type TFunction } from '@/i18n/react';
import type { FieldSpec } from '../fieldSpec';
import { VarHighlightTextarea } from './VarHighlight';

interface FieldProps {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  /** 동적 옵션 (툴 목록 · Ollama 모델 등 서버에서 받아온 것) */
  dynamicOptions?: { value: string; label: string; hint?: string }[];
  invalid?: boolean;
  /** `spec.interpolatesVars` 필드의 `{var}` 하이라이팅 기준 (Input 노드 var_name 전체) */
  declaredVars?: Set<string>;
}

/** 아티팩트 `.field` 를 그대로 이식한 범용 필드 렌더러. */
export function Field({ spec, value, onChange, dynamicOptions, invalid, declaredVars }: FieldProps) {
  const t = useT();
  const options = dynamicOptions ?? spec.options ?? [];
  // 동적 옵션(서버가 준 툴/모델 목록)은 이미 사람이 읽는 문자열이고, 레지스트리
  // 옵션은 i18n 키다 — `t.k` 가 둘을 구분해 준다.
  const label = t.k(spec.label);
  const placeholder = t.k(spec.placeholder);
  const hint = t.k(spec.hint);

  if (spec.kind === 'toggle') {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-[15px] w-[15px] accent-indigo"
        />
        <span className="text-t12 font-semibold text-text-dim">{label}</span>
      </label>
    );
  }

  return (
    <div>
      <label className="ac-label">
        {label}
        {spec.required && <span className="ml-1 text-danger">*</span>}
      </label>
      {renderControl()}
      {hint && <p className="ac-hint">{hint}</p>}
    </div>
  );

  function renderControl() {
    const base = cn('ac-input', invalid && '!border-danger');
    switch (spec.kind) {
      case 'textarea':
      case 'code':
        if (spec.interpolatesVars) {
          return (
            <VarHighlightTextarea
              value={asText(value)}
              onChange={onChange}
              declaredVars={declaredVars ?? new Set()}
              placeholder={placeholder}
              rows={spec.rows ?? 3}
              monospace={spec.kind === 'code'}
              invalid={invalid}
            />
          );
        }
        return (
          <textarea
            className={cn(base, 'min-h-[64px] resize-y leading-snug', spec.kind === 'code' && 'font-mono text-t11_5')}
            rows={spec.rows ?? 3}
            placeholder={placeholder}
            value={asText(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'select':
        return (
          <select className={base} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {!options.some((o) => o.value === String(value ?? '')) && (
              <option value={String(value ?? '')}>{String(value ?? '') || t('field.selectPlaceholder')}</option>
            )}
            {options.map((o) => (
              <option key={o.value} value={o.value}>{t.k(o.label)}</option>
            ))}
          </select>
        );

      case 'combobox':
        return <Combobox value={asText(value)} options={options} onChange={onChange} placeholder={placeholder} invalid={invalid} />;

      case 'number':
        return (
          <input
            type="number"
            className={base}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            placeholder={placeholder}
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
        return <TagsInput values={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} t={t} />;

      case 'file':
        return (
          <div className="ac-note">
            {value ? t('field.fileUploaded', { name: String(value) }) : t('field.fileDisabled')}
          </div>
        );

      default:
        return (
          <input
            type="text"
            className={base}
            placeholder={placeholder}
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

function TagsInput({ values, onChange, t }: { values: string[]; onChange: (v: string[]) => void; t: TFunction }) {
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
              aria-label={t('field.tagsRemove', { value: v })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        className="ac-input"
        placeholder={t('field.tagsPlaceholder')}
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
