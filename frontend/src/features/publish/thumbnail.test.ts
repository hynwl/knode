import { describe, expect, it, vi } from 'vitest';
import type { Node, ReactFlowInstance } from '@xyflow/react';

import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_WIDTH,
  computeThumbnailViewport,
  dataUrlByteSize,
  generateThumbnail,
} from './thumbnail';

function node(id: string, x: number, y: number, width = 200, height = 100): Node {
  return { id, position: { x, y }, data: {}, measured: { width, height } } as Node;
}

/** base64 문자만으로 이뤄진, 길이로 바이트 수를 정밀 제어 가능한 가짜 data URI. */
function fakeDataUrl(mime: string, base64Length: number): string {
  return `data:${mime};base64,${'A'.repeat(base64Length)}`;
}

function fakeRf(nodes: Node[]): ReactFlowInstance {
  return { getNodes: () => nodes } as unknown as ReactFlowInstance;
}

interface FakePath { style: { stroke: string } }

/**
 * vitest 환경이 `node` 라 실제 DOM 이 없다. 캡처 전후로 엣지 path 를 훑는
 * `inlineEdgeStrokes` 가 요구하는 것은 `querySelectorAll` 하나뿐이라 그것만 흉내낸다.
 */
function fakeViewportEl(paths: FakePath[] = []): HTMLElement {
  return { querySelectorAll: () => paths } as unknown as HTMLElement;
}

describe('dataUrlByteSize', () => {
  it('패딩 없는 base64 길이를 3/4로 환산한다', () => {
    // 4자 base64(패딩 0) = 정확히 3바이트
    expect(dataUrlByteSize(fakeDataUrl('image/png', 4))).toBe(3);
    expect(dataUrlByteSize(fakeDataUrl('image/png', 400))).toBe(300);
  });

  it('패딩(`=`)을 뺀 실제 바이트 수를 돌려준다', () => {
    expect(dataUrlByteSize('data:image/png;base64,QQ==')).toBe(1); // 'A' 1바이트
    expect(dataUrlByteSize('data:image/png;base64,QUE=')).toBe(2); // 'AA' 2바이트
  });
});

describe('computeThumbnailViewport', () => {
  it('노드 전체를 담는 뷰포트를 계산하고 zoom 범위를 지킨다', () => {
    const nodes = [node('a', 0, 0), node('b', 800, 400)];
    const vp = computeThumbnailViewport(nodes);
    expect(vp.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(vp.x)).toBe(true);
    expect(Number.isFinite(vp.y)).toBe(true);
  });

  it('노드가 넓게 퍼질수록 더 축소된 zoom 을 낸다', () => {
    const tight = computeThumbnailViewport([node('a', 0, 0), node('b', 100, 50)]);
    const wide = computeThumbnailViewport([node('a', 0, 0), node('b', 5000, 3000)]);
    expect(wide.zoom).toBeLessThan(tight.zoom);
  });
});

describe('generateThumbnail', () => {
  it('노드가 없으면 null (뷰포트 DOM 조회조차 하지 않는다)', async () => {
    const getViewportEl = vi.fn();
    const result = await generateThumbnail(fakeRf([]), { getViewportEl });
    expect(result).toBeNull();
    expect(getViewportEl).not.toHaveBeenCalled();
  });

  /**
   * 회귀 가드 (M5-T8) — `html-to-image` 는 복제본에 페이지 스타일시트를 싣지 않아,
   * `globals.css` 규칙에만 있던 엣지 `stroke` 가 결과 이미지에서 통째로 빠졌다
   * (시드 카드 10장이 "선 없는 노드 그림"으로 나온 뒤 발견). 캡처 시점에만 인라인으로
   * 심고 곧바로 되돌리는지를 고정한다 — 영구히 심으면 hover/selected CSS 가 죽는다.
   */
  it('캡처 동안만 엣지 stroke 를 인라인으로 심고 끝나면 되돌린다', async () => {
    const paths: FakePath[] = [{ style: { stroke: '' } }, { style: { stroke: '' } }];
    vi.stubGlobal('window', { getComputedStyle: () => ({ stroke: 'rgb(75, 91, 124)' }) });

    const strokesDuringCapture: string[] = [];
    const capturePng = vi.fn().mockImplementation(async () => {
      strokesDuringCapture.push(...paths.map((p) => p.style.stroke));
      return fakeDataUrl('image/png', 400);
    });

    await generateThumbnail(fakeRf([node('a', 0, 0)]), {
      getViewportEl: () => fakeViewportEl(paths),
      capturePng,
    });

    expect(strokesDuringCapture).toEqual(['rgb(75, 91, 124)', 'rgb(75, 91, 124)']);
    expect(paths.map((p) => p.style.stroke)).toEqual(['', '']);
    vi.unstubAllGlobals();
  });

  it('뷰포트 DOM 을 못 찾으면 null', async () => {
    const capturePng = vi.fn();
    const result = await generateThumbnail(fakeRf([node('a', 0, 0)]), {
      getViewportEl: () => null,
      capturePng,
    });
    expect(result).toBeNull();
    expect(capturePng).not.toHaveBeenCalled();
  });

  it('PNG 가 200KB 이하면 그대로 반환하고 JPEG 는 시도하지 않는다', async () => {
    const small = fakeDataUrl('image/png', 400); // 300바이트
    const capturePng = vi.fn().mockResolvedValue(small);
    const captureJpeg = vi.fn();
    const el = fakeViewportEl();
    const result = await generateThumbnail(fakeRf([node('a', 0, 0)]), {
      getViewportEl: () => el,
      capturePng,
      captureJpeg,
    });
    expect(result).toBe(small);
    expect(captureJpeg).not.toHaveBeenCalled();
    // width/height 는 카드 프리뷰 규격으로 고정 전달된다.
    expect(capturePng.mock.calls[0]?.[1]).toMatchObject({
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
    });
  });

  it('PNG 가 초과하면 JPEG 품질을 낮춰가며 재시도하고 처음 통과하는 값을 쓴다', async () => {
    const big = fakeDataUrl('image/png', 300_000); // 225000바이트 > 204800
    const stillBig = fakeDataUrl('image/jpeg', 280_000); // 210000바이트 > 204800
    const okJpeg = fakeDataUrl('image/jpeg', 200); // 150바이트

    const capturePng = vi.fn().mockResolvedValue(big);
    const captureJpeg = vi.fn()
      .mockResolvedValueOnce(stillBig) // quality 0.85
      .mockResolvedValueOnce(okJpeg); // quality 0.6

    const result = await generateThumbnail(fakeRf([node('a', 0, 0)]), {
      getViewportEl: () => fakeViewportEl(),
      capturePng,
      captureJpeg,
    });

    expect(result).toBe(okJpeg);
    expect(captureJpeg).toHaveBeenCalledTimes(2);
    expect(dataUrlByteSize(result!)).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
  });

  it('모든 품질 단계가 여전히 초과해도 최선의(가장 낮은 품질) 결과를 돌려준다', async () => {
    const big = fakeDataUrl('image/png', 1_000_000);
    const capturePng = vi.fn().mockResolvedValue(big);
    const captureJpeg = vi.fn().mockResolvedValue(fakeDataUrl('image/jpeg', 900_000));

    const result = await generateThumbnail(fakeRf([node('a', 0, 0)]), {
      getViewportEl: () => fakeViewportEl(),
      capturePng,
      captureJpeg,
    });

    expect(captureJpeg).toHaveBeenCalledTimes(3); // 0.85 / 0.6 / 0.4 전부 소진
    expect(result).toBe(await captureJpeg.mock.results[2]!.value);
  });
});
