import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * `next dev` 는 distDir 이 무엇이든 **추적 파일**인 `tsconfig.json` 과
 * `next-env.d.ts` 를 자기 손으로 다시 써서 그 디렉터리를 가리키게 만든다
 * (`next.config.mjs` 상단 주석 참조). E2E 는 `.next-e2e` 를 쓰므로, 원복하지
 * 않으면 사라진 디렉터리를 참조하는 tsconfig 가 커밋되어 남의 타입체크를 깬다.
 *
 * 산출물 디렉터리 자체는 `.gitignore` 의 `.next-` 글롭이 잡아 주므로 지우지 않는다
 * (다음 실행의 증분 컴파일 캐시로 쓰인다).
 */
export default function globalTeardown(): void {
  const cwd = path.resolve(__dirname, '..');
  try {
    execFileSync('git', ['checkout', '--', 'next-env.d.ts', 'tsconfig.json'], { cwd, stdio: 'ignore' });
  } catch {
    // git 이 없거나 워크트리가 아닌 환경(도커 등) — E2E 결과에는 영향이 없다.
  }
}
