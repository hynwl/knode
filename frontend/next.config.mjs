/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ⚠️ `next build` 는 기본적으로 `next dev` 와 **같은 `.next` 를 덮어쓴다.** dev
  // 서버가 도는 중에 빌드하면 코어 청크(main-app.js 등)가 404 로 죽는다 — 이 리포는
  // 여러 세션이 동시에 붙어 있어 실제로 두 번 발생했다. Next 는 `NEXT_DIST_DIR` 을
  // 자체적으로 읽지 않으므로(옵션 이름은 `distDir`) 여기서 직접 이어 준다:
  //     NEXT_DIST_DIR=.next-verify npx next build   # dev 서버를 안 건드리고 빌드
  //     git checkout -- next-env.d.ts tsconfig.json && rm -rf .next-verify
  // 값을 안 주면 평소대로 `.next` 다.
  //
  // ⚠️ 격리는 **산출물까지만**이다. `next build` 는 distDir 이 뭐든 추적 파일인
  // `next-env.d.ts` 와 `tsconfig.json` 을 자기 손으로 다시 써서 그 디렉터리를
  // 가리키게 만든다. 빌드 뒤 위 `git checkout` 을 빼먹으면 사라진 `.next-verify`
  // 를 참조하는 상태로 커밋되어 다른 사람의 타입체크가 깨진다.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // design/tokens.ts 는 frontend/ 바깥에 있으므로 트랜스파일 범위에 포함시킨다.
  outputFileTracingRoot: new URL('..', import.meta.url).pathname,
  eslint: { ignoreDuringBuilds: false },
};
export default nextConfig;
