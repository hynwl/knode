/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // design/tokens.ts 는 frontend/ 바깥에 있으므로 트랜스파일 범위에 포함시킨다.
  outputFileTracingRoot: new URL('..', import.meta.url).pathname,
  eslint: { ignoreDuringBuilds: false },
};
export default nextConfig;
