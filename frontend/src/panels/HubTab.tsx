'use client';

import { GitFork, Loader2, Lock, Star } from 'lucide-react';
import { useState } from 'react';
import { hubThumbnailUrl, type HubTeamEntry } from '@/templates/hub';
import { keyLabel } from '@/store/secrets';
import { useT } from '@/i18n/react';

/**
 * 갤러리 모달의 "Hub" 탭 (M5-T7 · WORK_PLAN §5.6 P1).
 *
 * `TemplatesModal` 이 `hubStatus.available` 일 때만 이 컴포넌트를 마운트한다 —
 * 레지스트리 미설정/오프라인이면 이 파일 자체가 렌더 트리에 들어오지 않는다
 * (P-D3, 탭이 "빈 상태로 보이는" 게 아니라 "아예 없어야" 한다).
 */
export function HubTab({
  teams, availableKeys, onFork,
}: {
  teams: HubTeamEntry[];
  availableKeys: string[];
  onFork: (entry: HubTeamEntry) => Promise<void>;
}) {
  const t = useT();
  const have = new Set(availableKeys);

  if (teams.length === 0) {
    return <p className="ac-hint">{t('hub.empty')}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {teams.map((entry) => (
        <HubCard key={entry.slug} entry={entry} missingKeys={entry.meta.requires_keys.filter((k) => !have.has(k))} onFork={onFork} />
      ))}
    </div>
  );
}

function HubCard({
  entry, missingKeys, onFork,
}: {
  entry: HubTeamEntry;
  missingKeys: string[];
  onFork: (entry: HubTeamEntry) => Promise<void>;
}) {
  const t = useT();
  const [forking, setForking] = useState(false);
  const thumb = hubThumbnailUrl(entry);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-3">
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- 외부 레지스트리 정적 파일, Next Image 최적화 대상 아님
        <img
          src={thumb}
          alt=""
          className="aspect-[16/9] w-full rounded-xl border border-border-soft object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-t13 font-bold text-text">{entry.name}</span>
        {entry.meta.difficulty && (
          <span className="flex flex-none items-center gap-[1px]" title={t('templates.difficulty', { level: entry.meta.difficulty })}>
            {[1, 2, 3].map((i) => (
              <Star
                key={i}
                size={10}
                strokeWidth={2}
                className={i <= entry.meta.difficulty! ? 'text-amber' : 'text-text-faint/30'}
                fill={i <= entry.meta.difficulty! ? 'currentColor' : 'none'}
              />
            ))}
          </span>
        )}
      </div>

      {entry.description && <p className="m-0 text-t11 leading-snug text-text-dim">{entry.description}</p>}

      <div className="flex flex-wrap items-center gap-[5px]">
        {entry.author && <span className="ac-chip">{t('hub.byAuthor', { author: entry.author })}</span>}
        {entry.meta.requires_keys.length === 0 && <span className="ac-chip">{t('templates.noKeys')}</span>}
        {entry.meta.requires_keys.map((k) => (
          <span
            key={k}
            className={`ac-chip ${missingKeys.includes(k) ? 'opacity-60' : '!border-emerald/50 !text-emerald'}`}
          >
            {missingKeys.includes(k) && <Lock size={9} strokeWidth={2.6} />}
            {keyLabel(k)}
          </span>
        ))}
        {entry.tags.map((tag) => <span key={tag} className="ac-chip">{tag}</span>)}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={forking}
          className="ac-btn ac-btn-primary ml-auto !px-3 !py-[4px] !text-t10_5"
          onClick={() => {
            setForking(true);
            void onFork(entry).finally(() => setForking(false));
          }}
        >
          {forking ? <Loader2 size={12} className="animate-spin" /> : <GitFork size={12} strokeWidth={2.4} />}
          {t('hub.fork')}
        </button>
      </div>
    </div>
  );
}
