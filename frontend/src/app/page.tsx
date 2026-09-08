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
import { PublishPreview } from '@/features/publish/PublishPreview';
import { RunParametersModal } from '@/panels/RunParametersModal';
import { StatusBar } from '@/panels/StatusBar';
import { ToastHost } from '@/panels/ToastHost';
import { Welcome } from '@/panels/Welcome';
import { downloadDoc } from '@/persistence/fileIO';
import { hasSeenWelcome, markWelcomeSeen } from '@/persistence/localStorage';
import { importFromShareHash, SHARE_HASH_PREFIX } from '@/persistence/shareLink';
import { emptyDoc, hydrateFromStorage, useAppStore } from '@/store';
import { cancelRun, connectRunEvents, RunApiError, startRun, type RunEventsHandle } from '@/run/client';
import { handleRunFrame, handleReconnecting, handleStreamGaveUp } from '@/run/eventHandlers';
import { checkBackendHealth, fetchOllamaModels, fetchProviderPresets, fetchToolTypes } from '@/lib/backendStatus';
import { ExportCodeModal } from '@/panels/ExportCodeModal';
import { TemplatesModal } from '@/panels/TemplatesModal';
import { TutorialModal } from '@/panels/TutorialModal';
import { SaveTemplateModal } from '@/panels/SaveTemplateModal';
import { BUILTIN_TEMPLATES, getTemplate, type TemplateMeta } from '@/templates/builtin';
import { fetchTemplates } from '@/templates/remote';
import {
  addCustomTemplate, effectiveTemplates, getCustomTemplate, loadSourceTemplateId,
  overwriteTemplate, removeTemplate, saveSourceTemplateId,
} from '@/templates/custom';
import { fetchHubIndex, fetchHubTeamDoc, hubSourceUrl, type HubTeamEntry } from '@/templates/hub';
import { filledSlots, useSecretsStore } from '@/store/secrets';
import { useT, type TFunction } from '@/i18n/react';
import { issueText } from '@/validation/issues';
import { ulid } from '@/lib/ulid';
import type { CanvasDoc } from '@/types/canvas';

/** Spec §13.1 "성공 → 모델 리스트 캐시(60초)" 와 같은 결로 상태바를 재폴링한다. */
const STATUS_POLL_MS = 60_000;
/** Ollama Base URL 입력칸에 타이핑하는 동안 매 keystroke 로 프로브하지 않기 위한 디바운스. */
const OLLAMA_HOST_DEBOUNCE_MS = 600;

type ModalKind = 'keys' | 'backup' | 'templates' | 'tutorial' | 'export' | 'save' | 'publish' | null;

