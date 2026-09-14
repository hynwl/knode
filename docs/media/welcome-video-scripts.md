# Welcome 페이지 영상 3종 — 촬영 대본

`frontend/public/` 에 있는 영상 3개가 각각 무엇을, 어떤 절차로, 어떤 앱 상태로 찍었는지를
정리한다. 전부 **실제 앱 화면을 Playwright 로 자동 조작하며 녹화**한 것이지 목업이 아니다.
재촬영 스크립트는 전부 [`record/`](record/) 에 있다 — 문서 안의 코드를 베끼지 말고 그 파일을
그대로 돌리면 된다.

| 파일 | 내용 | 해상도 | 길이 | 스크립트 |
|---|---|---|---|---|
| `feature-assemble.mp4` | 빈 캔버스에서 6노드 파이프라인 조립 | 1920×1080 (16:9) | 20.9s (1.2배속) | `record-assemble.mjs` |
| `feature-export.mp4` | 시장 조사 리포트 템플릿 → Export Code → `canvas.py` 스크롤 | 1920×1080 (16:9) | 18.8s | `record-export.mjs` |
| `demo.mp4` (+ `demo.gif`) | Blog & SEO Crew 를 로컬 Ollama 로 실제 실행 | 2560×1440 (16:9) | ~65s | `make-demo-seed.mjs` → `record-demo.mjs` |

## 2026-09-14 재촬영에서 바뀐 것 (왜 이전 버전이 "쓰레기"였나)

1. **Playwright `recordVideo` 를 버렸다.** 그 녹화는 CDP screencast(JPEG) 를 VP8 로 재인코딩한
   것이라 원본부터 뭉개져 있고, 1× CSS 픽셀 해상도만 나온다. 이제 `recorder.mjs` 가
   **`Page.captureScreenshot` 을 30fps 로 폴링해 PNG 프레임(무손실, `deviceScaleFactor: 2` →
   2× 해상도)** 을 쌓고 ffmpeg concat 으로 합친다. 실제 캡처율은 2880×1620 기준 20~24fps.
2. **세 영상 모두 16:9 다.** `Welcome.tsx` 의 `.feature-media video` 와 `.stage video` 가
   `aspect-ratio: 16/9; object-fit: cover` 라서, 이전의 1400×652 / 1180×756 은 카드 안에서
   좌우·상하가 **잘려 보이고 있었다**. 뷰포트 자체를 16:9 로 잡고 크롭 없이 낸다.
3. **뷰포트는 헤더가 다 들어오는 최소 폭으로.** 1180 은 `Queue Prompt` 가 잘리고 1440 은
   오류 배지(`N개 오류`)가 뜨는 순간 `Queue Prompt` 가 두 줄로 접힌다 → 기능 영상은
   **1520×855**, 데모는 **1600×900**. 이전 assemble 은 2000px 로 찍어 1400 으로 줄인 탓에
   UI 가 0.7 배로 쪼그라들어 있었다.
4. **커서가 보인다.** 스크린샷에는 OS 커서가 안 찍히므로 `installCursor()` 가 Playwright
   마우스를 따라다니는 SVG 화살표를 DOM 에 심는다 (mousedown 에 살짝 줄어듦).
5. **Next dev 배지(`N`) 를 숨긴다** — `hideDevBadge()` 가 `nextjs-portal` 을 감춘다. 이전
   demo.mp4 좌하단에 그대로 박혀 있었다.
6. Welcome 의 기능 카드 미디어 `max-width: 640px` 상한을 풀었다 — 카드 폭을 그대로 채운다.

## 공통 촬영 인프라

사용자의 실제 세션(포트 3000, Docker 백엔드)을 절대 건드리지 않기 위해 격리된
프론트엔드/백엔드를 별도 포트에 띄우고 그 위에서만 녹화한다.

```bash
# 1) 격리 백엔드 — CORS 를 녹화용 프론트 origin 에만 열어준다
cd backend
ALLOWED_ORIGINS=http://localhost:3101 .venv/bin/uvicorn app.main:app --port 8001 &

# 2) 격리 프론트엔드 — NEXT_DIST_DIR 로 .next 와 충돌 방지, 격리 백엔드를 바라보게
cd frontend
rm -rf .next-record
NEXT_DIST_DIR=.next-record NEXT_PUBLIC_API_BASE_URL=http://localhost:8001 \
  npx next dev -p 3101 &

# 3) 스크립트는 frontend/ 의 node_modules 를 찾아야 하므로 잠깐 복사해서 돌린다
cp docs/media/record/*.mjs frontend/scripts/
export OUT_DIR=/tmp/knode-record          # 프레임 PNG 가 쌓이는 곳 (demo 는 ~660MB)
node frontend/scripts/record-assemble.mjs
node frontend/scripts/record-export.mjs
node frontend/scripts/make-demo-seed.mjs && node frontend/scripts/record-demo.mjs
rm frontend/scripts/{recorder,record-*,make-demo-seed}.mjs
```

