'use client';

import { Eye, EyeOff, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { KEY_LABELS, KEY_NAMES, detectKeyName, maskKey, useSecretsStore, type KeyName } from '@/store/secrets';
import { useAppStore } from '@/store';

/**
 * BYOK 키 입력 (Spec §12.4, 사용자 요청으로 프로바이더별 고정 입력칸 대신
 * 단일 "AI API Key" 입력칸에서 붙여넣은 키의 프리픽스로 프로바이더를 자동 인식한다).
 * 키는 서버에 저장되지 않는다.
 */
export function KeysModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      toast('error', '어떤 서비스의 키인지 자동으로 인식하지 못했습니다. 아래에서 서비스를 직접 선택해주세요.');
      return;
    }
    setSecret(target, value);
    toast('success', `${KEY_LABELS[target].label} 키를 추가했습니다.`);
    setDraft('');
    setManualProvider('');
  }

  return (
    <Modal
      open={open}
      title="API Keys & 로컬 런타임"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="ac-btn !text-danger"
            onClick={() => { clearAll(); toast('success', '저장된 키를 모두 삭제했습니다.'); }}
          >
            모든 키 삭제
          </button>
          <button type="button" className="ac-btn ac-btn-primary" onClick={onClose}>완료</button>
        </>
      }
    >
      <div className="ac-note flex gap-2">
        <ShieldCheck size={16} className="mt-[2px] flex-none text-emerald" />
        <div>
          <b className="text-text-dim">AgentCanvas는 당신의 키를 서버에 저장하지 않습니다.</b>
          <br />
          키는 요청 헤더로만 전달되며 그래프 파일(`.acanvas.json`)·로그·디스크 어디에도 남지 않습니다.
          기본값은 이 탭을 닫으면 사라지는 세션 메모리입니다.
        </div>
      </div>

      <div>
        <label className="ac-label">AI API Key 추가</label>
        <div className="flex gap-2">
          <input
            type="text"
            className="ac-input flex-1"
            placeholder="발급받은 API 키를 붙여넣으세요 (sk-..., sk-ant-..., AIza..., gsk_...)"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setManualProvider(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="ac-btn ac-btn-primary flex-none" onClick={handleAdd}>
            추가
          </button>
        </div>
        {draft.trim() && (
          detected ? (
            <p className="ac-hint">
              <span className="ac-chip bg-emerald/15 text-log-ok">{KEY_LABELS[detected].label}</span> 키로 인식했습니다.
            </p>
          ) : (
            <div className="mt-[6px] flex items-center gap-2">
              <span className="ac-hint !mt-0">인식되지 않는 형식입니다. 서비스를 직접 선택하세요:</span>
              <select
                className="ac-input !w-auto py-[3px] text-t10_5"
                value={manualProvider}
                onChange={(e) => setManualProvider(e.target.value as KeyName | '')}
              >
                <option value="">선택...</option>
                {KEY_NAMES.map((name) => (
                  <option key={name} value={name}>{KEY_LABELS[name].label}</option>
                ))}
              </select>
            </div>
          )
        )}
      </div>

      {addedKeys.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <label className="ac-label">등록된 키</label>
          {addedKeys.map((name) => (
            <div key={name} className="flex items-center gap-2 rounded-lg border border-border-soft bg-surface-2 px-[10px] py-[7px]">
              <span className="ac-chip flex-none">{KEY_LABELS[name].label}</span>
              <span className="flex-1 truncate font-mono text-t11_5 text-text-dim">
                {shown[name] ? secrets[name] : maskKey(secrets[name] ?? '')}
              </span>
              <button
                type="button"
                className="flex-none text-text-faint hover:text-text"
                onClick={() => setShown((s) => ({ ...s, [name]: !s[name] }))}
                aria-label={shown[name] ? '키 숨기기' : '키 보기'}
              >
                {shown[name] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className="flex-none text-text-faint hover:text-danger"
                onClick={() => { setSecret(name, ''); toast('success', `${KEY_LABELS[name].label} 키를 삭제했습니다.`); }}
                aria-label={`${KEY_LABELS[name].label} 키 삭제`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <label className="ac-label">
          Ollama Base URL <span className="ac-badge bg-emerald/20 text-log-ok">로컬 · 무료</span>
        </label>
        <input
          type="text"
          className="ac-input"
          value={ollamaHost}
          placeholder="http://localhost:11434"
          onChange={(e) => setOllamaHost(e.target.value)}
        />
        <p className="ac-hint">키가 필요 없습니다. `ollama serve` 가 떠 있으면 모델 목록이 자동으로 채워집니다.</p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => setPersist(e.target.checked)}
          className="h-[15px] w-[15px] accent-indigo"
        />
        <span className="text-t12 font-semibold text-text-dim">
          이 브라우저에 저장 (공용 PC 에서는 권장하지 않습니다)
        </span>
      </label>
    </Modal>
  );
}
