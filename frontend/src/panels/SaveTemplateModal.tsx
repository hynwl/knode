'use client';

import { useState } from 'react';
import { useT } from '@/i18n/react';
import { Modal } from './Modal';

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}

/**
 * 헤더 "Save" 버튼 → 현재 캔버스를 이름/설명과 함께 커스텀 템플릿으로 저장한다.
 * 저장된 템플릿은 Templates 갤러리에 바로 나타난다(`templates/custom.ts`).
 */
export function SaveTemplateModal({ open, onClose, onSave }: SaveTemplateModalProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, description.trim());
    setName('');
    setDescription('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('header.save')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ac-tbtn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="ac-run-btn" disabled={!name.trim()} onClick={submit}>
            {t('templates.saveConfirm')}
          </button>
        </>
      }
    >
      <p className="ac-hint !mt-0">{t('header.saveTemplateTitle')}</p>
      <label className="flex flex-col gap-1">
        <span className="text-t10_5 font-semibold text-text-dim">{t('templates.saveNamePlaceholder')}</span>
        <input
          type="text"
          className="ac-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-t10_5 font-semibold text-text-dim">{t('templates.saveDescPlaceholder')}</span>
        <textarea
          className="ac-textarea"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
    </Modal>
  );
}
