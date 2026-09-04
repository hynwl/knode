'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Copy, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field } from '@/nodes/fields';
import { getNodeDef, nodeLabel } from '@/nodes/registry';
import { useAppStore, useNodeState } from '@/store';
import { slotLabel, slotsForKey, useSecretsStore } from '@/store/secrets';
import { PROVIDER_KEY_NAME } from '@/validation/rules';
import type { FieldSpec } from '@/nodes/fieldSpec';
import { useT, type TFunction } from '@/i18n/react';
import { issueText } from '@/validation/issues';

/** 아티팩트 `.inspector` 이식. 폭 300px. 필드는 전부 레지스트리에서 생성한다. */
export function InspectorPanel({ onOpenKeys }: { onOpenKeys?: () => void }) {
  const t = useT();
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
  const keySlots = useSecretsStore((s) => s.slots);
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
        <InspectorHead
          tag={t('inspector.tag')}
          title={selectedIds.length > 1 ? t('inspector.multi', { count: selectedIds.length }) : t('inspector.empty')}
        />
        <div className="flex flex-1 items-center justify-center p-8 text-center text-t12_5 leading-normal text-text-faint">
          {t('inspector.emptyBody1')}
          <br />
          {t('inspector.emptyBody2')}
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

  // LLM 노드 `key_ref` 셀렉트 옵션 — 이 프로바이더용으로 **등록된 키 슬롯**만 보여준다.
  // 값이 아니라 슬롯 id 를 저장한다는 게 요점이다 (Spec §12.1, `store/secrets.ts` 주석).
  const providerKeyName = node.type === 'llm' ? PROVIDER_KEY_NAME[provider] ?? null : null;
  const keyRefOptions = providerKeyName === null
    ? [{ value: '', label: t('inspector.keyRefNotNeeded') }]
    : [
      { value: '', label: t('inspector.keyRefDefault', { key: providerKeyName }) },
      // 기본 슬롯(id === 키 이름)은 빈 값과 **같은 키를 가리킨다** — 둘 다 목록에
      // 두면 뜻이 같은 항목이 두 개 뜬다(실브라우저 확인에서 실제로 그랬다).
      ...slotsForKey(keySlots, providerKeyName)
        .filter((slot) => slot.id !== providerKeyName)
        .map((slot) => ({ value: slot.id, label: slotLabel(slot), hint: slot.id })),
    ];

  // Tool 노드 `tool_id` 콤보박스 옵션 (Spec §5.6 MUST "하드코딩 금지, API로 서빙").
  const toolTypeOptions = toolTypes.map((tool) => ({
    value: tool.toolId,
    label: tool.enabled ? tool.label : t('inspector.toolDisabled', { label: tool.label }),
    hint: tool.requiredKeys.length > 0
      ? t('inspector.toolRequiredKeys', { keys: tool.requiredKeys.join(', ') })
      : undefined,
  }));

  return (
    <>
      <InspectorHead
        tag={t('inspector.nodeTag', { label: nodeLabel(def) })}
        title={String(node.data.name ?? node.data.title ?? nodeLabel(def))}
      />
      <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto px-4 pb-8 pt-[14px]">
        {nodeIssues.length > 0 && (
          <div className="flex flex-col gap-2">
            {nodeIssues.map((i, idx) => {
              const { message, hint } = issueText(i);
              return (
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
                    <span className="font-mono text-t10">{i.code}</span> {message}
                  </div>
                  {hint && <div className="mt-1 opacity-80">{hint}</div>}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {basic.map((f) => (
          <div key={f.key}>
            <Field
              spec={f}
              value={node.data[f.key]}
              dynamicOptions={
                node.type === 'llm' && f.key === 'model' ? modelOptions
                  : node.type === 'llm' && f.key === 'key_ref' ? keyRefOptions
                    : node.type === 'tool' && f.key === 'tool_id' ? toolTypeOptions
                      : undefined
              }
              invalid={nodeIssues.some((i) => i.field === f.key && i.severity === 'error')}
              // 프로바이더를 바꾸면 키 슬롯 선택은 함께 비운다 — 남겨 두면 다른
              // 프로바이더의 키를 지목한 상태가 되어 AC-E606 이 뜬다.
              onChange={(v) => updateNodeData(
                node.id,
                node.type === 'llm' && f.key === 'provider' ? { provider: v, key_ref: '' } : { [f.key]: v },
              )}
              declaredVars={declaredVars}
            />
            {f.key === 'model' && showOllamaGuidance && <OllamaGuidance reason={ollamaStatus?.reason ?? null} t={t} />}
            {f.key === 'key_ref' && providerKeyName !== null && onOpenKeys && (
              <button type="button" className="ac-hint underline hover:text-text-dim" onClick={onOpenKeys}>
                {t('inspector.keyRefManage')}
              </button>
            )}
          </div>
        ))}

        {advanced.length > 0 && (
          <>
            <button
              type="button"
              className="ac-section-title text-left hover:text-text-dim"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {t('inspector.advanced')} {showAdvanced ? '▾' : '▸'}
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
            <div className="ac-section-title">{t('inspector.result')}</div>
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

        <div className="ac-section-title">{t('inspector.connections')}</div>
        <div className="flex flex-col gap-3">
          {[...def.inputs, ...def.outputs].map((p) => {
            const linked = p.direction === 'in'
              ? edges.filter((e) => e.target === node.id && e.targetHandle === p.id)
                .map((e) => nodes.find((n) => n.id === e.source))
              : edges.filter((e) => e.source === node.id && e.sourceHandle === p.id)
                .map((e) => nodes.find((n) => n.id === e.target));
            return (
              <div key={`${p.direction}-${p.id}`}>
                <div className="ac-label !mb-1">
                  {p.label} ({p.direction === 'in' ? t('inspector.portIn') : t('inspector.portOut')})
                </div>
                <div className="ac-hint !mt-0">
                  {linked.length
                    ? linked.map((n) => (n ? String(n.data.name ?? n.data.title ?? n.type) : '?')).join(', ')
                    : t('inspector.notConnected')}
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
function OllamaGuidance({ reason, t }: { reason: string | null; t: TFunction }) {
  // 백엔드가 주소 자체를 거부한 경우엔 "설치하세요" 안내가 오히려 오해를 부른다.
  if (reason === 'host_not_allowed') {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/10 p-[10px] text-t11_5 leading-normal text-amber">
        <div>{t('inspector.ollamaHostBlocked')}</div>
        <div className="text-text-dim">{t('inspector.ollamaHostBlockedDetail')}</div>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/10 p-[10px] text-t11_5 leading-normal text-amber">
      <div>{t('inspector.ollamaUnreachable')}</div>
      <a
        href="https://ollama.com/download"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:opacity-80"
      >
        {t('inspector.ollamaInstall')}
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
