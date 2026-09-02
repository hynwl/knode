'use client';

/**
 * Zustand 루트 스토어 (Spec §16.2)
 *
 * 성능 규칙 `MUST`
 *  - 노드 컴포넌트는 선택적 구독만 한다: `useStore(s => s.nodeStates[id])`
 *  - 실행 이벤트는 50ms 배치로 묶어 반영한다 (runSlice.applyEvents)
 *  - `events` 배열 전체를 구독하는 컴포넌트는 로그 패널 하나뿐
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';

import { defaultDataFor, getNodeDef, getPort, type NodeType } from '@/nodes/registry';
import { checkConnection, REJECTION_MESSAGE_KEY, type ConnectionRejection } from '@/ports/matrix';
import { t } from '@/i18n';
import { issueText } from '@/validation/issues';
import { debounce, loadWorkspace, QuotaError, saveWorkspace } from '@/persistence/localStorage';
import { requiredKeys, validateGraph, validateOllama, wouldCreateCycle } from '@/validation/rules';
import type { ValidationIssue } from '@/validation/issues';
import { shortId, ulid } from '@/lib/ulid';
import {
  APP_VERSION, CURRENT_SCHEMA_VERSION, DEFAULT_NODE_UI,
  type AcEdge, type AcNode, type CanvasDoc, type NodeRunState, type RunStatus,
  type Viewport, type XYPosition,
} from '@/types/canvas';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
  /** 에러 토스트는 수동으로 닫을 때까지 유지한다 (Spec §3.5-17) */
  sticky?: boolean;
}

export type RightTab = 'stream' | 'inspector' | 'raw';

export type LogKind = 'sys' | 'agent' | 'tool' | 'think' | 'ok' | 'warn' | 'err' | 'final';

export interface LogLine {
  id: number;
  ts: number;
  kind: LogKind;
  text: string;
  nodeId?: string | null;
}

/** 로그 링버퍼 상한 (Spec §16.2 events 최대 2000개) */
export const MAX_LOG_LINES = 2000;

/** Auto Layout 이동 트랜지션 길이 (globals.css `.ac-layout-animating` 과 같은 값) */
export const LAYOUT_ANIMATION_MS = 260;

/** `GET /api/v1/ollama/models` 모델 항목 (`run/client.ts::fetchOllamaModels` 이 채운다). */
export interface OllamaModelInfo {
  name: string;
  sizeGb: number | null;
  family: string | null;
  context: number | null;
}

/** `GET /api/v1/tools` 항목 (`lib/backendStatus.ts::fetchToolTypes` 이 채운다). */
export interface ToolTypeInfo {
  toolId: string;
  label: string;
  description: string;
  requiredKeys: string[];
  enabled: boolean;
}

/** SSE `human.request` 1건 (Spec §5.10, §10.2). */
export interface HumanRequest {
  /** 검토 대상 Task 노드 id. `POST /runs/{id}/human` 의 `node_id` 로 그대로 되돌려준다. */
  nodeId: string;
  prompt: string;
  timeoutS: number;
  /** 이벤트를 받은 시각 — 모달의 남은 시간 카운트다운 기준. */
  requestedAt: number;
}

export interface AppState {
  /* ---------------- graphSlice ---------------- */
  canvasId: string;
  projectName: string;
  nodes: AcNode[];
  edges: AcEdge[];
  viewport: Viewport;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  issues: ValidationIssue[];
  savedAt: number | null;
  /**
   * "에러 → 노드 카메라 포커스" 요청 (Spec §17.4-2). `token` 은 같은 노드를
   * 연달아 다시 포커스해도 Canvas/BaseNode 의 하이라이트 애니메이션이 재시작되도록
   * 매번 증가시키는 값 — nodeId 만 같으면 effect 가 재실행되지 않는 문제를 피한다.
   */
  focusRequest: { nodeId: string; token: number } | null;

  setProjectName(name: string): void;
  addNode(type: NodeType, position: { x: number; y: number }, data?: Record<string, unknown>): string;
  updateNodeData(id: string, patch: Record<string, unknown>): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  /** Auto Layout 결과 일괄 반영 — 되돌리기 1스텝으로 묶기 위해 `set()` 한 번만 쓴다. */
  applyLayout(positions: Record<string, XYPosition>): void;
  /** 선택 노드를 감싸는 그룹 프레임 생성. 자식 좌표는 프레임 기준 상대값으로 변환된다. */
  groupNodes(ids: string[], bounds: { x: number; y: number; width: number; height: number }): string;
  /** 그룹 해제. 선택에 프레임이 있으면 프레임을 지우고, 없으면 선택된 자식만 떼어낸다. */
  ungroupNodes(ids: string[]): boolean;
  removeNodes(ids: string[]): void;
  duplicateNodes(ids: string[]): string[];
  toggleBypass(ids: string[]): void;
  toggleCollapse(ids: string[]): void;
  togglePin(ids: string[]): void;
  connect(c: { source: string; sourceHandle: string; target: string; targetHandle: string }): boolean;
  removeEdges(ids: string[]): void;
  setViewport(v: Viewport): void;
  selectNodes(ids: string[]): void;
  selectEdges(ids: string[]): void;
  clearSelection(): void;
  replaceDoc(doc: CanvasDoc): void;
  toDoc(): CanvasDoc;
  revalidate(): void;
  /** 노드를 선택하고 캔버스 카메라를 그 위로 옮긴다 (Spec §17.4-2 MUST). */
  requestFocusNode(nodeId: string): void;

