import { app, ipcMain, shell } from 'electron';
import { access, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

// 클린 프로필 첫 실행 판정(M6-T7). `userData` 안의 마커 파일 존재 여부로 판정한다 —
// 렌더러의 Welcome 화면(`frontend/src/panels/Welcome.tsx`)이 sessionStorage 로
// "이 탭에서" 봤는지를 기억하는 것과 달리, 이건 "이 설치에서 한 번" 을 보장해야
// 하므로 프로세스 재시작에도 살아남는 파일 기반 마커가 필요하다.
//
// 마커는 렌더러가 안내를 실제로 보여준 뒤 `markSeen` 을 호출해야 남는다 — 상태
// 조회 시점에 바로 남기면 창이 뜨기 전에 죽었을 때 안내를 영영 못 보게 된다.
const CHANNEL = {
  status: 'knode:onboarding:status',
  markSeen: 'knode:onboarding:markSeen',
  revealWorkspace: 'knode:onboarding:revealWorkspace',
} as const;

const MARKER_FILE = 'onboarded.json';

function markerPath(): string {
  return path.join(app.getPath('userData'), MARKER_FILE);
}

// backendManager.ts 의 `startBackend({ workspaceDir })` 과 같은 경로 계산 — 두 곳이
// 갈라지면 "폴더 열기" 가 백엔드가 실제로 쓰는 폴더와 다른 곳을 열게 된다.
function workspaceDir(): string {
  return path.join(app.getPath('userData'), 'workspace');
}

async function isFirstRun(): Promise<boolean> {
  try {
    await access(markerPath());
    return false;
  } catch {
    return true;
  }
}

export interface OnboardingStatus {
  firstRun: boolean;
  userDataDir: string;
  workspaceDir: string;
}

export function registerOnboardingBridge(): void {
  ipcMain.handle(CHANNEL.status, async (): Promise<OnboardingStatus> => ({
    firstRun: await isFirstRun(),
    userDataDir: app.getPath('userData'),
    workspaceDir: workspaceDir(),
  }));

  ipcMain.handle(CHANNEL.markSeen, async () => {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(markerPath(), JSON.stringify({ seenAt: new Date().toISOString() }));
  });

  ipcMain.handle(CHANNEL.revealWorkspace, async () => {
    await mkdir(workspaceDir(), { recursive: true });
    await shell.openPath(workspaceDir());
  });
}
