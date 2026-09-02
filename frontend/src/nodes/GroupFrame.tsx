'use client';

import { memo } from 'react';
import { X } from 'lucide-react';

import { nodeAccent, type NodeAccentKey } from '@design/tokens';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';
import type { AcNode } from '@/types/canvas';

/**
 * Group 프레임 (Spec §3.5-10).
 *
 * 아티팩트 원본(`design/reference/artifact-source.html`)에는 그룹 프레임 디자인이
 * 없어서 — 대응 요소 자체가 존재하지 않는다 — 노드 헤더의 그라디언트와
 * `nodeAccent` 팔레트를 그대로 재사용해 구성했다 (신규 색 토큰 없음).
 *
 * 본문은 포인터 이벤트를 받지 않는다(`globals.css` 의 `.react-flow__node-group`):
 * 프레임이 안에 든 노드의 클릭·마키 선택을 가로막으면 안 되기 때문에,
 * 잡을 수 있는 곳은 헤더뿐이다.
 */
export const GroupFrame = memo(function GroupFrame({ node, selected }: { node: AcNode; selected: boolean }) {
  const t = useT();
  const removeNodes = useAppStore((s) => s.removeNodes);
  const accent = nodeAccent[(node.data.color as NodeAccentKey) ?? 'note'] ?? nodeAccent.note;

  return (
    <div
      className={cn(
        'h-full min-h-[80px] w-full rounded-2xl border',
        selected && 'border-node-selected',
      )}
      style={{
        borderColor: selected ? undefined : `${accent.base}80`,
        background: `${accent.base}14`, // 액센트 8% — 파생값, 신규 토큰 아님
      }}
      data-node-id={node.id}
      data-node-type="group"
    >
      <div
        className="ac-drag-handle pointer-events-auto flex h-node-header cursor-grab items-center gap-[6px]
                   rounded-t-xl px-[10px] font-display text-t12 font-semibold tracking-tightest
                   text-header-text active:cursor-grabbing"
        style={{ background: `linear-gradient(90deg, ${accent.base}, ${accent.deep})` }}
      >
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {String(node.data.title ?? t('nodeBody.groupUntitled'))}
        </span>
        <button
          type="button"
          className="flex h-4 w-4 flex-none items-center justify-center rounded-sm opacity-75 hover:bg-black/20 hover:opacity-100"
          aria-label={t('nodeBody.groupDelete')}
          title={t('nodeBody.groupDeleteTitle')}
          onClick={(e) => { e.stopPropagation(); removeNodes([node.id]); }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
});