  /* ---------------- runSlice ---------------- */
  runId: string | null;
  runStatus: RunStatus;
  /** 현재/직전 실행이 Dry Run(Spec §11.3)이었는지 — 서버 응답이 아니라 실행을
   * 시작할 때 프론트가 스스로 기억한다(요청 자체가 dry_run 옵션을 실었으므로). */
  dryRun: boolean;
  nodeStates: Record<string, NodeRunState>;
  activeEdges: string[];
  usage: { prompt: number; completion: number; costUsd: number };
  startedAt: number | null;
  logs: LogLine[];
  /**
   * 응답을 기다리는 사람 검토 요청 (Spec §5.10). `null` = 없음.
   * 백엔드 크루 스레드가 **이 응답이 올 때까지 블로킹**된 상태이므로, 이 값이
   * 있는 동안 모달을 띄우는 것은 선택이 아니라 필수다 — 안 띄우면 사용자는
   * 실행이 멈춘 이유를 알 방법이 없다.
   */
  humanRequest: HumanRequest | null;
  setRunStatus(s: RunStatus, runId?: string | null): void;
  /** 응답 전송/타임아웃 후 모달을 닫는다. 백엔드 상태는 건드리지 않는다. */
  clearHumanRequest(): void;
  appendLogs(lines: Omit<LogLine, 'id' | 'ts'>[]): void;
  clearLogs(): void;
  setNodeState(nodeId: string, patch: Partial<NodeRunState>): void;
  setActiveEdges(ids: string[]): void;
  addUsage(prompt: number, completion: number, costUsd: number): void;
  resetRun(dryRun?: boolean): void;
  /**
   * SSE 프레임 1건을 큐에 쌓는다. 50ms 안에 들어온 이벤트는 한 번의 `set()` 으로
   * 묶어 반영한다 (Spec §16.2 성능 규칙 MUST). `run/eventHandlers.ts` 가 호출한다.
   */
  enqueueEvent(event: string, data: Record<string, unknown>): void;

  /* ---------------- uiSlice ---------------- */
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  rightTab: RightTab;
  consoleOpen: boolean;
  toasts: Toast[];
  /** Auto Layout 이동 중에만 켜진다 (Canvas 가 노드 transform 트랜지션 클래스로 반영). */
  layoutAnimating: boolean;
  togglePanel(side: 'left' | 'right'): void;
  setRightTab(t: RightTab): void;
  setConsoleOpen(open: boolean): void;
  toast(kind: Toast['kind'], message: string, sticky?: boolean): void;
  dismissToast(id: string): void;

  /* ---------------- envSlice (M3-T5, Spec §13) ---------------- */
  /** `GET /api/v1/health` 성공 여부. `null` = 아직 확인 전. */
  backendOnline: boolean | null;
  /**
   * `GET /api/v1/ollama/models` 결과. `null` = 아직 프로브 전.
   * `reason` 은 실패 사유(`host_not_allowed` = 백엔드가 루프백/사설망 밖 주소라 조회를 거부).
   */
  ollamaStatus: { available: boolean; models: OllamaModelInfo[]; reason?: string | null } | null;
  /** `GET /api/v1/providers` 프리셋 모델 목록. provider → model 이름 배열. */
  providerPresets: Record<string, string[]>;
  /** `GET /api/v1/tools` 결과. `tool` 노드의 `tool_id` 드롭다운을 채운다(Spec §5.6 하드코딩 금지). */
  toolTypes: ToolTypeInfo[];
  setBackendOnline(v: boolean): void;
  setOllamaStatus(v: { available: boolean; models: OllamaModelInfo[]; reason?: string | null } | null): void;
  setProviderPresets(v: Record<string, string[]>): void;
  setToolTypes(v: ToolTypeInfo[]): void;
}

function emptyDoc(): CanvasDoc {
  const now = new Date().toISOString();
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    app_version: APP_VERSION,
    id: `cvs_${ulid()}`,
    name: 'Untitled Crew',
    description: '',
    tags: [],
    author: 'anonymous',
    created_at: now,
    updated_at: now,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    meta: { requires_keys: [] },
  };
}

/* ---- 자동 저장: 1초 디바운스 (Spec §14.2) ---- */
let logSeq = 0;
let focusSeq = 0;
let quotaWarned = false;
const persistNow = (doc: CanvasDoc) => {
  try {
    saveWorkspace(doc);
    useAppStore.setState({ savedAt: Date.now() });
    quotaWarned = false;
  } catch (err) {
    if (err instanceof QuotaError && !quotaWarned) {
      quotaWarned = true;
      useAppStore.getState().toast(
        'error',
        t('log.quotaExceeded'),
        true,
      );
    }
  }
};
const schedulePersist = debounce(persistNow, 1000);

/**
 * 검증 결과 지문 — `revalidate()` 가 내용이 같은 결과로 `issues` 배열을 갈아끼우는
 * 것을 막는다. 순서까지 포함해 비교하므로 배열이 같으면 지문도 같다.
 */
