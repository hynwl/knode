'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Copy, FileUp, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field } from '@/nodes/fields';
import { getNodeDef, nodeLabel } from '@/nodes/registry';
import { useAppStore, useNodeState } from '@/store';
import { slotLabel, slotsForKey, useSecretsStore } from '@/store/secrets';
import { PROVIDER_KEY_NAME } from '@/validation/rules';
import { useProviderModels } from '@/lib/useProviderModels';
import { DocumentExtractError, extractDocument } from '@/lib/backendStatus';
import { defaultModelForProvider } from '@/lib/providerDefaults';
import type { ProviderModelProbe } from '@/store';
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

  // ⚠️ 훅은 아래 `if (!node)` **위에서** 부른다 — 노드 선택이 풀렸을 때만 훅 개수가
  // 달라지면 리액트가 훅 순서를 잃는다. LLM 이 아닐 땐 빈 프로바이더로 부르고,
  // 그 경우 `useProviderModels` 는 조회 없이 `not_probeable` 을 돌려준다.
  const provider = node?.type === 'llm' ? String(node.data.provider ?? '') : '';
  const isOllamaProvider = provider === 'ollama';
  const modelProbe = useProviderModels(
    provider,
    node?.type === 'llm' ? String(node.data.key_ref ?? '') : '',
  );
  const probeUsable = !isOllamaProvider && modelProbe.reason !== 'not_probeable';

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
  //
  // 목록의 출처가 프로바이더마다 다르다 — 셋 다 "지금 이 사용자가 **실제로 쓸 수
  // 있는** 것" 이라는 같은 기준을 따른다:
  //   ollama              → §13.1 자동 감지로 이 머신에 **설치된** 모델
  //   openai/anthropic/…  → 등록된 BYOK 키로 조회한 모델 (`useProviderModels`)
  //   openai_compatible   → 조회 불가(임의 base_url = SSRF) → 정적 프리셋 + 자유 입력
  const modelOptions = isOllamaProvider
    ? (ollamaStatus?.models ?? []).map((m) => ({
      value: m.name,
      label: m.sizeGb ? `${m.name} · ${m.sizeGb}GB` : m.name,
      hint: m.family ?? undefined,
    }))
    : probeUsable
      ? modelProbe.models.map((m) => ({ value: m, label: m }))
      : (providerPresets[provider] ?? []).map((m) => ({ value: m, label: m }));
  const showOllamaGuidance = isOllamaProvider && ollamaStatus !== null && !ollamaStatus.available;
  // 키로 조회하는 프로바이더인데 쓸 수 있는 모델이 하나도 없는 경우의 안내.
  const modelNotice = node.type === 'llm' && probeUsable && modelProbe.status !== 'ok'
    ? modelProbe
    : null;

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

  /**
   * 프로바이더를 바꿀 때 함께 넣어 줄 모델 이름.
   *
   * 새 프로바이더의 조회 결과는 아직 없으므로(그 프로바이더를 고른 **직후**라
   * `useProviderModels` 가 이제야 돌기 시작한다) 지금 손에 있는 목록으로 고른다:
   * Ollama 는 이미 감지해 둔 설치 목록, 원격은 정적 프리셋. 어느 쪽이든 곧
   * 드롭다운이 실제 목록으로 채워지므로 여기서는 "즉시 실행 가능한 값" 이면 된다.
   */
  const modelForProvider = (next: string): string => defaultModelForProvider(
    next,
    next === 'ollama'
      ? (ollamaStatus?.models ?? []).map((m) => m.name)
      : providerPresets[next] ?? [],
  );

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
                node.type === 'llm' && f.key === 'provider'
                  ? { provider: v, key_ref: '', model: modelForProvider(String(v)) }
                  : { [f.key]: v },
              )}
              declaredVars={declaredVars}
            />
            {f.key === 'model' && showOllamaGuidance && <OllamaGuidance reason={ollamaStatus?.reason ?? null} t={t} />}
            {node.type === 'input' && f.key === 'default_value' && (
              <DocumentLoader
                current={String(node.data.default_value ?? '')}
                onLoaded={(text) => updateNodeData(node.id, { default_value: text })}
                t={t}
              />
            )}
            {f.key === 'model' && modelNotice && (
              <ModelNotice probe={modelNotice} onOpenKeys={onOpenKeys} t={t} />
            )}
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

