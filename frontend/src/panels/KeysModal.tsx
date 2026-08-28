'use client';

import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Modal } from './Modal';
import { KEY_LABELS, KEY_NAMES, useSecretsStore, type KeyName } from '@/store/secrets';
import { useAppStore } from '@/store';

/** BYOK 키 입력 (Spec §12.4). 키는 서버에 저장되지 않는다. */
export function KeysModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { secrets, persist, ollamaHost, setSecret, setPersist, setOllamaHost, clearAll } = useSecretsStore();
  const toast = useAppStore((s) => s.toast);
  const [shown, setShown] = useState<Record<string, boolean>>({});

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

      {KEY_NAMES.map((name: KeyName) => (
        <div key={name}>
          <label className="ac-label">{KEY_LABELS[name].label}</label>
          <div className="relative">
            <input
              type={shown[name] ? 'text' : 'password'}
              className="ac-input pr-9"
              placeholder={KEY_LABELS[name].placeholder}
              value={secrets[name] ?? ''}
              onChange={(e) => setSecret(name, e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint hover:text-text"
              onClick={() => setShown((s) => ({ ...s, [name]: !s[name] }))}
              aria-label={shown[name] ? '키 숨기기' : '키 보기'}
            >
              {shown[name] ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      ))}

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