let lastIssuesSignature = '';
function issuesSignature(issues: ValidationIssue[]): string {
  let sig = '';
  for (const i of issues) sig += `${i.code}${i.severity}${i.nodeId ?? ''}${i.edgeId ?? ''}${i.field ?? ''}${i.message}`;
  return sig;
}

/* ---- SSE 이벤트 50ms 배치 (Spec §16.2 MUST) ---- */
let eventQueue: Array<{ event: string; data: Record<string, unknown> }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const TERMINAL_NODE_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'skipped']);

function truncatePreview(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pushLog(s: AppState, kind: LogKind, text: string, nodeId?: string | null): void {
  s.logs.push({ id: ++logSeq, ts: Date.now(), kind, text, nodeId: nodeId ?? null });
  if (s.logs.length > MAX_LOG_LINES) s.logs.splice(0, s.logs.length - MAX_LOG_LINES);
}

/**
 * `applyRunEvent` 는 immer draft(`s`) 만 받으므로 `toast()` 액션의 `set/get` 을
 * 쓸 수 없다 — 같은 push + 비-sticky 자동소멸 로직을 draft 위에서 재현한다
 * (Spec §3.5-17 "실행완료 알림" / 에러는 수동 닫기 전까지 유지).
 */
function pushToast(s: AppState, kind: Toast['kind'], message: string, sticky?: boolean): void {
  const id = shortId('t');
  s.toasts.push({ id, kind, message, sticky });
  if (!sticky) setTimeout(() => useAppStore.getState().dismissToast(id), 2600);
}

function patchNodeState(s: AppState, nodeId: string, patch: Partial<NodeRunState>): void {
  const prev = s.nodeStates[nodeId] ?? { status: 'idle' as const };
  s.nodeStates[nodeId] = { ...prev, ...patch };
  if (patch.status !== undefined && patch.status !== prev.status) syncActiveEdges(s, nodeId);
}

/**
 * 노드가 running 으로 전이하거나 running 에서 벗어날 때 그 노드의 in/out 엣지를
 * `activeEdges` 에 반영한다 (Spec §3.4.3 "활성 엣지만 애니메이션 — 현재 실행 중인
 * 노드의 in/out 엣지"). 백엔드는 `edge.active` 이벤트를 아직 보내지 않으므로
 * (backend/app/runtime/callbacks.py 상단 docstring, M2 범위 밖으로 명시 보류)
 * node.status/task.started/task.completed 등 상태 변화 시점에 여기서 파생한다.
 */
function syncActiveEdges(s: AppState, nodeId: string): void {
  const set = new Set(s.activeEdges);
  for (const e of s.edges) {
    if (e.source !== nodeId && e.target !== nodeId) continue;
    const otherId = e.source === nodeId ? e.target : e.source;
    const active = s.nodeStates[nodeId]?.status === 'running' || s.nodeStates[otherId]?.status === 'running';
    if (active) set.add(e.id); else set.delete(e.id);
  }
  s.activeEdges = Array.from(set);
}

/**
 * `sourceNodeId` 에서 엣지로 이어진 Output 노드들.
 *
 * Output 노드는 `result`(Crew 최종 결과)와 `task`(개별 태스크 결과) 두 종류의
 * 입력을 받는다 (`nodes/registry.ts` output.inputs). 백엔드는 "어느 캔버스 노드에
 * 결과를 꽂아야 하는지"를 모르므로 — `run.completed` 는 크루 전체의 산출물 하나만
 * 실어 보낸다 — 이 연결 해석은 프론트 몫이다.
 */
function outputTargetsOf(s: AppState, sourceNodeId: string): string[] {
  const targets: string[] = [];
  for (const e of s.edges) {
    if (e.source !== sourceNodeId) continue;
    if (s.nodes.some((n) => n.id === e.target && n.type === 'output')) targets.push(e.target);
  }
  return targets;
}

/** 크루 노드에 물린 Output 노드. 연결이 없으면 캔버스의 Output 노드 전체로 폴백한다. */
function finalOutputTargets(s: AppState): string[] {
  const targets = s.nodes
    .filter((n) => n.type === 'crew')
    .flatMap((crew) => outputTargetsOf(s, crew.id));
  if (targets.length > 0) return Array.from(new Set(targets));
  return s.nodes.filter((n) => n.type === 'output').map((n) => n.id);
}

/**
 * SSE 이벤트 카탈로그 → 스토어 반영 (Spec §10.3 매핑 표).
 * `enqueueEvent` 가 50ms 마다 쌓인 이벤트를 이 함수로 순회 적용한다.
 */
function applyRunEvent(s: AppState, event: string, data: Record<string, unknown>): void {
  switch (event) {
    case 'run.started': {
      s.runStatus = 'running';
      if (!s.startedAt) s.startedAt = Date.now();
      const taskOrder = Array.isArray(data.task_order) ? (data.task_order as string[]) : [];
      for (const nodeId of taskOrder) patchNodeState(s, nodeId, { status: 'queued' });
      pushLog(s, 'sys', t('log.runStarted', { count: taskOrder.length }));
      break;
    }
    case 'run.completed': {
      s.runStatus = 'succeeded';
      s.humanRequest = null;
      const finalOutput = String(data.final_output ?? '');
      // 최종 결과를 Output 노드 본문에 꽂는다 (Spec §5.9 "최종 결과를 캔버스에서
      // 바로 읽는다"). 이걸 안 하면 실행이 끝나도 노드가 계속 자리표시자를 보여준다.
      for (const nodeId of finalOutputTargets(s)) {
        patchNodeState(s, nodeId, {
          status: 'succeeded',
          output: finalOutput,
          finishedAt: Date.now(),
        });
      }
      pushLog(s, 'final', finalOutput);
      pushToast(s, 'success', t('log.runSucceeded'));
      break;
    }
    case 'run.failed': {
      s.runStatus = 'failed';
      s.humanRequest = null;
      const err = (data.error as { code?: string; message?: string; node_id?: string } | undefined) ?? {};
      // 모든 에러는 노드를 가리킨다 (Spec §17.4 MUST #2) — node_id 가 있으면 카메라를 옮기고
      // 로그 줄에도 같은 노드를 달아 로그 패널에서 다시 그 노드로 돌아갈 수 있게 한다.
      if (err.node_id) {
        patchNodeState(s, err.node_id, { status: 'failed', error: err.message });
        s.focusRequest = { nodeId: err.node_id, token: ++focusSeq };
      }
      // 백엔드가 준 이슈도 **코드 기반 매핑**을 태워 현재 로케일로 바꾼다 (§17.3).
      const code = err.code ?? 'AC-E501';
      const localized = issueText({
        code,
        message: err.message ?? t('log.runFailed'),
      }).message;
      pushLog(s, 'err', t('run.coded', { code, message: localized }), err.node_id);
      // 에러는 수동으로 닫을 때까지 유지 (Spec §3.5-17 MUST).
      pushToast(s, 'error', localized, true);
      break;
    }
    case 'run.cancelled': {
      s.runStatus = 'cancelled';
      s.humanRequest = null;
      pushLog(s, 'warn', t('log.cancelled'));
      pushToast(s, 'info', t('log.cancelledToast'));
      break;
    }
    case 'node.status': {
      const nodeId = (data.node_id as string | null) ?? null;
      const status = data.status as NodeRunState['status'];
      if (!nodeId) { pushLog(s, 'warn', t('log.nodeUnmapped', { status: String(status) })); break; }
      const prev = s.nodeStates[nodeId];
      patchNodeState(s, nodeId, {
        status,
        startedAt: status === 'running' ? (prev?.startedAt ?? Date.now()) : prev?.startedAt,
        finishedAt: TERMINAL_NODE_STATUSES.has(status) ? Date.now() : prev?.finishedAt,
      });
      break;
    }
    case 'task.started': {
      const nodeId = data.node_id as string;
      patchNodeState(s, nodeId, { status: 'running', startedAt: Date.now() });
      pushLog(s, 'agent', t('log.taskStarted', { name: String(data.task_name ?? nodeId) }), nodeId);
      break;
    }
    case 'task.completed': {
      const nodeId = data.node_id as string;
      const output = String(data.output ?? '');
      patchNodeState(s, nodeId, { status: 'succeeded', output, finishedAt: Date.now() });
      // 태스크에 직접 물린 Output 노드에도 그 태스크의 산출물을 흘려보낸다.
      for (const outId of outputTargetsOf(s, nodeId)) {
        patchNodeState(s, outId, { status: 'succeeded', output, finishedAt: Date.now() });
      }
      pushLog(s, 'ok', t('log.taskDone', { ms: Number(data.duration_ms ?? 0), preview: truncatePreview(output) }), nodeId);
      break;
    }
    case 'agent.thought': {
      pushLog(s, 'think', String(data.text ?? ''), (data.agent_node_id as string | null) ?? undefined);
      break;
    }
    case 'agent.tool_use': {
      const preview = data.input ? `: ${truncatePreview(String(data.input), 120)}` : '';
      pushLog(s, 'tool', `🛠️ ${data.tool_id}${preview}`, (data.agent_node_id as string | null) ?? undefined);
      break;
    }
    case 'agent.tool_result': {
      const isError = Boolean(data.is_error);
      pushLog(s, isError ? 'err' : 'tool', `${isError ? '✗' : '✓'} ${truncatePreview(String(data.output_preview ?? ''), 160)}`);
      break;
    }
    case 'agent.delegation': {
      pushLog(s, 'agent', t('log.delegation', { question: String(data.question ?? '') }), (data.from_node_id as string | null) ?? undefined);
      break;
    }
    case 'token.usage': {
      const prompt = Number(data.prompt_tokens ?? 0);
      const completion = Number(data.completion_tokens ?? 0);
      const costUsd = Number(data.cost_usd ?? 0);
      s.usage.prompt += prompt;
      s.usage.completion += completion;
      s.usage.costUsd += costUsd;
      const nodeId = data.node_id as string | null;
      if (nodeId) {
        const prevUsage = s.nodeStates[nodeId]?.usage ?? { prompt: 0, completion: 0, costUsd: 0 };
        patchNodeState(s, nodeId, {
          usage: {
            prompt: prevUsage.prompt + prompt,
            completion: prevUsage.completion + completion,
            costUsd: prevUsage.costUsd + costUsd,
          },
        });
      }
      break;
    }
    case 'log': {
      const level = data.level as string;
      const kind: LogKind = level === 'error' ? 'err' : level === 'warn' ? 'warn' : 'sys';
      pushLog(s, kind, String(data.message ?? ''), (data.node_id as string | null) ?? undefined);
      break;
    }
    case 'human.request': {
      const nodeId = data.node_id as string;
      pushLog(s, 'warn', t('log.humanWaiting', { prompt: String(data.prompt ?? '') }), nodeId);
      s.humanRequest = {
        nodeId,
        prompt: String(data.prompt ?? ''),
        timeoutS: Number(data.timeout_s ?? 300),
        requestedAt: Date.now(),
      };
      // 검토 대상 노드를 화면에 띄워 준다 — 무엇을 승인하는지 보이지 않으면
      // 사용자는 프롬프트만 보고 판단해야 한다 (Spec §17.4-2 와 같은 결).
      s.focusRequest = { nodeId, token: ++focusSeq };
      break;
    }
    case 'edge.active': {
      const edgeId = data.edge_id as string;
      const active = Boolean(data.active);
      const set = new Set(s.activeEdges);
      if (active) set.add(edgeId); else set.delete(edgeId);
      s.activeEdges = Array.from(set);
      break;
    }
    default:
      pushLog(s, 'sys', t('log.unknownEvent', { event }));
  }
}

export const useAppStore = create<AppState>()(
  temporal(
    immer<AppState>((set, get) => ({
      /* ---------------- graph ---------------- */
      canvasId: emptyDoc().id,
      projectName: 'Untitled Crew',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      issues: [],
      savedAt: null,
      focusRequest: null,

      setProjectName(name) {
        set((s) => { s.projectName = name; });
        schedulePersist(get().toDoc());
      },

      addNode(type, position, data) {
        const id = shortId(type);
        set((s) => {
          s.nodes.push({
            id,
            type,
            position,
            width: null,
            height: null,
            data: { ...defaultDataFor(type), ...(data ?? {}) },
            ui: { ...DEFAULT_NODE_UI },
            parentNode: null,
            extent: null,
          });
          s.selectedNodeIds = [id];
          s.selectedEdgeIds = [];
        });
        autoWireToCrew(id, type);
        get().revalidate();
        schedulePersist(get().toDoc());
        return id;
      },

      updateNodeData(id, patch) {
        set((s) => {
          const n = s.nodes.find((x) => x.id === id);
          if (n) Object.assign(n.data, patch);
        });
        get().revalidate();
        schedulePersist(get().toDoc());
      },

      moveNode(id, position) {
        set((s) => {
          const n = s.nodes.find((x) => x.id === id);
          if (n && !n.ui.pinned) n.position = position;
        });
        schedulePersist(get().toDoc());
      },

      applyLayout(positions) {
        if (!Object.keys(positions).length) return;
        // 트랜지션 클래스가 좌표 변경과 같은 렌더에 붙으면 브라우저가 애니메이션을
        // 시작하지 않는다(변경 전 스타일에 transition 이 없었으므로). 한 프레임 먼저 켠다.
        set((s) => { s.layoutAnimating = true; });
        requestAnimationFrame(() => {
          set((s) => {
            for (const n of s.nodes) {
              const p = positions[n.id];
              if (p) n.position = { ...p };
            }
          });
          schedulePersist(get().toDoc());
        });
        setTimeout(() => set((s) => { s.layoutAnimating = false; }), LAYOUT_ANIMATION_MS + 80);
      },

      groupNodes(ids, bounds) {
        const groupId = shortId('group');
        const members = new Set(ids);
        set((s) => {
          s.nodes.push({
            id: groupId,
            type: 'group',
            position: { x: bounds.x, y: bounds.y },
            width: bounds.width,
            height: bounds.height,
            data: defaultDataFor('group'),
            ui: { ...DEFAULT_NODE_UI },
            parentNode: null,
            extent: null,
          });
          for (const n of s.nodes) {
            if (!members.has(n.id)) continue;
            // React Flow 는 부모가 붙은 순간부터 자식 position 을 부모 기준 상대값으로
            // 읽는다 — 절대 좌표를 그대로 두면 노드가 그만큼 튄다.
            n.position = { x: n.position.x - bounds.x, y: n.position.y - bounds.y };
            n.parentNode = groupId;
            n.extent = 'parent';
          }
          s.selectedNodeIds = [groupId];
          s.selectedEdgeIds = [];
        });
        schedulePersist(get().toDoc());
        return groupId;
      },

      ungroupNodes(ids) {
        const selected = new Set(ids);
        const state = get();
        const frames = state.nodes.filter((n) => n.type === 'group' && selected.has(n.id));
        if (frames.length) {
          // 프레임만 지우면 removeNodes 가 자식을 절대 좌표로 되돌려 남겨둔다.
          get().removeNodes(frames.map((f) => f.id));
          return true;
        }
        const detach = state.nodes.filter((n) => selected.has(n.id) && n.parentNode);
        if (!detach.length) return false;
        set((s) => {
          for (const n of s.nodes) {
            if (!selected.has(n.id) || !n.parentNode) continue;
            const frame = s.nodes.find((f) => f.id === n.parentNode);
            if (frame) n.position = { x: n.position.x + frame.position.x, y: n.position.y + frame.position.y };
            n.parentNode = null;
            n.extent = null;
          }
        });
        schedulePersist(get().toDoc());
        return true;
      },

      removeNodes(ids) {
        const kill = new Set(ids);
        set((s) => {
          // 그룹 프레임을 지워도 안에 있던 노드는 살린다 (ComfyUI 관례).
          // 부모가 사라지면 상대 좌표가 의미를 잃으므로 절대 좌표로 되돌린다.
          for (const n of s.nodes) {
            if (!n.parentNode || kill.has(n.id) || !kill.has(n.parentNode)) continue;
            const frame = s.nodes.find((f) => f.id === n.parentNode);
            if (frame) n.position = { x: n.position.x + frame.position.x, y: n.position.y + frame.position.y };
            n.parentNode = null;
            n.extent = null;
          }
          s.nodes = s.nodes.filter((n) => !kill.has(n.id));
          s.edges = s.edges.filter((e) => !kill.has(e.source) && !kill.has(e.target));
          s.selectedNodeIds = s.selectedNodeIds.filter((id) => !kill.has(id));
        });
        get().revalidate();
        schedulePersist(get().toDoc());
      },

      duplicateNodes(ids) {
        const source = get().nodes.filter((n) => ids.includes(n.id));
        const created: string[] = [];
        set((s) => {
          for (const n of source) {
            const id = shortId(n.type);
            created.push(id);
            s.nodes.push({
              ...structuredClone(n),
              id,
              position: { x: n.position.x + 30, y: n.position.y + 30 },
              ui: { ...n.ui, bypassed: false },
            });
          }
          s.selectedNodeIds = created;
        });
        get().revalidate();
        schedulePersist(get().toDoc());
        return created;
      },

      toggleBypass(ids) {
        set((s) => {
          for (const n of s.nodes) if (ids.includes(n.id)) n.ui.bypassed = !n.ui.bypassed;
        });
        get().revalidate();
        schedulePersist(get().toDoc());
      },

      toggleCollapse(ids) {
        set((s) => {
          for (const n of s.nodes) if (ids.includes(n.id)) n.ui.collapsed = !n.ui.collapsed;
        });
        schedulePersist(get().toDoc());
      },

      togglePin(ids) {
        set((s) => {
          for (const n of s.nodes) if (ids.includes(n.id)) n.ui.pinned = !n.ui.pinned;
        });
        schedulePersist(get().toDoc());
      },

      connect(c) {
        const state = get();
        const sourceNode = state.nodes.find((n) => n.id === c.source);
        const targetNode = state.nodes.find((n) => n.id === c.target);
        if (!sourceNode || !targetNode) return false;

        const sourcePort = getPort(sourceNode.type, c.sourceHandle);
        const targetPort = getPort(targetNode.type, c.targetHandle);
        if (!sourcePort || !targetPort) return reject(state, 'incompatible-type');

        const verdict = checkConnection({
          sourceNode: c.source, sourcePort, targetNode: c.target, targetPort,
        });
        if (!verdict.ok) return reject(state, verdict.reason!);

        const duplicate = state.edges.some(
          (e) => e.source === c.source && e.sourceHandle === c.sourceHandle
            && e.target === c.target && e.targetHandle === c.targetHandle,
        );
        if (duplicate) return reject(state, 'duplicate');

        // 사이클 차단은 context 연결에만 적용 (Spec §6.5)
        if (targetPort.type === 'context' && wouldCreateCycle(state, c.source, c.target)) {
          return reject(state, 'cycle');
        }

        set((s) => {
          // 카디널리티 1 인 입력은 ComfyUI 방식으로 기존 엣지를 교체한다 (Spec §6.3)
          if (targetPort.maxConnections === 1) {
            s.edges = s.edges.filter(
              (e) => !(e.target === c.target && e.targetHandle === c.targetHandle),
            );
          }
          s.edges.push({
            id: shortId('e'),
            source: c.source,
            sourceHandle: c.sourceHandle,
            target: c.target,
            targetHandle: c.targetHandle,
            type: 'acanvas',
            data: { port_type: targetPort.type },
          });
        });
        get().revalidate();
        schedulePersist(get().toDoc());
        return true;
      },

      removeEdges(ids) {
        set((s) => {
          s.edges = s.edges.filter((e) => !ids.includes(e.id));
          s.selectedEdgeIds = [];
        });
        get().revalidate();
        schedulePersist(get().toDoc());
      },

      setViewport(v) {
        set((s) => { s.viewport = v; });
      },

      selectNodes(ids) { set((s) => { s.selectedNodeIds = ids; s.selectedEdgeIds = []; }); },
      selectEdges(ids) { set((s) => { s.selectedEdgeIds = ids; s.selectedNodeIds = []; }); },
      clearSelection() { set((s) => { s.selectedNodeIds = []; s.selectedEdgeIds = []; }); },

      replaceDoc(doc) {
        set((s) => {
          s.canvasId = doc.id;
          s.projectName = doc.name;
          s.nodes = doc.nodes;
          s.edges = doc.edges;
          s.viewport = doc.viewport;
          s.selectedNodeIds = [];
          s.selectedEdgeIds = [];
          s.nodeStates = {};
          s.activeEdges = [];
        });
        get().revalidate();
        schedulePersist(get().toDoc());
      },

      toDoc() {
        const s = get();
        const now = new Date().toISOString();
        return {
          schema_version: CURRENT_SCHEMA_VERSION,
          app_version: APP_VERSION,
          id: s.canvasId,
          name: s.projectName,
          description: '',
          tags: [],
          author: 'anonymous',
          created_at: now,
          updated_at: now,
          viewport: s.viewport,
          nodes: s.nodes,
          edges: s.edges,
          meta: { requires_keys: requiredKeys({ nodes: s.nodes, edges: s.edges }) },
        };
      },

      revalidate() {
        const { nodes, edges, ollamaStatus } = get();
        const issues = [
          ...validateGraph({ nodes, edges }),
          ...validateOllama({ nodes, edges }, ollamaStatus && { available: ollamaStatus.available, models: ollamaStatus.models.map((m) => m.name) }),
        ];
        // `issues` 를 매번 새 배열로 갈아끼우면 이 배열을 구독하는 모든 노드
        // (BaseNode 의 `useNodeIssues`)가 리렌더된다 — 인스펙터 타이핑 한 글자마다
        // 캔버스 전체가 다시 그려진다는 뜻이다 (M3-T11 실측: 50노드에서 104회).
        // 검증 결과가 실제로 달라졌을 때만 반영한다 (Spec §16.2 성능 규칙).
        const sig = issuesSignature(issues);
        if (sig === lastIssuesSignature) return;
        lastIssuesSignature = sig;
        set((s) => { s.issues = issues; });
      },

      requestFocusNode(nodeId) {
        set((s) => {
          if (!s.nodes.some((n) => n.id === nodeId)) return;
          s.focusRequest = { nodeId, token: ++focusSeq };
          s.selectedNodeIds = [nodeId];
          s.selectedEdgeIds = [];
          if (!s.rightPanelOpen) s.rightPanelOpen = true;
          s.rightTab = 'inspector';
        });
      },

      /* ---------------- run ---------------- */
      runId: null,
      runStatus: 'idle',
      dryRun: false,
      nodeStates: {},
      activeEdges: [],
      usage: { prompt: 0, completion: 0, costUsd: 0 },
      startedAt: null,
      logs: [],
      humanRequest: null,

      clearHumanRequest() { set((s) => { s.humanRequest = null; }); },

      appendLogs(lines) {
        if (!lines.length) return;
        set((s) => {
          for (const l of lines) {
            s.logs.push({ id: ++logSeq, ts: Date.now(), ...l });
          }
          if (s.logs.length > MAX_LOG_LINES) {
            s.logs.splice(0, s.logs.length - MAX_LOG_LINES);
          }
        });
      },

      clearLogs() { set((s) => { s.logs = []; }); },

      setRunStatus(status, runId) {
        set((s) => {
          s.runStatus = status;
          if (runId !== undefined) s.runId = runId;
          if (status === 'running' && !s.startedAt) s.startedAt = Date.now();
          if (status === 'idle') s.startedAt = null;
        });
      },

      setNodeState(nodeId, patch) {
        set((s) => { patchNodeState(s, nodeId, patch); });
      },

      setActiveEdges(ids) { set((s) => { s.activeEdges = ids; }); },

      addUsage(prompt, completion, costUsd) {
        set((s) => {
          s.usage.prompt += prompt;
          s.usage.completion += completion;
          s.usage.costUsd += costUsd;
        });
      },

      resetRun(dryRun = false) {
        eventQueue = [];
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        set((s) => {
          s.runId = null;
          s.runStatus = 'idle';
          s.dryRun = dryRun;
          s.nodeStates = {};
          s.activeEdges = [];
          s.usage = { prompt: 0, completion: 0, costUsd: 0 };
          s.startedAt = null;
          s.humanRequest = null;
        });
      },

      enqueueEvent(event, data) {
        eventQueue.push({ event, data });
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          const batch = eventQueue;
          eventQueue = [];
          set((s) => {
            for (const item of batch) applyRunEvent(s, item.event, item.data);
          });
        }, 50);
      },

      /* ---------------- ui ---------------- */
      leftPanelOpen: true,
      rightPanelOpen: true,
      rightTab: 'inspector',
      consoleOpen: false,
      toasts: [],
      layoutAnimating: false,

      togglePanel(side) {
        set((s) => {
          if (side === 'left') s.leftPanelOpen = !s.leftPanelOpen;
          else s.rightPanelOpen = !s.rightPanelOpen;
        });
      },
      setRightTab(t) { set((s) => { s.rightTab = t; }); },
      setConsoleOpen(open) { set((s) => { s.consoleOpen = open; }); },

      toast(kind, message, sticky) {
        const id = shortId('t');
        set((s) => { s.toasts.push({ id, kind, message, sticky }); });
        if (!sticky) setTimeout(() => get().dismissToast(id), 2600);
      },
      dismissToast(id) {
        set((s) => { s.toasts = s.toasts.filter((t) => t.id !== id); });
      },

      /* ---------------- env ---------------- */
      backendOnline: null,
      ollamaStatus: null,
      providerPresets: {},
      toolTypes: [],

      setBackendOnline(v) { set((s) => { s.backendOnline = v; }); },
      setOllamaStatus(v) {
        set((s) => { s.ollamaStatus = v; });
        get().revalidate();
      },
      setProviderPresets(v) { set((s) => { s.providerPresets = v; }); },
      setToolTypes(v) { set((s) => { s.toolTypes = v; }); },
    })),
    {
      limit: 50, // Spec §3.5-11 최소 50단계
      partialize: (s) => ({ nodes: s.nodes, edges: s.edges }) as Partial<AppState>,
      equality: (a, b) =>
        JSON.stringify((a as AppState).nodes) === JSON.stringify((b as AppState).nodes)
        && JSON.stringify((a as AppState).edges) === JSON.stringify((b as AppState).edges),
    },
  ),
);

