'use client';

import { Eye, EyeOff, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { KEY_NAMES, detectKeyName, keyLabel, maskKey, useSecretsStore, type KeyName } from '@/store/secrets';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';

/**
 * BYOK 키 입력 (Spec §12.4, 사용자 요청으로 프로바이더별 고정 입력칸 대신
 * 단일 "AI API Key" 입력칸에서 붙여넣은 키의 프리픽스로 프로바이더를 자동 인식한다).
 * 키는 서버에 저장되지 않는다.
 */
export function KeysModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { secrets, persist, ollamaHost, setSecret, setPersist, setOllamaHost, clearAll } = useSecretsStore();
  const toast = useAppStore((s) => s.toast);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const [manualProvider, setManualProvider] = useState<KeyName | ''>('');

  const detected = useMemo(() => detectKeyName(draft), [draft]);
  const addedKeys = KEY_NAMES.filter((name) => Boolean(secrets[name]?.trim()));

  function handleAdd() {
    const value = draft.trim();
    if (!value) return;
    const target = detected ?? (manualProvider || null);
    if (!target) {
      toast('error', t('keys.detectFailed'));
      return;
    }
    setSecret(target, value);
    toast('success', t('keys.added', { label: keyLabel(target) }));
    setDraft('');
    setManualProvider('');
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
          <input
            type="text"
            className="ac-input flex-1"
            placeholder={t('keys.addPlaceholder')}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setManualProvider(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="ac-btn ac-btn-primary flex-none" onClick={handleAdd}>
            {t('keys.addButton')}
          </button>
        </div>
        {draft.trim() && (
          detected ? (
            <p className="ac-hint">
              <span className="ac-chip bg-emerald/15 text-log-ok">{keyLabel(detected)}</span>{t('keys.detectedSuffix')}
            </p>
          ) : (
            <div className="mt-[6px] flex items-center gap-2">
              <span className="ac-hint !mt-0">{t('keys.manualPrompt')}</span>
              <select
                className="ac-input !w-auto py-[3px] text-t10_5"
                value={manualProvider}
                onChange={(e) => setManualProvider(e.target.value as KeyName | '')}
              >
                <option value="">{t('keys.manualPlaceholder')}</option>
                {KEY_NAMES.map((name) => (
                  <option key={name} value={name}>{keyLabel(name)}</option>
                ))}
              </select>
            </div>
          )
        )}
      </div>

      {addedKeys.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <label className="ac-label">{t('keys.registered')}</label>
          {addedKeys.map((name) => (
            <div key={name} className="flex items-center gap-2 rounded-lg border border-border-soft bg-surface-2 px-[10px] py-[7px]">
              <span className="ac-chip flex-none">{keyLabel(name)}</span>
              <span className="flex-1 truncate font-mono text-t11_5 text-text-dim">
                {shown[name] ? secrets[name] : maskKey(secrets[name] ?? '')}
              </span>
              <button
                type="button"
                className="flex-none text-text-faint hover:text-text"
                onClick={() => setShown((s) => ({ ...s, [name]: !s[name] }))}
                aria-label={shown[name] ? t('keys.hide') : t('keys.show')}
              >
                {shown[name] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className="flex-none text-text-faint hover:text-danger"
                onClick={() => { setSecret(name, ''); toast('success', t('keys.removed', { label: keyLabel(name) })); }}
                aria-label={t('keys.delete', { label: keyLabel(name) })}
              >
                <X size={14} />
              </button>
            </div>
          ))}
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
