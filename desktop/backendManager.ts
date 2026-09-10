import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import * as path from 'node:path';

// backend/scripts/package_standalone.py(M6-T2) 가 만드는 산출물 레이아웃 —
// <dir>/python/cpython-*/{bin/python3.*,python.exe,install/...}, <dir>/site-packages, <dir>/app.
// 실행파일 위치는 플랫폼에 따라 갈린다(findPythonBin 참고) — 그 스크립트의 출력
// 구조와 반드시 맞아야 한다.
// 패키징된 앱(M6-T8a)에서는 이 산출물이 리포 상대경로가 아니라 `extraResources`로
// `process.resourcesPath` 아래 복사된다 — main.ts의 OUT_DIR과 같은 분기.
const STANDALONE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'backend', 'dist_standalone')
  : path.join(__dirname, '..', '..', 'backend', 'dist_standalone');
const HEALTH_PATH = '/api/v1/health';
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 200;
const DEFAULT_PORT = 8000;
const MAX_PORT_ATTEMPTS = 20;
// 사이드카가 죽은 뒤 재시작까지의 대기 — 즉시 재시도하면 포트가 아직 안
// 풀렸거나(TIME_WAIT) 크래시 원인이 그대로라 크래시 루프를 빠르게 반복만 한다.
const CRASH_RESTART_DELAY_MS = 1_000;
// 짧은 시간에 반복 크래시하면 포기한다 — 무한 재시작은 사용자에게 "먹통인데
// 조용히 도는 중"인 것보다 명확한 실패가 낫다.
const MAX_CRASH_RESTARTS = 5;
// 재시작 후 이만큼 안 죽고 버티면 "회복됐다"고 보고 카운터를 리셋한다 —
// 그래야 며칠 켜둔 앱이 드물게 한 번씩 죽어도 재시작 예산이 안 고갈된다.
const CRASH_RESET_WINDOW_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidate = startPort + offset;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(
    `${startPort}부터 ${MAX_PORT_ATTEMPTS}개 포트가 모두 사용 중이라 백엔드를 띄울 포트를 찾지 못했습니다.`,
  );
}

export interface BackendHandle {
  process: ChildProcessWithoutNullStreams;
  port: number;
  apiBase: string;
}

async function findExecutableInDir(dir: string, pattern: RegExp): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const match = names.find((f) => pattern.test(f));
  return match ? path.join(dir, match) : undefined;
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

// package_standalone.py(find_python_bin)와 짝을 이루는 탐색 순서 — 실측 없이
// 하나만 가정하면 Windows에서 조용히 깨진다:
// macOS/Linux: cpython-*/bin/python3.<N> (uv 관리형) 또는
//              cpython-*/install/bin/python3.<N> (raw python-build-standalone)
// Windows:     cpython-*/python.exe (uv 관리형) 또는
//              cpython-*/install/python.exe (raw python-build-standalone)
async function findPythonBin(): Promise<string> {
  const pythonRoot = path.join(STANDALONE_DIR, 'python');
  let entries: Dirent[];
  try {
    entries = await readdir(pythonRoot, { withFileTypes: true });
  } catch {
    throw new Error(
      `임베디드 Python을 ${pythonRoot} 에서 찾지 못했습니다. ` +
        'backend/scripts/package_standalone.py 를 먼저 실행하세요.',
    );
  }

  const cpythonDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('cpython-'))
    .map((e) => e.name)
    .sort();

  for (const dirName of cpythonDirs) {
    const cpythonDir = path.join(pythonRoot, dirName);

    // python3.12-config 같은 스크립트 제외, python3.<N> 실행파일만
    const unixBin =
      (await findExecutableInDir(path.join(cpythonDir, 'bin'), /^python3\.\d+$/)) ??
      (await findExecutableInDir(path.join(cpythonDir, 'install', 'bin'), /^python3\.\d+$/));
    if (unixBin) return unixBin;

    for (const winCandidate of [
      path.join(cpythonDir, 'python.exe'),
      path.join(cpythonDir, 'install', 'python.exe'),
    ]) {
      if (await fileExists(winCandidate)) return winCandidate;
    }
  }

  throw new Error(`임베디드 Python 실행파일을 ${pythonRoot} 아래에서 찾지 못했습니다.`);
}

function waitForHealth(apiBase: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let settled = false;

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      reject(new Error(`백엔드 사이드카가 헬스체크 전에 종료됐습니다 (exit=${code})`));
    };
    child.once('exit', onExit);

    const poll = (): void => {
      if (settled) return;
      fetch(`${apiBase}${HEALTH_PATH}`)
        .then((res) => {
          if (settled) return;
          if (res.ok) {
            settled = true;
            child.off('exit', onExit);
            resolve();
            return;
          }
          if (Date.now() > deadline) {
            settled = true;
            reject(new Error(`백엔드 헬스체크가 실패 상태(${res.status})로 타임아웃됐습니다`));
            return;
          }
          setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
        })
        .catch(() => {
          if (settled) return;
          if (Date.now() > deadline) {
            settled = true;
            reject(new Error('백엔드 헬스체크가 응답 없이 타임아웃됐습니다'));
            return;
          }
          setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
        });
    };
    poll();
  });
}

