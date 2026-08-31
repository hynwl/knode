'use client';

import { ReactFlowProvider } from '@xyflow/react';
import { PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Canvas } from '@/canvas/Canvas';
import { useHotkeys } from '@/lib/hotkeys';
import { BackupModal } from '@/panels/BackupModal';
import { Header } from '@/panels/Header';
import { InspectorPanel } from '@/panels/InspectorPanel';
import { KeysModal } from '@/panels/KeysModal';
import { LogPanel } from '@/panels/LogPanel';
import { NodeLibrary } from '@/panels/NodeLibrary';
import { StatusBar } from '@/panels/StatusBar';
import { ToastHost } from '@/panels/ToastHost';
import { downloadDoc } from '@/persistence/fileIO';
import { hydrateFromStorage, useAppStore } from '@/store';
import { cancelRun, connectRunEvents, RunApiError, startRun, type RunEventsHandle } from '@/run/client';
import { handleRunFrame, handleReconnecting, handleStreamGaveUp } from '@/run/eventHandlers';
import { getTemplate } from '@/templates/builtin';
import { useSecretsStore } from '@/store/secrets';

type ModalKind = 'keys' | 'backup' | null;

export default function Page() {
  const [modal, setModal] = useState<ModalKind>(null);
  const [ready, setReady] = useState(false);

  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const runStatus = useAppStore((s) => s.runStatus);
  const issues = useAppStore((s) => s.issues);
  const leftPanelOpen = useAppStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const savedAt = useAppStore((s) => s.savedAt);
  const toast = useAppStore((s) => s.toast);
  const toDoc = useAppStore((s) => s.toDoc);

  useEffect(() => {
    useSecretsStore.getState().hydrate();
    // 저장된 워크스페이스가 없으면 기본 템플릿을 띄운다 (아티팩트 동작과 동일).
    if (!hydrateFromStorage()) {
      const tpl = getTemplate('blog');
      if (tpl) useAppStore.getState().replaceDoc(tpl.build());
    }
    useAppStore.getState().revalidate();
    setReady(true);
  }, []);

  const canRun = useMemo(
    () => !issues.some((i) => i.severity === 'error') && runStatus !== 'running' && runStatus !== 'queued',
    [issues, runStatus],
  );

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

  const onRun = useCallback(async () => {
    const store = useAppStore.getState();
    stopEventsStream();
    setStopPending(false);
    store.resetRun();
    store.setConsoleOpen(true);
    store.setRunStatus('queued');

    try {
      const secrets = useSecretsStore.getState().headerPayload();
      const result = await startRun(store.toDoc(), {}, secrets);
      useAppStore.getState().setRunStatus('queued', result.run_id);
      for (const w of result.warnings) {
        useAppStore.getState().toast('info', `[${w.code}] ${w.message}`);
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
      const message = err instanceof RunApiError ? `[${err.code}] ${err.message}` : '실행을 시작하지 못했습니다.';
      useAppStore.getState().setRunStatus('idle');
      useAppStore.getState().toast('error', message, true);
    }
  }, [stopEventsStream]);

  const onStop = useCallback(() => {
    const runId = useAppStore.getState().runId;
    if (!runId || stopPending) return;
    setStopPending(true);
    // CrewAI 는 진행 중인 LLM 호출을 중간에 끊지 못한다 — 취소는 태스크 경계에서
    // 걸린다. 그 사실을 숨기면 사용자가 "안 멈춘다"고 오해해 Stop 을 연타한다.
    useAppStore.getState().toast('info', '취소를 요청했습니다 — 진행 중인 태스크가 끝나는 즉시 중단됩니다.');
    cancelRun(runId).catch(() => {
      setStopPending(false);
      useAppStore.getState().toast('error', '취소 요청이 실패했습니다.');
    });
  }, [stopPending]);

  const onExport = useCallback(() => {
    try {
      downloadDoc(toDoc());
      toast('success', '파일로 내보냈습니다.');
    } catch {
      toast('error', 'API 키가 포함되어 내보내기가 차단되었습니다. (AC-E404)', true);
    }
  }, [toDoc, toast]);

  useHotkeys({
    onRun,
    onStop,
    onExport,
    onImport: () => setModal('backup'),
    onCommandPalette: () => toast('info', '커맨드 팔레트는 M4 에서 제공됩니다.'),
    onAutoLayout: () => toast('info', 'Auto Layout 은 M3 에서 제공됩니다.'),
    onFitSelection: () => {},
    onFitAll: () => {},
  });

  return (
    <div className="flex h-screen flex-col">
      <Header
        projectName={projectName}
        onProjectNameChange={setProjectName}
        runStatus={runStatus}
        canRun={canRun}
        onRun={onRun}
        onStop={onStop}
        stopPending={stopPending}
        onOpenTemplates={() => toast('info', '템플릿 갤러리는 M4 에서 제공됩니다.')}
        onOpenSettings={() => setModal('keys')}
        onOpenKeys={() => setModal('keys')}
        onOpenBackup={() => setModal('backup')}
        savedLabel={savedAt ? `저장됨 · ${relativeTime(savedAt)}` : ''}
      />

      <div className="relative flex min-h-0 flex-1">
        {leftPanelOpen ? (
          <NodeLibrary />
        ) : (
          <button
            type="button"
            onClick={() => togglePanel('left')}
            className="absolute left-2 top-2 z-dropdown rounded-md border border-border bg-surface-3 p-[6px] text-text-faint hover:text-text"
            aria-label="노드 라이브러리 열기"
          >
            <PanelLeftOpen size={14} />
          </button>
        )}

        <div className="relative min-w-0 flex-1">
          {ready && (
            <ReactFlowProvider>
              <Canvas />
            </ReactFlowProvider>
          )}
        </div>

        {rightPanelOpen ? (
          <aside className="flex w-[300px] flex-none flex-col overflow-hidden border-l border-border-soft bg-surface">
            <button
              type="button"
              onClick={() => togglePanel('right')}
              className="absolute right-[286px] top-2 z-dropdown rounded-md p-1 text-text-faint hover:text-text"
              aria-label="인스펙터 접기"
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
            aria-label="인스펙터 열기"
          >
            <PanelRightOpen size={14} />
          </button>
        )}
      </div>

      <LogPanel />
      <StatusBar backendOnline={null} ollama={null} />

      <KeysModal open={modal === 'keys'} onClose={() => setModal(null)} />
      <BackupModal open={modal === 'backup'} onClose={() => setModal(null)} />
      <ToastHost />
    </div>
  );
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return '방금 전';
  if (diff < 60) return `${diff}초 전`;
  return `${Math.floor(diff / 60)}분 전`;
}
