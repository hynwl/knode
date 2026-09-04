'use client';

import { ReactFlowProvider, type ReactFlowInstance } from '@xyflow/react';
import { PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Canvas } from '@/canvas/Canvas';
import { autoLayoutPositions, groupBoundsFor, type NodeSize } from '@/canvas/layout';
import { useHotkeys } from '@/lib/hotkeys';
import { BackupModal } from '@/panels/BackupModal';
import { CommandPalette } from '@/panels/CommandPalette';
import { Header } from '@/panels/Header';
import { HumanInputModal } from '@/panels/HumanInputModal';
import { InspectorPanel } from '@/panels/InspectorPanel';
import { KeysModal } from '@/panels/KeysModal';
import { LogPanel } from '@/panels/LogPanel';
import { NodeLibrary } from '@/panels/NodeLibrary';
import { RunParametersModal } from '@/panels/RunParametersModal';
import { StatusBar } from '@/panels/StatusBar';
import { ToastHost } from '@/panels/ToastHost';
import { downloadDoc } from '@/persistence/fileIO';
import { importFromShareHash, SHARE_HASH_PREFIX } from '@/persistence/shareLink';
import { hydrateFromStorage, useAppStore } from '@/store';
import { cancelRun, connectRunEvents, RunApiError, startRun, type RunEventsHandle } from '@/run/client';
import { handleRunFrame, handleReconnecting, handleStreamGaveUp } from '@/run/eventHandlers';
import { checkBackendHealth, fetchOllamaModels, fetchProviderPresets, fetchToolTypes } from '@/lib/backendStatus';
import { ExportCodeModal } from '@/panels/ExportCodeModal';
import { TemplatesModal } from '@/panels/TemplatesModal';
import { BUILTIN_TEMPLATES, getTemplate, type TemplateMeta } from '@/templates/builtin';
import { fetchTemplates } from '@/templates/remote';
import { useSecretsStore } from '@/store/secrets';
import { useT, type TFunction } from '@/i18n/react';
import { issueText } from '@/validation/issues';

/** Spec §13.1 "성공 → 모델 리스트 캐시(60초)" 와 같은 결로 상태바를 재폴링한다. */
const STATUS_POLL_MS = 60_000;
/** Ollama Base URL 입력칸에 타이핑하는 동안 매 keystroke 로 프로브하지 않기 위한 디바운스. */
const OLLAMA_HOST_DEBOUNCE_MS = 600;

type ModalKind = 'keys' | 'backup' | 'templates' | 'export' | null;