function reject(state: AppState, reason: ConnectionRejection): boolean {
  state.toast('error', t(REJECTION_MESSAGE_KEY[reason]));
  return false;
}

/**
 * Auto-Wire 편의 (Spec §5.7)
 * Crew 노드가 있을 때 새 Agent/Task 를 추가하면 자동으로 Crew 에 연결한다.
 */
function autoWireToCrew(nodeId: string, type: NodeType): void {
  if (type !== 'agent' && type !== 'task') return;
  const s = useAppStore.getState();
  const crew = s.nodes.find((n) => n.type === 'crew');
  if (!crew) return;
  useAppStore.setState((draft) => {
    (draft as AppState).edges.push({
      id: shortId('e'),
      source: nodeId,
      sourceHandle: type,
      target: crew.id,
      targetHandle: type,
      type: 'acanvas',
      data: { port_type: type },
    });
  });
}

/* ---- 부팅 시 워크스페이스 복원 ---- */
export function hydrateFromStorage(): boolean {
  const doc = loadWorkspace();
  if (!doc) return false;
  try {
    useAppStore.getState().replaceDoc(doc);
    useAppStore.temporal.getState().clear();
    return true;
  } catch {
    return false;
  }
}

export const undo = () => useAppStore.temporal.getState().undo();
export const redo = () => useAppStore.temporal.getState().redo();

