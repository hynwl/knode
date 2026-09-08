import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { toJpeg, toPng } from 'html-to-image';
import type { Node, ReactFlowInstance } from '@xyflow/react';

import { color } from '@design/tokens';

/**
 * 갤러리 카드 썸네일 (M5-T4 · WORK_PLAN §5.6 P0). 스펙에 치수 지정이 없어
 * 카드 프리뷰용 16:9 로 자체 확정했다.
 */
export const THUMBNAIL_WIDTH = 400;
export const THUMBNAIL_HEIGHT = 225;

/** DoD — "노드 20개 그래프 기준 2초 내 생성 + 200KB 이하". */
export const THUMBNAIL_MAX_BYTES = 200 * 1024;

const PADDING = 0.15;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

/** PNG 가 200KB 를 넘을 때만 순서대로 시도하는 JPEG 품질 폴백. */
const JPEG_QUALITY_STEPS = [0.85, 0.6, 0.4];

/** data URI 의 실제 바이트 크기 — base64 패딩(`=`)을 뺀 디코드 후 크기. */
export function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * 노드 전체가 들어오는 뷰포트(x/y/zoom)를 계산한다. `getNodesBounds`/
 * `getViewportForBounds` 는 순수함수라 여기까지만 단위테스트가 가능하고,
 * 실제 DOM 캡처(`html-to-image`)는 실브라우저에서만 의미가 있어 E2E 로 검증한다.
 */
export function computeThumbnailViewport(nodes: Node[]) {
  const bounds = getNodesBounds(nodes);
  return getViewportForBounds(bounds, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, MIN_ZOOM, MAX_ZOOM, PADDING);
}

export interface GenerateThumbnailDeps {
  /** 테스트 훅. 기본은 실제 `html-to-image`. */
  capturePng?: typeof toPng;
  captureJpeg?: typeof toJpeg;
  /** 테스트 훅. 기본은 `document.querySelector('.react-flow__viewport')`. */
  getViewportEl?: () => HTMLElement | null;
}

/**
 * 현재 렌더된 캔버스 DOM 을 캡처해 `meta.thumbnail` 에 넣을 data URI 를 만든다.
 * 노드가 없거나(빈 캔버스) 뷰포트 DOM 을 못 찾으면 `null`.
 */
export async function generateThumbnail(
  rf: ReactFlowInstance,
  deps: GenerateThumbnailDeps = {},
): Promise<string | null> {
  const capturePng = deps.capturePng ?? toPng;
  const captureJpeg = deps.captureJpeg ?? toJpeg;
  const getViewportEl = deps.getViewportEl
    ?? (() => document.querySelector<HTMLElement>('.react-flow__viewport'));

  const nodes = rf.getNodes();
  if (!nodes.length) return null;

  const viewportEl = getViewportEl();
  if (!viewportEl) return null;

  const viewport = computeThumbnailViewport(nodes);
  const captureOptions = {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    backgroundColor: color.bg,
    pixelRatio: 1,
    style: {
      width: `${THUMBNAIL_WIDTH}px`,
      height: `${THUMBNAIL_HEIGHT}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  };

  const restoreEdges = inlineEdgeStrokes(viewportEl);
  try {
    const png = await capturePng(viewportEl, captureOptions);
    if (dataUrlByteSize(png) <= THUMBNAIL_MAX_BYTES) return png;

    let best = png;
    for (const quality of JPEG_QUALITY_STEPS) {
      const jpeg = await captureJpeg(viewportEl, { ...captureOptions, quality });
      best = jpeg;
      if (dataUrlByteSize(jpeg) <= THUMBNAIL_MAX_BYTES) return jpeg;
    }
    // 최선의 결과도 200KB 를 넘는다 — 매우 복잡한 그래프의 극단값. 호출부가
    // meta.thumbnail 에 그대로 실을지 포기할지 판단하도록 넘긴다.
    return best;
  } finally {
    restoreEdges();
  }
}

/**
 * 캡처 동안만 엣지 선 색을 **인라인 스타일로** 복사하고, 되돌리는 함수를 준다.
 *
 * `html-to-image` 는 DOM 을 복제해 `foreignObject` 안에서 래스터라이즈하는데,
 * 복제본에는 **페이지 스타일시트가 따라오지 않는다** — 계산된 스타일을 요소에
 * 인라인으로 옮겨 심는 방식이라, 그 과정에서 SVG 의 `stroke` 는 빠진다. 우리
 * 엣지 색은 `globals.css` 의 `.react-flow__edge-path { stroke: … }` 한 줄에만
 * 있었으므로, 결과 이미지에서 **선이 전부 사라졌다**(M5-T8 에서 시드 카드 10장을
 * 실제로 만들어 보고 발견 — 노드만 떠 있는 그림이었다. 노드를 잇는 게 이 제품의
 * 전부인데).
 *
 * CSS 규칙을 인라인으로 옮기는 대신 **캡처할 때만** 심는 이유는 hover/selected
 * 규칙 때문이다. 인라인 스타일은 CSS 규칙을 이기므로, 영구히 심으면
 * `.react-flow__edge:hover .react-flow__edge-path` 가 죽는다.
 *
 * 계산된 값을 그대로 읽으므로 실행 중 활성 엣지(포트 색)·선택 엣지도 화면에 보이는
 * 색 그대로 찍힌다.
 */
function inlineEdgeStrokes(viewportEl: HTMLElement): () => void {
  const paths = viewportEl.querySelectorAll<SVGPathElement>('.react-flow__edge-path');
  const saved = [...paths].map((path) => ({ path, stroke: path.style.stroke }));
  for (const { path } of saved) path.style.stroke = window.getComputedStyle(path).stroke;
  return () => {
    for (const { path, stroke } of saved) path.style.stroke = stroke;
  };
}