- **절대 포트 3000 을 쓰지 않는다** — 사람이 쓰는 개발 세션 전용 (`frontend/playwright.config.ts` 의 규칙과 동일).
- Next dev 서버는 `NEXT_DIST_DIR`/`distDir` 를 쓰면 `tsconfig.json` / `next-env.d.ts` 를 건드린다.
  녹화가 끝나면 반드시 원복:
  ```bash
  git checkout -- frontend/next-env.d.ts frontend/tsconfig.json
  ```
- **`recorder.mjs` 의 핵심 함정 두 가지**:
  - `Page.captureScreenshot` 은 `clip` 없이 부르면 **CSS 픽셀**로 나온다. 2× 를 얻으려면
    `clip: { x:0, y:0, width, height, scale: 2 }` 처럼 **`clip.scale` 에 deviceScaleFactor 를
    넣어야** 한다 (`Page.startScreencast` 는 `maxWidth` 를 얼마를 주든 CSS 픽셀만 준다).
  - **모달의 `backdrop-blur` 가 켜져 있으면 스크린샷 한 장이 227ms** 로 4배 느려져 프레임이
    7fps 로 떨어진다. `hideDevBadge()` 가 `.backdrop-blur-[2px]` 의 `backdrop-filter` 를 끈다
    (어두운 오버레이 자체는 남는다). `addStyleTag` 문자열 안에서 `[`/`]` 는 `\\[` 로
    이스케이프해야 셀렉터가 산다.
- 프레임 → mp4 (프레임 간격은 `frames.txt` 의 `duration` 으로 보존된다):
  ```bash
  ffmpeg -y -f concat -safe 0 -i $OUT_DIR/asm/frames.txt \
    -vf "fps=30,scale=1920:1080:flags=lanczos,setpts=PTS/1.2" -r 30 \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -an \
    frontend/public/feature-assemble.mp4
  ffmpeg -y -f concat -safe 0 -i $OUT_DIR/exp/frames.txt \
    -vf "fps=30,scale=1920:1080:flags=lanczos" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -an \
    frontend/public/feature-export.mp4
  ffmpeg -y -f concat -safe 0 -i $OUT_DIR/demo/frames.txt \
    -vf "fps=30,scale=2560:1440:flags=lanczos" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an \
    frontend/public/demo.mp4
  ```
- **로고 교체 직후라면 dev 서버가 500 을 뱉는지 먼저 확인한다.** Next 의 metadata
  image loader 가 쓰는 `image-size` 는 **파일 앞 1000 바이트 안에서만** `<svg` 를
  찾는다. `frontend/src/app/icon.svg` 머리말 주석이 길어져 `<svg` 가 1000 바이트
  밖으로 밀리면 `Image import ... is not a valid image file` 로 페이지 전체가 죽는다
  (한글 주석은 글자당 3바이트라 금방 넘어간다). 긴 설명은 `<svg>` **안쪽** 주석으로
  옮길 것.
- 앱 내부 드래그(노드 이동, 소켓 연결)는 **HTML5 네이티브 드래그가 아니라 pointer 이벤트
  기반**이다. 반드시 `page.mouse.move/down/move(steps)/up` 시퀀스로 흉내내야 하고,
  `page.dragAndDrop()` 류는 동작하지 않는다.
- **커서가 노드 위에 머물면 hover 카드가 뜬다.** 그 카드가 이웃 노드의 소켓을 덮으면
  다음 소켓 드래그가 카드의 글자를 선택하고 끝난다(2026-09-14 실측 — Crew→Output 엣지가
  두 번 연속 안 그어진 원인). 드래그/클릭이 끝나면 커서를 빈 캔버스나 인스펙터로 치우고
  400ms 쉰다.