/** 노드 상태 선택적 구독 (성능 규칙) */
export function useNodeState(nodeId: string): NodeRunState | undefined {
  return useAppStore((s) => s.nodeStates[nodeId]);
}

/**
 * 노드별 이슈. 셀렉터에서 새 배열을 만들면 Zustand v5 가 매 렌더 리렌더를 유발한다
 * (getSnapshot 무한 루프). 원본 배열을 구독하고 useMemo 로 파생시킨다.
 */
export function useNodeIssues(nodeId: string): ValidationIssue[] {
  const issues = useAppStore((s) => s.issues);
  return useMemo(() => issues.filter((i) => i.nodeId === nodeId), [issues, nodeId]);
}

/* ---- 노드별 "연결된 포트" 파생 캐시 (Spec §16.2 원자적 구독) ---- */
const EMPTY_PORT_SET: ReadonlySet<string> = new Set();
let portsCacheEdges: AcEdge[] | null = null;
let portsCache = new Map<string, Set<string>>();

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * `edges` 배열 1회 순회로 노드→연결된 포트 id 맵을 만들고, **내용이 같은 Set 은
 * 직전 인스턴스를 그대로 재사용**한다. 그래야 셀렉터 반환값이 참조로 안정되어
 * 연결이 실제로 바뀐 노드만 리렌더된다.
 */