export default function Page() {
  const t = useT();
  const [modal, setModal] = useState<ModalKind>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [runParamsOpen, setRunParamsOpen] = useState(false);
  // Queue Prompt vs Dry Run 둘 다 Input 노드가 있으면 같은 파라미터 모달을 거친다
  // (Spec §5.8) — 모달이 열려 있는 동안 "이번엔 어느 쪽을 실행할지" 기억해둔다.
  const dryRunPendingRef = useRef(false);
  const [ready, setReady] = useState(false);

  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const runStatus = useAppStore((s) => s.runStatus);
  const dryRun = useAppStore((s) => s.dryRun);
  const nodes = useAppStore((s) => s.nodes);
  const nodeStates = useAppStore((s) => s.nodeStates);
  const usage = useAppStore((s) => s.usage);
  const startedAt = useAppStore((s) => s.startedAt);
  const issues = useAppStore((s) => s.issues);
  const leftPanelOpen = useAppStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const savedAt = useAppStore((s) => s.savedAt);
  const toast = useAppStore((s) => s.toast);
  const toDoc = useAppStore((s) => s.toDoc);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const ollamaStatus = useAppStore((s) => s.ollamaStatus);
  const ollamaHost = useSecretsStore((s) => s.ollamaHost);
  const secretValues = useSecretsStore((s) => s.secrets);
  // 갤러리 목록은 백엔드(`GET /api/v1/templates`)를 우선하되, 오프라인이면 번들
  // 폴백으로 그대로 열린다 (Spec §15.1 MUST "백엔드 없이도 열람 가능").
  const [templates, setTemplates] = useState<TemplateMeta[]>(BUILTIN_TEMPLATES);

  // 부팅 1회 — `t` 가 로케일 전환마다 새 참조가 되지만 여기서 다시 돌면 안 된다
  // (그래프를 통째로 다시 불러오게 된다). 그래서 최신 `t` 를 ref 로만 들고 간다.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    useSecretsStore.getState().hydrate();

    void (async () => {
      // 공유 링크(`#share=...`, §14.3)가 있으면 저장된 워크스페이스/기본 템플릿보다
      // 우선한다 — 링크를 클릭한 사람의 의도는 그 그래프를 보는 것이다.
      const hash = window.location.hash;
      if (hash.startsWith(SHARE_HASH_PREFIX)) {
        // 재로드/스크린샷 공유 시 남의 그래프가 노출되지 않도록 즉시 프래그먼트를 지운다.
        history.replaceState(null, '', window.location.pathname + window.location.search);
        try {
          const { doc, redactions } = await importFromShareHash(hash);
          useAppStore.getState().replaceDoc(doc);
          useAppStore.getState().toast(
            redactions.length ? 'error' : 'success',
            redactions.length
              ? tRef.current('toast.shareLoadedRedacted', { count: redactions.length })
              : tRef.current('toast.shareLoaded'),
            redactions.length > 0,
          );
          useAppStore.getState().revalidate();
          setReady(true);
          return;
        } catch {
          useAppStore.getState().toast('error', tRef.current('toast.shareFailed'), true);
          // 아래 기본 부팅 경로로 이어간다.
        }
      }

      // 저장된 워크스페이스가 없으면 기본 템플릿을 띄운다.
      // 첫 화면은 §15.1 이 "⭐ 3분 첫 성공"으로 지목한 Hello Crew 다 — 키 1개(OPENAI_API_KEY)로
      // 끝까지 도는 최소 그래프. blog 는 키가 2개라 첫 방문자를 실행 전에 막아 세운다.
      if (!hydrateFromStorage()) {
        const tpl = getTemplate('hello');
        if (tpl) useAppStore.getState().replaceDoc(tpl.build());
      }
      useAppStore.getState().revalidate();
      setReady(true);
    })();
  }, []);

  // Spec §13.1 자동 감지: 부팅 시 1회 + 60초 주기 재폴링. 백엔드 헬스체크와
  // 프로바이더 프리셋(§5.3)도 같은 자리에서 1회/주기로 채운다.
  const refreshOllama = useCallback((force: boolean) => {
    fetchOllamaModels(useSecretsStore.getState().ollamaHost, force).then((r) => {
      useAppStore.getState().setOllamaStatus({ available: r.available, models: r.models, reason: r.reason });
    });
  }, []);

  useEffect(() => {
    checkBackendHealth().then((ok) => useAppStore.getState().setBackendOnline(ok));
    fetchProviderPresets().then((map) => useAppStore.getState().setProviderPresets(map));
    fetchToolTypes().then((types) => useAppStore.getState().setToolTypes(types));
    fetchTemplates().then(setTemplates);
  }, []);

  const firstOllamaProbeRef = useRef(true);
  useEffect(() => {
    // 첫 마운트는 즉시 조회, Ollama Base URL 입력 중 변경은 디바운스한다
    // (KeysModal 텍스트 입력마다 프로브를 쏘지 않기 위함).
    if (firstOllamaProbeRef.current) {
      firstOllamaProbeRef.current = false;
      refreshOllama(false);
      return;
    }
    const t = setTimeout(() => refreshOllama(false), OLLAMA_HOST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ollamaHost, refreshOllama]);

  useEffect(() => {
    const id = setInterval(() => {
      checkBackendHealth().then((ok) => useAppStore.getState().setBackendOnline(ok));
      refreshOllama(false);
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refreshOllama]);

  const canRun = useMemo(
    () => !issues.some((i) => i.severity === 'error') && runStatus !== 'running' && runStatus !== 'queued',
    [issues, runStatus],
  );
  // 헤더의 "N개 오류" 칩이 순서대로 순회할 노드 목록 (Spec §17.4-2).
  const errorNodeIds = useMemo(
    () => [...new Set(issues.filter((i) => i.severity === 'error' && i.nodeId).map((i) => i.nodeId!))],
    [issues],
  );

  // Run Progress Bar (Spec §3.5-14): "3/7 tasks · 00:42 · ~$0.014".
  // 경과시간은 매초 갱신돼야 하므로 실행 중에만 도는 1초 틱으로 리렌더를 강제한다.
  const running = runStatus === 'running' || runStatus === 'queued';
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const progress = useMemo(() => {
    if (!running) return undefined;
    const taskNodes = nodes.filter((n) => n.type === 'task' && !n.ui.bypassed);
    const done = taskNodes.filter((n) => {
      const status = nodeStates[n.id]?.status;
      return status === 'succeeded' || status === 'failed' || status === 'skipped' || status === 'cancelled';
    }).length;
    const elapsedS = startedAt ? Math.max(0, Math.floor((nowTick - startedAt) / 1000)) : 0;
    return { done, total: taskNodes.length, elapsedS, costUsd: usage.costUsd };
  }, [running, nodes, nodeStates, startedAt, nowTick, usage.costUsd]);

  const eventsHandleRef = useRef<RunEventsHandle | null>(null);
  const [stopPending, setStopPending] = useState(false);

  // 실행이 끝나면(성공/실패/취소) 취소 대기 표시를 원복한다.
  useEffect(() => {
    if (runStatus !== 'running' && runStatus !== 'queued') setStopPending(false);
  }, [runStatus]);

  const stopEventsStream = useCallback(() => {
    eventsHandleRef.current?.stop();
    eventsHandleRef.current = null;
  }, []);

  useEffect(() => () => stopEventsStream(), [stopEventsStream]);

  const startRunWithInputs = useCallback(async (inputs: Record<string, unknown>, dryRun = false) => {
    const store = useAppStore.getState();
    stopEventsStream();
    setStopPending(false);
    store.resetRun(dryRun);
    store.setConsoleOpen(true);
    store.setRunStatus('queued');

    try {
      const secrets = useSecretsStore.getState().headerPayload();
      const result = await startRun(store.toDoc(), inputs, secrets, { dryRun });
      useAppStore.getState().setRunStatus('queued', result.run_id);
      for (const w of result.warnings) {
        // `messageKey`/`params` 가 있으면 지금 로케일로 풀어서 띄운다 (§17.3).
        const text = issueText({
          code: w.code, message: w.message,
          messageKey: w.message_key ?? undefined,
          params: w.params ?? undefined,
        }).message;
        useAppStore.getState().toast('info', t('run.coded', { code: w.code, message: text }));
      }

      eventsHandleRef.current = connectRunEvents(result.run_id, {
        onFrame: handleRunFrame,
        onReconnecting: handleReconnecting,
        onClosed: (reason) => {
          if (reason === 'gave-up') handleStreamGaveUp();
          eventsHandleRef.current = null;
        },
      });
    } catch (err) {
      // 422 면 `issues[0]` 에 `messageKey`/`params` 가 실려 있다 — 그걸 그대로
      // 넘겨야 영어 UI 에서 백엔드 동적 메시지가 한국어로 남지 않는다 (§17.3).
      const first = err instanceof RunApiError ? err.issues?.[0] : undefined;
      const message = err instanceof RunApiError
        ? t('run.coded', {
            code: err.code,
            message: issueText({
              code: err.code,
              message: err.message,
              messageKey: first?.messageKey ?? undefined,
              hint: first?.hint ?? undefined,
              params: first?.params ?? undefined,
            }).message,
          })
        : t('run.startFailed');
      useAppStore.getState().setRunStatus('idle');
      useAppStore.getState().toast('error', message, true);
    }
  }, [stopEventsStream, t]);

  /**
   * `Queue Prompt` 진입점. Input 노드가 있으면 실행 파라미터 모달을 먼저 띄운다
   * (Spec §5.8 동작 흐름 3). 없으면 바로 실행 — 기존 동작 그대로 유지.
   */
  const onRun = useCallback(() => {
    const hasInputNodes = useAppStore.getState().nodes.some((n) => n.type === 'input');
    dryRunPendingRef.current = false;
    if (hasInputNodes) {
      setRunParamsOpen(true);
      return;
    }
    void startRunWithInputs({}, false);
  }, [startRunWithInputs]);

  /**
   * Dry Run 진입점 (Spec §11.3). "Queue Prompt"와 같은 파라미터 모달 흐름을
   * 그대로 타되, 제출 시 `dry_run: true`로 보낸다는 것만 다르다.
   */
  const onDryRun = useCallback(() => {
    const hasInputNodes = useAppStore.getState().nodes.some((n) => n.type === 'input');
    dryRunPendingRef.current = true;
    if (hasInputNodes) {
      setRunParamsOpen(true);
      return;
    }
    void startRunWithInputs({}, true);
  }, [startRunWithInputs]);

  const onRunParamsSubmit = useCallback((inputs: Record<string, string>) => {
    setRunParamsOpen(false);
    void startRunWithInputs(inputs, dryRunPendingRef.current);
  }, [startRunWithInputs]);

  /**
   * 헤더 Templates 드롭다운에서 내장 템플릿(§15.1)을 골랐을 때. Restore(§14.3)와 같이
   * 현재 캔버스를 그대로 대체한다. 로컬 템플릿은 이 머신에 실제로 설치된 Ollama
   * 모델로 만들어져야 하므로(§13.1) 감지 결과를 넘긴다.
   */
  const onSelectTemplate = useCallback((id: string) => {
    const tpl = templates.find((t) => t.id === id) ?? getTemplate(id);
    if (!tpl) return;
    setModal(null);
    const models = useAppStore.getState().ollamaStatus?.models.map((m) => m.name);
    useAppStore.getState().replaceDoc(tpl.build(models));
    toast(
      'success',
      tpl.requiresKeys.length
        ? t('toast.templateLoadedWithKeys', { name: tpl.name, keys: tpl.requiresKeys.join(', ') })
        : t('toast.templateLoadedFree', { name: tpl.name }),
    );
  }, [templates, toast, t]);

  // 자물쇠 배지(§15.2)는 "값이 실제로 들어 있는" 키만 보유로 친다.
  const availableKeys = useMemo(
    () => Object.entries(secretValues).filter(([, v]) => Boolean(v && v.trim())).map(([k]) => k),
    [secretValues],
  );
  const ollamaModels = useMemo(() => ollamaStatus?.models.map((m) => m.name), [ollamaStatus]);

  const onStop = useCallback(() => {
    const runId = useAppStore.getState().runId;
    if (!runId || stopPending) return;
    setStopPending(true);
    // CrewAI 는 진행 중인 LLM 호출을 중간에 끊지 못한다 — 취소는 태스크 경계에서
    // 걸린다. 그 사실을 숨기면 사용자가 "안 멈춘다"고 오해해 Stop 을 연타한다.
    useAppStore.getState().toast('info', t('run.cancelRequested'));
    cancelRun(runId).catch(() => {
      setStopPending(false);
      useAppStore.getState().toast('error', t('run.cancelFailed'));
    });
  }, [stopPending, t]);

  const onExport = useCallback(() => {
    try {
      downloadDoc(toDoc());
      toast('success', t('toast.exported'));
    } catch {
      toast('error', t('toast.exportBlocked'), true);
    }
  }, [toDoc, toast, t]);

  // Auto Layout / Group 은 노드 실측 크기가 있어야 제대로 계산된다 (접힌 노드와
  // 펼친 노드의 높이가 다르다). 아직 렌더 전이면 layout.ts 의 폴백 추정치를 쓴다.
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const measuredSize = useCallback((id: string): NodeSize | undefined => {
    // getNode() 는 우리가 넘긴 원본 객체를 돌려줘 실측값이 없다 — 실측은 내부 노드에만 있다
    // (@xyflow/react: `getNode: (id) => getInternalNode(id)?.internals.userNode`).
    const measured = rfRef.current?.getInternalNode(id)?.measured;
    return measured?.width && measured.height
      ? { width: measured.width, height: measured.height }
      : undefined;
  }, []);

  const onAutoLayout = useCallback(() => {
    const store = useAppStore.getState();
    const positions = autoLayoutPositions(store.nodes, store.edges, measuredSize);
    const moved = Object.keys(positions).length;
    if (!moved) {
      toast('info', t('toast.layoutEmpty'));
      return;
    }
    store.applyLayout(positions);
    toast('success', t('toast.layoutDone', { count: moved }));
  }, [measuredSize, toast, t]);

  const onGroupSelection = useCallback(() => {
    const store = useAppStore.getState();
    const bounds = groupBoundsFor(store.nodes, store.selectedNodeIds, measuredSize);
    if (!bounds) {
      toast('info', t('toast.groupNeedTwo'));
      return;
    }
    store.groupNodes(bounds.ids, bounds);
    toast('success', t('toast.groupDone', { count: bounds.ids.length }));
  }, [measuredSize, toast, t]);

  const onUngroupSelection = useCallback(() => {
    const store = useAppStore.getState();
    if (!store.ungroupNodes(store.selectedNodeIds)) {
      toast('info', t('toast.ungroupNone'));
      return;
    }
    toast('success', t('toast.ungroupDone'));
  }, [toast, t]);

  useHotkeys({
    onRun,
    onStop,
    onExport,
    onImport: () => setModal('backup'),
    onCommandPalette: () => setPaletteOpen((v) => !v),
    onAutoLayout,
    onGroupSelection,
    onUngroupSelection,
    onFitSelection: () => {},
    onFitAll: () => {},
  });

  return (
    <div className="flex h-screen flex-col">
      <Header
        projectName={projectName}
        onProjectNameChange={setProjectName}
        runStatus={runStatus}
        dryRun={dryRun}
        progress={progress}
        canRun={canRun}
        errorNodeIds={errorNodeIds}
        onFocusNode={(nodeId) => useAppStore.getState().requestFocusNode(nodeId)}
        onRun={onRun}
        onDryRun={onDryRun}
        onStop={onStop}
        stopPending={stopPending}
        onOpenTemplates={() => setModal('templates')}
        onOpenExport={() => setModal('export')}
        onOpenSettings={() => setModal('keys')}
        onOpenKeys={() => setModal('keys')}
        onOpenBackup={() => setModal('backup')}
        savedLabel={savedAt ? t('header.saved', { when: relativeTime(savedAt, t) }) : ''}
      />

      <div className="relative flex min-h-0 flex-1">
        {leftPanelOpen ? (
          <NodeLibrary />
        ) : (
          <button
            type="button"
            onClick={() => togglePanel('left')}
            className="absolute left-2 top-2 z-dropdown rounded-md border border-border bg-surface-3 p-[6px] text-text-faint hover:text-text"
            aria-label={t('library.open')}
          >
            <PanelLeftOpen size={14} />
          </button>
        )}

        <div className="relative min-w-0 flex-1">
          {ready && (
            <ReactFlowProvider>
              <Canvas onInit={(instance) => { rfRef.current = instance; }} />
            </ReactFlowProvider>
          )}
        </div>

        {rightPanelOpen ? (
          <aside className="flex w-[300px] flex-none flex-col overflow-hidden border-l border-border-soft bg-surface">
            <button
              type="button"
              onClick={() => togglePanel('right')}
              className="absolute right-[286px] top-2 z-dropdown rounded-md p-1 text-text-faint hover:text-text"
              aria-label={t('inspector.collapse')}
            >
              <PanelRightClose size={14} />
            </button>
            <InspectorPanel />
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => togglePanel('right')}
            className="absolute right-2 top-2 z-dropdown rounded-md border border-border bg-surface-3 p-[6px] text-text-faint hover:text-text"
            aria-label={t('inspector.open')}
          >
            <PanelRightOpen size={14} />
          </button>
        )}
      </div>

      <LogPanel />
      <StatusBar
        backendOnline={backendOnline}
        ollama={ollamaStatus ? { available: ollamaStatus.available, count: ollamaStatus.models.length } : null}
        onOllamaClick={() => refreshOllama(true)}
      />

      <KeysModal open={modal === 'keys'} onClose={() => setModal(null)} />
      <BackupModal open={modal === 'backup'} onClose={() => setModal(null)} />
      <TemplatesModal
        open={modal === 'templates'}
        onClose={() => setModal(null)}
        templates={templates}
        availableKeys={availableKeys}
        ollamaModels={ollamaModels}
        onUse={onSelectTemplate}
      />
      <ExportCodeModal open={modal === 'export'} onClose={() => setModal(null)} />
      <RunParametersModal
        open={runParamsOpen}
        dryRun={dryRunPendingRef.current}
        onClose={() => setRunParamsOpen(false)}
        onSubmit={onRunParamsSubmit}
      />
      <HumanInputModal />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        canRun={canRun}
        running={running}
        onRun={onRun}
        onDryRun={onDryRun}
        onStop={onStop}
        onExport={onExport}
        onOpenBackup={() => setModal('backup')}
        onOpenTemplates={() => setModal('templates')}
        onOpenSettings={() => setModal('keys')}
        onOpenExportCode={() => setModal('export')}
        onAutoLayout={onAutoLayout}
        onGroupSelection={onGroupSelection}
        onUngroupSelection={onUngroupSelection}
        templates={templates}
        onSelectTemplate={onSelectTemplate}
      />
      <ToastHost />
    </div>
  );
}

function relativeTime(ts: number, t: TFunction): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return t('header.savedJustNow');
  if (diff < 60) return t('header.savedSeconds', { n: diff });
  return t('header.savedMinutes', { n: Math.floor(diff / 60) });
}
