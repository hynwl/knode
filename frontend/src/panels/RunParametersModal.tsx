'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Field } from '@/nodes/fields';
import type { FieldKind, FieldSpec } from '@/nodes/fieldSpec';
import { useAppStore } from '@/store';
import { loadLastInputs, saveLastInputs } from '@/persistence/localStorage';
import { useT } from '@/i18n/react';

interface RunParametersModalProps {
  open: boolean;
  /** Dry Run(Spec §11.3) 진입이면 제목/버튼 문구를 바꿔 실제 실행과 헷갈리지 않게 한다. */
  dryRun?: boolean;
  onClose: () => void;
  onSubmit: (inputs: Record<string, string>) => void;
}

const INPUT_TYPE_TO_FIELD_KIND: Record<string, FieldKind> = {
  text: 'text', textarea: 'textarea', number: 'number', select: 'select', file: 'file',
};

/**
 * Queue Prompt 클릭 시 Input 노드가 1개 이상이면 먼저 뜨는 실행 파라미터 모달
 * (Spec §5.8 동작 흐름 3~5). 값은 `nodes/fields`의 `Field` 렌더러를 그대로
 * 재사용한다 — Input 노드의 `input_type` 이 `FieldKind` 어휘와 겹치므로 별도
 * 폼 UI를 새로 만들지 않는다.
 */
export function RunParametersModal({ open, dryRun, onClose, onSubmit }: RunParametersModalProps) {
  const t = useT();
  const canvasId = useAppStore((s) => s.canvasId);
  const nodes = useAppStore((s) => s.nodes);
  const inputNodes = useMemo(
    () => nodes
      .filter((n) => n.type === 'input')
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x),
    [nodes],
  );

  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const last = loadLastInputs(canvasId);
    const next: Record<string, string> = {};
    for (const n of inputNodes) {
      const varName = String(n.data.var_name ?? '');
      if (!varName) continue;
      next[varName] = last[varName] ?? String(n.data.default_value ?? '');
    }
    setValues(next);
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canvasId]);

  if (!open) return null;

  const isMissing = (n: (typeof inputNodes)[number]) => {
    const varName = String(n.data.var_name ?? '');
    return Boolean(n.data.required) && !String(values[varName] ?? '').trim();
  };

  function handleSubmit() {
    if (inputNodes.some(isMissing)) {
      setSubmitted(true);
      return;
    }
    saveLastInputs(canvasId, values);
    onSubmit(values);
  }

  return (
    <Modal
      open={open}
      title={dryRun ? t('runparams.titleDryRun') : t('runparams.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ac-tbtn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="ac-run-btn" onClick={handleSubmit}>
            {dryRun ? t('runparams.submitDryRun') : t('runparams.submit')}
          </button>
        </>
      }
    >
      <p className="text-t11_5 leading-normal text-text-faint">
        {t('runparams.intro')}
        {dryRun && t('runparams.introDryRun')}
      </p>
      {inputNodes.map((n) => {
        const varName = String(n.data.var_name ?? '');
        const spec: FieldSpec = {
          key: varName,
          label: String(n.data.label ?? varName) || varName,
          kind: INPUT_TYPE_TO_FIELD_KIND[String(n.data.input_type ?? 'text')] ?? 'text',
          required: Boolean(n.data.required),
          hint: n.data.description ? String(n.data.description) : undefined,
          options: Array.isArray(n.data.options)
            ? (n.data.options as string[]).map((v) => ({ value: v, label: v }))
            : undefined,
          placeholder: `{${varName}}`,
        };
        return (
          <Field
            key={n.id}
            spec={spec}
            value={values[varName] ?? ''}
            invalid={submitted && isMissing(n)}
            onChange={(v) => setValues((prev) => ({ ...prev, [varName]: String(v ?? '') }))}
          />
        );
      })}
    </Modal>
  );
}
