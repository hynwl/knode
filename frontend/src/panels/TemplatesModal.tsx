'use client';

import { Lock, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { nodeAccent } from '@design/tokens';
import { getNodeDef, nodeLabel } from '@/nodes/registry';
import type { TemplateMeta } from '@/templates/builtin';
import { CUSTOM_ID_PREFIX } from '@/templates/custom';
import type { HubTeamEntry } from '@/templates/hub';
import type { CanvasDoc } from '@/types/canvas';
import { keyLabel } from '@/store/secrets';
import { useT, type TFunction } from '@/i18n/react';
import { HubTab } from './HubTab';
import { Modal } from './Modal';

interface TemplatesModalProps {
  open: boolean;
  onClose: () => void;
  templates: TemplateMeta[];
  /** 사용자가 실제로 값을 넣어 둔 키 이름들 (Spec §12.1). 자물쇠 배지 판정용. */
  availableKeys: string[];
  /** §13.1 자동 감지 결과 — 로컬 템플릿 미리보기가 실제 설치 모델을 쓰게 한다. */
  ollamaModels?: string[];
  onUse: (id: string) => void;
  /** "New +" 카드 — 백지 캔버스로 현재 캔버스를 교체한다. */
  onNew: () => void;
  /** 갤러리에서 템플릿을 지운다(커스텀은 완전히, 내장은 숨김). */
  onDelete: (id: string) => void;
  /**
   * Hub 레지스트리 팀 목록. `null` = 미설정/오프라인 — 이때 "Hub" 탭 자체가
   * 렌더링되지 않는다(M5 P-D3). `[]` 는 "설정은 됐는데 아직 아무도 안 올렸다".
   */
  hubTeams?: HubTeamEntry[] | null;
  onForkHub?: (entry: HubTeamEntry) => Promise<void>;
}

/**
 * 템플릿 갤러리 (Spec §15.2)
 * - 카드에 난이도/필요 키/예상 비용, 키가 없으면 자물쇠 배지
 * - `Preview` 는 **읽기 전용** 축소 다이어그램 (클릭해도 편집되지 않는다)
 * - `Use this` 는 현재 캔버스를 통째로 교체한다 (Restore 와 같은 동작)
 */
export function TemplatesModal({
  open, onClose, templates, availableKeys, ollamaModels, onUse, onNew, onDelete,
  hubTeams, onForkHub,
}: TemplatesModalProps) {
  const t = useT();
  const showHub = hubTeams != null && !!onForkHub;
  const [tab, setTab] = useState<'templates' | 'hub'>('templates');
  useEffect(() => { if (open) setTab('templates'); }, [open]);
  const have = useMemo(() => new Set(availableKeys), [availableKeys]);
  // 키가 없는 사용자에게 대신 권할 템플릿 — 요구 키가 0개인 것 (§15.2 SHOULD).
  //
  // ⚠️ 스펙 §15.2 의 문구는 "Ollama로 대체 실행"이지만, 실제 동작은 **이 템플릿의 LLM을
  // 갈아끼우는 게 아니라 무료 템플릿을 대신 여는 것**이다. blog/market_research 는
  // SERPER_API_KEY(툴 키)까지 필요해서 LLM만 바꿔도 못 돌기 때문이다.
  // M4-T10 감사에서 한국어 라벨만 "대체 실행"이라 오해를 부르고(영문은 "Run the Ollama one
  // instead"로 이미 정확했다), 무료 템플릿이 이미 열려 있으면 눌러도 화면이 안 바뀌어
  // "버튼이 고장 났다"로 읽혔다 → 라벨에 열리는 템플릿 이름을 박아 모호함을 없앴다.
  const freeAlternative = templates.find((t) => t.requiresKeys.length === 0);

  return (
    <Modal open={open} wide title={t('templates.title')} onClose={onClose}>
      {showHub && (
        <div role="tablist" aria-label={t('templates.title')} className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {(['templates', 'hub'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`flex-1 rounded-lg py-[6px] text-t11_5 font-semibold ${
                tab === k ? 'bg-surface text-text shadow-sm' : 'text-text-faint hover:text-text'
              }`}
            >
              {k === 'templates' ? t('hub.tabTemplates') : t('hub.tabHub')}
            </button>
          ))}
        </div>
      )}

      {(!showHub || tab === 'templates') ? (
        <>
          <p className="ac-hint !mt-0">{t('templates.intro')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onNew}
              className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-text-faint hover:border-border-light hover:text-text"
            >
              <Plus size={18} strokeWidth={2.2} />
              <span className="font-display text-t13 font-bold">{t('templates.new')}</span>
              <span className="text-t10_5">{t('templates.newHint')}</span>
            </button>
            {templates.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                tpl={tpl}
                missingKeys={tpl.requiresKeys.filter((k) => !have.has(k))}
                ollamaModels={ollamaModels}
                freeAlternative={freeAlternative && freeAlternative.id !== tpl.id ? freeAlternative : undefined}
                onUse={onUse}
                onDelete={onDelete}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="ac-hint !mt-0">{t('hub.intro')}</p>
          <HubTab teams={hubTeams!} availableKeys={availableKeys} onFork={onForkHub!} />
        </>
      )}
    </Modal>
  );
}

/**
 * 예상 비용 라벨. 실측 결과 템플릿 1회 실행은 대개 **1센트 미만**이라
 * (`templates/builtin.ts` 의 `estimatedCostUsd` 주석), 소수 3자리로 자르면
 * 전부 "$0.000" 으로 뭉개져 비교가 불가능해진다. 센트 미만은 자릿수를 늘린다.
 */
export function formatCostUsd(usd: number): string {
  return usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2);
}

