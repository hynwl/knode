import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * `tsconfig.json` 의 `paths`(`@/*` → `./src/*`)를 vitest 에도 반영한다.
 * Next.js 빌드는 이 매핑을 자체 처리하지만, vitest 는 별도 설정이 없으면
 * `@/` import 를 못 찾는다 — 지금까지 소스 파일을 import 하지 않는 테스트만
 * 있어서 드러나지 않았을 뿐이다.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@design': path.resolve(__dirname, '../design'),
    },
  },
  test: {
    environment: 'node',
    // `e2e/*.spec.ts` 는 Playwright 전용이다 (M4-T7) — vitest 기본 include 패턴
    // (`**/*.spec.ts`)에 걸려 `test()` 이중 등록 충돌을 일으키므로 명시 제외한다.
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
});
