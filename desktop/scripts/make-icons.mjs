// LR-T2 — K-Cross 마크로 데스크톱 앱 아이콘(.icns / .ico / .png)을 만든다.
//
//   node scripts/make-icons.mjs        (desktop/ 에서, frontend 의 Playwright chromium 을 빌려 쓴다)
//
// 왜 브라우저로 그리나: 이 머신엔 rsvg/ImageMagick 이 없고, 마크의 교차 "틈"이
// SVG mask 라 단순 래스터라이저는 자주 틀린다. 앱 파비콘(`frontend/src/app/icon.svg`)을
// 그리는 것과 같은 엔진으로 찍어야 탭·헤더·독 아이콘이 한 그림이 된다.
//
// 형태: macOS(Big Sur+) 관례대로 둥근 정사각형 타일을 캔버스의 ~82% 에 두고 바깥은 투명.
// 타일 색은 `design/tokens.ts` 의 bg→surface, 끈은 color.cord — 앱 헤더와 같은 팔레트.
// 좌표·굵기는 파비콘(끈 11 / 틈 19·14)과 동일 — 독에서도 16px 로 줄어드는 순간이 있다.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'build');
mkdirSync(out, { recursive: true });

const SIZE = 1024;
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div id="icon" style="width:${SIZE}px;height:${SIZE}px;display:grid;place-items:center">
  <svg viewBox="0 0 1024 1024" width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg" fill="none">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#141d30"/><stop offset="1" stop-color="#0b1220"/>
      </linearGradient>
      <mask id="stem" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
        <rect x="-8" y="-8" width="80" height="80" fill="white"/>
        <path d="M21 9 V55" stroke="black" stroke-width="19"/>
      </mask>
      <mask id="arm" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
        <rect x="-8" y="-8" width="80" height="80" fill="white"/>
        <path d="M21 29 L21 47" stroke="black" stroke-width="14"/>
      </mask>
    </defs>
    <!-- 타일: 캔버스 1024 중 832 (여백 96) — Apple 템플릿의 비율, 모서리 반경 ≈ 22.4% -->
    <rect x="96" y="96" width="832" height="832" rx="186" fill="url(#tile)"/>
    <rect x="96.5" y="96.5" width="831" height="831" rx="186" stroke="#818cf8" stroke-opacity=".18"/>
    <!-- 마크: 64 격자 → 타일 안 약 560px 로 확대, 실측 bbox(55×59, 원점 2,2 근처) 기준 중앙 정렬 -->
    <g transform="translate(512 512) scale(9.2) translate(-31.5 -32)">
      <path d="M54 8 L10 32 L54 56" mask="url(#stem)" stroke="#818cf8" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21 9 V55" mask="url(#arm)" stroke="#818cf8" stroke-width="11" stroke-linecap="round"/>
      <path d="M10 32.1 L32 43.9" stroke="#818cf8" stroke-width="11" stroke-linecap="round"/>
    </g>
  </svg>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
await page.setContent(html);
const png = (w) => page.locator('#icon').screenshot({ omitBackground: true, type: 'png' })
  .then(async (buf) => (w === SIZE ? buf : resize(buf, w)));
// 브라우저 안에서 canvas 로 다운스케일 — 외부 도구 없이 크기별 PNG 를 얻는다.
async function resize(buf, w) {
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  const b64 = await page.evaluate(async ([src, w]) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = w;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, w);
    return c.toDataURL('image/png').split(',')[1];
  }, [dataUrl, w]);
  return Buffer.from(b64, 'base64');
}

const master = await png(SIZE);
writeFileSync(join(out, 'icon.png'), master);

// .icns — iconutil (macOS 내장). iconset 의 파일명 규약이 곧 크기 표다.
const iconset = join(out, 'icon.iconset');
rmSync(iconset, { recursive: true, force: true }); mkdirSync(iconset);
for (const [name, w] of [
  ['icon_16x16', 16], ['icon_16x16@2x', 32], ['icon_32x32', 32], ['icon_32x32@2x', 64],
  ['icon_128x128', 128], ['icon_128x128@2x', 256], ['icon_256x256', 256], ['icon_256x256@2x', 512],
  ['icon_512x512', 512], ['icon_512x512@2x', 1024],
]) writeFileSync(join(iconset, `${name}.png`), await png(w));
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(out, 'icon.icns')]);
rmSync(iconset, { recursive: true });

// .ico — PNG 압축 엔트리(Vista+)를 담는 컨테이너를 직접 쓴다. 헤더 6B + 엔트리 16B×n + 데이터.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const entries = [];
for (const w of icoSizes) entries.push({ w, data: await png(w) });
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + 16 * entries.length;
const dir = entries.map(({ w, data }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(w === 256 ? 0 : w, 0); e.writeUInt8(w === 256 ? 0 : w, 1); // 256 은 0 으로 표기
  e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
  offset += data.length; return e;
});
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]));

await browser.close();
console.log('wrote', out, '→ icon.png (1024), icon.icns, icon.ico');
