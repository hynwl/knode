'use client';

import { useMemo, useState } from 'react';
import { PanelLeftClose, Search } from 'lucide-react';
import { nodeAccent } from '@design/tokens';
import {
  NODE_CATEGORIES, nodeDescription, nodeLabel, searchNodes,
  type NodeCategory, type NodeDefinition,
} from '@/nodes/registry';
import { useAppStore } from '@/store';
import { useT } from '@/i18n/react';

/**
 * 좌측 노드 라이브러리 (Spec §3.6).
 * 아티팩트에는 없는 화면이므로 §1.4 확장 규칙에 따라 기존 토큰만 재조합한다.
 */
export function NodeLibrary() {
  const t = useT();
  const [query, setQuery] = useState('');
  const togglePanel = useAppStore((s) => s.togglePanel);
  const addNode = useAppStore((s) => s.addNode);
  const viewport = useAppStore((s) => s.viewport);

  const grouped = useMemo(() => {
    const results = searchNodes(query);
    const map = new Map<NodeCategory, NodeDefinition[]>();
    for (const d of results) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return NODE_CATEGORIES.map((c) => [c, map.get(c) ?? []] as const).filter(([, l]) => l.length);
    // `t` 는 로케일이 바뀔 때마다 새 참조가 되므로, 이름 기준 검색 결과도 같이 갱신된다.
  }, [query, t]);

  /** 캔버스 중앙 근처에 떨어뜨린다 */
  const dropPosition = () => ({
    x: (-viewport.x + 420) / viewport.zoom,
    y: (-viewport.y + 200) / viewport.zoom,
  });

  return (
    <aside className="flex w-64 flex-none flex-col border-r border-border-soft bg-surface">
      <div className="flex flex-none items-center gap-2 border-b border-border-soft px-3 py-[10px]">
        <Search size={13} className="text-text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('library.search')}
          className="w-full bg-transparent text-t12_5 text-text outline-none placeholder:text-text-faint"
        />
        <button type="button" onClick={() => togglePanel('left')} aria-label={t('library.collapse')} className="text-text-faint hover:text-text">
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {grouped.map(([category, defs]) => (
          <div key={category} className="mb-3">
            <div className="px-2 pb-1 font-mono text-t9_5 font-semibold uppercase tracking-widest text-text-faint">
              {category}
            </div>
            {defs.map((def) => (
              <button
                key={def.type}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/acanvas-node', def.type)}
                onClick={() => addNode(def.type, dropPosition())}
                className="mb-[2px] flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left
                           text-t12_5 font-semibold text-text-dim hover:bg-surface-2 hover:text-text"
                title={nodeDescription(def)}
              >
                <span className="h-[9px] w-[9px] flex-none rounded-xs" style={{ background: nodeAccent[def.accent].base }} />
                <span className="flex-1 truncate">{nodeLabel(def)}</span>
                {def.priority !== 'MUST' && (
                  <span className="flex-none font-mono text-t9_5 text-text-faint">
                    {def.disabledInV1 ? 'v1.1' : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