- 온보딩/시드 데이터는 `page.addInitScript()` 로 네비게이션 전에 주입한다
  (`sessionStorage['knode.onboarding.v1'] = '1'` 로 온보딩 스킵,
  `localStorage['knode.workspace.v1']` 에 캔버스 JSON을 직접 써서 빈 캔버스로 시작 가능,
  `localStorage['knode.templates.custom.v1']` 에 **내장 템플릿과 같은 id** 를 넣으면 갤러리의
  그 자리를 대신한다 — `templates/custom.ts` `effectiveTemplates()`).
- **로고/브랜드가 바뀌면 다시 찍어야 하는 이유**: 헤더의 워드마크가 좌상단에 고정돼
  프레임 내내 노출된다. **Export 코드 다이얼로그 안의 문구도 제품명을 그대로 쓴다**
  (푸터 "Knode 없이 `python canvas.py` 로 그대로 돌아갑니다").

---

## 1. `feature-assemble.mp4` — "캔버스에서 크루 조립" 블록

**위치**: `frontend/src/panels/Welcome.tsx` features 그리드, 블록 1 (`.feature-card-media` 첫 번째).
**보여주는 것**: 완전히 빈 캔버스(`Demo`)에서 노드 라이브러리로 6개 노드(Input → LLM → Agent →
Task → Crew → Output)를 하나씩 검색·추가·배치하고, 소켓 5개를 실제로 드래그 연결해서
파이프라인을 조립하는 전 과정. 마지막에 fit-view 로 전체 그래프를 한 화면에 담는 샷으로 끝난다.
1× 로 25초가 나와 `setpts=PTS/1.2` 로 20.9초에 맞췄다.

**연출 결정**:
- **인스펙터를 접고 찍는다** (`인스펙터 접기` 버튼). 빈 노드는 필수 필드 미입력 오류가
  빨갛게 쌓이는데, 그 패널이 화면 1/5 을 차지한 채 계속 바뀌면 산만하다. 캔버스도
  884 → 1184px 로 넓어져 5열 배치가 들어간다.
- **시드 뷰포트는 zoom 0.8** — 노드 폭 184px 로 5열 + 2행이 1184px 안에 들어간다.
- 배치는 다이아몬드: 1행 y=110 에 Input(A)·Task(C), 2행 y=330 에 LLM(A)·Agent(B)·Crew(D)·Output(E).
  Agent→Task↗, Task→Crew↘, Agent→Crew→ 직선, Crew→Output→ 직선이라 엣지가 노드를 안 가로지른다.

**핵심 함정** (재촬영 시 꼭 지킬 것):
1. 노드를 라이브러리에서 추가(`onClick`)하면 **항상 같은 고정 화면 좌표**에 스폰된다
   (`NodeLibrary.tsx` 의 `dropPosition()` 은 캔버스 원점에서 화면 기준 (420,200) — 줌·팬과
   무관하게 **화면 x 676..860, y 250..282 에 헤더**가 생긴다). 이미 놓인 노드가 이 사각형을
   덮으면 드래그가 그 노드를 잡는다. 위 배치는 1행이 y≤230 에서 끝나고 2행이 y≥314 에서
   시작해 스폰 사각형을 비워 둔 것이다 — 좌표를 바꾸면 이 조건부터 다시 확인.
2. 스폰 직후 위치 전환 애니메이션 중이라 `boundingBox()` 를 바로 읽으면 중간값이 나온다.
   `stableBox()` 로 두 번 연속 같은 값이 나올 때까지 폴링한 뒤 드래그한다.
3. `glide()` 는 mousedown 뒤 **6px 만 먼저 움직인 다음** 목표로 간다 — 그래야 React Flow 가
   드래그/연결 시작을 확실히 잡는다.
4. 배치 오차 검증은 핸들 **중심**(`x + width/2`)과 비교한다. 2026-09-14 실측 6개 전부 2px.
5. 선택 해제 클릭은 `(700, 790)` — **미니맵(우하단 1241..1409 × 634..746) 을 클릭하면
   뷰포트가 팬** 되어 이후 좌표가 다 틀어진다.

**참고**: Input 노드의 `text` 출력 포트는 이 앱에서 다른 어떤 노드에도 엣지로 연결되지
않는다(`CONNECTION_MATRIX` 상 `text` 타입을 받는 입력이 없음 — Input 은 `{var_name}` 문자열
치환으로만 쓰인다). 그래서 Input 은 배치만 하고 엣지는 LLM→Agent, Agent→Task, Agent→Crew,
Task→Crew, Crew→Output 5개만 긋는다.

---

## 2. `feature-export.mp4` — "언제든 코드로 탈출" 블록