export default function Page() {
  const t = useT();
  const [modal, setModal] = useState<ModalKind>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [runParamsOpen, setRunParamsOpen] = useState(false);
  // Queue Prompt vs Dry Run 둘 다 Input 노드가 있으면 같은 파라미터 모달을 거친다
  // (Spec §5.8) — 모달이 열려 있는 동안 "이번엔 어느 쪽을 실행할지" 기억해둔다.
  const dryRunPendingRef = useRef(false);
  const [ready, setReady] = useState(false);
  // 서버 스냅샷은 항상 `false`(SSR 은 localStorage 를 모른다) — 마운트 후 1회만
  // 켠다. 방문 이력이 있으면 아예 켜지 않아 화면이 깜빡이지 않는다.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (!hasSeenWelcome()) setShowWelcome(true);
  }, []);

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
  const hubStatus = useAppStore((s) => s.hubStatus);
  const ollamaHost = useSecretsStore((s) => s.ollamaHost);
  const keySlots = useSecretsStore((s) => s.slots);
  // 갤러리 목록은 백엔드(`GET /api/v1/templates`)를 우선하되, 오프라인이면 번들
  // 폴백으로 그대로 열린다 (Spec §15.1 MUST "백엔드 없이도 열람 가능").
  const [templates, setTemplates] = useState<TemplateMeta[]>(BUILTIN_TEMPLATES);
  // 사용자가 만든 커스텀 템플릿 + 삭제(숨김) 목록은 localStorage 에 있어 반응형이
  // 아니다 — add/remove 때마다 이 카운터를 올려 `galleryTemplates` memo 를 강제로
  // 다시 계산시킨다.
  const [templatesRevision, setTemplatesRevision] = useState(0);
  /**
   * 지금 캔버스의 출처 커스텀 템플릿 id. Save 가 새로 만들지 덮어쓸지를 가른다
   * (`templates/custom.ts` 의 `SOURCE_KEY` 주석). `templatesRevision` 이 오를 때
   * 다시 읽는 이유는 그 사이 템플릿이 지워졌을 수 있어서다.
   */
  const [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null);
  const galleryTemplates = useMemo(
    () => effectiveTemplates(templates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, templatesRevision],
  );

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
          // 남이 보낸 그래프다 — 내 템플릿을 덮어쓸 대상이 아니다.
          setSourceTemplateId(null);
          saveSourceTemplateId(null);
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
      if (hydrateFromStorage()) {
        // 복원한 워크스페이스가 커스텀 템플릿에서 온 것이면 Save 가 계속 그것을
        // 덮어쓰도록 출처를 같이 되살린다. 새로고침했다고 사본이 생기면 안 된다.
        setSourceTemplateId(loadSourceTemplateId());
      } else {
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
    // Hub 는 self-host 필수 기능이 아니라(M5 P-D3) 60초 재폴링 없이 부팅 1회만 —
    // 미설정이면 `fetchHubIndex()` 가 네트워크 없이 즉시 `available:false` 를 준다.
    fetchHubIndex().then((r) => useAppStore.getState().setHubStatus(r));
  }, []);

  // 키를 추가·삭제하면 "키 미등록"(AC-W606/AC-E606) 판정이 바뀐다. 검증은 그래프
  // 변경에만 걸려 있으므로 여기서 한 번 더 깨워 준다 — 결과가 같으면
  // `revalidate()` 의 지문 비교가 리렌더를 막는다(M3-T11).
  useEffect(() => {
    useAppStore.getState().revalidate();
  }, [keySlots]);

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
    const tpl = galleryTemplates.find((t) => t.id === id) ?? getTemplate(id);
    if (!tpl) return;
    setModal(null);
    const models = useAppStore.getState().ollamaStatus?.models.map((m) => m.name);
    useAppStore.getState().replaceDoc(tpl.build(models));
    // 갤러리에서 연 것은 **무엇이든** 이후 Save 의 대상이 된다(워드에서 파일을
    // 열면 저장이 그 파일로 가는 것과 같다). 내장 템플릿은 코드에 있어 진짜로
    // 고칠 수 없으므로, 저장하면 같은 id 의 로컬 덮어쓰기본이 원본 자리를 대신한다
    // (`templates/custom.ts` 의 `overwriteTemplate`).
    setSourceTemplateId(id);
    saveSourceTemplateId(id);
    toast(
      'success',
      tpl.requiresKeys.length
        ? t('toast.templateLoadedWithKeys', { name: t.k(tpl.name), keys: tpl.requiresKeys.join(', ') })
        : t('toast.templateLoadedFree', { name: t.k(tpl.name) }),
    );
  }, [galleryTemplates, toast, t]);

  /**
   * Hub 탭의 "Fork" (M5-T7). 목록 조회 때 못 받은 실제 그래프를 그제서야 내려받고,
   * `forked_from` 에 원본 계보(id/revision/출처)를 한 칸 기록한다 — `ForkOrigin`
   * 은 체인 전체가 아니라 바로 앞 한 단계만 담는다(`types/canvas.ts` 주석).
   * 이 캔버스는 로컬에서 새로 시작하는 문서이므로 id 를 새로 발급하고
   * revision/license 는 `emptyDoc()` 과 같은 기본값으로 되돌린다 — 재게시 여부와
   * 라이선스는 이 사용자가 다시 정할 몫이다(P-D4).
   */
  const onForkHub = useCallback(async (entry: HubTeamEntry) => {
    try {
      const remote = await fetchHubTeamDoc(entry);
      const now = new Date().toISOString();
      const forked: CanvasDoc = {
        ...remote,
        id: `cvs_${ulid()}`,
        revision: 0,
        license: null,
        forked_from: { id: entry.id, revision: entry.revision, source: hubSourceUrl(), name: entry.name },
        created_at: now,
        updated_at: now,
      };
      setModal(null);
      useAppStore.getState().replaceDoc(forked);
      setSourceTemplateId(null);
      saveSourceTemplateId(null);
      toast('success', t('toast.hubForked', { name: entry.name }));
    } catch {
      toast('error', t('toast.hubForkFailed', { name: entry.name }), true);
    }
  }, [toast, t]);

  /** Templates 갤러리의 "New +" — 백지 캔버스로 시작해서 직접 템플릿을 만들 수 있게 한다. */
  const onNewBlank = useCallback(() => {
    setModal(null);
    useAppStore.getState().replaceDoc(emptyDoc());
    setSourceTemplateId(null);
    saveSourceTemplateId(null);
    toast('info', t('toast.blankCanvas'));
  }, [toast, t]);

  /**
   * 저장 모달의 확인 — 첫 저장이거나 "다른 이름으로 저장" 이다(그냥 덮어쓰기는
   * 아래 `onSave` 가 모달 없이 처리한다). `asNew` 면 언제나 새 템플릿을 만들고,
   * 아니면(모달의 "업데이트") 출처 템플릿을 여기 적은 이름·설명으로 덮어쓴다.
   */
  const onSaveAsTemplate = useCallback((name: string, description: string, asNew: boolean) => {
    const target = asNew ? null : saveTargetRef.current?.id ?? null;
    const updated = target ? overwriteTemplate(target, name, description, toDoc()) : null;
    if (updated) {
      setSourceTemplateId(updated.id);
      saveSourceTemplateId(updated.id);
    } else {
      // 출처가 없거나(신규) 그 사이 지워졌으면 새로 만든다 — 저장을 실패시키지 않는다.
      const created = addCustomTemplate(name, description, toDoc());
      setSourceTemplateId(created.id);
      saveSourceTemplateId(created.id);
    }
    // 캔버스 제목과 템플릿 이름은 같은 것을 가리킨다 — 모달에서 이름을 고쳤으면
    // 헤더 이름 칸도 따라간다(워드의 "다른 이름으로 저장" 후 제목 표시줄).
    if (name !== useAppStore.getState().projectName) setProjectName(name);
    setTemplatesRevision((v) => v + 1);
    toast('success', t(updated ? 'toast.templateUpdated' : 'toast.templateSaved', { name }));
  }, [toDoc, setProjectName, toast, t]);

  /**
   * 지금 캔버스의 저장 대상. 커스텀 템플릿이면 저장본에서, 아직 덮어쓴 적 없는
   * 내장/백엔드 템플릿이면 갤러리 메타에서 이름·설명을 가져온다. 갤러리에 없으면
   * (지워졌거나 백엔드 목록이 바뀌었으면) `null` — 그때는 새로 저장한다.
   * `templatesRevision` 을 의존성에 넣어 그 사이 이름이 바뀌었으면 다시 읽는다.
   */
  const saveTarget = useMemo(() => {
    if (!sourceTemplateId) return null;
    const stored = getCustomTemplate(sourceTemplateId);
    if (stored) return { id: stored.id, name: stored.name, description: stored.description };
    const tpl = galleryTemplates.find((x) => x.id === sourceTemplateId);
    return tpl ? { id: tpl.id, name: t.k(tpl.name), description: t.k(tpl.description) } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LocalStorage 읽기라 revision 이 트리거다
  }, [sourceTemplateId, templatesRevision, galleryTemplates]);

  // `onSaveAsTemplate` 이 `saveTarget` 을 의존성으로 잡으면 모달이 열려 있는 동안
  // 매번 새 콜백이 된다. 최신 값만 필요하므로 ref 로 들고 간다.
  const saveTargetRef = useRef(saveTarget);
  saveTargetRef.current = saveTarget;

  /**
   * 헤더 Save — **대상이 있으면 묻지 않고 그대로 덮어쓴다**(워드의 Ctrl+S).
   * 이름은 헤더 이름 칸을 따르고, 설명은 저장돼 있던 것을 유지한다. 대상이 없을
   * 때만(백지 캔버스·공유 링크·지워진 템플릿) 이름을 묻는 모달을 연다.
   */
  const onSave = useCallback(() => {
    const target = saveTarget;
    if (!target) { setModal('save'); return; }
    const name = projectName.trim() || target.name;
    overwriteTemplate(target.id, name, target.description, toDoc());
    setSourceTemplateId(target.id);
    saveSourceTemplateId(target.id);
    setTemplatesRevision((v) => v + 1);
    toast('success', t('toast.templateUpdated', { name }));
  }, [saveTarget, projectName, toDoc, toast, t]);

  /** 템플릿 삭제 — 커스텀이면 완전히, 내장/백엔드 템플릿이면 갤러리에서 숨긴다. */
  const onDeleteTemplate = useCallback((id: string) => {
    const tpl = galleryTemplates.find((x) => x.id === id);
    removeTemplate(id);
    // 지운 것이 Save 의 대상이었으면 다음 Save 는 새로 만들어야 한다.
    // 함수형 갱신이라 `sourceTemplateId` 를 의존성으로 잡지 않아도 항상 최신을 본다.
    setSourceTemplateId((cur) => (cur === id ? null : cur));
    setTemplatesRevision((v) => v + 1);
    if (tpl) toast('info', t('toast.templateDeleted', { name: t.k(tpl.name) }));
  }, [galleryTemplates, toast, t]);

  // 자물쇠 배지(§15.2)는 "값이 실제로 들어 있는" 키만 보유로 친다. 슬롯이 여러
  // 개여도 템플릿이 묻는 건 "이 프로바이더 키가 있느냐"뿐이라 키 이름으로 접는다.
  const availableKeys = useMemo(
    () => [...new Set(filledSlots(keySlots).map((s) => s.keyName))],
    [keySlots],
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
    <>
      {showWelcome && (
        <Welcome onEnter={() => { markWelcomeSeen(); setShowWelcome(false); }} />
      )}
      {/*
        오프닝 화면이 떠 있는 동안 앱은 **마운트된 채로** 뒤에 남는다 (그래야
        "캔버스 열기"가 로딩 없이 즉시 열린다). 다만 화면만 가리면 그 뒤의 헤더·
        패널이 여전히 Tab 순서와 접근성 트리에 남아, 스크린리더나 키보드 사용자는
        보이지도 않는 버튼 사이를 헤매게 된다 — 실제로 언어 토글이 화면에 둘
        존재하는 상태가 된다. `inert` 로 그 구간을 통째로 비활성화한다.
      */}
      <div className="flex h-screen flex-col" inert={showWelcome}>
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
          onOpenTutorial={() => setModal('tutorial')}
          onOpenExport={() => setModal('export')}
          onOpenPublish={() => setModal('publish')}
          onSave={onSave}
          onOpenSave={() => setModal('save')}
          saveTargetName={saveTarget?.name ?? null}
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
              <InspectorPanel onOpenKeys={() => setModal('keys')} />
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
          templates={galleryTemplates}
          availableKeys={availableKeys}
          ollamaModels={ollamaModels}
          onUse={onSelectTemplate}
          onNew={onNewBlank}
          onDelete={onDeleteTemplate}
          hubTeams={hubStatus?.available ? hubStatus.teams : null}
          onForkHub={onForkHub}
        />
        <TutorialModal open={modal === 'tutorial'} onClose={() => setModal(null)} />
        <SaveTemplateModal
          open={modal === 'save'}
          onClose={() => setModal(null)}
          onSave={onSaveAsTemplate}
          existing={saveTarget}
          defaultName={projectName}
        />
        <ExportCodeModal open={modal === 'export'} onClose={() => setModal(null)} />
        <PublishPreview
          open={modal === 'publish'}
          onClose={() => setModal(null)}
          getFlow={() => rfRef.current}
        />
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
          onOpenPublish={() => setModal('publish')}
          onAutoLayout={onAutoLayout}
          onGroupSelection={onGroupSelection}
          onUngroupSelection={onUngroupSelection}
          templates={galleryTemplates}
          onSelectTemplate={onSelectTemplate}
        />
        <ToastHost />
      </div>
    </>
  );
}

function relativeTime(ts: number, t: TFunction): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return t('header.savedJustNow');
  if (diff < 60) return t('header.savedSeconds', { n: diff });
  return t('header.savedMinutes', { n: Math.floor(diff / 60) });
}
