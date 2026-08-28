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
import { checkConnection, REJECTION_MESSAGE, type ConnectionRejection } from '@/ports/matrix';
import { debounce, loadWorkspace, QuotaError, saveWorkspace } from '@/persistence/localStorage';
import { requiredKeys, validateGraph, wouldCreateCycle } from '@/validation/rules';
import type { ValidationIssue } from '@/validation/issues';
import { shortId, ulid } from '@/lib/ulid';
import {
  APP_VERSION, CURRENT_SCHEMA_VERSION, DEFAULT_NODE_UI,
  type AcEdge, type AcNode, type CanvasDoc, type NodeRunState, type RunStatus, type Viewport,
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

  setProjectName(name: string): void;
  addNode(type: NodeType, position: { x: number; y: number }, data?: Record<string, unknown>): string;
  updateNodeData(id: string, patch: Record<string, unknown>): void;
  moveNode(id: string, position: { x: number; y: number }): void;
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

  /* ---------------- runSlice ---------------- */
  runId: string | null;
  runStatus: RunStatus;
  nodeStates: Record<string, NodeRunState>;
  activeEdges: string[];
  usage: { prompt: number; completion: number; costUsd: number };
  startedAt: number | null;
  logs: LogLine[];
  setRunStatus(s: RunStatus, runId?: string | null): void;
  appendLogs(lines: Omit<LogLine, 'id' | 'ts'>[]): void;
  clearLogs(): void;
  setNodeState(nodeId: string, patch: Partial<NodeRunState>): void;
  setActiveEdges(ids: string[]): void;
  addUsage(prompt: number, completion: number, costUsd: number): void;
  resetRun(): void;

  /* ---------------- uiSlice ---------------- */
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  rightTab: RightTab;
  consoleOpen: boolean;
  toasts: Toast[];
  togglePanel(side: 'left' | 'right'): void;
  setRightTab(t: RightTab): void;
  setConsoleOpen(open: boolean): void;
  toast(kind: Toast['kind'], message: string, sticky?: boolean): void;
  dismissToast(id: string): void;
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
        'LocalStorage 용량이 부족해 자동 저장에 실패했습니다. 파일로 내보내세요.',
        true,
      );
    }
  }
};
const schedulePersist = debounce(persistNow, 1000);

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

      removeNodes(ids) {
        const kill = new Set(ids);
        set((s) => {
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
        const { nodes, edges } = get();
        const issues = validateGraph({ nodes, edges });
        set((s) => { s.issues = issues; });
      },

      /* ---------------- run ---------------- */
      runId: null,
      runStatus: 'idle',
      nodeStates: {},
      activeEdges: [],
      usage: { prompt: 0, completion: 0, costUsd: 0 },
      startedAt: null,
      logs: [],

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
        set((s) => {
          const prev = s.nodeStates[nodeId] ?? { status: 'idle' as const };
          s.nodeStates[nodeId] = { ...prev, ...patch };
        });
      },

      setActiveEdges(ids) { set((s) => { s.activeEdges = ids; }); },

      addUsage(prompt, completion, costUsd) {
        set((s) => {
          s.usage.prompt += prompt;
          s.usage.completion += completion;
          s.usage.costUsd += costUsd;
        });
      },

      resetRun() {
        set((s) => {
          s.runId = null;
          s.runStatus = 'idle';
          s.nodeStates = {};
          s.activeEdges = [];
          s.usage = { prompt: 0, completion: 0, costUsd: 0 };
          s.startedAt = null;
        });
      },

      /* ---------------- ui ---------------- */
      leftPanelOpen: true,
      rightPanelOpen: true,
      rightTab: 'inspector',
      consoleOpen: false,
      toasts: [],

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
  state.toast('error', REJECTION_MESSAGE[reason]);
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

export { getNodeDef };