function TemplateCard({
  tpl, missingKeys, ollamaModels, freeAlternative, onUse, onDelete,
}: {
  tpl: TemplateMeta;
  missingKeys: string[];
  ollamaModels?: string[];
  freeAlternative?: TemplateMeta;
  onUse: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const [previewOpen, setPreviewOpen] = useState(false);
  const isCustom = tpl.id.startsWith(CUSTOM_ID_PREFIX);
  // 미리보기를 펼칠 때만 빌드한다 — 카드 5장을 매 렌더마다 빌드할 이유가 없다.
  const doc = useMemo(() => (previewOpen ? tpl.build(ollamaModels) : null), [previewOpen, tpl, ollamaModels]);
  const locked = missingKeys.length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-t13 font-bold text-text">{t.k(tpl.name)}</span>
        {isCustom && <span className="ac-chip !text-t9_5">{t('templates.customBadge')}</span>}
        <span className="flex flex-none items-center gap-[1px]" title={t('templates.difficulty', { level: tpl.difficulty })}>
          {[1, 2, 3].map((i) => (
            <Star
              key={i}
              size={10}
              strokeWidth={2}
              className={i <= tpl.difficulty ? 'text-amber' : 'text-text-faint/30'}
              fill={i <= tpl.difficulty ? 'currentColor' : 'none'}
            />
          ))}
        </span>
        <button
          type="button"
          aria-label={t('templates.delete', { name: t.k(tpl.name) })}
          title={t('templates.delete', { name: t.k(tpl.name) })}
          className="flex-none p-[3px] text-text-faint hover:text-danger"
          onClick={() => {
            if (window.confirm(t('templates.deleteConfirm', { name: t.k(tpl.name) }))) onDelete(tpl.id);
          }}
        >
          <Trash2 size={12} strokeWidth={2.2} />
        </button>
      </div>

      <p className="m-0 text-t11 leading-snug text-text-dim">{t.k(tpl.description)}</p>

      <div className="flex flex-wrap items-center gap-[5px]">
        {locked && (
          <span className="ac-chip !border-amber/50 !text-amber">
            <Lock size={9} strokeWidth={2.6} />
            {t('templates.needKeys')}
          </span>
        )}
        {tpl.requiresKeys.length === 0 && <span className="ac-chip">{t('templates.noKeys')}</span>}
        {tpl.requiresKeys.map((k) => (
          <span
            key={k}
            className={`ac-chip ${missingKeys.includes(k) ? 'opacity-60' : '!border-emerald/50 !text-emerald'}`}
          >
            {keyLabel(k)}
          </span>
        ))}
        <span className="ml-auto font-mono text-t10_5 text-text-faint">
          {tpl.estimatedCostUsd > 0 ? `~$${formatCostUsd(tpl.estimatedCostUsd)}` : t('templates.free')}
        </span>
      </div>

      {locked && freeAlternative && (
        <div className="ac-note !mt-0 flex flex-wrap items-center gap-2">
          <span className="flex-1">
            {t('templates.missingKeys', { keys: missingKeys.join(', ') })}
          </span>
          <button
            type="button"
            className="ac-btn !px-2 !py-[3px] !text-t10_5"
            onClick={() => onUse(freeAlternative.id)}
          >
            {t('templates.useOllama', { name: t.k(freeAlternative.name) })}
          </button>
        </div>
      )}

      {previewOpen && doc && <TemplatePreview doc={doc} t={t} />}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <button
          type="button"
          className="ac-btn !px-2 !py-[4px] !text-t10_5"
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen((v) => !v)}
        >
          {previewOpen ? t('templates.hidePreview') : t('templates.preview')}
        </button>
        <button
          type="button"
          className="ac-btn ac-btn-primary ml-auto !px-3 !py-[4px] !text-t10_5"
          onClick={() => onUse(tpl.id)}
        >
          {t('templates.use')}
        </button>
      </div>
    </div>
  );
}

