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
  },
});