/**
 * `model` 드롭다운에 고를 것이 없을 때의 안내 (사용자 요청: "등록된 API keys 가
 * 없을 경우 <사용 가능 모델 없음> + API keys 를 먼저 등록하세요").
 *
 * 사유를 뭉뚱그리지 않는 게 요점이다 — "키를 등록하세요" 와 "등록한 키가 거부됐다"
 * 는 사용자가 해야 할 행동이 완전히 다른데, 둘 다 "모델 없음" 으로만 보이면
 * 멀쩡한 키를 지웠다 다시 넣는 헛수고를 하게 된다.
 */
function ModelNotice({
  probe, onOpenKeys, t,
}: { probe: ProviderModelProbe; onOpenKeys?: () => void; t: TFunction }) {
  if (probe.status === 'loading') {
    return <div className="ac-hint">{t('inspector.modelsLoading')}</div>;
  }

  const detailKey = probe.reason === 'no_key' ? 'inspector.modelsNoKey'
    : probe.reason === 'invalid_key' ? 'inspector.modelsInvalidKey'
      : probe.reason === 'rate_limited' ? 'inspector.modelsRateLimited'
        : probe.reason === 'backend_offline' ? 'inspector.modelsBackendOffline'
          : 'inspector.modelsFetchFailed';

  return (
    <div
      className="mt-2 flex flex-col items-start gap-1 rounded-xl border border-amber/40 bg-amber/10 p-[10px] text-t11_5 leading-normal text-amber"
      role="status"
    >
      <div className="font-semibold">{t('inspector.modelsNone')}</div>
      <div className="text-text-dim">{t(detailKey)}</div>
      {probe.reason === 'no_key' && onOpenKeys && (
        <button type="button" className="underline underline-offset-2 hover:opacity-80" onClick={onOpenKeys}>
          {t('inspector.keyRefManage')}
        </button>
      )}
    </div>
  );
}

/**
 * Input 노드 텍스트를 **문서 파일에서** 채운다 (PDF · DOCX · txt/md/csv…).
 *
 * 추출은 백엔드가 한다(`POST /api/v1/documents/extract`) — 브라우저에서 PDF 를
 * 파싱하려면 무거운 번들이 필요한데, 백엔드에는 `pdfplumber`/`python-docx` 가
 * 이미 있다. 파일은 서버에 저장되지 않고 추출된 텍스트만 돌아온다.
 *
 * 이미 적어 둔 내용이 있으면 먼저 물어본다 — 긴 글을 손으로 쓴 뒤 파일을 잘못
 * 고르면 그대로 날아가기 때문이다.
 */
function DocumentLoader({
  current, onLoaded, t,
}: { current: string; onLoaded: (text: string) => void; t: TFunction }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (current.trim() && !window.confirm(t('field.input.fileReplaceWarn'))) return;
    setBusy(true);
    setNote(null);
    try {
      const doc = await extractDocument(file);
      onLoaded(doc.text);
      setNote({
        kind: 'ok',
        text: doc.truncated
          ? t('field.input.fileTruncated', { chars: doc.chars.toLocaleString() })
          : doc.pages
            ? t('field.input.fileLoadedPages', {
              name: doc.filename, pages: doc.pages, chars: doc.chars.toLocaleString(),
            })
            : t('field.input.fileLoaded', { name: doc.filename, chars: doc.chars.toLocaleString() }),
      });
    } catch (err) {
      const code = err instanceof DocumentExtractError ? err.code : 'AC-E408';
      const hint = err instanceof DocumentExtractError ? err.hint : undefined;
      // 에러 문구는 코드 카탈로그가 이미 갖고 있다 (§17.3 — 코드 기반이라 자동 다국어).
      setNote({ kind: 'error', text: `${code} · ${issueText({ code, message: '' }).message}${hint ? ` — ${hint}` : ''}` });
    } finally {
      setBusy(false);
      // 같은 파일을 다시 고를 수 있게 비운다 (`change` 는 값이 같으면 안 뜬다).
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.yaml,.yml"
        onChange={(e) => { void handleFile(e.target.files?.[0]); }}
      />
      <button
        type="button"
        className="ac-btn flex items-center justify-center gap-[6px] !py-[5px] !text-t10_5"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp size={12} className="flex-none" />
        {busy ? t('field.input.fileLoading') : t('field.input.fileButton')}
      </button>
      {note && (
        <div
          className={cn('text-t10_5 leading-snug', note.kind === 'ok' ? 'text-emerald' : 'text-danger')}
          role={note.kind === 'error' ? 'alert' : 'status'}
        >
          {note.text}
        </div>
      )}
    </div>
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
