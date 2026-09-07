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

/**
 * 게시물 라이선스 (M5 P-D4). **코드 라이선스(AGPL-3.0)와 분리된다** — 이건
 * 사용자가 만든 그래프에 붙는 값이고, 게시자가 직접 고른다. 게시 전에는 `null`
 * (기본값을 임의로 정해두면 사용자가 고르지 않은 조건으로 공개돼 버린다).
 */
export const LICENSE_IDS = [
  'CC0-1.0',
  'MIT',
  'Apache-2.0',
  'CC-BY-4.0',
  'AGPL-3.0',
  'all-rights-reserved',
] as const;
export type LicenseId = (typeof LICENSE_IDS)[number];

/**
 * fork 계보 (M5-T1). **한 단계만** 기록한다 — 체인 전체를 문서에 담으면 fork 가
 * 깊어질수록 문서가 무한히 커진다. 전체 계보는 레지스트리가 이 한 칸을 이어 붙여
 * 복원한다.
 */
export interface ForkOrigin {
  /** 원본 문서의 `id` */
  id: string;
  /** 가져온 시점의 원본 `revision` */
  revision: number;
  /** 가져온 출처(레지스트리 URL 등). 로컬 파일에서 왔으면 `null` */
  source?: string | null;
  /** 표시용 원본 이름 — 원본이 삭제돼도 계보가 읽히도록 값을 복사해 둔다 */
  name?: string | null;
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
  /** 게시물 라이선스 (P-D4). 게시 전에는 `null` */
  license?: LicenseId | null;
  /**
   * 게시 단위의 판번호. 같은 `id` 로 다시 게시할 때마다 1 씩 오른다.
   * `schema_version`(문서 **형식**의 버전)과는 완전히 다른 축이다.
   */
  revision?: number;
  /** 남의 팀에서 갈라져 나왔다면 그 출처 */
  forked_from?: ForkOrigin | null;
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