function connectedPortsFor(edges: AcEdge[], nodeId: string): ReadonlySet<string> {
  if (edges !== portsCacheEdges) {
    const next = new Map<string, Set<string>>();
    const add = (id: string, port: string) => {
      const set = next.get(id);
      if (set) set.add(port); else next.set(id, new Set([port]));
    };
    for (const e of edges) { add(e.source, e.sourceHandle); add(e.target, e.targetHandle); }
    for (const [id, set] of next) {
      const prev = portsCache.get(id);
      if (prev && sameSet(prev, set)) next.set(id, prev);
    }
    portsCache = next;
    portsCacheEdges = edges;
  }
  return portsCache.get(nodeId) ?? EMPTY_PORT_SET;
}

/**
 * 이 노드에 연결된 포트 id 집합. `edges` 배열 전체를 구독하면 엣지가 하나만
 * 생겨도 모든 노드가 리렌더되므로(M3-T11 실측: 노드 추가 1회 → BaseNode 110회),
 * 파생값을 참조 안정적으로 만들어 원자적으로 구독한다 (Spec §16.2 MUST).
 */
export function useConnectedPorts(nodeId: string): ReadonlySet<string> {
  return useAppStore((s) => connectedPortsFor(s.edges, nodeId));
}

/**
 * 이 노드가 지금 카메라 포커스 대상인지 — 대상이면 매번 달라지는 `token` 을,
 * 아니면 `null` 을 반환한다. 원시값 셀렉터라 무관한 노드는 리렌더되지 않는다
 * (다른 노드의 `focusRequest` 참조가 매번 바뀌어도 이 셀렉터의 반환값은 그대로).
 */
export function useNodeFocusToken(nodeId: string): number | null {
  return useAppStore((s) => (s.focusRequest?.nodeId === nodeId ? s.focusRequest.token : null));
}

export { getNodeDef };
