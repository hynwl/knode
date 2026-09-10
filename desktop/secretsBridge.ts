import { app, ipcMain, safeStorage } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

// BYOK 키는 웹 배포에서 LocalStorage(§12.1, M2-T18)에 평문으로 남는다 — Electron은
// OS 키체인(`safeStorage`)로 대체한다. `safeStorage`는 문자열 암복호화만 하고
// 영속화는 직접 해야 하므로, 암호화된 바이트를 `userData`에 파일로 둔다.
// 채널 이름의 `agentcanvas:` 접두사는 다른 preload IPC와 네임스페이스 충돌을 막는다.
const CHANNEL = {
  read: 'agentcanvas:secrets:read',
  write: 'agentcanvas:secrets:write',
  remove: 'agentcanvas:secrets:remove',
} as const;

function secretsFilePath(): string {
  return path.join(app.getPath('userData'), 'secrets.enc');
}

// ipcMain.handle 콜백과 헤드리스 테스트 하네스가 같은 로직을 쓰도록 IPC 배선과
// 분리해 둔다 — `ipcMain.handle`은 renderer의 `ipcRenderer.invoke`를 거쳐야만
// 트리거되므로, 로직 자체가 함수로 분리돼 있지 않으면 창 없이 검증할 방법이 없다.
export async function readSecrets(): Promise<unknown> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = await readFile(secretsFilePath());
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    // 파일 없음(최초 실행) 또는 손상된 저장본 — 빈 상태로 시작한다.
    return null;
  }
}

export async function writeSecrets(payload: unknown): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS 키체인을 사용할 수 없어 키를 저장하지 못했습니다.');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(payload));
  const filePath = secretsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, encrypted);
}

export async function removeSecrets(): Promise<void> {
  try {
    await rm(secretsFilePath());
  } catch {
    // 이미 없으면 그걸로 충분하다.
  }
}

export function registerSecretsBridge(): void {
  ipcMain.handle(CHANNEL.read, () => readSecrets());
  ipcMain.handle(CHANNEL.write, (_event, payload: unknown) => writeSecrets(payload));
  ipcMain.handle(CHANNEL.remove, () => removeSecrets());
}