export interface StartBackendOptions {
  /** 정적 프론트서버 origin — 백엔드 CORS `allowed_origins`에 그대로 들어간다 */
  allowedOrigin: string;
  /** file_read/directory_read 툴의 샌드박스 루트 (WORKSPACE_DIR) */
  workspaceDir: string;
}

export async function startBackend(options: StartBackendOptions): Promise<BackendHandle> {
  const pythonBin = await findPythonBin();
  const sitePackages = path.join(STANDALONE_DIR, 'site-packages');
  const appDir = path.join(STANDALONE_DIR, 'app');
  // 8000이 점유 중이면 8001... 순차로 빈 포트를 찾는다. 재시작 시에도 이
  // 함수를 다시 타므로, 죽은 우리 프로세스가 놓아준 포트는 자연스럽게 다시
  // 잡히고, 그사이 다른 프로그램이 먼저 채갔다면 그다음 빈 포트로 넘어간다.
  const port = await findAvailablePort(DEFAULT_PORT);

  await mkdir(options.workspaceDir, { recursive: true });

  const child = spawn(
    pythonBin,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: path.dirname(appDir),
      env: {
        ...process.env,
        PYTHONPATH: sitePackages,
        ALLOWED_ORIGINS: options.allowedOrigin,
        WORKSPACE_DIR: options.workspaceDir,
      },
    },
  );

  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(`[backend] ${chunk}`));
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[backend] ${chunk}`));

  const apiBase = `http://127.0.0.1:${port}`;
  await waitForHealth(apiBase, child);

  return { process: child, port, apiBase };
}

export interface BackendSupervisorHooks {
  /** 사이드카가 죽어서 재시작을 시도하기 직전 — 로깅용 */
  onCrash?: (info: { code: number | null; attempt: number }) => void;
  /** 재시작이 성공해 새 프로세스가 헬스체크를 통과함 */
  onRestarted?: (handle: BackendHandle) => void;
  /** 재시작 예산(MAX_CRASH_RESTARTS)을 소진했거나 재시작 자체가 실패함 — 더는 재시도 안 함 */
  onRestartExhausted?: (error: Error) => void;
}

// M6-T4b 실기동에서 확인된 문제: Electron main이 SIGTERM(또는 크래시)으로 죽으면
// 백엔드 자식이 고아로 남는다. 그 해법은 main.ts 쪽 종료 훅이고, 여기 Supervisor는
// 반대 방향 — 백엔드가 먼저 죽었을 때 Electron은 살아있는 경우를 다룬다(사이드카
// 자체 크래시). `stop()`으로 명시적으로 멈춘 경우는 재시작하지 않는다.
export class BackendSupervisor {
  private handle: BackendHandle | undefined;
  private stopping = false;
  private restartCount = 0;
  private resetTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly options: StartBackendOptions,
    private readonly hooks: BackendSupervisorHooks = {},
  ) {}

  async start(): Promise<BackendHandle> {
    this.handle = await startBackend(this.options);
    this.armWatcher(this.handle);
    return this.handle;
  }

  get current(): BackendHandle | undefined {
    return this.handle;
  }

  stop(): void {
    this.stopping = true;
    if (this.resetTimer) clearTimeout(this.resetTimer);
    if (this.handle && !this.handle.process.killed) {
      this.handle.process.kill();
    }
  }

  private armWatcher(handle: BackendHandle): void {
    handle.process.once('exit', (code) => {
      if (this.stopping) return;
      void this.handleCrash(code);
    });
  }

  private async handleCrash(code: number | null): Promise<void> {
    if (this.restartCount >= MAX_CRASH_RESTARTS) {
      this.hooks.onRestartExhausted?.(
        new Error(`백엔드가 ${MAX_CRASH_RESTARTS}회 연속 종료돼 재시작을 포기합니다 (마지막 exit=${code})`),
      );
      return;
    }
    this.restartCount += 1;
    this.hooks.onCrash?.({ code, attempt: this.restartCount });

    await delay(CRASH_RESTART_DELAY_MS);
    if (this.stopping) return;

    try {
      this.handle = await startBackend(this.options);
      this.armWatcher(this.handle);
      this.scheduleCounterReset();
      this.hooks.onRestarted?.(this.handle);
    } catch (err) {
      this.hooks.onRestartExhausted?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private scheduleCounterReset(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.restartCount = 0;
    }, CRASH_RESET_WINDOW_MS);
  }
}