**위치**: `frontend/src/panels/Welcome.tsx` features 그리드, 블록 2.
**보여주는 것**: 템플릿 갤러리에서 **내장 템플릿 중 노드 수가 가장 많은(13개) "시장
조사 리포트"(`market_research`)** 를 불러온 뒤(fit-view 로 한 번 보여줌), 헤더의 `Export Code` 를
눌러 백엔드가 그 자리에서 생성한 진짜 CrewAI 파이썬 코드(`canvas.py`)를 ease-in-out 으로
끝까지 스크롤한 뒤 부드럽게 되감는다.

**왜 이 템플릿인가**: `frontend/src/templates/builtin.ts` 기준 노드 수 —
`market_research` 13개 > `blog` 12개 > `youtube` 11개 > `hello`/`local` 6개. 코드도 가장 길어서
"복잡한 크루도 결국 평범한 파이썬"이라는 메시지가 가장 잘 산다.

**Export Code 는 백엔드가 렌더링한다** (`POST /api/v1/export/python`, Jinja2) — 프론트
목업이 아니라 실제 응답. 그래서 녹화 프론트가 격리 백엔드(8001)를 CORS 허용 상태로
바라보고 있어야 로딩 스피너에서 안 멈춘다.

**함정**: 템플릿을 불러오면 **"…을(를) 불러왔습니다. 실행하려면 OPENAI_API_KEY… 필요합니다"
토스트가 화면 하단에 몇 초간 남아 Export 다이얼로그 위에 겹친다** (이전 버전에 그대로
찍혀 있었다). Export 를 열기 전에 `알림 닫기` 버튼을 눌러 지운다.

---

## 3. `demo.mp4` — Welcome "Quick Demo" 라이브 플레이어 + README GIF 원본

**위치**: `frontend/src/panels/Welcome.tsx` 의 `#watch` 섹션 (`.player .stage` 안 `<video>`),
그리고 `docs/media/demo.mp4` → `docs/media/demo.gif` 로 변환해 GitHub README 에도 쓰인다
(GitHub는 `<video>` 태그를 못 그려서 GIF가 필요).

**보여주는 것** (실제 실행 + SSE 스트리밍 — 앱에서 가장 화려한 기능이라 히어로 영상으로 씀):

1. **(0~4s)** Templates 클릭 → 갤러리. 2번째 카드가 **"Blog & SEO Crew"** (아래 시드로 덮어쓴
   것 — `API 키 불필요` 배지가 붙는다).
2. **(~4~8s)** 그 카드의 `Use this` → 10노드 로드. **노드 라이브러리를 접고**(`패널 접기`)
   fit-view — 캔버스가 1044 → 1300px 이 되어 줌 56% → 69%, 노드 글자가 읽힌다.
3. **(~8~15s)** LLM 노드 클릭 → 인스펙터에 **Ollama (로컬 · 무료) / llama3:latest / 키 불필요**.
   Task "Write Blog Post" 클릭 → 작업 설명·기대 산출물. 클릭 뒤 커서는 인스펙터 안(x=1450)으로
   옮긴다 (hover 카드가 이웃 노드를 덮지 않게).
4. **(~16s)** `Queue Prompt` → **"실행 파라미터" 모달** → `실행`. 로그 패널이 열리며 캔버스가
   줄어들므로 **fit-view 를 한 번 더** 누른다.
5. **(~18~55s) 실행 스트리밍 — 핵심 장면**: 헤더 `1/3 tasks · 00:14 · ~$0.000` + 빨간 `Stop`,
   실행 중 엣지 애니메이션, 하단 Execution Log 에 실시간 로그(실제 llama3 가 생성한 텍스트).
6. **(~55~65s) 완료**: `실행이 완료되었습니다.` → Output 노드 클릭 → 인스펙터 실행 결과 +
   노드 인라인 미리보기에 완성된 마크다운 글.

**재현 시 필요한 조건**:
- Ollama 가 실제로 로컬에서 돌고 있어야 한다 (`llama3` 설치 상태). 이 장면은 **키 없이
  무료로 진짜 실행되는 모습**이 메시지의 핵심이라 mock 이나 정지화면으로 대체하면 안 된다.
  2026-09-14 실측 실행 시간 38~43초.
- 완료 폴링은 **한국어 문구** `실행이 완료되었습니다.` / 실패 `실행 중 오류가 발생했습니다.`
  (`log.runSucceeded` / `log.runFailed`). UI 는 커밋 `2118d76` 이후 한국어 고정이다.
