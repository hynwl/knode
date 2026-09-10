import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { BackendSupervisor, type BackendHandle } from './backendManager';
import { registerSecretsBridge } from './secretsBridge';
import { registerOnboardingBridge } from './onboarding/firstRun';

// `activate`(macOS 창 재생성)로 `createWindow()`가 다시 불려도 IPC 핸들러는 한 번만
// 등록돼야 한다 — 두 번째 `ipcMain.handle`은 "이미 등록된 채널" 에러를 던진다.
// `ipcMain.handle`은 `app.whenReady()` 이전에도 안전(등록만, 실제 호출은 렌더러가
// 뜬 뒤라 항상 ready 이후다)하므로 모듈 로드 시 1회만 실행한다.
registerSecretsBridge();
registerOnboardingBridge();

// Next 정적 export(`output:'export'`) 산출물은 `/_next/...` 같은 절대경로로 에셋을
// 참조한다. `file://` 로 직접 열면 브라우저가 그 절대경로를 파일시스템 루트
// 기준으로 풀어버려 에셋이 전부 깨진다 — 그래서 file:// 대신 로컬 정적서버를
// 하나 띄워 http(s) origin 으로 서빙한다. 이 origin(`http://127.0.0.1:<port>`)이
// 백엔드 사이드카(backendManager.ts)의 CORS `allowed_origins` 에 그대로 들어간다.
// 패키징된 앱(M6-T8a, electron-builder)에서는 `frontend/out`이 리포 상대경로가
// 아니라 `extraResources`로 `process.resourcesPath` 아래 복사된다.
const OUT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'frontend', 'out')
  : path.join(__dirname, '..', '..', 'frontend', 'out');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolveStaticFile(urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.normalize(path.join(OUT_DIR, relative));
  if (!resolved.startsWith(OUT_DIR)) return null; // path traversal 방지

  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      return resolveStaticFile(path.join(decoded, 'index.html'));
    }
    return resolved;
  } catch {
    // Next export 는 확장자 없는 경로(`/about`)를 `about.html` 로 내보낸다
    try {
      const withHtml = `${resolved}.html`;
      await stat(withHtml);
      return withHtml;
    } catch {
      return null;
    }
  }
}

function startStaticServer(): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const filePath = await resolveStaticFile(req.url ?? '/');
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      try {
        const body = await readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal error');
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // 포트 0 = OS가 사용 가능한 포트를 골라줌. 정적서버는 매 실행 임시 포트라
    // M6-T5의 순차 재시도 대상이 아니다(백엔드 고정 포트 8000만 해당).
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// `server`/`supervisor`를 모듈 스코프에 두는 이유: 이전엔 `before-quit` 리스너를
// `createWindow()` 안에서 등록해서, macOS `activate`로 창이 다시 만들어질 때마다
// (예: 창을 다 닫았다가 Dock 아이콘 클릭) 리스너가 누적됐다. 종료 훅은 앱 전체에
// 하나만 있으면 되므로 모듈 최상단에서 한 번만 등록하고, 그 훅이 참조할 현재
// 상태만 여기 보관한다.
let server: Server | undefined;
let supervisor: BackendSupervisor | undefined;

function shutdown(): void {
  server?.close();
  server = undefined;
  supervisor?.stop();
}

function handleBackendCrash(info: { code: number | null; attempt: number }): void {
  console.error(
    `[backend] 사이드카가 예기치 않게 종료(exit=${info.code}) — 재시작 시도 ${info.attempt}회째`,
  );
}

function handleBackendRestarted(handle: BackendHandle): void {
  console.log(`[backend] 재시작 완료 (port=${handle.port})`);
}

function handleBackendRestartExhausted(err: Error): void {
  console.error(`[backend] ${err.message}`);
  dialog.showErrorBox(
    'AgentCanvas 백엔드가 응답하지 않습니다',
    `${err.message}\n앱을 완전히 종료했다가 다시 실행해 주세요.`,
  );
}

async function createWindow(): Promise<void> {
  server = await startStaticServer();
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine static server port');
  }
  const staticOrigin = `http://127.0.0.1:${address.port}`;

  supervisor = new BackendSupervisor(
    {
      allowedOrigin: staticOrigin,
      workspaceDir: path.join(app.getPath('userData'), 'workspace'),
    },
    {
      onCrash: handleBackendCrash,
      onRestarted: handleBackendRestarted,
      onRestartExhausted: handleBackendRestartExhausted,
    },
  );

  let backend: BackendHandle;
  try {
    backend = await supervisor.start();
  } catch (err) {
    server.close();
    dialog.showErrorBox(
      'AgentCanvas 백엔드를 시작하지 못했습니다',
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--agentcanvas-api-base=${backend.apiBase}`],
    },
  });

  await win.loadURL(`${staticOrigin}/`);
}

app.whenReady().then(createWindow);

app.on('before-quit', shutdown);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

// 강제 종료(`kill <pid>` = SIGTERM, 터미널 Ctrl+C = SIGINT)는 Electron 앱
// 라이프사이클을 거치지 않고 프로세스를 바로 끝내 `before-quit`이 발화하지
// 않는다 — M6-T4b 실기동에서 실제로 재현된 버그(백엔드 자식이 고아로 남음).
// Node 레벨 시그널 핸들러로 우회 없이 직접 자식을 정리한다.
process.on('SIGTERM', () => {
  shutdown();
  app.exit(0);
});
process.on('SIGINT', () => {
  shutdown();
  app.exit(0);
});
