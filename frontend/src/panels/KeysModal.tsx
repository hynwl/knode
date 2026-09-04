'use client';

import { Eye, EyeOff, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import {
  KEY_NAMES, detectKeyName, filledSlots, keyLabel, maskKey, slotLabel,
  useSecretsStore, type KeyName,
} from '@/store/secrets';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';

/**
 * BYOK 키 입력 (Spec §12.4).
 *
 * 프로바이더별 고정 입력칸 대신 **붙여넣기 한 칸 + 서비스 선택**이다 — 붙여넣은
 * 키의 프리픽스로 서비스를 자동 인식하되, 인식 결과는 언제든 바꿀 수 있게 열어
 * 둔다(자체 호스팅 엔드포인트 키는 `sk-` 로 시작해도 OpenAI 본계정 키가 아니다).
 *
 * 같은 서비스의 키를 여러 개 등록할 수 있고(“키 슬롯”), LLM 블록은 그 슬롯을
 * 이름으로 고른다. 키 값 자체는 서버에도, 그래프 파일에도 저장되지 않는다.
 */
export function KeysModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const {
    slots, persist, ollamaHost, addSlot, removeSlot, setPersist, setOllamaHost, clearAll,
  } = useSecretsStore();
  const toast = useAppStore((s) => s.toast);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const [provider, setProvider] = useState<KeyName | ''>('');
  const [alias, setAlias] = useState('');
  // 입력칸도 §12.4 MUST 대로 `password` + 눈 아이콘이다. 붙여넣기 사고를 눈으로
  // 확인할 수 있어야 해서 토글을 같이 둔다.
  const [showDraft, setShowDraft] = useState(false);

  const detected = useMemo(() => detectKeyName(draft), [draft]);
  const target: KeyName | '' = provider || detected || '';
  const registered = filledSlots(slots);
  // 같은 서비스의 두 번째 키부터는 별칭을 받는다 — 목록에서도 노드 드롭다운에서도
  // 이름이 같으면 어느 키를 고르는 건지 알 수 없기 때문이다.
  const needsAlias = Boolean(target) && registered.some((s) => s.keyName === target);

  function handleAdd() {
    const value = draft.trim();
    if (!value) return;
    if (!target) {
      toast('error', t('keys.detectFailed'));
      return;
    }
    if (needsAlias && !alias.trim()) {
      toast('error', t('keys.aliasRequired', { label: keyLabel(target) }));
      return;
    }
    addSlot(target, value, alias);
    toast('success', t('keys.added', { label: alias.trim() || keyLabel(target) }));
    setDraft('');
    setProvider('');
    setAlias('');
  }

  return (
    <Modal
      open={open}
      title={t('keys.title')}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="ac-btn !text-danger"
            onClick={() => { clearAll(); toast('success', t('keys.clearedAll')); }}
          >
            {t('keys.clearAll')}
          </button>
          <button type="button" className="ac-btn ac-btn-primary" onClick={onClose}>{t('keys.done')}</button>
        </>
      }
    >
      <div className="ac-note flex gap-2">
        <ShieldCheck size={16} className="mt-[2px] flex-none text-emerald" />
        <div>
          <b className="text-text-dim">{t('keys.noticeTitle')}</b>
          <br />
          {t('keys.noticeBody')}
        </div>
      </div>

      <div>
        <label className="ac-label">{t('keys.addLabel')}</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showDraft ? 'text' : 'password'}
              className="ac-input !pr-8"
              placeholder={t('keys.addPlaceholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint hover:text-text"
              onClick={() => setShowDraft((v) => !v)}
              aria-label={showDraft ? t('keys.hide') : t('keys.show')}
            >
              {showDraft ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button type="button" className="ac-btn ac-btn-primary flex-none" onClick={handleAdd}>
            {t('keys.addButton')}
          </button>
        </div>

        {draft.trim() && (
          <div className="mt-[6px] flex flex-col gap-[6px]">
            <div className="flex items-center gap-2">
              <span className="ac-hint !mt-0 flex-none">{t('keys.providerLabel')}</span>
              <select
                className="ac-input !w-auto py-[3px] text-t10_5"
                value={target}
                onChange={(e) => setProvider(e.target.value as KeyName | '')}
              >
                <option value="">{t('keys.manualPlaceholder')}</option>
                {KEY_NAMES.map((name) => (
                  <option key={name} value={name}>{keyLabel(name)}</option>
                ))}
              </select>
              {detected && provider === '' && (
                <span className="ac-chip bg-emerald/15 text-log-ok">{t('keys.autoDetected')}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="ac-hint !mt-0 flex-none">
                {needsAlias ? t('keys.aliasLabelRequired') : t('keys.aliasLabel')}
              </span>
              <input
                type="text"
                className="ac-input !w-[180px] py-[3px] text-t10_5"
                placeholder={t('keys.aliasPlaceholder')}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                autoComplete="off"
              />
            </div>
            <p className="ac-hint !mt-0">{t('keys.aliasHint')}</p>
          </div>
        )}
      </div>

      {registered.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <label className="ac-label">{t('keys.registered')}</label>
          {registered.map((slot) => (
            <div key={slot.id} className="flex items-center gap-2 rounded-lg border border-border-soft bg-surface-2 px-[10px] py-[7px]">
              <span className="ac-chip flex-none">{keyLabel(slot.keyName)}</span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-t11_5 font-semibold text-text-dim">{slot.label || slot.id}</span>
                <span className="truncate font-mono text-t10 text-text-faint">
                  {shown[slot.id] ? slot.value : maskKey(slot.value)}
                </span>
              </div>
              <button
                type="button"
                className="flex-none text-text-faint hover:text-text"
                onClick={() => setShown((s) => ({ ...s, [slot.id]: !s[slot.id] }))}
                aria-label={shown[slot.id] ? t('keys.hide') : t('keys.show')}
              >
                {shown[slot.id] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className="flex-none text-text-faint hover:text-danger"
                onClick={() => {
                  removeSlot(slot.id);
                  toast('success', t('keys.removed', { label: slotLabel(slot) }));
                }}
                aria-label={t('keys.delete', { label: slotLabel(slot) })}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <p className="ac-hint !mt-0">{t('keys.slotRefHint')}</p>
        </div>
      )}

      <div>
        <label className="ac-label">
          {t('keys.ollamaLabel')} <span className="ac-badge bg-emerald/20 text-log-ok">{t('keys.ollamaBadge')}</span>
        </label>
        <input
          type="text"
          className="ac-input"
          value={ollamaHost}
          placeholder="http://localhost:11434"
          onChange={(e) => setOllamaHost(e.target.value)}
        />
        <p className="ac-hint">{t('keys.ollamaHint')}</p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => setPersist(e.target.checked)}
          className="h-[15px] w-[15px] accent-indigo"
        />
        <span className="text-t12 font-semibold text-text-dim">
          {t('keys.persist')}
        </span>
      </label>
    </Modal>
  );
}