- 캔버스 헤더 문서 이름이 `Blog & SEO Crew` 로 떠야 한다 — Welcome 의 player-bar 가
  `localhost:3000 — blog_seo_crew.acanvas.json` 을 하드코딩해서 보여준다.

**시드 그래프 — 갤러리의 내장 blog 를 그대로 쓰면 안 되는 이유**: 내장 템플릿은 LLM 이
`openai / gpt-4o-mini` 이고 툴 노드 2개(`serper_search`, `scrape_website`) 때문에
`requires_keys = ["OPENAI_API_KEY", "SERPER_API_KEY"]` 라 키 없이는 못 돈다. `make-demo-seed.mjs`
가 격리 프론트에서 내장 템플릿을 실제로 불러온 뒤(한국어 로컬라이즈된 doc 을 얻기 위해)
툴 노드 2개와 그 엣지를 빼고 `llm_2.data` 를 `{ name: 'Local Llama', provider: 'ollama',
model: 'llama3:latest' }` 로, `meta.requires_keys` 를 `[]` 로 바꿔 10노드/15엣지 JSON 을 만든다.
`record-demo.mjs` 는 이걸 `knode.templates.custom.v1` 에 **`id: 'blog'`** 로 넣는다 —
`effectiveTemplates()` 가 같은 id 의 커스텀 저장본을 내장 자리에서 대신 보여주므로 갤러리
순서가 그대로고, `Use this` 가 Ollama 버전을 불러온다. 갤러리 장면을 살리면서도 키 없이
도는 방법이 이것이다.

**⚠️ Queue Prompt 는 바로 실행되지 않는다**: Input 노드 값을 받는 **"실행 파라미터"**
모달이 먼저 뜬다(`블로그 주제 / 니치` + `취소`/`실행`). 기본값이 채워져 있으므로 `실행`
만 누른다. 모달을 **Escape 로 닫으면 실행이 취소된다**.

**GIF 파생** (README 용 — 8fps / 680폭, 2026-09-14 기준 2.4MB):
```bash
ffmpeg -y -i frontend/public/demo.mp4 \
  -vf "fps=8,scale=680:-1:flags=lanczos,palettegen=stats_mode=full" palette.png
ffmpeg -y -i frontend/public/demo.mp4 -i palette.png \
  -lavfi "fps=8,scale=680:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 frontend/public/demo.gif
cp frontend/public/demo.{mp4,gif} docs/media/
```
두 산출물 모두 `docs/media/` 와 `frontend/public/` 양쪽에 둔다 (README 는 `docs/media/demo.gif`,
Welcome 은 `frontend/public/demo.mp4`). `frontend/public/demo.gif` 는 아무도 참조하지 않지만
이전 브랜드가 박힌 파일이 남지 않도록 같이 갱신한다.

---

## 재촬영 체크리스트

0. `frontend/src/app/icon.svg` 를 건드렸다면 dev 서버가 200 을 주는지 먼저 확인
   (위 "공통 촬영 인프라"의 1000 바이트 함정).
1. 격리 프론트(3101)/백엔드(8001) 기동, `record/*.mjs` 를 `frontend/scripts/` 로 복사.
2. `record-assemble.mjs` → 로그에 `edges 5` 가 찍혔는지 확인 (4면 hover 카드 함정).
   변환 때 `setpts=PTS/1.2`.
3. `record-export.mjs` — `templates/builtin.ts` 의 노드 수가 바뀌었으면 "가장 복잡한 템플릿"
   재계산부터.
4. `make-demo-seed.mjs` → `record-demo.mjs` (Ollama 필요, `run seconds` 로그 확인).
   완료 후 `demo.gif` 도 갱신.
5. **출력은 전부 16:9** — assemble/export 1920×1080, demo 2560×1440.
6. mp4 3개를 `frontend/public/`, `demo.mp4`/`demo.gif` 는 `docs/media/` 에도 반영.
7. `frontend/scripts/` 의 복사본 삭제, `frontend/next-env.d.ts` / `tsconfig.json` 원복,
   격리 서버 종료, `.next-record` 와 `$OUT_DIR` 삭제.
8. 격리 프론트(3101)의 Welcome 화면을 스크린샷으로 최종 확인 — 기능 카드 2장이 카드 폭을
   꽉 채우고, 플레이어의 헤더 `Queue Prompt` 가 잘리지 않아야 한다.
