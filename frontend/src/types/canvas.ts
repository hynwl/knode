/** `.acanvas.json` 문서 모델 (Spec §7) */

import type { NodeType } from '@/nodes/registry';

export const CURRENT_SCHEMA_VERSION = '1.0';
export const APP_VERSION = '0.1.0';

export interface XYPosition { x: number; y: number; }
export interface Viewport { x: number; y: number; zoom: number; }

/** 실행에 영향을 주지 않는 순수 UI 상태 (Spec §7.2 `ui`) */
export interface NodeUiState {
  collapsed: boolean;
  pinned: boolean;
  bypassed: boolean;
  colorOverride: string | null;
}

export interface AcNode {
  id: string;
  type: NodeType;
  position: XYPosition;
  width?: number | null;
  height?: number | null;
  data: Record<string, unknown>;
  ui: NodeUiState;
  parentNode?: string | null;
  extent?: 'parent' | null;
}

export interface AcEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type?: string;
  data?: { port_type: string };
}

export interface CanvasMeta {
  requires_keys: string[];
  estimated_cost_usd?: number | null;
  estimated_duration_s?: number | null;
  thumbnail?: string | null;
  /** 갤러리 난이도 별표 (Spec §15.1). 내장 템플릿 스냅샷에만 채워진다. */
  difficulty?: 1 | 2 | 3 | null;
}

export interface CanvasDoc {
  schema_version: string;
  app_version: string;
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  author?: string;
  created_at: string;
  updated_at: string;
  viewport: Viewport;
  nodes: AcNode[];
  edges: AcEdge[];
  meta: CanvasMeta;
}

export const DEFAULT_NODE_UI: NodeUiState = {
  collapsed: false,
  pinned: false,
  bypassed: false,
  colorOverride: null,
};

export type RunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type NodeStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export interface NodeRunState {
  status: NodeStatus;
  output?: string;
  error?: string;
  usage?: { prompt: number; completion: number; costUsd: number };
  startedAt?: number;
  finishedAt?: number;
}
