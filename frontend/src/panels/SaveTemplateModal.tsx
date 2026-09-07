'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/react';
import { Modal } from './Modal';

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * @param asNew `true` 면 `existing` 이 있어도 새 템플릿으로 만든다 ("다른 이름으로 저장").
   */
  onSave: (name: string, description: string, asNew: boolean) => void;
  /**
   * 지금 캔버스가 갤러리의 어떤 템플릿에서 왔다면 그 이름/설명(내장 템플릿 포함).
   * 있으면 모달이 "다른 이름으로 저장" 모드로 열린다.
   */
  existing?: { id: string; name: string; description: string } | null;
  /**
   * 출처 템플릿이 없을 때(첫 저장) 이름 칸에 미리 채울 값 — 헤더의 캔버스 이름.
   * 방금 이름을 지어 둔 사용자에게 빈 칸을 내밀지 않기 위한 것이다.
   */
  defaultName?: string;
}

/**
 * 템플릿의 **이름·설명**을 다루는 모달(`templates/custom.ts`).
 *
 * 캔버스 내용 덮어쓰기는 헤더 Save 가 모달 없이 처리한다(워드의 Ctrl+S). 그래서
 * 이 모달이 열리는 경우는 둘뿐이다 — ① 아직 저장된 적 없는 캔버스의 첫 저장,
 * ② 헤더 "Edit" 으로 연 템플릿의 이름·설명 고치기. ②에서는 기본 동작이
 * **업데이트**이고, 원본을 두고 사본을 뜨고 싶을 때 "다른 이름으로 저장" 을
 * 명시적으로 고른다(반대로 두면 실수로 원본을 날린다).
 */
export function SaveTemplateModal({ open, onClose, onSave, existing, defaultName = '' }: SaveTemplateModalProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // 모달을 열 때마다 출처 템플릿 기준으로 채운다. 닫힌 동안 사용자가 다른 템플릿을
  // 불러왔을 수 있으므로 `open` 이 바뀔 때 다시 맞춘다.
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? defaultName);
    setDescription(existing?.description ?? '');
  }, [open, existing?.id, existing?.name, existing?.description, defaultName]);

  function submit(asNew: boolean) {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, description.trim(), asNew);
    onClose();
  }

  const isUpdate = Boolean(existing);

  return (
    <Modal
      open={open}
      title={isUpdate ? t('templates.editTitle') : t('header.save')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ac-tbtn" onClick={onClose}>{t('common.cancel')}</button>
          {isUpdate && (
            <button type="button" className="ac-tbtn" disabled={!name.trim()} onClick={() => submit(true)}>
              {t('templates.saveAsNew')}
            </button>
          )}
          <button type="button" className="ac-run-btn" disabled={!name.trim()} onClick={() => submit(!isUpdate)}>
            {isUpdate ? t('templates.updateConfirm') : t('templates.saveConfirm')}
          </button>
        </>
      }
    >
      <p className="ac-hint !mt-0">
        {isUpdate
          ? t('templates.updateHint', { name: existing?.name ?? '' })
          : t('header.saveTemplateTitle')}
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-t10_5 font-semibold text-text-dim">{t('templates.saveNamePlaceholder')}</span>
        <input
          type="text"
          className="ac-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(!isUpdate); }}
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