/* ---------- 읽기 전용 캔버스 미리보기 (Spec §15.2) ---------- */

const PREVIEW_W = 320;
const PREVIEW_H = 132;
/** 캔버스 노드 실측 폭/높이 근사치. 축소 다이어그램이라 정확할 필요는 없다. */
const NODE_W = 220;
const NODE_H = 96;

/**
 * React Flow 미니 캔버스를 통째로 띄우지 않고 정적 SVG 로 그린다 — 미리보기는
 * **읽기 전용**이어야 하고(§15.2), 편집 가능한 캔버스를 하나 더 마운트하는 것은
 * 이 목적에 과하다. `pointer-events: none` 으로 상호작용 자체를 막는다.
 */
function TemplatePreview({ doc, t }: { doc: CanvasDoc; t: TFunction }) {
  const { boxes, lines, counts } = useMemo(() => layout(doc), [doc, t]);
  return (
    <div className="rounded-xl border border-border-soft bg-surface-3 p-2">
      <svg
        viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
        width="100%"
        height={PREVIEW_H}
        role="img"
        aria-label={t('templates.previewAria', { name: doc.name, count: doc.nodes.length })}
        className="pointer-events-none select-none block"
      >
        {lines.map((l, i) => (
          <line
            key={i}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke="var(--border)" strokeWidth={1}
          />
        ))}
        {boxes.map((b) => (
          <g key={b.id}>
            <rect
              x={b.x} y={b.y} width={b.w} height={b.h} rx={3}
              fill={b.color} fillOpacity={0.85}
            />
            <text
              x={b.x + b.w / 2} y={b.y + b.h / 2 + 3}
              textAnchor="middle" fontSize={7} fontFamily="var(--font-mono, monospace)"
              className="fill-header-mark"
            >
              {b.mark}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 font-mono text-t10_5 text-text-faint">
        {t('templates.counts', { nodes: doc.nodes.length, edges: doc.edges.length, breakdown: counts })}
      </div>
    </div>
  );
}

interface Box { id: string; x: number; y: number; w: number; h: number; color: string; mark: string }
interface Line { x1: number; y1: number; x2: number; y2: number }

function layout(doc: CanvasDoc): { boxes: Box[]; lines: Line[]; counts: string } {
  const pad = 6;
  const xs = doc.nodes.map((n) => n.position.x);
  const ys = doc.nodes.map((n) => n.position.y);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxX = Math.max(...xs.map((x) => x + NODE_W), minX + 1);
  const maxY = Math.max(...ys.map((y) => y + NODE_H), minY + 1);
  const scale = Math.min((PREVIEW_W - pad * 2) / (maxX - minX), (PREVIEW_H - pad * 2) / (maxY - minY));
  const px = (x: number) => pad + (x - minX) * scale;
  const py = (y: number) => pad + (y - minY) * scale;

  const boxes: Box[] = doc.nodes.map((n) => {
    const def = getNodeDef(n.type);
    return {
      id: n.id,
      x: px(n.position.x),
      y: py(n.position.y),
      w: Math.max(NODE_W * scale, 6),
      h: Math.max(NODE_H * scale, 5),
      color: nodeAccent[def.accent].base,
      mark: def.mark,
    };
  });
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const lines: Line[] = [];
  for (const e of doc.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    lines.push({ x1: s.x + s.w, y1: s.y + s.h / 2, x2: t.x, y2: t.y + t.h / 2 });
  }

  const tally = new Map<string, number>();
  for (const n of doc.nodes) tally.set(n.type, (tally.get(n.type) ?? 0) + 1);
  const counts = [...tally.entries()].map(([type, n]) => `${nodeLabel(getNodeDef(type as never))} ${n}`).join(' · ');

  return { boxes, lines, counts };
}
