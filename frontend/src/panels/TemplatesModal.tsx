'use client';

import { Lock, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { nodeAccent } from '@design/tokens';
import { getNodeDef } from '@/nodes/registry';
import type { TemplateMeta } from '@/templates/builtin';
import type { CanvasDoc } from '@/types/canvas';
import { KEY_LABELS, type KeyName } from '@/store/secrets';
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
}

/**
 * 템플릿 갤러리 (Spec §15.2)
 * - 카드에 난이도/필요 키/예상 비용, 키가 없으면 자물쇠 배지
 * - `Preview` 는 **읽기 전용** 축소 다이어그램 (클릭해도 편집되지 않는다)
 * - `Use this` 는 현재 캔버스를 통째로 교체한다 (Restore 와 같은 동작)
 */
export function TemplatesModal({
  open, onClose, templates, availableKeys, ollamaModels, onUse,
}: TemplatesModalProps) {
  const have = useMemo(() => new Set(availableKeys), [availableKeys]);
  // "Ollama로 대체 실행" 유도 대상 — 요구 키가 0개인 템플릿 (§15.2 SHOULD).
  const freeAlternative = templates.find((t) => t.requiresKeys.length === 0);

  return (
    <Modal open={open} wide title="템플릿 갤러리" onClose={onClose}>
      <p className="ac-hint !mt-0">
        카드를 고르면 현재 캔버스가 그 템플릿으로 교체됩니다. 미리보기는 읽기 전용입니다.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            tpl={t}
            missingKeys={t.requiresKeys.filter((k) => !have.has(k))}
            ollamaModels={ollamaModels}
            freeAlternative={freeAlternative && freeAlternative.id !== t.id ? freeAlternative : undefined}
            onUse={onUse}
          />
        ))}
      </div>
    </Modal>
  );
}

function TemplateCard({
  tpl, missingKeys, ollamaModels, freeAlternative, onUse,
}: {
  tpl: TemplateMeta;
  missingKeys: string[];
  ollamaModels?: string[];
  freeAlternative?: TemplateMeta;
  onUse: (id: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  // 미리보기를 펼칠 때만 빌드한다 — 카드 5장을 매 렌더마다 빌드할 이유가 없다.
  const doc = useMemo(() => (previewOpen ? tpl.build(ollamaModels) : null), [previewOpen, tpl, ollamaModels]);
  const locked = missingKeys.length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-t13 font-bold text-text">{tpl.name}</span>
        <span className="flex flex-none items-center gap-[1px]" title={`난이도 ${tpl.difficulty}/3`}>
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
      </div>

      <p className="m-0 text-t11 leading-snug text-text-dim">{tpl.description}</p>

      <div className="flex flex-wrap items-center gap-[5px]">
        {locked && (
          <span className="ac-chip !border-amber/50 !text-amber">
            <Lock size={9} strokeWidth={2.6} />
            키 필요
          </span>
        )}
        {tpl.requiresKeys.length === 0 && <span className="ac-chip">API 키 불필요</span>}
        {tpl.requiresKeys.map((k) => (
          <span
            key={k}
            className={`ac-chip ${missingKeys.includes(k) ? 'opacity-60' : '!border-emerald/50 !text-emerald'}`}
          >
            {KEY_LABELS[k as KeyName]?.label ?? k}
          </span>
        ))}
        <span className="ml-auto font-mono text-t10_5 text-text-faint">
          {tpl.estimatedCostUsd > 0 ? `~$${tpl.estimatedCostUsd.toFixed(3)}` : '무료'}
        </span>
      </div>

      {locked && freeAlternative && (
        <div className="ac-note !mt-0 flex flex-wrap items-center gap-2">
          <span className="flex-1">
            {missingKeys.join(', ')} 이(가) 없습니다. API 키 없이 바로 돌려보려면:
          </span>
          <button
            type="button"
            className="ac-btn !px-2 !py-[3px] !text-t10_5"
            onClick={() => onUse(freeAlternative.id)}
          >
            Ollama로 대체 실행
          </button>
        </div>
      )}

      {previewOpen && doc && <TemplatePreview doc={doc} />}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <button
          type="button"
          className="ac-btn !px-2 !py-[4px] !text-t10_5"
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen((v) => !v)}
        >
          {previewOpen ? 'Hide preview' : 'Preview'}
        </button>
        <button
          type="button"
          className="ac-btn ac-btn-primary ml-auto !px-3 !py-[4px] !text-t10_5"
          onClick={() => onUse(tpl.id)}
        >
          Use this
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
function TemplatePreview({ doc }: { doc: CanvasDoc }) {
  const { boxes, lines, counts } = useMemo(() => layout(doc), [doc]);
  return (
    <div className="rounded-xl border border-border-soft bg-surface-3 p-2">
      <svg
        viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
        width="100%"
        height={PREVIEW_H}
        role="img"
        aria-label={`${doc.name} 미리보기 — 노드 ${doc.nodes.length}개`}
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
              fill="#fff" fillOpacity={0.95}
            >
              {b.mark}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 font-mono text-t10_5 text-text-faint">
        노드 {doc.nodes.length} · 엣지 {doc.edges.length} · {counts}
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
  const counts = [...tally.entries()].map(([type, n]) => `${getNodeDef(type as never).label} ${n}`).join(' · ');

  return { boxes, lines, counts };
}
