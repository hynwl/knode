# Knode frontend — Next.js 15 (Spec §19.1)
#
# 빌드 컨텍스트는 리포 루트다 (docker-compose.yml 의 `build: {context: ., dockerfile:
# frontend/Dockerfile}`). frontend/tailwind.config.ts 가 `../design/tokens.ts` 를
# import 하므로(design/ 은 frontend/ 바깥) frontend/ 만으로는 빌드가 안 된다.
#
# next.config.mjs 의 outputFileTracingRoot 가 리포 루트를 가리키므로, 이 Dockerfile도
# frontend/ 를 /app/frontend 에 두어 실제 리포와 같은 상대 경로 구조를 유지한다.

FROM node:22-slim AS deps
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY design ./design
COPY frontend ./frontend
WORKDIR /app/frontend
# 이 프로젝트에는 아직 frontend/public 이 없다 — 나중에 생기더라도 COPY 가
# 깨지지 않도록 빈 디렉터리를 보장해 둔다.
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* 은 빌드 시점에 클라이언트 번들로 인라인되므로 build-arg 로 받는다.
# ⚠️ 실제 코드가 읽는 변수명은 `NEXT_PUBLIC_API_BASE_URL`이다 (.env.example 참조 —
# 스펙 §19.3 표의 `NEXT_PUBLIC_API_BASE`는 코드와 어긋난 오기다).
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system app && useradd --system --gid app --home /app app

# standalone 산출물은 outputFileTracingRoot(=/app) 기준 상대 경로를 그대로 보존한다
# → 서버 엔트리는 /app/frontend/server.js.
COPY --from=builder --chown=app:app /app/frontend/.next/standalone ./
COPY --from=builder --chown=app:app /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=app:app /app/frontend/public ./frontend/public

USER app

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD ["node", "-e", "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "frontend/server.js"]
