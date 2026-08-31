'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Copy, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field } from '@/nodes/fields';
import { getNodeDef } from '@/nodes/registry';
import { useAppStore, useNodeState } from '@/store';
import type { FieldSpec } from '@/nodes/fieldSpec';

/** 아티팩트 `.inspector` 이식. 폭 300px. 필드는 전부 레지스트리에서 생성한다. */
export function InspectorPanel() {
  const selectedIds = useAppStore((s) => s.selectedNodeIds);
  const node = useAppStore((s) => s.nodes.find((n) => n.id === s.selectedNodeIds[0]));
  const edges = useAppStore((s) => s.edges);
  const nodes = useAppStore((s) => s.nodes);
  const issues = useAppStore((s) => s.issues);
  const updateNodeData = useAppStore((s) => s.updateNodeData);
  const runState = useNodeState(node?.id ?? '');
  const providerPresets = useAppStore((s) => s.providerPresets);
  const ollamaStatus = useAppStore((s) => s.ollamaStatus);
  const toolTypes = useAppStore((s) => s.toolTypes);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const nodeIssues = useMemo(
    () => issues.filter((i) => i.nodeId === node?.id),
    [issues, node?.id],
  );

  const declaredVars = useMemo(() => new Set(
    nodes
      .filter((n) => n.type === 'input')
      .map((n) => String(n.data.var_name ?? ''))
      .filter(Boolean),
  ), [nodes]);

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

  // LLM 노드 `model` 콤보박스 옵션 (Spec §13.2 MUST "자유 텍스트 입력 강요 금지").
  const provider = node.type === 'llm' ? String(node.data.provider ?? '') : '';
  const isOllamaProvider = provider === 'ollama';
  const modelOptions = isOllamaProvider
    ? (ollamaStatus?.models ?? []).map((m) => ({
      value: m.name,
      label: m.sizeGb ? `${m.name} · ${m.sizeGb}GB` : m.name,
      hint: m.family ?? undefined,
    }))
    : (providerPresets[provider] ?? []).map((m) => ({ value: m, label: m }));
  const showOllamaGuidance = isOllamaProvider && ollamaStatus !== null && !ollamaStatus.available;

  // Tool 노드 `tool_id` 콤보박스 옵션 (Spec §5.6 MUST "하드코딩 금지, API로 서빙").
  const toolTypeOptions = toolTypes.map((t) => ({
    value: t.toolId,
    label: t.enabled ? t.label : `${t.label} (비활성)`,
    hint: t.requiredKeys.length > 0 ? `필요 키: ${t.requiredKeys.join(', ')}` : undefined,
  }));

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
          <div key={f.key}>
            <Field
              spec={f}
              value={node.data[f.key]}
              dynamicOptions={
                node.type === 'llm' && f.key === 'model' ? modelOptions
                  : node.type === 'tool' && f.key === 'tool_id' ? toolTypeOptions
                    : undefined
              }
              invalid={nodeIssues.some((i) => i.field === f.key && i.severity === 'error')}
              onChange={(v) => updateNodeData(node.id, { [f.key]: v })}
              declaredVars={declaredVars}
            />
            {f.key === 'model' && showOllamaGuidance && <OllamaGuidance reason={ollamaStatus?.reason ?? null} />}
          </div>
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

        {runState?.output && (
          <div className="flex flex-col gap-2">
            <div className="ac-section-title">실행 결과</div>
            <div className="flex gap-3 font-mono text-t10 text-text-faint">
              {runState.startedAt && runState.finishedAt && (
                <span>{((runState.finishedAt - runState.startedAt) / 1000).toFixed(1)}s</span>
              )}
              {runState.usage && (
                <span>{(runState.usage.prompt + runState.usage.completion).toLocaleString()} tok</span>
              )}
            </div>
            <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-soft bg-surface-2 p-3 font-mono text-t11 leading-relaxed text-log-ok">
              {runState.output}
            </div>
          </div>
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

/** Ollama 미실행 안내 (Spec §13.2 MUST: 설치 링크 + `ollama serve`/`ollama pull` 복사 버튼). */
function OllamaGuidance({ reason }: { reason: string | null }) {
  // 백엔드가 주소 자체를 거부한 경우엔 "설치하세요" 안내가 오히려 오해를 부른다.
  if (reason === 'host_not_allowed') {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/10 p-[10px] text-t11_5 leading-normal text-amber">
        <div>허용되지 않는 Ollama 주소입니다.</div>
        <div className="text-text-dim">
          보안상 백엔드는 로컬호스트(`http://localhost:11434`) 또는 사설망(LAN) 주소만 대신 조회합니다.
          API Keys 창의 Ollama Base URL 을 확인하세요.
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/10 p-[10px] text-t11_5 leading-normal text-amber">
      <div>Ollama 서버에 연결할 수 없습니다.</div>
      <a
        href="https://ollama.com/download"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:opacity-80"
      >
        ollama.com 에서 설치
      </a>
      <CopyCommand command="ollama serve" />
      <CopyCommand command="ollama pull llama3.1" />
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 클립보드 접근이 막힌 환경 — 조용히 무시
        }
      }}
      className="flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-2 px-2 py-1 font-mono text-t11 text-text hover:bg-surface-3"
    >
      <span>{command}</span>
      <Copy size={11} className={copied ? 'text-emerald' : 'text-text-faint'} />
    </button>
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
