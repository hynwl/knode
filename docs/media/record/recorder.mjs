// High-fidelity frame recorder: polls CDP Page.captureScreenshot at device pixel
// resolution (honours deviceScaleFactor) and writes frames + a ffmpeg concat list.
import fs from 'node:fs';
import path from 'node:path';

export async function startRecorder(page, dir, { format = 'jpeg', quality = 95, fps = 30, scale = 2 } = {}) {
  const vp = page.viewportSize();
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  let running = true;
  let i = 0;
  const t0 = performance.now();
  const ext = format === 'png' ? 'png' : 'jpg';
  const loop = (async () => {
    while (running) {
      const t = (performance.now() - t0) / 1000;
      try {
        const { data } = await cdp.send('Page.captureScreenshot', {
          format, ...(format === 'jpeg' ? { quality } : { optimizeForSpeed: true }), fromSurface: true,
          // clip.scale = deviceScaleFactor makes Chromium return device pixels
          clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale },
        });
        const file = path.join(dir, `f${String(i++).padStart(5, '0')}.${ext}`);
        frames.push({ file, t });
        writes.push(fs.promises.writeFile(file, Buffer.from(data, 'base64')));
        const spent = (performance.now() - t0) / 1000 - t;
        if (spent < 1 / fps) await new Promise((r) => setTimeout(r, (1 / fps - spent) * 1000));
      } catch (e) {
        if (!running) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  })();
  return {
    async stop(tailSeconds = 0.5) {
      running = false;
      await loop;
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      const lines = [];
      for (let k = 0; k < frames.length; k++) {
        const d = k + 1 < frames.length ? frames[k + 1].t - frames[k].t : tailSeconds;
        lines.push(`file '${frames[k].file}'`, `duration ${Math.max(d, 0.001).toFixed(4)}`);
      }
      // concat demuxer quirk: repeat the last file so its duration is honoured
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = path.join(dir, 'frames.txt');
      fs.writeFileSync(list, lines.join('\n') + '\n');
      const secs = frames[frames.length - 1].t - frames[0].t;
      return { list, count: frames.length, seconds: secs, fps: frames.length / Math.max(secs, 0.001) };
    },
  };
}

/** Screenshots never contain the OS cursor — draw one that follows Playwright's mouse. */
export async function installCursor(page) {
  await page.addInitScript(() => {
    const mount = () => {
      const c = document.createElement('div');
      c.id = '__rec_cursor';
      c.style.cssText = 'position:fixed;left:-100px;top:-100px;width:20px;height:24px;pointer-events:none;z-index:2147483647;transform-origin:4px 2px;transition:transform .08s';
      c.innerHTML = '<svg width="20" height="24" viewBox="0 0 20 24"><path d="M3 2 L3 19 L7.5 15 L10.5 22 L13.5 20.7 L10.6 14 L16.5 14 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c);
      window.addEventListener('mousemove', (e) => { c.style.left = e.clientX - 3 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
      window.addEventListener('mousedown', () => { c.style.transform = 'scale(.8)'; }, true);
      window.addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
    };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  });
}

/**
 * Next dev overlay badge must not appear in a product video. Modal backdrop blur is
 * also dropped: it makes every 2x screenshot ~4x slower (227ms -> 66ms) and would
 * starve the capture loop; the dark overlay itself stays.
 */
export async function hideDevBadge(page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important} .backdrop-blur-\\[2px\\]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' });
}
