'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field } from '@/nodes/fields';
import { getNodeDef } from '@/nodes/registry';
import { useAppStore } from '@/store';
import type { FieldSpec } from '@/nodes/fieldSpec';

/** 아티팩트 `.inspector` 이식. 폭 300px. 필드는 전부 레지스트리에서 생성한다. */
export function InspectorPanel() {
  const selectedIds = useAppStore((s) => s.selectedNodeIds);
  const node = useAppStore((s) => s.nodes.find((n) => n.id === s.selectedNodeIds[0]));
  const edges = useAppStore((s) => s.edges);
  const nodes = useAppStore((s) => s.nodes);
  const issues = useAppStore((s) => s.issues);
  const updateNodeData = useAppStore((s) => s.updateNodeData);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const nodeIssues = useMemo(
    () => issues.filter((i) => i.nodeId === node?.id),
    [issues, node?.id],
  );

  if (!node) {
    return (
      <>
        <InspectorHead tag="Property Inspector" title={selectedIds.length > 1 ? `${selectedIds.length}개 선택됨` : '선택된 노드 없음'} />
        <div className="flex flex-1 items-center justify-center p-8 text-center text-t12_5 leading-normal text-text-faint">
          캔버스를 우클릭해 노드를 추가하거나,
          <br />
          기존 노드를 클릭해 여기서 편집하세요.
        </div>
      </>
    );
  }

  const def = getNodeDef(node.type);
  const basic = def.fields.filter((f) => !f.advanced && isVisible(f, node.data));
  const advanced = def.fields.filter((f) => f.advanced && isVisible(f, node.data));

  return (
    <>
      <InspectorHead tag={`${def.label} Node`} title={String(node.data.name ?? node.data.title ?? def.label)} />
      <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto px-4 pb-8 pt-[14px]">
        {nodeIssues.length > 0 && (
          <div className="flex flex-col gap-2">
            {nodeIssues.map((i, idx) => (
              <div
                key={`${i.code}-${idx}`}
                className={cn(
                  'flex gap-2 rounded-xl border p-[10px] text-t11_5 leading-normal',
                  i.severity === 'error'
                    ? 'border-danger/40 bg-danger/10 text-danger'
                    : 'border-amber/40 bg-amber/10 text-amber',
                )}
              >
                {i.severity === 'error' ? <AlertTriangle size={14} className="mt-[2px] flex-none" /> : <Info size={14} className="mt-[2px] flex-none" />}
                <div>
                  <div className="font-semibold">
                    <span className="font-mono text-t10">{i.code}</span> {i.message}
                  </div>
                  {i.hint && <div className="mt-1 opacity-80">{i.hint}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {basic.map((f) => (
          <Field
            key={f.key}
            spec={f}
            value={node.data[f.key]}
            invalid={nodeIssues.some((i) => i.field === f.key && i.severity === 'error')}
            onChange={(v) => updateNodeData(node.id, { [f.key]: v })}
          />
        ))}

        {advanced.length > 0 && (
          <>
            <button
              type="button"
              className="ac-section-title text-left hover:text-text-dim"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              고급 설정 {showAdvanced ? '▾' : '▸'}
            </button>
            {showAdvanced && advanced.map((f) => (
              <Field
                key={f.key}
                spec={f}
                value={node.data[f.key]}
                onChange={(v) => updateNodeData(node.id, { [f.key]: v })}
              />
            ))}
          </>
        )}

        <div className="ac-section-title">연결</div>
        <div className="flex flex-col gap-3">
          {[...def.inputs, ...def.outputs].map((p) => {
            const linked = p.direction === 'in'
              ? edges.filter((e) => e.target === node.id && e.targetHandle === p.id)
                .map((e) => nodes.find((n) => n.id === e.source))
              : edges.filter((e) => e.source === node.id && e.sourceHandle === p.id)
                .map((e) => nodes.find((n) => n.id === e.target));
            return (
              <div key={`${p.direction}-${p.id}`}>
                <div className="ac-label !mb-1">{p.label} ({p.direction === 'in' ? '입력' : '출력'})</div>
                <div className="ac-hint !mt-0">
                  {linked.length
                    ? linked.map((n) => (n ? String(n.data.name ?? n.data.title ?? n.type) : '?')).join(', ')
                    : '연결되지 않음'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function InspectorHead({ tag, title }: { tag: string; title: string }) {
  return (
    <div className="flex-none border-b border-border-soft px-4 pb-[10px] pt-[14px]">
      <div className="font-mono text-t10 font-semibold uppercase tracking-widest text-text-faint">{tag}</div>
      <h2 className="mt-1 font-display text-t15 font-bold text-text">{title}</h2>
    </div>
  );
}

function isVisible(f: FieldSpec, data: Record<string, unknown>): boolean {
  if (!f.visibleWhen) return true;
  return data[f.visibleWhen.key] === f.visibleWhen.equals;
}
