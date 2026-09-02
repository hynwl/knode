# AgentCanvas backend — FastAPI + CrewAI 실행 서버 (Spec §19.1)
#
# 빌드 컨텍스트는 backend/ 자체다 (docker-compose.yml 의 `build: ./backend`).
# 백엔드는 리포 루트의 다른 디렉터리를 import 하지 않는다 (design/ 은 프론트 전용).
#
# 2단계 빌드: crewai/crewai-tools 의 전이 의존성 중 플랫폼별 프리빌트 wheel이
# 없는 조합은 소스 빌드가 필요할 수 있어 builder 단계에만 build-essential 을 둔다.
# 최종 이미지에는 컴파일 도구를 남기지 않는다.

FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /install /usr/local
COPY app ./app

# WORKSPACE_DIR (Spec §19.3) — file_read/directory_read 툴의 샌드박스 루트.
# docker-compose 에서 호스트의 ./workspace 를 여기 바인드 마운트한다. 컨테이너를
# 비루트로 돌리면 Docker 가 마운트 시 새로 만드는 호스트 디렉터리가 보통
# root:root 소유라 쓰기 권한 오류로 막힌다 — 로컬 원클릭 도구라는 목적(§19.1
# DoD: "깨끗한 머신에서 바로 됨")을 위해 이 컨테이너는 root 로 돌린다. 신뢰
# 경계는 SSRF/경로 탈출 가드(core/security.py)가 맡는다.
ENV WORKSPACE_DIR=/workspace
RUN mkdir -p /workspace

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health', timeout=2)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
