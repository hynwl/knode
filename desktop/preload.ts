import { contextBridge, ipcRenderer } from 'electron';

// `contextIsolation: true`라 main-world `window`에 직접 값을 쓸 수 없다 —
// main.ts가 BrowserWindow 생성 시 `webPreferences.additionalArguments`로
// 실제 백엔드 사이드카 포트를 넘기고, 여기서 그걸 읽어 contextBridge로
// main-world에 노출한다. frontend/src/lib/apiBase.ts(M6-T3)가 이 값을 읽는다.
const ARG_PREFIX = '--knode-api-base=';
const arg = process.argv.find((a) => a.startsWith(ARG_PREFIX));

if (arg) {
  const apiBase = arg.slice(ARG_PREFIX.length);
  contextBridge.exposeInMainWorld('__AGENTCANVAS_API_BASE__', apiBase);
}

// BYOK 키의 OS 키체인 저장(M6-T6, `desktop/secretsBridge.ts`). 값 자체는 여기를
// 그냥 지나가는 통로일 뿐이고, `frontend/src/store/secrets.ts`가 이 존재 여부로
// LocalStorage 대신 이 브리지를 쓸지 분기한다.
contextBridge.exposeInMainWorld('__AGENTCANVAS_SECRETS_BRIDGE__', {
  read: () => ipcRenderer.invoke('knode:secrets:read'),
  write: (payload: unknown) => ipcRenderer.invoke('knode:secrets:write', payload),
  remove: () => ipcRenderer.invoke('knode:secrets:remove'),
});

// 첫 실행 온보딩(M6-T7, `desktop/onboarding/firstRun.ts`). 데이터 디렉터리 안내는
// userData 안 마커 파일로 판정하므로 세션(sessionStorage) 기반인 Welcome 화면과
// 달리 설치당 정확히 한 번만 뜬다. `frontend/src/lib/desktopOnboarding.ts`가 이
// 존재 여부로 웹/데스크톱을 가른다.
contextBridge.exposeInMainWorld('__AGENTCANVAS_ONBOARDING_BRIDGE__', {
  status: () => ipcRenderer.invoke('knode:onboarding:status'),
  markSeen: () => ipcRenderer.invoke('knode:onboarding:markSeen'),
  revealWorkspace: () => ipcRenderer.invoke('knode:onboarding:revealWorkspace'),
});
