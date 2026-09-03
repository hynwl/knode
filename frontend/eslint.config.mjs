import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

// `next lint`(및 CI 의 `eslint .`)가 지금까지 이 파일이 없어 대화형 셋업 프롬프트로
// 막혀 있었다(비대화 셸/CI에서는 즉시 실패) — M4-T7 에서 CI 를 처음 붙이며 드러났다.
export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', '.next-*/**', 'node_modules/**', 'e2e/**'],
  },
];
