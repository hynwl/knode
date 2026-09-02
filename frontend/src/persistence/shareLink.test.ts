import { beforeAll, describe, expect, it } from 'vitest';

import { getTemplate } from '@/templates/builtin';
import { AcanvasError } from './migrations';
import { buildShareLink, importFromShareHash, SHARE_HASH_PREFIX, SHARE_LINK_MAX_BYTES } from './shareLink';

const doc = getTemplate('hello')!.build();

// jsdom 환경은 Blob.stream()을 구현하지 않아 gzip 압축이 깨진다(실측 확인).
// 반면 Node 네이티브 Blob 은 완전한 Streams 구현이라 'node' 환경을 그대로 쓰고,
// `buildShareLink`가 참조하는 `window.location`만 최소한으로 흉내낸다.
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    location: new URL('https://example.test/canvas'),
  };
});

describe('buildShareLink / importFromShareHash', () => {
  it('gzip+base64url 왕복 후 그래프가 그대로 복원된다', async () => {
    const outcome = await buildShareLink(doc);
    expect(outcome.kind).toBe('link');
    if (outcome.kind !== 'link') return;

    const hash = new URL(outcome.url).hash;
    expect(hash.startsWith(SHARE_HASH_PREFIX)).toBe(true);

    const { doc: restored, redactions } = await importFromShareHash(hash);
    expect(redactions).toHaveLength(0);
    expect(restored.nodes).toEqual(doc.nodes);
    expect(restored.edges).toEqual(doc.edges);
    expect(restored.name).toBe(doc.name);
  });

  it('그래프는 `#` 프래그먼트 뒤에만 실린다(서버로 전송되지 않는 자리)', async () => {
    const outcome = await buildShareLink(doc);
    if (outcome.kind !== 'link') throw new Error('expected link');
    const url = new URL(outcome.url);
    expect(url.hash).toBe(outcome.url.slice(outcome.url.indexOf('#')));
    expect(url.hash.startsWith(SHARE_HASH_PREFIX)).toBe(true);
    expect(url.search).toBe('');
  });

  it('그래프에 API 키가 있으면 AC-E404 로 링크 생성을 막는다', async () => {
    const withSecret = { ...doc, nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, data: { ...n.data, note: 'sk-abcdefghijklmnopqrstuvwx' } } : n)) };
    await expect(buildShareLink(withSecret)).rejects.toMatchObject({ code: 'AC-E404' });
  });

  it('3KB 를 넘는 그래프는 링크 대신 too-large 를 반환한다', async () => {
    // 반복 문자는 gzip 이 잘 눌러버려 임계값을 안 넘긴다 — 압축이 잘 안 되는
    // 난수 문자열이어야 실제로 3KB 를 초과하는 페이로드가 된다.
    const noise = Array.from({ length: 8000 }, () => Math.random().toString(36).slice(2)).join('');
    const huge = {
      ...doc,
      nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, data: { ...n.data, note: noise } } : n)),
    };
    const outcome = await buildShareLink(huge);
    expect(outcome.kind).toBe('too-large');
    if (outcome.kind === 'too-large') expect(outcome.encodedBytes).toBeGreaterThan(SHARE_LINK_MAX_BYTES);
  });

  it('접두사가 없는 해시는 AC-E403 으로 거부한다', async () => {
    await expect(importFromShareHash('#notshare=abc')).rejects.toMatchObject({ code: 'AC-E403' } satisfies Partial<AcanvasError>);
  });

  it('깨진 base64/gzip 페이로드는 AC-E403 으로 거부한다', async () => {
    await expect(importFromShareHash(`${SHARE_HASH_PREFIX}not-valid-gzip-data`)).rejects.toMatchObject({ code: 'AC-E403' });
  });

  it('복원된 그래프에 시크릿이 섞여 있으면 차단이 아니라 마스킹 후 알려준다', async () => {
    const withSecret = { ...doc, description: 'key: sk-abcdefghijklmnopqrstuvwx' };
    // 시크릿이 있으면 애초에 링크가 안 만들어지므로(AC-E404), 수동으로 만든 페이로드로
    // "이미 퍼진 링크"를 흉내낸다 — importFromShareHash 는 export 경로와 달리 마스킹만 한다.
    const json = JSON.stringify(withSecret);
    const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const bytes = new Uint8Array(gz);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const { doc: restored, redactions } = await importFromShareHash(`${SHARE_HASH_PREFIX}${encoded}`);
    expect(redactions.length).toBeGreaterThan(0);
    expect(restored.description).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });
});
