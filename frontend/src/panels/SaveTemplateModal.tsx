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
   * 지금 캔버스가 이미 저장된 커스텀 템플릿에서 왔다면 그 이름/설명.
   * 있으면 모달이 "덮어쓰기" 모드로 열린다.
   */
  existing?: { id: string; name: string; description: string } | null;
}

/**
 * 헤더 "Save" 버튼 → 현재 캔버스를 커스텀 템플릿으로 저장한다(`templates/custom.ts`).
 *
 * **저장과 덮어쓰기를 구분한다.** 예전엔 이미 저장한 템플릿을 열어 고친 뒤 Save 를
 * 눌러도 빈 이름 칸이 떠서, 사용자는 같은 것을 고쳤는데도 이름을 다시 짓고 갤러리에
 * 사본을 하나 더 만들게 됐다. 출처 템플릿이 있으면 이름·설명을 미리 채우고 기본
 * 동작을 **덮어쓰기**로 둔다 — 사본이 필요하면 "다른 이름으로 저장" 으로 명시적으로
 * 고른다(반대로 두면 실수로 원본을 날린다).
 */
export function SaveTemplateModal({ open, onClose, onSave, existing }: SaveTemplateModalProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // 모달을 열 때마다 출처 템플릿 기준으로 채운다. 닫힌 동안 사용자가 다른 템플릿을
  // 불러왔을 수 있으므로 `open` 이 바뀔 때 다시 맞춘다.
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
  }, [open, existing?.id, existing?.name, existing?.description]);

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
      title={isUpdate ? t('templates.updateTitle') : t('header.save')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ac-tbtn" onClick={onClose}>{t('common.cancel')}</button>
          {isUpdate && (
            <button type="button" className="ac-tbtn" disabled={!name.trim()} onClick={() => submit(true)}>
              {t('templates.saveAsNew')}
            </button>
          )}
          <button type="button" className="ac-run-btn" disabled={!name.trim()} onClick={() => submit(false)}>
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
          onKeyDown={(e) => { if (e.key === 'Enter') submit(false); }}
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
