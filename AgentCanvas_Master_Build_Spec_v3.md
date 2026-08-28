# 🎛️ AgentCanvas — Master Build Specification

**프로젝트명:** AgentCanvas
**문서 버전:** v3.0 (Build Edition — 구현 지시서)
**기반 문서:** Master PRD v2.0 (2026-08-27)
**작성일:** 2026-08-28
**대상 수신자:** Claude Code / Lead Software Engineer
**문서 성격:** PRD(무엇을 만들까)가 아니라 **빌드 스펙(어떻게 만들까)**. 이 문서 하나만 읽고 바로 구현 착수가 가능해야 한다.

---

## 📌 0. 이 문서를 읽는 법 (필독)

### 0.1. 문서 계층 구조와 우선순위

구현 중 지시가 충돌할 경우, **아래 순서의 위쪽이 무조건 이긴다.**

| 순위 | 소스 | 관할 영역 |
|---|---|---|
| **1** | **첨부 Artifact** (`https://claude.ai/code/artifact/3d917dda-d447-4f94-a3e6-e9353641930d`) | **비주얼 디자인 전권** — 색상, 타이포, 간격, 컴포넌트 형태, 레이아웃, 인터랙션 감각 |
| 2 | 본 문서 (Master Build Spec v3.0) | 시스템 구조, 데이터 모델, API, 실행 로직, 노드 스펙 |
| 3 | Master PRD v2.0 | 제품 방향성, 전략 (본 문서에 전량 흡수됨) |
| 4 | 구현자 재량 | 위 3개가 침묵하는 영역만 |

### 0.2. 이 문서의 구성

* **1~2장**: 제품 정의와 **디자인 구속 조항** (반드시 먼저 읽을 것)
* **3~7장**: 데이터 모델 — 노드 카탈로그, 포트 타입 시스템, Canvas JSON Schema
* **8~11장**: 백엔드 — 컴파일러, 실행 엔진, API, SSE 프로토콜
* **12~15장**: 인프라 — BYOK 보안, Ollama, 영속성, 템플릿
* **16~19장**: 코드베이스 구조, 품질, 테스트, 배포
* **20~22장**: 로드맵, 수용 기준, 부록(에러 코드/단축키/용어집)

### 0.3. 표기 규칙

* `MUST` / `필수` — 미구현 시 릴리즈 차단
* `SHOULD` / `권장` — v1.0 목표, 일정상 후순위 가능
* `MAY` / `선택` — 있으면 좋음
* 🆕 표시 — PRD v2.0에 없던 **본 문서에서 신규 추가된 시스템 구조**

---

## 🔒 1. DESIGN LOCK — 디자인 구속 조항 (최우선)

> ### ⚠️ 절대 규칙
>
> **AgentCanvas의 모든 화면은 첨부된 Artifact의 디자인을 100% 그대로 따른다.**
>
> `https://claude.ai/code/artifact/3d917dda-d447-4f94-a3e6-e9353641930d`
>
> 이 아티팩트는 **디자인의 단일 진실 공급원(Single Source of Truth)** 이다.
> 구현자는 디자인을 **새로 창작하지 않는다. 이식(port)한다.**

### 1.1. 무엇을 "그대로" 따르는가

아티팩트에 정의된 아래 항목 전부는 **1:1로 복제**되어야 한다. 재해석·개선·현대화 금지.

| 카테고리 | 복제 대상 |
|---|---|
| **컬러** | 배경, 서피스, 보더, 텍스트, 노드 헤더별 색상, 상태색(성공/실패/실행중), 그림자, 투명도 값 |
| **타이포그래피** | 폰트 패밀리, 크기 스케일, 굵기, 자간, 행간, 라벨/모노스페이스 사용 규칙 |
| **스페이싱** | 패딩, 마진, 갭, 노드 내부 여백, 컴포넌트 간 리듬 |
| **형태** | border-radius, 보더 두께, 소켓(핸들) 크기·모양, 엣지 곡률·굵기 |
| **레이아웃** | 헤더/사이드바/캔버스/로그패널의 배치, 폭, 높이, 리사이즈 동작 |
| **컴포넌트** | 버튼, 인풋, 셀렉트, 슬라이더, 토글, 배지, 툴팁, 모달, 컨텍스트 메뉴의 정확한 생김새 |
| **모션** | 트랜지션 duration/easing, hover 반응, glow/pulse 애니메이션 파라미터 |
| **아이콘** | 아이콘 세트(추정: `lucide-react`), 크기, 굵기, 노드 타입별 아이콘 매핑 |

### 1.2. 구현 착수 전 필수 절차 (Design Token 추출)

구현자는 **첫 줄의 코드를 작성하기 전에** 다음을 수행한다.

1. 아티팩트를 브라우저에서 연다.
2. 아티팩트의 **소스 코드 전문을 복사**해 리포지토리 `/design/reference/artifact-source.tsx` 에 원본 그대로 보관한다. (수정 금지, 읽기 전용 참조본)
3. 소스에서 아래를 추출해 `/design/tokens.ts` 와 `tailwind.config.ts` 로 옮긴다.
   * 모든 하드코딩 색상 HEX / `rgb()` / Tailwind 클래스
   * 모든 폰트/사이즈/굵기
   * 모든 radius / shadow / spacing 값
   * 모든 `transition` / `animation` 정의
4. `/design/DESIGN_AUDIT.md` 를 작성한다: **아티팩트 화면 요소 → 구현 컴포넌트 매핑표**. 모든 행은 "구현 완료 시 스크린샷 대조 확인"으로 체크된다.
5. 아티팩트에 **없는** 화면(예: 신규 노드 타입, 설정 모달)이 필요할 경우 → §1.4 확장 규칙을 따른다.

> **본 문서 §2의 색상/치수 값은 PRD v2.0에서 옮겨온 "참고용 초기값"일 뿐이다.**
> 아티팩트의 실제 값과 다르면 **아티팩트 값으로 덮어쓴다.** 예외 없음.

### 1.3. 금지 사항 (Hard No)

* ❌ 아티팩트에 없는 색을 임의로 추가하기
* ❌ "더 예쁘게" 를 이유로 radius, 그림자, 여백 변경하기
* ❌ 다른 UI 라이브러리(MUI, Chakra, Ant 등)의 기본 스타일을 노출시키기
* ❌ 라이트 모드를 임의로 기본값으로 두기 (Dark가 기본)
* ❌ 아티팩트의 컴포넌트를 "리팩터링"하며 시각적 결과를 바꾸기
* ❌ 임의의 그라디언트, 글래스모피즘, 네온 효과 추가

### 1.4. 아티팩트에 없는 화면을 만들어야 할 때 (확장 규칙)

기존 디자인 언어를 **그대로 재사용**해서 조합한다. 새 언어를 만들지 않는다.

1. 아티팩트에서 **가장 유사한 기존 컴포넌트**를 찾는다.
2. 그 컴포넌트의 토큰(색/여백/radius/폰트)만 재조합한다.
3. 새로 도입한 토큰이 하나라도 있으면 → `DESIGN_AUDIT.md` 의 **"확장 토큰" 섹션에 사유와 함께 기록**한다.
4. 확장 토큰은 5개를 넘지 않는다. 넘으면 설계가 틀린 것이다.

### 1.5. 검수 기준 (Definition of Done — Design)

* [ ] 아티팩트와 구현 화면을 나란히 놓고 **픽셀 대조**했을 때 구분이 어렵다.
* [ ] `grep` 으로 검색했을 때 컴포넌트 파일 안에 **하드코딩된 HEX 색상이 0개**다. (전부 토큰 참조)
* [ ] `DESIGN_AUDIT.md` 의 매핑표가 100% 체크되어 있다.
* [ ] 확장 토큰이 5개 이하이며 전부 사유가 기록되어 있다.

---

## 🎯 2. 제품 정의 (PRD v2.0 계승 + 확장)

### 2.1. 한 줄 정의

> ComfyUI 감성의 시각적 캔버스(React Flow)를 통해 **코딩 없이 드래그 앤 드롭으로 CrewAI 멀티 에이전트 팀을 빌딩·모니터링·실행**하는 오픈소스 무상 배포형 플랫폼.

### 2.2. 해결하는 문제

* CrewAI·LangGraph 등 멀티 에이전트 프레임워크는 Python 코드 작성과 터미널 제어가 필수라 **비개발자(마케터, 기획자)의 진입 장벽이 높다.**
* 에이전트 간 작업 흐름과 **현재 실행 상태를 한눈에 파악하기 어렵다.** (터미널 로그 스크롤 지옥)
* 🆕 프롬프트/역할 정의를 수정할 때마다 코드를 고치고 재실행해야 해 **반복 실험 사이클이 느리다.**
* 🆕 팀 구성을 **공유·재사용할 표준 포맷이 없다.** (남의 Crew를 가져다 쓰기 어려움)

### 2.3. 해결책

* **ComfyUI 스타일 Node-Wire 인터페이스** — 직관적이고 손맛 있는 레고 블록 조립 경험.
* 시각적 노드 그래프를 백엔드에서 **동적 컴파일**하여 CrewAI 오케스트레이션 수행.
* 🆕 **`.acanvas.json` 단일 파일 포맷** — 팀 전체를 파일 하나로 저장/공유/임포트.
* 🆕 **실시간 SSE 스트리밍** — 어느 에이전트가 지금 무슨 생각을 하고 어떤 툴을 쓰는지 캔버스 위에서 시각화.

### 2.4. 타깃 사용자 (Persona)

| 페르소나 | 설명 | 핵심 니즈 |
|---|---|---|
| **P1. 노코드 기획자 "지민"** | 마케터/PM. Python 모름. ChatGPT는 매일 씀. | 템플릿을 열어 프롬프트만 고쳐 바로 돌리기 |
| **P2. AI 엔지니어 "현우"** | CrewAI를 코드로 써봄. 실험 속도가 답답함. | 구조를 시각적으로 빠르게 프로토타이핑 → 코드로 Export |
| **P3. 오픈소스 탐험가 "Alex"** | GitHub 트렌딩 보고 옴. 로컬에서 무료로 돌리고 싶음. | `docker compose up` 한 번 + Ollama 로컬 구동 |

### 2.5. 무상 배포 및 오픈소스 운영 전략

* **BYOK (Bring Your Own Key):** 중앙 서버 API 비용 0원. 유저 본인의 API Key(OpenAI, Groq, Gemini, Anthropic, Serper) 사용.
* **Local First (Ollama):** 완전 오프라인/무료 환경을 위한 로컬 Ollama LLM **자동 감지 및 연동**.
* **Zero Cost DB / Privacy:** 중앙 DB 필수 의존성 없음. 브라우저 `LocalStorage` + `.json` Import/Export 기반.
* **Open Source & License:** GitHub 공개를 통한 스타(Star) 확보 및 **템플릿 바이럴 루프** 형성.
  * 🆕 **라이선스 권고: `AGPL-3.0`.** 이유: (a) SaaS 형태의 무단 상용 포크를 억제하면서 (b) 개인/기업 내부 사용은 완전 자유. ComfyUI(GPL-3.0)와 동일한 커뮤니티 정서. 상업적 임베딩 수요가 확인되면 듀얼 라이선스(AGPL + Commercial)로 전환 여지를 남긴다.
  * 🆕 대안: 채택률 극대화가 최우선이면 `MIT`. **단, 결정은 첫 커밋 전에 확정할 것** (사후 변경은 기여자 전원 동의 필요).

### 2.6. 🆕 비목표 (Non-Goals) — v1.0에서 하지 않는 것

명확히 선을 그어야 스코프가 터지지 않는다.

* ❌ 멀티유저 실시간 협업 편집 (CRDT) — v2.0 이후
* ❌ 서버 계정/로그인/과금 시스템 — BYOK 철학과 충돌
* ❌ CrewAI 외 프레임워크(LangGraph, AutoGen) 동시 지원 — 어댑터 인터페이스만 남겨두고 v1.0은 CrewAI 전용
* ❌ 클라우드 상시 실행 / 스케줄러(cron) — v2.0
* ❌ 모바일 편집 UI — 뷰어(읽기 전용)까지만
* ❌ 자체 LLM 프록시/키 대행 — 절대 하지 않음 (비용 폭탄)

### 2.7. 🆕 성공 지표 (Success Metrics)

| 지표 | v1.0 목표 |
|---|---|
| 최초 실행까지 걸리는 시간 (TTFR) | 템플릿 로드 → 실행 성공까지 **3분 이내** |
| GitHub Star | 릴리즈 후 3개월 내 1,000+ |
| 템플릿 Import 성공률 | 99% (버전 마이그레이션 포함) |
| 실행 중 UI 프레임레이트 | 노드 50개 기준 **60fps 유지** |
| 백엔드 없이 편집 가능 여부 | 100% (편집은 순수 프론트엔드) |

---

## 🎨 3. UI/UX 명세 (ComfyUI Aesthetic)

> ⚠️ **본 장의 모든 수치는 §1.2에 따라 아티팩트 실제 값으로 대체된다.** 아래는 PRD 계승 초기값이자, 아티팩트에서 값을 못 찾았을 때의 폴백이다.

### 3.1. 비주얼 테마 (PRD 계승)

* **Base Theme:** Dark Mode Default (`bg-slate-900` / `#0f172a`)
* **Background:** 점선 그리드 패턴 (Dot Grid)
* **Bezier Curves:** 노드 간 연결선은 매끄러운 곡선(Curved Edge) 유지
* **Color System (노드 헤더):**

| 노드 | 이모지 | 색상 | Tailwind |
|---|---|---|---|
| **LLM Node** | 🧠 | `#e11d48` | `rose-600` |
| **Agent Node** | 🤖 | `#4f46e5` | `indigo-600` |
| **Task Node** | 📋 | `#059669` | `emerald-600` |
| **Tool Node** | 🛠️ | `#d97706` | `amber-600` |

### 3.2. 🆕 확장 컬러 시스템 (신규 노드 대응)

신규 노드 타입은 기존 팔레트와 **동일한 채도/명도 레벨**의 색상만 사용한다.

| 노드 | 이모지 | 색상 | Tailwind | 역할 |
|---|---|---|---|---|
| **Crew Node** | 🏛️ | `#7c3aed` | `violet-600` | 오케스트레이터(루트) |
| **Input Node** | 📥 | `#0891b2` | `cyan-600` | 런타임 변수 주입 |
| **Output Node** | 📤 | `#0d9488` | `teal-600` | 최종 결과 수집 |
| **Knowledge Node** | 📚 | `#c2410c` | `orange-700` | RAG 지식원 |
| **Memory Node** | 🧩 | `#4338ca` | `indigo-700` | 메모리 설정 |
| **Router Node** | 🔀 | `#a16207` | `yellow-700` | 조건 분기 |
| **Human Node** | 🙋 | `#be123c` | `rose-700` | Human-in-the-loop |
| **Note / Group** | 📝 | `#475569` | `slate-600` | 주석·그룹핑 (실행 무관) |

### 3.3. 🆕 상태 컬러 (실행 시각화)

| 상태 | 색상 | 시각 효과 |
|---|---|---|
| `idle` | 기본 보더 | 없음 |
| `queued` | `slate-400` | 보더 점선 |
| `running` | `indigo-500` | `ring-2 ring-indigo-500 animate-pulse` + 엣지 파티클 |
| `succeeded` | `emerald-500` | `ring-1 ring-emerald-500`, 체크 배지 (2초 후 페이드) |
| `failed` | `red-500` | `ring-2 ring-red-500`, 에러 배지 상시 표시 |
| `skipped` | `slate-600` | opacity 50% |
| `cancelled` | `amber-500` | opacity 70%, 사선 패턴 |

### 3.4. 핵심 UX 디테일 (PRD 계승 + 상세화)

#### 3.4.1. ComfyUI 우클릭 Context Menu `MUST`
빈 캔버스 우클릭 시 **커서 위치**에 노드 추가 메뉴 팝업.
* 카테고리 계층: `Agents` / `Tasks` / `Models` / `Tools` / `Data` / `Flow` / `Utils`
* 상단에 **검색 인풋** 자동 포커스 → 타이핑으로 즉시 필터 (퍼지 매칭)
* `Enter` 로 첫 결과 추가, `Esc` 로 닫기
* 노드 위에서 우클릭 시에는 **노드 메뉴**: `Rename` / `Duplicate` (Ctrl+D) / `Copy` / `Pin` / `Collapse` / `Bypass` / `Delete`
* 엣지 위에서 우클릭: `Delete Edge` / `Insert Node Here` / `Reroute`

#### 3.4.2. Interactive Node Highlighting (Glow) `MUST`
백엔드 SSE `node.status` 이벤트 수신 시 해당 노드 테두리에 `ring-2 ring-indigo-500 animate-pulse` 적용. 상태별 링 색상은 §3.3 표를 따른다.

#### 3.4.3. Wire Particle Animation `MUST`
`Queue Prompt` 실행 시 연결선 위로 데이터 입자가 흐르는 애니메이션.
* 구현: SVG `<circle>` + `animateMotion` 또는 CSS `stroke-dashoffset` 애니메이션
* **활성 엣지만** 애니메이션 (현재 실행 중인 노드의 in/out 엣지)
* 🆕 **성능 가드:** 화면 내 애니메이션 엣지가 30개를 넘으면 파티클을 끄고 `stroke` 밝기 변화로 대체한다. (프레임레이트 사수)
* 🆕 `prefers-reduced-motion: reduce` 시 전체 비활성화

#### 3.4.4. Smart Auto-Connect `MUST`
소켓 드래그 후 빈 공간에 drop 시 **연관 노드 자동 추천 팝업**.
* 추천 로직: 드래그 시작 소켓의 **포트 타입(§5)** 과 호환되는 노드만 필터링해 표시
* 예: `Agent.llm` 인풋에서 드래그 → `LLM Node` 만 추천
* 선택 시 드롭 위치에 노드 생성 + 자동 연결

#### 3.4.5. Node Hover Preview `MUST`
마우스 호버 시 해당 노드의 **역할(Role)** 및 **직전 Output** 미니 팝업 출력.
* 지연: 400ms
* 내용: 노드 타입 / 이름 / 핵심 설정 요약 / 마지막 실행 출력 200자 프리뷰 / 실행 소요시간·토큰
* 팝업 내 `Expand` 클릭 → 우측 로그 패널에 전체 출력 표시

### 3.5. 🆕 추가 UX 디테일

| # | 기능 | 우선순위 | 설명 |
|---|---|---|---|
| 6 | **Node Collapse** | `MUST` | 노드 헤더 좌측 삼각형 클릭 → 본문 접힘, 소켓만 남음. 대형 그래프 정리용 |
| 7 | **Bypass (Mute)** | `SHOULD` | `Ctrl+B`. 노드를 회색·반투명 처리하고 컴파일에서 제외. 입출력은 통과(pass-through) |
| 8 | **Pin (Freeze)** | `MAY` | 노드 위치 고정. 실수로 끌려나가는 것 방지 |
| 9 | **Minimap** | `MUST` | 우하단. 노드 타입별 색상 점으로 표시. 실행 중 노드는 깜빡임 |
| 10 | **Group Frame** | `SHOULD` | 노드 다중 선택 → `Ctrl+G` → 배경 프레임 생성. 프레임 이동 시 내부 노드 동반 이동 |
| 11 | **Undo / Redo** | `MUST` | `Ctrl+Z` / `Ctrl+Shift+Z`. 최소 50단계. 커맨드 패턴으로 구현 |
| 12 | **Auto Layout** | `SHOULD` | `Ctrl+L`. Dagre 기반 위상 정렬 배치. 애니메이션 트랜지션으로 이동 |
| 13 | **Validation Overlay** | `MUST` | 실행 전 검증 실패 노드에 빨간 뱃지 + 마우스오버 시 사유. 실행 버튼은 disabled |
| 14 | **Run Progress Bar** | `MUST` | 헤더에 `3/7 tasks · 00:42 · ~$0.014` 형태로 진행률·경과시간·추정비용 표시 |
| 15 | **Log Panel (Drawer)** | `MUST` | 우측 슬라이드 패널. 탭: `Stream` / `Tasks` / `Raw JSON`. 자동 스크롤 토글 |
| 16 | **Command Palette** | `SHOULD` | `Ctrl+K`. 노드 추가·템플릿 열기·설정·실행 전부 키보드로 |
| 17 | **Toast System** | `MUST` | 우하단. 저장/에러/실행완료 알림. 에러는 수동 닫기 전까지 유지 |
| 18 | **Empty State** | `SHOULD` | 빈 캔버스에 "템플릿으로 시작하기 / 우클릭해서 노드 추가" 안내 |
| 19 | **Onboarding Tour** | `MAY` | 최초 방문 시 4스텝 코치마크 (LocalStorage 플래그로 1회만) |
| 20 | **Cost Estimator** | `SHOULD` | 실행 후 실제 토큰 사용량 기반 비용 계산 → 노드별 뱃지 |

### 3.6. 🆕 레이아웃 구조

```text
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER (h-14)                                                        │
│  [Logo] [FileName ▾]     [▶ Queue Prompt] [■ Stop] [3/7 · 00:42]     │
│                                     [Templates] [Settings] [GitHub]  │
├────────────┬────────────────────────────────────────┬────────────────┤
│            │                                        │                │
│  LEFT      │            CANVAS (React Flow)         │   RIGHT        │
│  SIDEBAR   │                                        │   PANEL        │
│  (w-64)    │        · Dot Grid Background           │   (w-96)       │
│            │        · Nodes + Bezier Edges          │                │
│  Node      │        · Selection Box                 │  Tab: Stream   │
│  Library   │                                        │  Tab: Inspector│
│  (검색+    │                                        │  Tab: Raw JSON │
│   카테고리)│                          ┌───────────┐ │                │
│            │                          │  MiniMap  │ │  (collapsible) │
│  [접기 ◀]  │                          └───────────┘ │  [접기 ▶]      │
├────────────┴────────────────────────────────────────┴────────────────┤
│ STATUS BAR (h-8)  ● Backend Connected · Ollama: 3 models · Zoom 85%  │
└──────────────────────────────────────────────────────────────────────┘
```

* 좌우 패널은 **접기 가능**하며 상태는 LocalStorage에 저장.
* 캔버스는 항상 남은 공간 전체를 차지 (`flex-1`).
* 반응형: `< 1024px` 에서는 사이드바가 오버레이 드로어로 전환.

---

## 🏗️ 4. 시스템 아키텍처 & 기술 스택

### 4.1. PRD 계승 아키텍처 (원본)

```text
[ Frontend: Next.js (App Router) + React Flow v12 ]
        │
        │ 1. POST /api/run-crew (JSON Payload)
        │ 2. SSE (Server-Sent Events) <- 실시간 실행 상태/로그 스트리밍
        ▼
[ Backend: FastAPI (Python 3.11+) ]
        │
        ├─▶ [ Canvas Topology Parser ] -> JSON을 CrewAI Agent/Task/Tool 객체로 변환
        └─▶ [ CrewAI Execution Core ] ──▶ [ OpenAI / Groq / Ollama / Serper ]
```

### 4.2. 🆕 확장 아키텍처 (구현 상세)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                                │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Next.js 15 (App Router) — 전부 Client Component 캔버스            │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐    │  │
│  │  │ React Flow  │  │ Zustand      │  │ Node Registry          │    │  │
│  │  │ v12 Canvas  │◀▶│ Store        │◀▶│ (노드 정의 = 단일 진실) │    │  │
│  │  └─────────────┘  └──────────────┘  └────────────────────────┘    │  │
│  │         │                │                                        │  │
│  │         │         ┌──────▼────────┐   ┌──────────────────┐        │  │
│  │         │         │ Persistence   │   │ Validator        │        │  │
│  │         │         │ LocalStorage  │   │ (실행 전 검증)   │        │  │
│  │         │         │ + File I/O    │   └──────────────────┘        │  │
│  │         │         └───────────────┘                               │  │
│  │         │                                                         │  │
│  │  ┌──────▼──────────────────────────────────────────────────────┐  │  │
│  │  │ Execution Client                                            │  │  │
│  │  │  · POST /api/v1/runs          (그래프 + BYOK 키 헤더)       │  │  │
│  │  │  · GET  /api/v1/runs/{id}/events  (SSE 구독)                │  │  │
│  │  │  · POST /api/v1/runs/{id}/cancel                            │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  🔐 API Keys: LocalStorage(선택) 또는 세션 메모리. 서버 영속 저장 없음.  │
└─────────────────────────────────────────────────────────────────────────┘
             │  HTTPS / JSON                     ▲  text/event-stream
             ▼                                   │
┌─────────────────────────────────────────────────────────────────────────┐
│  BACKEND — FastAPI (Python 3.11+), Stateless-ish                        │
│                                                                         │
│  ┌────────────────┐   ┌─────────────────┐   ┌───────────────────────┐   │
│  │ API Layer      │──▶│ Graph Validator │──▶│ Canvas Compiler       │   │
│  │ (routers)      │   │ (스키마+의미)   │   │ (JSON → CrewAI 객체)  │   │
│  └────────────────┘   └─────────────────┘   └──────────┬────────────┘   │
│                                                        │                │
│  ┌─────────────────────────────────────────────────────▼────────────┐   │
│  │ Run Manager  (run_id ↔ asyncio.Queue ↔ Worker Thread)            │   │
│  │  · 동시 실행 제한 (semaphore)                                    │   │
│  │  · 타임아웃 / 취소 토큰                                          │   │
│  │  · 이벤트 버퍼(최근 N개) — 재연결 시 replay                      │   │
│  └─────────────────────────────────────────────────────┬────────────┘   │
│                                                        │                │
│  ┌─────────────────────────────────────────────────────▼────────────┐   │
│  │ CrewAI Execution Core                                            │   │
│  │  Crew(agents, tasks, process, manager_llm, memory)               │   │
│  │  · step_callback  → agent.thought / agent.tool_use 이벤트        │   │
│  │  · task_callback  → task.completed 이벤트                        │   │
│  │  · LiteLLM callback → token.usage 이벤트                         │   │
│  └───────┬──────────────────────────────────────────────────────────┘   │
│          │                                                              │
│  ┌───────▼─────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ LLM Adapters    │  │ Tool Registry│  │ Ollama Discovery           │  │
│  │ OpenAI/Groq/    │  │ Serper/Scrape│  │ GET localhost:11434/api/tags│ │
│  │ Gemini/Anthropic│  │ /File/Code   │  └────────────────────────────┘  │
│  │ /Ollama         │  └──────────────┘                                  │
│  └─────────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.3. 기술 스택 확정

#### Frontend
| 항목 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | **Next.js 15 (App Router)** | 캔버스는 `'use client'`. SSR 불필요 |
| 캔버스 | **@xyflow/react v12** (React Flow) | v12 패키지명 주의 (`reactflow` 아님) |
| 상태관리 | **Zustand** (+ `immer`, `temporal`(zundo)) | Undo/Redo는 zundo |
| 스타일 | **Tailwind CSS** | 토큰은 §1.2에서 아티팩트 추출 |
| 아이콘 | **lucide-react** | 아티팩트 사용 세트에 맞춤 |
| 폼/검증 | **zod** | 프론트/백엔드 스키마 공유(수동 미러링) |
| SSE | **네이티브 `EventSource`** 또는 `fetch` + `ReadableStream` | POST+SSE가 필요하면 후자 `MUST` |
| 자동배치 | **dagre** | Auto Layout |
| 마크다운 | **react-markdown** + `rehype-highlight` | 에이전트 출력 렌더링 |
| 테스트 | **Vitest** + **Playwright** | |

> ⚠️ **SSE 구현 주의:** 키를 헤더로 보내야 하므로 `EventSource`(GET, 커스텀 헤더 불가)를 쓸 수 없다.
> **`fetch` + `ReadableStream` 기반 SSE 파서를 직접 구현**하거나 `@microsoft/fetch-event-source` 를 사용한다. `MUST`

#### Backend
| 항목 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | **FastAPI** (Python 3.11+) | |
| 서버 | **uvicorn** | `--workers 1` (인메모리 런 상태 공유 때문) |
| 오케스트레이션 | **crewai** + **crewai-tools** | 버전 핀 고정 `MUST` |
| LLM 게이트웨이 | **litellm** (CrewAI 내장) | 모델 문자열로 프로바이더 스위칭 |
| 검증 | **pydantic v2** | |
| 비동기 브릿지 | `asyncio.Queue` + `anyio.to_thread` | crew.kickoff()는 블로킹 |
| 로깅 | **structlog** (JSON 라인) | 키 마스킹 프로세서 필수 |
| 테스트 | **pytest** + `pytest-asyncio` + `respx` | |

#### 버전 핀 정책 `MUST`

> ⚠️ **2026-08-28 기준 확인 사항:** CrewAI는 **PyPI 기준 최신 안정 버전 `1.15.18`** (2026-08-27 릴리즈)이며, 3월 이후로만 봐도 1.10 → 1.15까지 수십 차례 릴리즈될 만큼 API 변화가 빠르다. 최근 changelog에는 memory/knowledge/rag/flow의 pluggable 백엔드 추가, `flow.py`를 DSL/definition/runtime으로 분리, conversational routing 개편 등이 포함되어 있다. **CLI 스캐폴드(`crewai create crew`)는 최신 버전에서 JSON 우선 구조(`agents/*.jsonc`, `crew.jsonc`)가 기본이 되었고 예전 `crew.py` + `config/*.yaml` 방식은 `--classic` 플래그가 필요하다.** 단, 본 프로젝트는 CLI 스캐폴드를 쓰지 않고 FastAPI 안에서 `Agent`/`Task`/`Crew`/`LLM` 객체를 **직접 인스턴스화**하므로 이 변화의 직접 영향은 받지 않지만, 그 객체들의 생성자 시그니처와 콜백 페이로드 구조는 계속 바뀌어왔으므로 §8.2·§10.4·§10.5 구현 전 반드시 아래 검증 절차를 거친다.

**구현 착수 전 필수 검증 절차** `MUST`
1. `pip index versions crewai` (또는 PyPI 프로젝트 페이지)로 **그 시점의 실제 최신 안정 버전**을 확인한다. 본 문서의 `1.15.18`은 2026-08-28 기준 스냅샷일 뿐이며, 착수 시점에 다시 확인해 갱신한다.
2. 해당 버전을 가상환경에 설치한다: `pip install crewai==<확인된 버전> crewai-tools==<대응 버전>`
3. Claude Code가 `site-packages/crewai/` 소스를 **직접 읽는다** (`grep`/`view`). 아래를 반드시 확인:
   * `Agent.__init__`, `Task.__init__`, `Crew.__init__`, `LLM.__init__` 의 정확한 파라미터명·기본값
   * `step_callback` / `task_callback` 에 실제로 전달되는 객체의 타입과 필드 (클래스명, 속성)
   * `Process` enum의 정확한 멤버명
   * `crewai.flow` 모듈 구조 (Router/Guardrail 노드 §5.10을 v1.1에서 구현할 때 필요)
4. `github.com/crewAIInc/crewAI-examples` 저장소를 `/reference/crewai-examples`(`.gitignore` 처리, 배포 제외)에 클론해 Trip Planner / Stock Analysis / Human-input-on-execution 예제를 콜백·컨텍스트 연결 패턴의 레퍼런스로 참고한다. **이 저장소 자체는 vendoring하지 않고 읽기 전용 참고용으로만 둔다.**
5. 위 1~4에서 확인한 실제 시그니처를 `backend/app/core/crewai_compat.py` 작성 근거로 삼는다. 본 문서 §8.2의 코드 골격은 **개념적 구조**이며, 실제 파라미터명은 설치된 버전의 소스가 최종 진실이다.

**지속 운영 정책**
* `requirements.txt` 는 `==` 로 **정확한 버전 고정** (예: `crewai==1.15.18`)
* `constraints.txt` 병행
* CI에 **주간 의존성 업데이트 잡** + 통합 테스트로 회귀 감지 (버전이 이 정도 속도로 바뀌므로 필수)
* `backend/app/core/crewai_compat.py` 에 **호환 레이어**를 두어 CrewAI API 변경을 한 파일에서 흡수한다. 버전 업그레이드 시 이 파일과 §18의 컴파일러 골든 픽스처 테스트만 재검증하면 되도록 격리한다.

---

## 🧩 5. 노드 카탈로그 (Node Catalog)

### 5.1. 노드 설계 원칙

1. **노드 정의는 코드 한 곳(Registry)에서만 선언한다.** UI 렌더링·검증·컴파일이 전부 이 정의를 참조한다.
2. 노드는 **자기 상태만** 안다. 그래프 전체 지식은 컴파일러가 갖는다.
3. 모든 노드는 `id`, `type`, `position`, `data` 를 갖는다. (React Flow 규약)
4. 노드 정의 스키마(프론트):

```ts
// frontend/src/nodes/registry.ts
export interface NodeDefinition {
  type: NodeType;              // 'agent' | 'task' | ...
  label: string;               // "Agent"
  category: NodeCategory;      // 'Agents' | 'Tasks' | 'Models' | 'Tools' | 'Data' | 'Flow' | 'Utils'
  icon: LucideIcon;
  accent: string;              // 디자인 토큰 키 (아티팩트에서 추출)
  description: string;         // 컨텍스트 메뉴/툴팁용
  inputs: PortSpec[];
  outputs: PortSpec[];
  fields: FieldSpec[];         // 노드 본문에 렌더링될 폼 필드
  defaults: Record<string, unknown>;
  validate?: (data, graph) => ValidationIssue[];
  compilable: boolean;         // false면 백엔드 페이로드에서 제외 (Note/Group)
}
```

### 5.2. 노드 목록 요약

| # | 노드 | 타입 키 | 카테고리 | 우선순위 | 신규 |
|---|---|---|---|---|---|
| 1 | 🧠 LLM | `llm` | Models | `MUST` | |
| 2 | 🤖 Agent | `agent` | Agents | `MUST` | |
| 3 | 📋 Task | `task` | Tasks | `MUST` | |
| 4 | 🛠️ Tool | `tool` | Tools | `MUST` | |
| 5 | 🏛️ Crew | `crew` | Flow | `MUST` | 🆕 |
| 6 | 📥 Input | `input` | Data | `MUST` | 🆕 |
| 7 | 📤 Output | `output` | Data | `MUST` | 🆕 |
| 8 | 📚 Knowledge | `knowledge` | Data | `SHOULD` | 🆕 |
| 9 | 🧩 Memory | `memory` | Data | `SHOULD` | 🆕 |
| 10 | 🙋 Human Input | `human` | Flow | `SHOULD` | 🆕 |
| 11 | 🔀 Router | `router` | Flow | `MAY` | 🆕 |
| 12 | 🛡️ Guardrail | `guardrail` | Flow | `MAY` | 🆕 |
| 13 | 📝 Note | `note` | Utils | `SHOULD` | 🆕 |
| 14 | 🗂️ Group | `group` | Utils | `SHOULD` | 🆕 |

---

### 5.3. 🧠 LLM Node `MUST`

에이전트가 사용할 언어 모델을 정의한다. **여러 에이전트가 하나의 LLM 노드를 공유**할 수 있다.

**Ports**
* Outputs: `llm` → (Agent.llm, Crew.manager_llm)

**Fields**

| 필드 | 타입 | 기본값 | UI | 설명 |
|---|---|---|---|---|
| `provider` | enum | `openai` | Select | `openai` / `groq` / `gemini` / `anthropic` / `ollama` / `openai_compatible` |
| `model` | string | `gpt-4o-mini` | Combobox | 프로바이더별 프리셋 + 자유 입력. Ollama 선택 시 §13에서 자동 조회한 목록 표시 |
| `temperature` | float | `0.7` | Slider 0–2 | |
| `max_tokens` | int \| null | `null` | Number | null이면 프로바이더 기본 |
| `top_p` | float | `1.0` | Slider (Advanced) | |
| `base_url` | string \| null | `null` | Input (Advanced) | `openai_compatible`, `ollama` 용 |
| `timeout_s` | int | `120` | Number (Advanced) | |
| `max_retries` | int | `2` | Number (Advanced) | |

**컴파일 결과**
```python
from crewai import LLM
LLM(
    model="openai/gpt-4o-mini",   # f"{provider}/{model}" — litellm 규약
    temperature=0.7,
    max_tokens=None,
    api_key=<헤더에서 주입, 그래프에 저장 안 됨>,
    base_url=<optional>,
)
```

**프로바이더 → litellm 접두사 매핑 표** `MUST`

| provider | litellm prefix | 대표 모델 | 키 이름 |
|---|---|---|---|
| `openai` | `openai/` | `gpt-4o`, `gpt-4o-mini` | `OPENAI_API_KEY` |
| `groq` | `groq/` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `gemini` | `gemini/` | `gemini-2.0-flash` | `GEMINI_API_KEY` |
| `anthropic` | `anthropic/` | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| `ollama` | `ollama/` | `llama3.1`, `qwen2.5` | (불필요) |
| `openai_compatible` | `openai/` + `base_url` | 임의 | 사용자 지정 |

> 모델 프리셋 목록은 **하드코딩하지 말고** `backend/app/data/model_presets.json` 에 두고 `GET /api/v1/providers` 로 서빙한다. 모델은 자주 바뀐다.

---

### 5.4. 🤖 Agent Node `MUST`

**Ports**
* Inputs: `llm` (1, 선택 — 없으면 Crew 기본 LLM 상속), `tool` (N, 선택), `knowledge` (N, 선택)
* Outputs: `agent` → (Task.agent, Crew.agents)

**Fields**

| 필드 | 타입 | 기본값 | UI | 설명 |
|---|---|---|---|---|
| `name` | string | `New Agent` | Input | 캔버스 표시용 (CrewAI 미전달) |
| `role` | string | — | Input | **필수.** 예: `Senior Market Researcher` |
| `goal` | string | — | Textarea | **필수.** 예: `Uncover emerging trends in {topic}` |
| `backstory` | string | — | Textarea (3줄) | **필수.** 페르소나 |
| `allow_delegation` | bool | `false` | Toggle | 다른 에이전트에게 위임 허용 |
| `verbose` | bool | `true` | Toggle | |
| `max_iter` | int | `20` | Number (Advanced) | 무한루프 방지 |
| `max_rpm` | int \| null | `null` | Number (Advanced) | 분당 요청 제한 |
| `cache` | bool | `true` | Toggle (Advanced) | 툴 결과 캐싱 |
| `respect_context_window` | bool | `true` | Toggle (Advanced) | |

**컴파일 결과**
```python
Agent(
    role=..., goal=..., backstory=...,
    llm=<연결된 LLM 노드 객체 or crew 기본>,
    tools=[<연결된 Tool 노드들>],
    knowledge_sources=[<연결된 Knowledge 노드들>],
    allow_delegation=False, verbose=True, max_iter=20,
)
```

**검증**
* `role`, `goal`, `backstory` 중 하나라도 공백 → `AC-E201`
* 연결된 Task가 0개이고 `allow_delegation=false` → 경고 `AC-W203` (실행은 가능)

---

### 5.5. 📋 Task Node `MUST`

**Ports**
* Inputs: `agent` (1, **필수**), `context` (N, 선택 — 다른 Task의 출력), `tool` (N, 선택 — 태스크 한정 툴)
* Outputs: `task` → (Crew.tasks, 다른 Task.context)

**Fields**

| 필드 | 타입 | 기본값 | UI | 설명 |
|---|---|---|---|---|
| `name` | string | `New Task` | Input | 표시용 |
| `description` | string | — | Textarea (5줄) | **필수.** `{variable}` 보간 지원 |
| `expected_output` | string | — | Textarea (3줄) | **필수.** CrewAI 품질에 결정적 |
| `async_execution` | bool | `false` | Toggle | 병렬 실행 |
| `human_input` | bool | `false` | Toggle | 완료 후 사람 검토 (§5.10 연계) |
| `output_file` | string \| null | `null` | Input (Advanced) | 결과 파일 저장 경로 |
| `output_format` | enum | `raw` | Select | `raw` / `json` / `pydantic` |
| `json_schema` | string \| null | `null` | Code Editor | `output_format=json` 일 때 |
| `markdown` | bool | `true` | Toggle | 마크다운 출력 유도 |

**컴파일 결과**
```python
Task(
    description=render_template(description, inputs),
    expected_output=...,
    agent=<연결된 Agent>,
    context=[<context 엣지로 연결된 Task들>],
    tools=[...],
    async_execution=False,
    human_input=False,
    output_file=None,
)
```

**🆕 Task 순서 결정 규칙 (중요)** `MUST`
CrewAI `Process.sequential` 은 **리스트 순서**로 실행한다. 캔버스는 순서 개념이 없으므로:
1. `context` 엣지로 **위상 정렬(topological sort)** 한다.
2. 위상이 동일한(의존 없는) 태스크들은 **캔버스 X좌표 → Y좌표 오름차순**으로 정렬한다. (사용자의 시각적 배치 = 의도로 간주)
3. 정렬 결과를 노드 헤더 좌측에 **순번 배지 `#1 #2 #3`** 로 상시 표시한다. → 사용자가 실행 순서를 눈으로 확인 가능. `MUST`

---

### 5.6. 🛠️ Tool Node `MUST`

**Ports**
* Inputs: (없음)
* Outputs: `tool` → (Agent.tools, Task.tools)

**Fields**

| 필드 | 타입 | UI | 설명 |
|---|---|---|---|
| `tool_id` | enum | Select | 아래 툴 레지스트리 참조 |
| `config` | object | 동적 폼 | 선택한 툴의 스키마에 따라 폼이 바뀜 |

**v1.0 툴 레지스트리** (`backend/app/tools/registry.py`)

| tool_id | CrewAI 클래스 | 필요 키 | config 필드 |
|---|---|---|---|
| `serper_search` | `SerperDevTool` | `SERPER_API_KEY` | `n_results`(10), `country`, `locale` |
| `scrape_website` | `ScrapeWebsiteTool` | — | `website_url`(선택, 없으면 동적) |
| `file_read` | `FileReadTool` | — | `file_path` |
| `directory_read` | `DirectoryReadTool` | — | `directory` |
| `website_rag` | `WebsiteSearchTool` | 임베딩 키 | `website` |
| `code_interpreter` | `CodeInterpreterTool` | — | `unsafe_mode`(false) ⚠️ |
| `csv_search` | `CSVSearchTool` | 임베딩 키 | `csv` |
| `youtube_search` | `YoutubeVideoSearchTool` | 임베딩 키 | `youtube_video_url` |
| `custom_http` 🆕 | 자체 구현 | — | `name`, `description`, `method`, `url_template`, `headers` |

> ⚠️ **`code_interpreter` 보안:** Docker 샌드박스가 없는 환경에서는 **기본 비활성화**하고, UI에서 켤 때 명시적 경고 모달을 띄운다. `MUST`
> ⚠️ **툴 목록 하드코딩 금지:** `GET /api/v1/tools` 로 서버가 스키마를 내려주고 프론트는 동적 폼을 렌더링한다. 툴 추가 시 프론트 수정 불필요.

---

### 5.7. 🏛️ Crew Node 🆕 `MUST`

**왜 필요한가:** PRD에는 Crew 개념이 노드로 없었다. 하지만 `process`(sequential/hierarchical), `manager_llm`, `memory`, `max_rpm` 은 **Crew 레벨 설정**이라 어딘가에 있어야 한다. 이걸 사이드바 설정 창에 숨기면 ComfyUI 감성이 깨진다. **캔버스의 루트 노드로 명시**한다.

**Ports**
* Inputs: `agent` (N), `task` (N), `llm` (1 — manager_llm), `memory` (1)
* Outputs: `result` → (Output Node)

**Fields**

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `name` | string | `My Crew` | |
| `process` | enum | `sequential` | `sequential` / `hierarchical` |
| `verbose` | bool | `true` | |
| `memory` | bool | `false` | 단기 메모리 활성화 |
| `cache` | bool | `true` | |
| `max_rpm` | int \| null | `null` | Crew 전역 레이트 리밋 |
| `planning` | bool | `false` | CrewAI 플래닝 기능 |
| `full_output` | bool | `true` | 모든 태스크 출력 반환 |

**규칙** `MUST`
* 그래프에 **Crew 노드는 정확히 1개** 존재해야 한다. 0개 → `AC-E101`, 2개 이상 → `AC-E102`
* `process=hierarchical` 인데 `manager_llm` 미연결 → `AC-E103`
* Crew에 연결되지 않은 Agent/Task는 **회색 반투명**으로 표시하고 컴파일에서 제외 + 경고 `AC-W104`
* 🆕 **Auto-Wire 편의:** Crew 노드가 존재할 때 새 Agent/Task 노드를 추가하면 **자동으로 Crew에 연결**한다. (사용자가 매번 선 긋는 피로 제거)

**컴파일 결과**
```python
Crew(
    agents=[...], tasks=[...],
    process=Process.sequential,
    manager_llm=<optional>,
    memory=False, cache=True, verbose=True,
    step_callback=emit_step, task_callback=emit_task,
)
```

---

### 5.8. 📥 Input Node 🆕 `MUST`

**왜 필요한가:** 템플릿 바이럴 루프의 핵심. `"{topic}에 대한 블로그 써줘"` 템플릿을 받은 사람이 **프롬프트를 뒤지지 않고 상단 인풋 하나만 바꿔서** 실행할 수 있어야 한다.

**Ports**
* Outputs: `text` → (Task.description 의 `{var}` 보간 — 논리적 연결)

**Fields**

| 필드 | 타입 | 설명 |
|---|---|---|
| `var_name` | string | 변수명. `[a-zA-Z_][a-zA-Z0-9_]*`. 예: `topic` |
| `label` | string | 실행 모달에 표시될 라벨. 예: `블로그 주제` |
| `input_type` | enum | `text` / `textarea` / `number` / `select` / `file` |
| `default_value` | string | |
| `options` | string[] | `input_type=select` 일 때 |
| `required` | bool | |
| `description` | string | 도움말 |

**동작 흐름** `MUST`
1. Task의 `description` / `expected_output` 안의 `{var_name}` 을 **실시간 하이라이팅**한다.
2. 정의되지 않은 변수를 쓰면 노란 밑줄 + `AC-W301` 경고.
3. `Queue Prompt` 클릭 시 Input 노드가 1개 이상 있으면 **실행 파라미터 모달**을 먼저 띄운다.
4. 입력값은 `POST /api/v1/runs` 의 `inputs` 필드로 전달 → `crew.kickoff(inputs={...})`.
5. 🆕 마지막 입력값을 LocalStorage에 기억해 다음 실행 시 프리필.

---

### 5.9. 📤 Output Node 🆕 `MUST`

**Ports**
* Inputs: `result` (1) 또는 `task` (N)

**Fields**

| 필드 | 타입 | 설명 |
|---|---|---|
| `title` | string | 결과 패널 제목 |
| `render_as` | enum | `markdown` / `plain` / `json` |
| `allow_download` | bool | `.md` / `.json` 다운로드 버튼 노출 |

**동작:** 실행 완료 시 노드 본문이 확장되며 결과를 렌더링. 우측 로그 패널의 `Result` 탭과 동기화. 노드 우상단 복사 버튼 제공.

---

### 5.10. 📚 Knowledge / 🧩 Memory / 🙋 Human / 🔀 Router / 🛡️ Guardrail 🆕

| 노드 | 우선순위 | 요약 |
|---|---|---|
| **📚 Knowledge** `SHOULD` | v1.0 | 파일(pdf/txt/md/csv) 또는 URL을 지식원으로. Agent의 `knowledge` 인풋에 연결. 필드: `source_type`(file/url/text), `content`, `chunk_size`(4000), `chunk_overlap`(200), `embedder`(provider/model). 파일은 `POST /api/v1/uploads` 로 업로드 후 `file_ref` 만 그래프에 저장. |
| **🧩 Memory** `SHOULD` | v1.0 | Crew의 `memory` 인풋에 연결. 필드: `short_term`(bool), `long_term`(bool), `entity`(bool), `storage_path`. 미연결 시 Crew의 `memory` 토글만 사용. |
| **🙋 Human Input** `SHOULD` | v1.0 | Task의 완료 시점에 사람 승인 요청. SSE로 `human.request` 이벤트 → UI 모달 → `POST /api/v1/runs/{id}/human` 으로 응답. 필드: `prompt`, `timeout_s`(300), `on_timeout`(`abort`/`continue`). ⚠️ 백엔드가 스레드 블로킹 상태로 대기하므로 타임아웃 필수. |
| **🔀 Router** `MAY` | v1.1 | 조건 분기. 필드: `mode`(`keyword`/`llm_judge`/`regex`), `condition`, 다중 출력 포트. CrewAI Flow의 `@router` 로 컴파일. **v1.0에서는 UI만 두고 disabled 처리 가능.** |
| **🛡️ Guardrail** `MAY` | v1.1 | Task 출력 검증. 필드: `type`(`length`/`json_schema`/`llm_check`), `retry_count`(2). CrewAI Task의 `guardrail` 파라미터로 컴파일. |
| **📝 Note** `SHOULD` | v1.0 | 마크다운 메모. `compilable: false`. 크기 조절 가능. |
| **🗂️ Group** `SHOULD` | v1.0 | 배경 프레임. `compilable: false`. 내부 노드 동반 이동. React Flow `parentNode` 활용. |

---

## 🔌 6. 포트 타입 시스템 (Port Type System) 🆕

> **이 장이 AgentCanvas의 "손맛"을 결정한다.** ComfyUI가 기분 좋은 이유는 **연결될 수 없는 선은 애초에 연결되지 않기 때문**이다. 타입 시스템 없이 자유 연결을 허용하면 백엔드에서 터지고 사용자는 이유를 모른다.

### 6.1. 포트 타입 정의

| 타입 키 | 소켓 색상(제안) | 소켓 모양 | 의미 |
|---|---|---|---|
| `llm` | rose | ● 원형 | 언어 모델 인스턴스 |
| `agent` | indigo | ● 원형 | 에이전트 인스턴스 |
| `task` | emerald | ● 원형 | 태스크 인스턴스 |
| `tool` | amber | ◆ 마름모 | 툴 인스턴스 |
| `context` | emerald (밝게) | ◇ 빈 마름모 | 태스크 간 의존 (출력→입력) |
| `knowledge` | orange | ▲ 삼각형 | 지식원 |
| `memory` | indigo (진하게) | ▲ 삼각형 | 메모리 설정 |
| `result` | teal | ■ 사각형 | 최종 실행 결과 |
| `text` | cyan | ■ 사각형 | 문자열 변수 |

> 소켓 색/모양은 **아티팩트 디자인에 존재하는 형태를 최우선 채택**한다(§1). 위 표는 아티팩트에 소켓 구분이 없을 때의 확장안이다.

### 6.2. 연결 규칙 매트릭스 `MUST`

행 = 출력(source), 열 = 입력(target). ✅ 허용 / ❌ 차단

| source \ target | Agent.llm | Agent.tool | Agent.knowledge | Task.agent | Task.context | Task.tool | Crew.agent | Crew.task | Crew.llm | Crew.memory | Output.result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **LLM.llm** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Agent.agent** | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Task.task** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **Tool.tool** | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Knowledge.knowledge** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Memory.memory** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Crew.result** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### 6.3. 연결 카디널리티

| 포트 | 최대 연결 수 | 초과 시 동작 |
|---|---|---|
| `Agent.llm` | 1 | 기존 엣지 자동 교체 (ComfyUI 방식) |
| `Task.agent` | 1 | 기존 엣지 자동 교체 |
| `Crew.llm` (manager) | 1 | 기존 엣지 자동 교체 |
| `Crew.memory` | 1 | 기존 엣지 자동 교체 |
| 그 외 (`tool`, `context`, `agent`, `task`, `knowledge`) | N | 무제한 |
| **모든 출력 포트** | N | 무제한 (하나의 LLM을 여러 에이전트가 공유) |

### 6.4. 인터랙션 규칙 `MUST`

1. **드래그 시작 시** 호환 소켓만 밝게 강조하고, 비호환 소켓은 opacity 30%로 낮춘다.
2. **비호환 소켓 위에 hover** 시 커서를 `not-allowed` 로 바꾸고 연결선을 빨갛게 표시한다.
3. **드롭 실패 시** 연결선이 스프링 애니메이션으로 소멸한다.
4. **사이클 생성 시도**(`Task.context` 루프)는 실시간으로 차단한다. → 토스트 `AC-E105`
5. **엣지 삭제**: 엣지 hover 시 중앙에 × 버튼, 또는 엣지 선택 후 `Delete`.

### 6.5. 사이클 검출 알고리즘

* 대상: `context` 타입 엣지만 (다른 엣지는 구조상 사이클 불가)
* 방식: 엣지 추가 **전에** DFS로 `target → ... → source` 경로 존재 여부 확인. 존재하면 연결 거부.
* 복잡도: O(V+E). 노드 500개까지 체감 지연 없음.

---

## 📦 7. Canvas JSON Schema (`.acanvas.json`) 🆕

> **이 포맷이 제품의 자산이다.** 저장·공유·템플릿·버전관리·Git diff가 전부 여기 달려 있다.

### 7.1. 최상위 스키마 v1

```jsonc
{
  "schema_version": "1.0",              // 마이그레이션 기준
  "app_version": "0.1.0",               // 생성한 앱 버전
  "id": "cvs_01J8XKQ2M3N4P5",           // ULID
  "name": "SEO Blog Writing Crew",
  "description": "키워드 하나로 리서치→작성→교정까지",
  "tags": ["content", "seo", "beginner"],
  "author": "anonymous",
  "created_at": "2026-08-28T09:00:00Z",
  "updated_at": "2026-08-28T09:30:00Z",

  "viewport": { "x": 0, "y": 0, "zoom": 1 },

  "nodes": [ /* NodeObject[] */ ],
  "edges": [ /* EdgeObject[] */ ],

  "meta": {
    "requires_keys": ["OPENAI_API_KEY", "SERPER_API_KEY"],  // 임포트 시 안내용
    "estimated_cost_usd": 0.02,
    "estimated_duration_s": 90,
    "thumbnail": null                    // base64 소형 PNG (선택)
  }
}
```

### 7.2. NodeObject

```jsonc
{
  "id": "agent_1",
  "type": "agent",
  "position": { "x": 240, "y": 120 },
  "width": 320,                          // 사용자가 리사이즈했을 때
  "height": null,
  "data": {
    "name": "Researcher",
    "role": "Senior Market Researcher",
    "goal": "Uncover the latest trends about {topic}",
    "backstory": "You have 15 years of experience...",
    "allow_delegation": false,
    "verbose": true,
    "max_iter": 20
  },
  "ui": {                                // 🆕 실행에 영향 없는 순수 UI 상태
    "collapsed": false,
    "pinned": false,
    "bypassed": false,
    "color_override": null
  },
  "parentNode": null,                    // Group 노드 ID
  "extent": null
}
```

### 7.3. EdgeObject

```jsonc
{
  "id": "e_llm1_agent1",
  "source": "llm_1",
  "sourceHandle": "llm",                 // 포트 타입 = 핸들 ID
  "target": "agent_1",
  "targetHandle": "llm",
  "type": "acanvas",                     // 커스텀 엣지 컴포넌트
  "data": { "port_type": "llm" }
}
```

### 7.4. 🔐 절대 규칙: 그래프에 비밀정보를 담지 않는다 `MUST`

* `.acanvas.json` 에는 **API Key, 토큰, 비밀번호가 절대 포함되지 않는다.**
* 키는 별도 저장소(§12)에 있고, 그래프는 `meta.requires_keys` 로 **필요한 키의 "이름"만** 명시한다.
* Export 직전 **Secret Scanner**를 실행한다: 모든 문자열 필드를 정규식으로 스캔.
  * `sk-[a-zA-Z0-9]{20,}`, `AIza[0-9A-Za-z\-_]{35}`, `gsk_[a-zA-Z0-9]{20,}`, `sk-ant-`, `ghp_`, `Bearer [A-Za-z0-9\-._~+/]+`
  * 탐지 시 **Export 차단** + 해당 노드/필드 하이라이트 + 경고 모달. `MUST`
* Import 시에도 동일 스캔 실행 → 발견 시 해당 필드를 `***REDACTED***` 로 치환하고 사용자에게 고지.

### 7.5. 스키마 버전 마이그레이션 `MUST`

```ts
// frontend/src/persistence/migrations.ts
const migrations: Record<string, (doc: any) => any> = {
  '1.0->1.1': (doc) => { /* 필드 추가/이름 변경 */ return doc; },
};
export function migrate(doc: any): CanvasDoc {
  let cur = doc.schema_version ?? '1.0';
  while (cur !== CURRENT_SCHEMA_VERSION) {
    const step = findMigration(cur);
    if (!step) throw new AcanvasError('AC-E401', `Unsupported schema: ${cur}`);
    doc = step.fn(doc); cur = step.to;
  }
  return validate(doc);
}
```

* **하위 호환은 영구 보장한다.** 구버전 파일은 항상 열려야 한다.
* 상위 버전 파일을 열면 → "더 최신 버전에서 만든 파일입니다. 앱을 업데이트하세요." (`AC-E402`)
* 마이그레이션은 **순수 함수**로 작성하고 각 스텝마다 픽스처 테스트를 둔다.

### 7.6. 예시 그래프 (최소 실행 가능 크루)

```jsonc
{
  "schema_version": "1.0",
  "name": "Minimal Research Crew",
  "nodes": [
    { "id": "input_1", "type": "input", "position": {"x": 40, "y": 40},
      "data": { "var_name": "topic", "label": "리서치 주제",
                "input_type": "text", "default_value": "AI 에이전트 시장", "required": true } },
    { "id": "llm_1", "type": "llm", "position": {"x": 40, "y": 200},
      "data": { "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7 } },
    { "id": "tool_1", "type": "tool", "position": {"x": 40, "y": 380},
      "data": { "tool_id": "serper_search", "config": { "n_results": 10 } } },
    { "id": "agent_1", "type": "agent", "position": {"x": 420, "y": 160},
      "data": { "name": "Researcher", "role": "Senior Market Researcher",
                "goal": "{topic}에 대한 최신 동향을 수집한다",
                "backstory": "당신은 15년 경력의 시장 분석가입니다." } },
    { "id": "task_1", "type": "task", "position": {"x": 800, "y": 160},
      "data": { "name": "Research", "description": "{topic}에 대해 웹을 조사하고 핵심 5가지를 정리하라.",
                "expected_output": "불릿 5개, 각 항목마다 출처 URL 포함" } },
    { "id": "crew_1", "type": "crew", "position": {"x": 1160, "y": 160},
      "data": { "name": "Research Crew", "process": "sequential", "verbose": true } },
    { "id": "output_1", "type": "output", "position": {"x": 1500, "y": 160},
      "data": { "title": "리서치 결과", "render_as": "markdown", "allow_download": true } }
  ],
  "edges": [
    { "id": "e1", "source": "llm_1",  "sourceHandle": "llm",    "target": "agent_1", "targetHandle": "llm" },
    { "id": "e2", "source": "tool_1", "sourceHandle": "tool",   "target": "agent_1", "targetHandle": "tool" },
    { "id": "e3", "source": "agent_1","sourceHandle": "agent",  "target": "task_1",  "targetHandle": "agent" },
    { "id": "e4", "source": "agent_1","sourceHandle": "agent",  "target": "crew_1",  "targetHandle": "agent" },
    { "id": "e5", "source": "task_1", "sourceHandle": "task",   "target": "crew_1",  "targetHandle": "task" },
    { "id": "e6", "source": "crew_1", "sourceHandle": "result", "target": "output_1","targetHandle": "result" }
  ],
  "meta": { "requires_keys": ["OPENAI_API_KEY", "SERPER_API_KEY"] }
}
```

---

## ⚙️ 8. Canvas Compiler 명세 (JSON → CrewAI) 🆕

> PRD의 `Canvas Topology Parser` 를 구현 가능한 수준으로 확장한 것. **AgentCanvas 백엔드의 심장.**
>
> ⚠️ **아래 §8.2의 코드는 개념 골격이다.** `Agent`/`Task`/`Crew`/`LLM` 의 실제 파라미터명·기본값은 §4.3 "구현 착수 전 필수 검증 절차"에서 설치된 CrewAI 버전의 실제 소스를 읽어 확정한다. 학습 데이터 기반 추정치로 그대로 구현하지 않는다.

### 8.1. 컴파일 파이프라인 (6단계)

```text
[1] Normalize      → bypassed/non-compilable 노드 제거, 고아 엣지 정리, 기본값 채우기
      ↓
[2] Structural     → 스키마 검증(pydantic), 포트 타입 매트릭스 검증, 카디널리티 검증
    Validation       Crew 노드 유일성, 사이클 검출
      ↓
[3] Semantic       → 필수 필드 공백 체크, 미정의 변수 참조, 툴 키 존재 여부,
    Validation       hierarchical인데 manager_llm 없음 등
      ↓
[4] Topological    → context 엣지로 위상 정렬 → 동순위는 (x, y) 오름차순 (§5.5)
    Ordering
      ↓
[5] Instantiation  → LLM → Tool → Knowledge → Agent → Task → Crew 순으로 객체 생성
                     (의존성 역순. 인스턴스 캐시로 공유 노드 중복 생성 방지)
      ↓
[6] Binding        → 콜백 주입(step/task), 변수 보간, 실행 컨텍스트 구성
```

### 8.2. 구현 골격

```python
# backend/app/compiler/compiler.py
from dataclasses import dataclass, field
from crewai import Agent, Task, Crew, Process, LLM

@dataclass
class CompileResult:
    crew: Crew
    node_index: dict[str, str]          # crewai 객체 id → canvas node id (이벤트 역매핑용)
    task_order: list[str]               # 실행 순서대로의 canvas node id
    warnings: list["Issue"] = field(default_factory=list)

class CanvasCompiler:
    def __init__(self, graph: CanvasGraph, secrets: SecretBundle, inputs: dict):
        self.g, self.secrets, self.inputs = graph, secrets, inputs
        self._cache: dict[str, object] = {}     # node_id → 인스턴스 (공유 보장)
        self.node_index: dict[str, str] = {}

    def compile(self) -> CompileResult:
        self._normalize()
        issues = self._validate_structural() + self._validate_semantic()
        if any(i.severity == "error" for i in issues):
            raise CompilationError(issues)

        order = self._topological_order()

        crew_node = self.g.single("crew")
        agents = [self._build_agent(n) for n in self.g.incoming(crew_node, "agent")]
        tasks  = [self._build_task(self.g.node(nid)) for nid in order]

        crew = Crew(
            agents=agents, tasks=tasks,
            process=Process[crew_node.data["process"]],
            manager_llm=self._manager_llm(crew_node),
            memory=crew_node.data.get("memory", False),
            cache=crew_node.data.get("cache", True),
            verbose=crew_node.data.get("verbose", True),
            max_rpm=crew_node.data.get("max_rpm"),
            planning=crew_node.data.get("planning", False),
            step_callback=self.emitter.on_step,
            task_callback=self.emitter.on_task,
        )
        return CompileResult(crew, self.node_index, order, warnings=issues)

    # --- builders (전부 self._cache 경유) ---
    def _build_llm(self, node) -> LLM: ...
    def _build_tool(self, node): ...
    def _build_agent(self, node) -> Agent: ...
    def _build_task(self, node) -> Task: ...
```

### 8.3. 인스턴스 캐시 규칙 `MUST`

```python
def _get_or_create(self, node_id, factory):
    if node_id not in self._cache:
        self._cache[node_id] = factory()
    return self._cache[node_id]
```
하나의 LLM 노드에 5개 에이전트가 연결되면 **LLM 객체는 1개만** 생성한다. (커넥션 풀/레이트리밋 관점에서 중요)

### 8.4. 변수 보간 규칙

* CrewAI가 `{var}` 보간을 자체 지원하므로 **원칙적으로 그대로 넘긴다.**
* 단, 실행 전 프론트/백엔드 모두에서 **미정의 변수 사전 검출**을 수행한다.
* 이스케이프: 리터럴 중괄호는 `{{` `}}`.
* 정규식: `/(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g`

### 8.5. 🆕 Export to Python (역컴파일) `SHOULD`

**전략적으로 중요한 기능.** 페르소나 P2(엔지니어)를 붙잡고, "락인 없음"을 증명해 신뢰를 산다. 바이럴 훅으로도 강력하다.

* `GET /api/v1/runs/compile-preview` 또는 `POST /api/v1/export/python`
* 그래프 → 실행 가능한 단일 `crew.py` 파일 문자열 생성 (Jinja2 템플릿)
* API 키 자리는 `os.getenv("OPENAI_API_KEY")` 로 출력 (하드코딩 금지)
* UI: 헤더의 `</> Export Code` 버튼 → 모달에 신택스 하이라이팅 + 복사/다운로드
* 함께 `requirements.txt` 와 `.env.example` 도 생성

---

## 🌐 9. 백엔드 API 명세 🆕

### 9.1. 공통 규약

* Base: `/api/v1`
* Content-Type: `application/json`
* 인증: 없음 (로컬/BYOK). 단 CORS 화이트리스트 필수 (§12.5)
* 에러 응답 포맷 (전 엔드포인트 통일) `MUST`

```jsonc
{
  "error": {
    "code": "AC-E201",
    "message": "Agent 'Researcher' is missing required field: goal",
    "severity": "error",
    "node_id": "agent_1",
    "field": "goal",
    "hint": "에이전트의 목표를 한 문장으로 입력하세요.",
    "docs_url": "https://github.com/.../docs/errors#AC-E201"
  },
  "request_id": "req_01J8XK..."
}
```

> `node_id` 가 있으면 프론트는 **해당 노드로 카메라를 이동시키고 하이라이팅**한다. `MUST`

### 9.2. 엔드포인트 목록

| Method | Path | 설명 | 우선순위 |
|---|---|---|---|
| `GET` | `/api/v1/health` | 헬스체크 + 버전 + crewai 버전 | `MUST` |
| `GET` | `/api/v1/providers` | LLM 프로바이더/모델 프리셋 목록 | `MUST` |
| `GET` | `/api/v1/tools` | 툴 레지스트리 + config JSON Schema | `MUST` |
| `GET` | `/api/v1/ollama/models` | 로컬 Ollama 모델 목록 (§13) | `MUST` |
| `POST` | `/api/v1/validate` | 그래프 검증만 수행 (실행 X) | `MUST` |
| `POST` | `/api/v1/runs` | 실행 시작 → `run_id` 반환 | `MUST` |
| `GET` | `/api/v1/runs/{id}/events` | **SSE 스트림 구독** | `MUST` |
| `POST` | `/api/v1/runs/{id}/cancel` | 실행 취소 | `MUST` |
| `GET` | `/api/v1/runs/{id}` | 실행 스냅샷(폴백/재연결) | `SHOULD` |
| `POST` | `/api/v1/runs/{id}/human` | Human-in-the-loop 응답 제출 | `SHOULD` |
| `POST` | `/api/v1/export/python` | 그래프 → Python 코드 | `SHOULD` |
| `POST` | `/api/v1/uploads` | Knowledge 파일 업로드 | `SHOULD` |
| `GET` | `/api/v1/templates` | 내장 템플릿 목록 | `SHOULD` |

### 9.3. `POST /api/v1/runs`

**Request Headers** `MUST`
```http
Content-Type: application/json
X-Provider-Keys: {"OPENAI_API_KEY":"sk-...","SERPER_API_KEY":"..."}   # JSON, Base64 인코딩 권장
X-Client-Version: 0.1.0
```

> **키는 헤더로만 전송한다.** 바디에 넣으면 요청 로그·에러 리포트에 섞여 유출된다. 헤더는 로깅 미들웨어에서 **화이트리스트 방식**으로 제거한다. `MUST`

**Request Body**
```jsonc
{
  "graph": { /* CanvasDoc — nodes/edges/viewport */ },
  "inputs": { "topic": "AI 에이전트 시장" },
  "options": {
    "dry_run": false,
    "max_duration_s": 900,
    "stream_thoughts": true,
    "verbose": true
  }
}
```

**Response `202 Accepted`**
```jsonc
{
  "run_id": "run_01J8XKQ2M3N4P5",
  "status": "queued",
  "task_order": ["task_1", "task_2", "task_3"],
  "warnings": [ { "code": "AC-W104", "node_id": "agent_9", "message": "..." } ],
  "events_url": "/api/v1/runs/run_01J8XKQ2M3N4P5/events"
}
```

**Error `422`** — 검증 실패 시 `errors: Issue[]` 배열 전체 반환 (첫 에러만 반환하지 말 것. 사용자가 한 번에 다 고칠 수 있어야 한다) `MUST`

### 9.4. `POST /api/v1/validate`

`runs` 와 동일 바디, 실행 없이 검증 결과만 반환. 프론트는 **그래프 변경 후 800ms 디바운스**로 호출해 실시간 검증 오버레이를 갱신한다. `SHOULD`
(백엔드가 꺼져 있어도 프론트 자체 검증은 항상 동작해야 한다. `MUST`)

---

## 📡 10. SSE 실시간 이벤트 프로토콜 🆕

### 10.1. 전송 규약

```http
GET /api/v1/runs/{run_id}/events
Accept: text/event-stream
Cache-Control: no-cache
X-Last-Event-Id: 42            # 재연결 시 replay 지점
```

응답 헤더: `Content-Type: text/event-stream`, `X-Accel-Buffering: no` (nginx 버퍼링 차단 `MUST`), `Connection: keep-alive`

**포맷**
```text
id: 42
event: node.status
data: {"run_id":"run_01J...","seq":42,"ts":"2026-08-28T09:00:03.412Z","node_id":"task_1","status":"running"}

: heartbeat
```

* `id`: 단조 증가 시퀀스. 재연결 시 `Last-Event-ID` 로 누락분 replay `MUST`
* **하트비트**: 15초마다 `: heartbeat` 코멘트 전송 (프록시 타임아웃 방지) `MUST`
* 서버는 최근 **500개 이벤트를 링버퍼**에 유지 (replay용)

### 10.2. 이벤트 카탈로그 `MUST`

| event | 발생 시점 | payload 핵심 필드 |
|---|---|---|
| `run.started` | 컴파일 성공 직후 | `task_order`, `agent_count`, `started_at` |
| `run.completed` | 전체 성공 | `duration_ms`, `final_output`, `usage` |
| `run.failed` | 치명적 실패 | `error{code,message,node_id}`, `traceback_digest` |
| `run.cancelled` | 사용자 취소 | `cancelled_at`, `completed_tasks` |
| `node.status` | 노드 상태 변화 | `node_id`, `status`, `progress?` |
| `task.started` | 태스크 시작 | `node_id`, `task_name`, `agent_node_id` |
| `task.completed` | 태스크 완료 | `node_id`, `output`, `duration_ms`, `usage` |
| `agent.thought` | LLM 중간 사고 | `agent_node_id`, `text`, `iteration` |
| `agent.tool_use` | 툴 호출 | `agent_node_id`, `tool_id`, `input`, `call_id` |
| `agent.tool_result` | 툴 결과 | `call_id`, `output_preview`, `duration_ms`, `is_error` |
| `agent.delegation` | 위임 발생 | `from_node_id`, `to_node_id`, `question` |
| `token.usage` | LLM 호출 종료 | `node_id`, `prompt_tokens`, `completion_tokens`, `cost_usd` |
| `log` | 일반 로그 | `level`, `message`, `node_id?` |
| `human.request` | 사람 입력 요청 | `node_id`, `prompt`, `timeout_s` |
| `edge.active` | 데이터 흐름 | `edge_id`, `active`(bool) → 파티클 애니메이션 트리거 |

### 10.3. 이벤트 → UI 반응 매핑 `MUST`

| 이벤트 | UI 동작 |
|---|---|
| `node.status: running` | 노드에 `ring-2 ring-indigo-500 animate-pulse` |
| `edge.active: true` | 해당 엣지 파티클 애니메이션 ON |
| `agent.thought` | 로그 패널 스트림 탭에 타이핑 효과로 추가 + 노드 hover 프리뷰 갱신 |
| `agent.tool_use` | 툴 노드에 짧은 플래시 + 로그에 🛠️ 배지 |
| `task.completed` | 노드 링 emerald 전환, 출력 요약을 노드 하단 접이식 영역에 표시 |
| `token.usage` | 헤더 비용 카운터 누적, 노드 우상단 토큰 배지 |
| `run.failed` | 에러 노드로 카메라 이동 + 붉은 링 + 에러 모달 |
| `human.request` | 모달 오픈 + 남은 시간 카운트다운 |

### 10.4. 🆕 백엔드 이벤트 브릿지 구현 노트

CrewAI의 `kickoff()` 는 **동기 블로킹**이다. 아래 패턴을 사용한다.

> ⚠️ **콜백 페이로드 구조는 버전마다 바뀐다.** 아래 `emit()` 호출 지점에서 실제로 넘어오는 `AgentAction`/`TaskOutput` 류 객체의 속성명은 §4.3 검증 절차로 설치된 버전의 소스에서 직접 확인한다. 특히 최근 CrewAI가 memory/knowledge/rag/flow 백엔드를 pluggable 구조로 리팩터링하면서 콜백 관련 내부 구조도 함께 바뀌었을 가능성이 높으므로, 이 절을 구현하기 직전에 반드시 재확인한다.

```python
# backend/app/runtime/bridge.py
import anyio, asyncio
from queue import Queue, Empty

class EventBridge:
    """워커 스레드(동기 CrewAI) → 이벤트 루프(SSE) 브릿지"""
    def __init__(self):
        self._q: Queue = Queue()          # thread-safe
        self._seq = 0
        self._buffer: list[dict] = []     # replay 링버퍼 (max 500)

    def emit(self, event: str, payload: dict) -> None:      # 워커 스레드에서 호출
        self._seq += 1
        item = {"id": self._seq, "event": event, "data": payload}
        self._buffer = (self._buffer + [item])[-500:]
        self._q.put(item)

    async def stream(self, last_id: int = 0):               # 이벤트 루프에서 소비
        for item in self._buffer:
            if item["id"] > last_id:
                yield item
        while True:
            try:
                yield self._q.get_nowait()
            except Empty:
                await asyncio.sleep(0.05)                    # 폴링 간격
```

* `crew.kickoff()` 는 `anyio.to_thread.run_sync()` 로 실행한다.
* `step_callback` / `task_callback` 안에서 `bridge.emit()` 을 호출한다.
* **콜백에서 예외가 나도 실행이 죽지 않도록** 전부 `try/except` 로 감싼다. `MUST`
* CrewAI 콜백이 주는 객체(`AgentAction`, `TaskOutput` 등)의 구조는 버전마다 다르므로 **`crewai_compat.py` 의 어댑터 함수로만 접근**한다. `MUST` (근거: §4.3 검증 절차 결과)

### 10.5. 콜백 → 캔버스 노드 역매핑 🆕 `MUST`

CrewAI 콜백은 `agent.role` 문자열만 준다. 캔버스 노드 ID를 알아야 UI를 켤 수 있다.
* 컴파일 시 `id(agent_object) → canvas_node_id` 딕셔너리(`node_index`)를 만든다.
* `role` 중복 가능성이 있으므로 **객체 아이덴티티(`id()`)를 1차 키**로 쓰고, `role` 은 폴백으로만 쓴다.
* 매핑 실패 시 이벤트를 버리지 말고 `node_id: null` 로 보내 로그 패널에는 남긴다.

### 10.6. 취소(Cancel) 구현 `MUST`

* CrewAI는 우아한 중단 API가 빈약하다. 현실적 전략:
  1. `cancel_event = threading.Event()` 를 런에 하나 둔다.
  2. `step_callback` 진입 시 `cancel_event.is_set()` 이면 `CancelledByUser` 예외를 raise → CrewAI 스택을 빠져나온다.
  3. 이미 진행 중인 단일 LLM 호출은 끝날 때까지 기다린다. **UI에 "현재 단계 완료 후 중단됩니다" 를 명시한다.** `MUST`
* `max_duration_s` 초과 시 동일 경로로 자동 취소하고 `run.failed(AC-E502)` 발행.

---

## 🔁 11. 실행 엔진 & 상태 머신 🆕

### 11.1. Run 라이프사이클

```text
      POST /runs
          │
          ▼
     ┌─────────┐  검증 실패   ┌──────────┐
     │ queued  │─────────────▶│  failed  │
     └────┬────┘              └──────────┘
          │ 컴파일 성공             ▲
          ▼                        │ 예외 / 타임아웃
     ┌─────────┐                   │
     │ running │───────────────────┘
     └────┬────┘
          │            취소 요청
          ├──────────────────────────▶ ┌───────────┐
          │                            │ cancelled │
          │ 전체 태스크 완료            └───────────┘
          ▼
     ┌───────────┐
     │ succeeded │
     └───────────┘
```

### 11.2. Run Manager 요구사항 `MUST`

| 항목 | 요구사항 |
|---|---|
| 동시 실행 제한 | 기본 `MAX_CONCURRENT_RUNS=3` (env). 초과 시 `429` + `AC-E503` |
| 런 보존 | 완료 후 **30분** 인메모리 유지 → 새로고침 시 결과 복구 가능. 이후 GC |
| 메모리 상한 | 런당 이벤트 링버퍼 500개 + 출력 텍스트 최대 1MB. 초과분은 truncate + `...(truncated)` |
| 워커 모델 | `uvicorn --workers 1`. 멀티워커 필요 시 Redis 백엔드로 교체 (인터페이스 분리해둘 것) |
| 격리 | 런 하나의 예외가 다른 런/서버 프로세스를 죽이지 않는다 |
| 그레이스풀 셧다운 | SIGTERM 수신 시 진행 중 런에 `run.cancelled` 발행 후 종료 |

### 11.3. 🆕 Dry Run 모드 `SHOULD`

`options.dry_run: true` → **LLM 호출 없이** 컴파일 + 실행 순서 + 예상 비용만 반환.
* 사용자가 API 비용 없이 그래프 구조를 검증할 수 있다.
* SSE로 `node.status` 를 가짜로 순차 발행해 애니메이션 리허설도 보여준다. (교육 효과 + 데모용으로 강력)

### 11.4. 🆕 재시도 정책

| 대상 | 정책 |
|---|---|
| LLM 호출 실패 (429/5xx) | 지수 백오프 3회 (1s, 2s, 4s + jitter). litellm `num_retries` 위임 |
| LLM 호출 실패 (401/403) | **즉시 중단.** 키 문제이므로 재시도 무의미 → `AC-E601` + 키 설정 모달 유도 |
| 툴 호출 실패 | 1회 재시도 후 에이전트에게 에러 텍스트 전달 (CrewAI 기본 동작 유지) |
| SSE 연결 끊김 | 프론트가 지수 백오프로 재연결(최대 5회) + `Last-Event-ID` replay |

---

## 🔐 12. BYOK 보안 모델 🆕

> **오픈소스 툴에서 가장 신뢰를 잃기 쉬운 지점이 API 키다.** 여기서 한 번 사고 나면 프로젝트가 끝난다. 아래는 타협 불가.

### 12.1. 키 저장 정책

| 저장 위치 | 정책 |
|---|---|
| **브라우저 (기본)** | `LocalStorage` 키 `agentcanvas.secrets.v1`. 사용자가 "이 브라우저에 저장" 을 **명시적으로 체크**했을 때만. |
| **세션 메모리 (권장 기본값)** | 체크 안 하면 Zustand 메모리에만 보관 → 탭 닫으면 소멸 |
| **서버** | ❌ **절대 저장 금지.** 디스크/DB/로그/환경변수 어디에도 남기지 않는다 |
| **`.acanvas.json`** | ❌ 절대 포함 금지 (§7.4 스캐너) |
| **서버 `.env` (셀프호스팅)** | 선택. 헤더에 키가 없을 때만 폴백으로 사용. 우선순위: **헤더 > 서버 env** |

### 12.2. 키 전송

* 전송: HTTPS + `X-Provider-Keys` **헤더** (Base64(JSON))
* 서버 수명: 요청 처리 동안만 메모리 상주. `SecretBundle` 객체는 런 종료 시 명시적으로 `clear()`
* `SecretBundle.__repr__` / `__str__` 를 오버라이드해 **항상 마스킹** 출력 `MUST`

```python
class SecretBundle:
    def __init__(self, data: dict[str, str]): self._d = dict(data)
    def get(self, k): return self._d.get(k)
    def clear(self): self._d.clear()
    def __repr__(self): return f"SecretBundle(keys={list(self._d)})"   # 값 노출 금지
    __str__ = __repr__
```

### 12.3. 로깅 마스킹 `MUST`

* structlog 프로세서로 **모든 로그 레코드를 정규식 스캔** 후 치환:
  `sk-\w{8,}` → `sk-***`, `AIza[\w\-]{30,}` → `AIza***`, `gsk_\w+` → `gsk_***`, `Bearer \S+` → `Bearer ***`
* 예외 트레이스백도 동일 처리. `traceback` 전문을 클라이언트에 보내지 않고 **다이제스트(마지막 3프레임)** 만 보낸다.
* 요청 로깅 미들웨어는 헤더를 **화이트리스트**로만 기록한다. (블랙리스트 금지 — 새 헤더가 추가되면 새는 구조)

### 12.4. UI 요구사항 `MUST`

* 키 입력 필드는 `type="password"` + 눈 아이콘 토글, 표시 시에도 `sk-...ab12` 형태로 마스킹
* 설정 모달에 **"AgentCanvas는 당신의 키를 서버에 저장하지 않습니다"** 문구 + 소스 코드 라인 링크
* 키 없이 실행 시도 → 어떤 키가 왜 필요한지 명확히 안내 (`meta.requires_keys` 활용)
* **"모든 키 삭제"** 버튼 상시 제공

### 12.5. 그 외 보안 요구사항

| 항목 | 요구사항 |
|---|---|
| **CORS** | `ALLOWED_ORIGINS` env 화이트리스트. 기본 `http://localhost:3000`. `*` 금지 `MUST` |
| **SSRF 방어** | `scrape_website`, `custom_http` 의 URL이 사설 IP 대역(`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`)을 향하면 차단 `MUST` |
| **파일 접근** | `file_read`, `directory_read` 는 `WORKSPACE_DIR` 하위로 경로 제한(chroot 유사). `..` 정규화 후 검사 `MUST` |
| **코드 실행** | `code_interpreter` 는 Docker 샌드박스 없으면 기본 OFF + 경고 모달 `MUST` |
| **업로드** | 크기 20MB 제한, 확장자 화이트리스트(`.pdf .txt .md .csv .json .docx`), MIME 검증 |
| **Rate Limit** | 셀프호스팅 기본은 없음. 공개 데모 배포 시 IP당 분당 5런 `SHOULD` |
| **프롬프트 인젝션** | 웹 스크래핑 결과는 **신뢰할 수 없는 데이터**다. 스크랩 텍스트를 시스템 프롬프트가 아닌 **툴 결과 영역**에만 넣고, UI 로그 패널에서 툴 결과를 시각적으로 구분 표시한다 `SHOULD` |
| **의존성** | Dependabot + `pip-audit` / `npm audit` CI 게이트 |

---

## 🦙 13. Ollama 로컬 연동 🆕

### 13.1. 자동 감지 프로토콜

```text
1. 프론트 부팅 → GET /api/v1/ollama/models  (백엔드 경유. CORS 회피 목적)
2. 백엔드 → GET {OLLAMA_HOST}/api/tags  (기본 http://localhost:11434, 타임아웃 1.5s)
3. 성공 → 모델 리스트 캐시(60초) 후 반환
   실패 → { "available": false, "models": [], "reason": "connection_refused" }
4. 프론트 상태바에 표시: "● Ollama: 3 models" / "○ Ollama: 미실행"
```

**응답 예시**
```jsonc
{
  "available": true,
  "host": "http://localhost:11434",
  "models": [
    { "name": "llama3.1:8b",  "size_gb": 4.7, "family": "llama", "context": 131072 },
    { "name": "qwen2.5:14b",  "size_gb": 9.0, "family": "qwen2",  "context": 32768 }
  ]
}
```

### 13.2. UX 요구사항 `MUST`

* LLM 노드에서 `provider=ollama` 선택 시 `model` 필드가 **자동 조회된 실제 설치 모델 드롭다운**으로 바뀐다. (자유 텍스트 입력 강요 금지)
* Ollama 미실행 상태에서 선택 시 → 인라인 안내: 설치 링크 + `ollama serve` + `ollama pull llama3.1` 명령어 복사 버튼
* 상태바 Ollama 인디케이터 클릭 → 즉시 재탐지
* 🆕 **함수 호출(tool calling) 경고:** 많은 소형 로컬 모델은 tool use가 불안정하다. Ollama 모델을 툴이 연결된 에이전트에 물릴 경우 노란 경고 뱃지 `AC-W701` 표시. (사용자가 "왜 툴을 안 쓰지?" 로 헤매는 걸 예방)

### 13.3. 원격 Ollama

`OLLAMA_HOST` env로 원격 주소 지정 가능. UI 설정에서도 변경 가능하며 LocalStorage에 저장한다.

---

## 💾 14. 영속성 (Persistence) 🆕

### 14.1. LocalStorage 키 스펙

| 키 | 내용 | 비고 |
|---|---|---|
| `agentcanvas.workspace.v1` | 열려 있는 캔버스 문서 (CanvasDoc) | 자동 저장 |
| `agentcanvas.projects.v1` | 저장된 캔버스 목록 `{id, name, updated_at, doc}` | 최대 50개 |
| `agentcanvas.secrets.v1` | API 키 (사용자 동의 시에만) | §12 |
| `agentcanvas.settings.v1` | 테마/패널 상태/Ollama 호스트/언어 | |
| `agentcanvas.inputs.v1` | 캔버스별 마지막 실행 입력값 | 프리필용 |
| `agentcanvas.onboarding.v1` | 온보딩 완료 플래그 | |

### 14.2. 자동 저장 정책 `MUST`

* 그래프 변경 후 **1초 디바운스** 저장
* 저장 시각을 헤더에 `저장됨 · 방금 전` 형태로 표시
* `QuotaExceededError` 처리: 가장 오래된 프로젝트부터 정리 제안 모달. **조용히 실패하지 말 것** `MUST`
* 저장 실패 시 우측 상단 붉은 인디케이터 + "파일로 내보내기" 유도

### 14.3. Import / Export `MUST`

* **Export:** `{slug}.acanvas.json` 다운로드. Secret Scanner 통과 필수(§7.4).
* **Import:** 파일 선택 + **캔버스에 드래그&드롭**. 스키마 검증 → 마이그레이션 → 로드.
* Import 시 `meta.requires_keys` 를 읽어 **부족한 키 목록 모달**을 먼저 띄운다.
* 🆕 **URL 공유 (`SHOULD`):** 그래프를 gzip+base64url 하여 `#` 프래그먼트에 담는 공유 링크. (서버 없이 공유 = 바이럴 핵심)
  * 3KB 초과 시 링크 대신 파일 다운로드로 폴백.
  * `#` 프래그먼트는 서버로 전송되지 않으므로 프라이버시 안전.

### 14.4. 🆕 선택적 서버 영속화 (Self-host 옵션)

`PERSISTENCE_MODE=none|sqlite` env. 기본 `none`(PRD의 Zero Cost DB 철학 준수).
`sqlite` 모드에서만 `/api/v1/projects` CRUD가 활성화된다. **인터페이스만 미리 분리**해두고 v1.0은 `none` 고정.

---

## 🗂️ 15. 템플릿 갤러리 & 바이럴 루프 🆕

### 15.1. 내장 템플릿 (v1.0 필수 5종) `MUST`

| # | 이름 | 난이도 | 노드 수 | 필요 키 | 설명 |
|---|---|---|---|---|---|
| 1 | **Hello Crew** | ⭐ | 4 | OpenAI 또는 Ollama | 에이전트 1 + 태스크 1. 3분 안에 첫 성공 경험 |
| 2 | **SEO 블로그 작성팀** | ⭐⭐ | 9 | OpenAI + Serper | 리서처 → 작가 → 편집자 (순차) |
| 3 | **시장 조사 리포트** | ⭐⭐ | 11 | OpenAI + Serper | 병렬 리서치 3인 → 애널리스트 종합 |
| 4 | **YouTube 대본 파이프라인** | ⭐⭐ | 10 | OpenAI | 기획 → 대본 → 훅 최적화 |
| 5 | **로컬 전용 요약봇** | ⭐ | 5 | **없음 (Ollama)** | 완전 무료 오프라인 데모. 진입장벽 0 |

각 템플릿은 `backend/app/data/templates/*.acanvas.json` 에 저장, `GET /api/v1/templates` 로 서빙. 프론트에도 번들해 **백엔드 없이도 열람 가능**하게 한다. `MUST`

### 15.2. 템플릿 갤러리 UX

* 헤더 `Templates` → 모달 그리드. 카드에 썸네일/난이도/필요 키/예상 비용 표시
* `Preview` — 읽기 전용 캔버스 미리보기 / `Use this` — 새 탭으로 로드
* 필요한 키가 없으면 카드에 자물쇠 배지 + "Ollama로 대체 실행" 옵션 제시 `SHOULD`

### 15.3. 바이럴 루프 설계

```text
사용자가 멋진 Crew 제작
   → [Export] 로 .acanvas.json 또는 공유 링크 생성
      → 트위터/디스코드/GitHub 에 투척
         → 받은 사람이 드래그&드롭으로 즉시 로드 (설치 필요 없음, 링크면 웹앱에서 바로)
            → "이거 뭐야?" → 리포지토리 방문 → ⭐
               → 자기 Crew 제작 → (반복)
```

**증폭 장치**
* `README.md` 최상단에 **실행 화면 GIF** (파티클 애니메이션이 흐르는 장면 — 이게 스타를 만든다) `MUST`
* 커뮤니티 템플릿 리포지토리 `agentcanvas-templates` 분리 + PR 기반 큐레이션
* 헤더에 GitHub Star 버튼 상시 노출
* `</> Export to Python` (§8.5) — 엔지니어 커뮤니티에서 강력한 공유 소재

---

## 📁 16. 코드베이스 구조 🆕

### 16.1. 모노레포 트리

```text
agentcanvas/
├── README.md
├── LICENSE                          # AGPL-3.0 (또는 MIT) — §2.5
├── docker-compose.yml               # 원클릭 실행
├── .env.example
├── design/                          # 🔒 §1 디자인 락
│   ├── reference/artifact-source.tsx   # 아티팩트 원본 (읽기 전용)
│   ├── tokens.ts                       # 추출된 디자인 토큰
│   └── DESIGN_AUDIT.md                 # 매핑표 + 확장 토큰 기록
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx              # 캔버스 (client)
│   │   │   └── globals.css
│   │   ├── canvas/
│   │   │   ├── Canvas.tsx            # ReactFlow 루트
│   │   │   ├── ContextMenu.tsx       # §3.4.1
│   │   │   ├── AutoConnectPopup.tsx  # §3.4.4
│   │   │   ├── ParticleEdge.tsx      # §3.4.3
│   │   │   ├── MiniMapPanel.tsx
│   │   │   └── autoLayout.ts         # dagre
│   │   ├── nodes/
│   │   │   ├── registry.ts           # ⭐ 노드 정의 단일 진실
│   │   │   ├── BaseNode.tsx          # 헤더/소켓/상태링 공통 셸
│   │   │   ├── fields/               # Input, Textarea, Select, Slider, Toggle...
│   │   │   ├── LLMNode.tsx
│   │   │   ├── AgentNode.tsx
│   │   │   ├── TaskNode.tsx
│   │   │   ├── ToolNode.tsx
│   │   │   ├── CrewNode.tsx
│   │   │   ├── InputNode.tsx
│   │   │   ├── OutputNode.tsx
│   │   │   ├── KnowledgeNode.tsx
│   │   │   ├── MemoryNode.tsx
│   │   │   ├── HumanNode.tsx
│   │   │   ├── NoteNode.tsx
│   │   │   └── GroupNode.tsx
│   │   ├── ports/
│   │   │   ├── types.ts              # PortType 정의
│   │   │   ├── matrix.ts             # §6.2 연결 규칙
│   │   │   └── Socket.tsx
│   │   ├── store/
│   │   │   ├── index.ts              # Zustand 루트
│   │   │   ├── graphSlice.ts
│   │   │   ├── runSlice.ts
│   │   │   ├── secretsSlice.ts
│   │   │   ├── uiSlice.ts
│   │   │   └── history.ts            # zundo undo/redo
│   │   ├── run/
│   │   │   ├── client.ts             # POST /runs
│   │   │   ├── sse.ts                # fetch 기반 SSE 파서 (§4.3 주의)
│   │   │   └── eventHandlers.ts      # 이벤트 → 스토어 반영 (§10.3)
│   │   ├── validation/
│   │   │   ├── rules.ts              # 프론트 검증 (백엔드와 동일 규칙)
│   │   │   └── issues.ts             # 에러 코드 → 한글 메시지
│   │   ├── persistence/
│   │   │   ├── localStorage.ts
│   │   │   ├── fileIO.ts             # import/export
│   │   │   ├── secretScanner.ts      # §7.4
│   │   │   ├── shareLink.ts          # gzip + base64url
│   │   │   └── migrations.ts
│   │   ├── panels/
│   │   │   ├── Header.tsx
│   │   │   ├── NodeLibrary.tsx
│   │   │   ├── LogPanel.tsx
│   │   │   ├── InspectorPanel.tsx
│   │   │   ├── RunParamsModal.tsx
│   │   │   ├── SettingsModal.tsx
│   │   │   ├── TemplateGallery.tsx
│   │   │   ├── ExportCodeModal.tsx
│   │   │   ├── CommandPalette.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── i18n/  (ko.json, en.json)
│   │   └── lib/ (cn.ts, ulid.ts, format.ts, hotkeys.ts)
│   ├── tailwind.config.ts            # 토큰은 design/tokens.ts 참조
│   └── package.json
│
└── backend/
    ├── app/
    │   ├── main.py                   # FastAPI 앱 + CORS + 미들웨어
    │   ├── config.py                 # pydantic-settings
    │   ├── routers/
    │   │   ├── health.py
    │   │   ├── providers.py
    │   │   ├── tools.py
    │   │   ├── ollama.py
    │   │   ├── runs.py               # POST /runs, SSE, cancel, human
    │   │   ├── export.py
    │   │   ├── uploads.py
    │   │   └── templates.py
    │   ├── schemas/                  # pydantic: graph.py, run.py, events.py, errors.py
    │   ├── compiler/
    │   │   ├── compiler.py           # §8.2
    │   │   ├── graph.py              # 인접 리스트 · 조회 헬퍼
    │   │   ├── validators.py         # 구조/의미 검증
    │   │   ├── topology.py           # 위상 정렬 · 사이클 검출
    │   │   └── interpolate.py        # {var} 처리
    │   ├── runtime/
    │   │   ├── manager.py            # RunManager (동시성/GC/취소)
    │   │   ├── bridge.py             # §10.4 EventBridge
    │   │   ├── callbacks.py          # step/task callback → 이벤트
    │   │   └── cost.py               # 토큰 → USD 추정
    │   ├── adapters/
    │   │   ├── llm.py                # provider → litellm 문자열
    │   │   └── ollama.py
    │   ├── tools/
    │   │   ├── registry.py           # 툴 ID → 클래스 + JSON Schema
    │   │   └── custom_http.py
    │   ├── core/
    │   │   ├── crewai_compat.py      # ⭐ CrewAI 버전 호환 레이어
    │   │   ├── secrets.py            # SecretBundle
    │   │   ├── logging.py            # structlog + 마스킹
    │   │   ├── security.py           # SSRF/경로 가드
    │   │   └── errors.py             # AC-Exxx 정의
    │   ├── export/python_renderer.py # Jinja2 → crew.py
    │   └── data/
    │       ├── model_presets.json
    │       └── templates/*.acanvas.json
    ├── tests/
    ├── requirements.txt              # == 핀 고정
    └── Dockerfile
```

### 16.2. Zustand 스토어 설계

```ts
interface AppState {
  // graphSlice
  nodes: AcNode[]; edges: AcEdge[]; viewport: Viewport;
  addNode(type: NodeType, pos: XYPosition): string;
  updateNodeData(id: string, patch: Record<string, unknown>): void;
  connect(conn: Connection): void;        // 포트 매트릭스 검증 후 커밋
  deleteSelection(): void;
  duplicateNode(id: string): void;
  toggleBypass(id: string): void;

  // runSlice
  runId: string | null;
  runStatus: 'idle'|'queued'|'running'|'succeeded'|'failed'|'cancelled';
  nodeStates: Record<string, NodeRunState>;   // node_id → {status, output, usage, error}
  events: RunEvent[];                          // 최대 2000개 링버퍼
  activeEdges: Set<string>;
  usage: { prompt: number; completion: number; costUsd: number };
  start(inputs: Record<string, string>): Promise<void>;
  cancel(): Promise<void>;
  applyEvent(e: RunEvent): void;               // §10.3

  // secretsSlice
  secrets: Record<string, string>;
  persistSecrets: boolean;
  setSecret(k: string, v: string): void;
  clearSecrets(): void;

  // uiSlice
  leftPanelOpen: boolean; rightPanelOpen: boolean; rightTab: 'stream'|'inspector'|'raw';
  contextMenu: ContextMenuState | null;
  modal: ModalState | null;
  toasts: Toast[];
  issues: ValidationIssue[];
}
```

**성능 규칙** `MUST`
* 노드 컴포넌트는 전부 `React.memo`. 셀렉터는 **원자적으로** 구독한다. (`useStore(s => s.nodeStates[id])`)
* 실행 중 이벤트가 초당 수십 개 들어오므로 `applyEvent` 는 **50ms 배치 플러시**로 묶어 반영한다.
* `events` 배열 전체를 구독하는 컴포넌트는 로그 패널 **하나뿐**이어야 한다. (가상 스크롤 적용)

---

## ✅ 17. 품질 요구사항 🆕

### 17.1. 성능 예산 `MUST`

| 지표 | 목표 |
|---|---|
| 초기 로드 (LCP) | < 2.0s |
| 노드 50개 캔버스 패닝/줌 | 60fps 유지 |
| 노드 300개 | 30fps 이상 (파티클 자동 비활성화) |
| 노드 추가 → 렌더 | < 16ms |
| SSE 이벤트 반영 지연 | < 100ms |
| 자동 저장 | 메인 스레드 블로킹 < 8ms |

### 17.2. 접근성 (a11y) `SHOULD`

* 모든 인터랙티브 요소 키보드 도달 가능. 캔버스는 `Tab` 으로 노드 순회 + 화살표로 이동.
* 모달은 포커스 트랩 + `Esc` 닫기.
* 상태를 색으로만 전달하지 않는다 → 아이콘/텍스트 병행 (색약 대응) `MUST`
* 다크 배경 대비 본문 텍스트 대비율 4.5:1 이상.
* `prefers-reduced-motion` 존중 (§3.4.3).

### 17.3. 국제화 (i18n) `SHOULD`

* `ko` / `en` 2개 언어. 기본은 브라우저 로케일 감지, 설정에서 변경.
* **UI 문자열은 전부 `i18n/*.json` 경유.** 컴포넌트에 한글 하드코딩 금지.
* 에러 메시지는 코드(`AC-Exxx`) 기반 매핑이므로 자동으로 다국어 지원됨.
* 노드 라벨과 에러 메시지 우선. 문서/템플릿 설명은 후순위.

### 17.4. 에러 UX 원칙 `MUST`

1. **모든 에러는 코드를 갖는다.** (§22.1)
2. **모든 에러는 노드를 가리킨다.** (`node_id` 있으면 카메라 이동 + 하이라이팅)
3. **모든 에러는 다음 행동을 제안한다.** (`hint` 필드 필수)
4. 스택 트레이스를 사용자에게 그대로 던지지 않는다. "자세히" 를 눌렀을 때만 접이식으로 표시.
5. 여러 검증 에러는 **한 번에 전부** 보여준다.

---

## 🧪 18. 테스트 전략 🆕

| 레이어 | 도구 | 필수 커버리지 |
|---|---|---|
| **컴파일러 (백엔드)** | pytest | 골든 픽스처: `graph.json` → 예상 CrewAI 구조 스냅샷. **최소 20 케이스** (정상 5 + 에러 15) |
| **검증기** | pytest | 모든 `AC-Exxx` 에러 코드마다 **최소 1개 트리거 테스트** `MUST` |
| **위상 정렬** | pytest | 선형/분기/병합/사이클/고아 노드/동순위 정렬 |
| **API** | pytest + httpx | 202 응답, 422 에러 배열, SSE 스트림 형태, 취소 |
| **SSE 브릿지** | pytest-asyncio | 순서 보장, replay, 하트비트, 소비자 이탈 시 누수 없음 |
| **보안** | pytest | 키 마스킹, SSRF 차단, 경로 탈출 차단, 시크릿 스캐너 |
| **포트 매트릭스 (프론트)** | Vitest | §6.2 표 전 셀을 테이블 드리븐 테스트로 검증 `MUST` |
| **마이그레이션** | Vitest | 버전별 픽스처 → 최신 스키마 변환 |
| **스토어** | Vitest | undo/redo, 이벤트 배치 반영, 카디널리티 자동 교체 |
| **E2E** | Playwright | 아래 시나리오 |

**E2E 필수 시나리오** `MUST`
1. 빈 캔버스 → 우클릭 → Agent 추가 → 필드 입력 → 저장 → 새로고침 → 복원 확인
2. 템플릿 "Hello Crew" 로드 → 키 입력 → 실행 → SSE 이벤트로 노드 링 변화 → 결과 출력 확인 (백엔드 모킹)
3. 비호환 소켓 연결 시도 → 차단 확인
4. `context` 사이클 연결 시도 → 차단 + 토스트 확인
5. Export → 파일 다운로드 → Import → 그래프 동일성 검증 (라운드트립)
6. 키가 포함된 그래프 Export 시도 → 스캐너 차단 확인
7. 실행 중 Stop → `cancelled` 상태 전이 확인

---

## 🚀 19. 배포 & 실행 🆕

### 19.1. 로컬 원클릭 `MUST`

```bash
git clone https://github.com/<org>/agentcanvas
cd agentcanvas
cp .env.example .env
docker compose up
# → http://localhost:3000
```

```yaml
# docker-compose.yml (요지)
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      - ALLOWED_ORIGINS=http://localhost:3000
      - OLLAMA_HOST=http://host.docker.internal:11434
      - MAX_CONCURRENT_RUNS=3
      - WORKSPACE_DIR=/workspace
    volumes: ["./workspace:/workspace"]
    extra_hosts: ["host.docker.internal:host-gateway"]   # 리눅스에서 호스트 Ollama 접근
  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    environment: [NEXT_PUBLIC_API_BASE=http://localhost:8000]
    depends_on: [backend]
```

> ⚠️ 컨테이너 안에서 호스트의 Ollama(`localhost:11434`)에 접근하려면 `host.docker.internal` 이 필요하다. 리눅스는 `extra_hosts` 설정 필수. 이 함정으로 이슈가 대량 발생하므로 **README에 명시** `MUST`

### 19.2. 클라우드 배포 (공개 데모용) `SHOULD`

* Frontend → **Vercel** (무료 티어)
* Backend → **Render / Fly.io / Railway** — ⚠️ **SSE 지원 및 응답 버퍼링 없음**을 반드시 확인. 서버리스(Lambda류)는 장시간 스트리밍에 부적합.
* 공개 데모에는 Rate limit + `MAX_CONCURRENT_RUNS` 축소 + `code_interpreter` 비활성 필수.

### 19.3. 환경변수 목록

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS 화이트리스트 |
| `OLLAMA_HOST` | `http://localhost:11434` | |
| `MAX_CONCURRENT_RUNS` | `3` | |
| `RUN_TTL_SECONDS` | `1800` | 완료 런 보존 시간 |
| `MAX_RUN_DURATION_S` | `900` | 런 강제 타임아웃 |
| `WORKSPACE_DIR` | `./workspace` | 파일 툴 루트 (탈출 차단) |
| `ENABLE_CODE_INTERPRETER` | `false` | |
| `PERSISTENCE_MODE` | `none` | `none` \| `sqlite` |
| `LOG_LEVEL` | `INFO` | |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8000` | 프론트 |

---

## 🗺️ 20. 개발 로드맵 & 마일스톤 🆕

> 각 마일스톤은 **동작하는 제품**으로 끝난다. "백엔드만 완성" 같은 마일스톤은 두지 않는다.

### M0 — Design Port & Dependency Recon (1~2일) 🔒
**목표: 아티팩트 디자인을 코드로 이식하고 토큰을 확정한다 + CrewAI 실제 API를 검증한다.**
- [ ] `design/reference/artifact-source.tsx`(또는 `.html`) 원본 보관
- [ ] `design/tokens.ts` + `tailwind.config.ts` 추출 완료
- [ ] `DESIGN_AUDIT.md` 매핑표 작성
- [ ] 레이아웃 셸(헤더/사이드바/캔버스/우패널/상태바) 정적 렌더
- [ ] 🆕 §4.3 절차대로 CrewAI 최신 안정 버전 확인 → 설치 → `Agent`/`Task`/`Crew`/`LLM` 실제 시그니처 및 콜백 페이로드 확인 → `requirements.txt` 에 `==` 고정
- [ ] 🆕 `crewAI-examples` 클론 → `/reference/crewai-examples`(gitignore)
- ✅ **DoD:** 아티팩트와 나란히 놓고 픽셀 대조 통과 (§1.5) + CrewAI 버전이 고정되고 실제 생성자 시그니처가 문서화됨

### M1 — Canvas Core (3~5일)
- [ ] React Flow v12 마운트, 도트 그리드, 베지어 엣지
- [ ] 노드 레지스트리 + `BaseNode` 셸 + 필드 컴포넌트
- [ ] LLM / Agent / Task / Tool / Crew 5종 구현
- [ ] 포트 타입 시스템 + 연결 매트릭스 + 카디널리티 (§6)
- [ ] 우클릭 컨텍스트 메뉴 + 검색
- [ ] Undo/Redo, 복제, 삭제, 다중 선택
- [ ] LocalStorage 자동 저장 + Import/Export
- ✅ **DoD:** 백엔드 없이 §7.6 예시 그래프를 손으로 만들고, 저장→새로고침→복원, Export→Import 라운드트립 성공

### M2 — Execution (4~6일)
- [ ] FastAPI 스캐폴딩 + 스키마 + 에러 포맷
- [ ] Canvas Compiler (§8) + 검증기 + 위상 정렬
- [ ] Run Manager + EventBridge + SSE 엔드포인트
- [ ] CrewAI 콜백 → 이벤트 매핑, 노드 역매핑 (§10.5)
- [ ] 프론트 SSE 클라이언트 + 이벤트 → 스토어 반영
- [ ] 노드 상태 링 + 로그 패널 스트림
- [ ] BYOK 키 UI + 헤더 전송 + 마스킹 (§12)
- ✅ **DoD:** OpenAI 키로 2에이전트 3태스크 크루가 끝까지 실행되고, 실행 순서대로 노드가 빛난다

### M3 — Polish & Delight (3~5일)
- [ ] 파티클 애니메이션 + 성능 가드
- [ ] Smart Auto-Connect
- [ ] Hover Preview
- [ ] Input/Output 노드 + 실행 파라미터 모달
- [ ] Ollama 자동 감지 + 모델 드롭다운
- [ ] 미니맵, Auto Layout, Collapse, Bypass
- [ ] 검증 오버레이 + 에러 → 노드 포커스
- [ ] 취소, 진행률, 비용 카운터
- ✅ **DoD:** 신규 사용자가 문서 없이 템플릿 실행까지 3분 내 도달 (실제 사용자 3명 관찰)

### M4 — Open Source Launch (2~4일)
- [ ] 템플릿 5종 + 갤러리
- [ ] Export to Python
- [ ] 공유 링크
- [ ] i18n (ko/en)
- [ ] Docker Compose 원클릭 + README(GIF 포함) + LICENSE + CONTRIBUTING
- [ ] E2E 테스트 7종 + CI 파이프라인
- [ ] 에러 코드 문서 페이지
- ✅ **DoD:** 깨끗한 머신에서 `docker compose up` → 로컬 Ollama 템플릿 실행 성공. 퍼블릭 리포 공개.

### v1.1 이후 (백로그)
Router / Guardrail 노드, CrewAI Flow 지원, 커뮤니티 템플릿 허브, 실행 히스토리 뷰어, 노드별 프롬프트 A/B 비교, 멀티유저 협업(CRDT), 스케줄 실행, LangGraph 어댑터.

---

## 🎯 21. 최종 수용 기준 (Acceptance Criteria)

릴리즈 판정 체크리스트. 하나라도 실패하면 릴리즈하지 않는다.

**디자인**
- [ ] AC-D1: 아티팩트와 시각적으로 구분 불가 (§1.5)
- [ ] AC-D2: 컴포넌트 파일 내 하드코딩 HEX 0개
- [ ] AC-D3: 확장 토큰 5개 이하, 전부 문서화

**기능**
- [ ] AC-F1: 우클릭으로 모든 노드 타입 추가 가능
- [ ] AC-F2: 비호환 소켓 연결이 물리적으로 불가능
- [ ] AC-F3: `context` 사이클 생성이 차단됨
- [ ] AC-F4: 실행 중 노드가 실행 순서대로 glow
- [ ] AC-F5: 실행 중 활성 엣지에 파티클이 흐름
- [ ] AC-F6: 실행 완료 후 Output 노드에 결과 렌더링
- [ ] AC-F7: Export→Import 라운드트립이 그래프를 100% 보존
- [ ] AC-F8: Ollama 실행 중이면 모델 목록이 자동으로 뜸
- [ ] AC-F9: 템플릿 5종이 전부 실행 성공
- [ ] AC-F10: Stop 버튼으로 실행이 중단됨

**신뢰성 / 보안**
- [ ] AC-S1: API 키가 `.acanvas.json` 에 절대 포함되지 않음 (스캐너 통과)
- [ ] AC-S2: 서버 로그 전체 grep 시 키 원문 0건
- [ ] AC-S3: 사설 IP 스크래핑 차단됨
- [ ] AC-S4: `WORKSPACE_DIR` 밖 파일 읽기 차단됨
- [ ] AC-S5: 백엔드 다운 상태에서도 편집·저장·Export 정상 동작
- [ ] AC-S6: SSE 재연결 시 이벤트 누락 없음

**성능**
- [ ] AC-P1: 노드 50개에서 60fps
- [ ] AC-P2: 초기 로드 2초 이내

**문서**
- [ ] AC-X1: README만 보고 처음 사용자가 실행 성공
- [ ] AC-X2: 모든 에러 코드에 문서 항목 존재

---

## 📎 22. 부록

### 22.1. 에러 코드 표 `MUST`

**E1xx — 그래프 구조**
| 코드 | 심각도 | 메시지 | 힌트 |
|---|---|---|---|
| `AC-E101` | error | Crew 노드가 없습니다 | 우클릭 → Flow → Crew 추가 |
| `AC-E102` | error | Crew 노드가 2개 이상입니다 | 하나만 남기세요 |
| `AC-E103` | error | hierarchical 프로세스에는 Manager LLM이 필요합니다 | Crew의 manager 소켓에 LLM 연결 |
| `AC-W104` | warn | Crew에 연결되지 않은 노드가 있습니다 | 실행에서 제외됩니다 |
| `AC-E105` | error | 순환 의존이 감지되었습니다 | Task context 연결을 확인하세요 |
| `AC-E106` | error | 호환되지 않는 포트 연결입니다 | §6.2 매트릭스 참조 |
| `AC-E107` | error | Crew에 Task가 없습니다 | 최소 1개의 Task 연결 필요 |

**E2xx — 노드 설정**
| 코드 | 심각도 | 메시지 |
|---|---|---|
| `AC-E201` | error | 필수 필드가 비어 있습니다 (`role`/`goal`/`backstory`) |
| `AC-E202` | error | Task에 Agent가 연결되지 않았습니다 |
| `AC-W203` | warn | Agent에 연결된 Task가 없습니다 |
| `AC-E204` | error | Task의 `description` 또는 `expected_output` 이 비어 있습니다 |
| `AC-E205` | error | 알 수 없는 tool_id 입니다 |
| `AC-E206` | error | 툴 설정이 스키마와 맞지 않습니다 |

**E3xx — 변수/보간**
| 코드 | 심각도 | 메시지 |
|---|---|---|
| `AC-W301` | warn | 정의되지 않은 변수 `{x}` 를 참조합니다 |
| `AC-E302` | error | 필수 입력값이 제공되지 않았습니다 |
| `AC-E303` | error | 잘못된 변수명 형식입니다 |

**E4xx — 파일/스키마**
| 코드 | 심각도 | 메시지 |
|---|---|---|
| `AC-E401` | error | 지원하지 않는 스키마 버전입니다 |
| `AC-E402` | error | 더 최신 버전에서 만든 파일입니다 |
| `AC-E403` | error | 파일이 손상되었거나 형식이 올바르지 않습니다 |
| `AC-E404` | error | 파일에 API 키로 보이는 값이 포함되어 있습니다 (Export 차단) |
| `AC-E405` | error | LocalStorage 용량이 부족합니다 |

**E5xx — 실행/런타임**
| 코드 | 심각도 | 메시지 |
|---|---|---|
| `AC-E501` | error | 실행 중 오류가 발생했습니다 |
| `AC-E502` | error | 최대 실행 시간을 초과했습니다 |
| `AC-E503` | error | 동시 실행 한도를 초과했습니다 |
| `AC-E504` | error | 백엔드에 연결할 수 없습니다 |
| `AC-E505` | error | 실행이 취소되었습니다 |

**E6xx — 프로바이더/키**
| 코드 | 심각도 | 메시지 |
|---|---|---|
| `AC-E601` | error | API 키가 유효하지 않습니다 (401/403) |
| `AC-E602` | error | 필요한 API 키가 설정되지 않았습니다 |
| `AC-E603` | error | 요청 한도(rate limit)에 도달했습니다 |
| `AC-E604` | error | 모델을 찾을 수 없습니다 |

**E7xx — Ollama/로컬**
| 코드 | 심각도 | 메시지 |
|---|---|---|
| `AC-E701` | error | Ollama 서버에 연결할 수 없습니다 |
| `AC-W701` | warn | 이 로컬 모델은 툴 호출이 불안정할 수 있습니다 |
| `AC-E702` | error | 선택한 모델이 설치되어 있지 않습니다 |

**E8xx — 보안**
| 코드 | 심각도 | 메시지 |
|---|---|---|
| `AC-E801` | error | 내부 네트워크 주소 접근이 차단되었습니다 |
| `AC-E802` | error | 작업 디렉터리 밖의 파일에 접근할 수 없습니다 |
| `AC-E803` | error | 코드 실행 도구가 비활성화되어 있습니다 |

### 22.2. 키보드 단축키 (ComfyUI 컨벤션) `MUST`

| 키 | 동작 |
|---|---|
| `우클릭` | 노드 추가 메뉴 |
| `Ctrl+K` | 커맨드 팔레트 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 실행 취소 / 재실행 |
| `Ctrl+C` / `Ctrl+V` | 복사 / 붙여넣기 |
| `Ctrl+D` | 선택 노드 복제 |
| `Delete` / `Backspace` | 삭제 |
| `Ctrl+A` | 전체 선택 |
| `Ctrl+G` | 그룹 생성 |
| `Ctrl+B` | Bypass 토글 |
| `Ctrl+L` | 자동 정렬 |
| `Ctrl+S` | 저장 (Export) |
| `Ctrl+O` | 열기 (Import) |
| `Ctrl+Enter` | Queue Prompt (실행) |
| `Esc` | 실행 중단 / 메뉴 닫기 |
| `Space + 드래그` | 캔버스 패닝 |
| `F` | 선택 노드로 카메라 맞춤 |
| `Shift+F` | 전체 그래프 맞춤 |
| `1` ~ `9` | 노드 라이브러리 카테고리 전환 |

### 22.3. 용어집

| 용어 | 정의 |
|---|---|
| **Canvas** | 노드와 엣지로 구성된 편집 화면 및 그 문서(`.acanvas.json`) |
| **Node** | 캔버스의 블록. LLM/Agent/Task/Tool/Crew 등 |
| **Edge / Wire** | 노드 간 연결선 |
| **Port / Socket / Handle** | 노드의 연결 지점. 타입을 가짐 |
| **Compile** | 캔버스 JSON을 CrewAI 파이썬 객체로 변환하는 과정 |
| **Run** | 컴파일된 크루의 1회 실행. `run_id` 로 식별 |
| **Bypass** | 노드를 실행에서 제외 (삭제하지 않고) |
| **BYOK** | Bring Your Own Key. 사용자가 자기 API 키를 씀 |
| **Queue Prompt** | 실행 버튼 명칭 (ComfyUI 오마주) |
| **SSoT** | Single Source of Truth. 여기서는 디자인=아티팩트, 노드정의=Registry |

### 22.4. 참고 링크

* CrewAI 문서: https://docs.crewai.com
* React Flow v12: https://reactflow.dev
* Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
* LiteLLM 프로바이더: https://docs.litellm.ai/docs/providers

---

## 🤖 23. Claude Code 작업 지시 (Kickoff Prompt)

> 아래를 그대로 Claude Code에 전달하면 착수 가능하다.

```text
AgentCanvas를 구현한다. 본 문서(Master Build Spec v3.0)가 유일한 구현 기준이다.

[절대 규칙]
1. 디자인은 첨부 아티팩트를 100% 복제한다. 창작하지 않는다. (§1)
   → 코드 작성 전에 반드시 §1.2 절차(토큰 추출, DESIGN_AUDIT.md 작성)를 먼저 끝낸다.
2. 노드 정의는 frontend/src/nodes/registry.ts 한 곳에서만 선언한다. 중복 선언 금지.
3. 포트 연결은 §6.2 매트릭스를 코드로 강제한다. 자유 연결 허용 금지.
4. API 키는 헤더로만 전송하고, 그래프/로그/디스크 어디에도 남기지 않는다. (§12)
5. CrewAI API 접근은 backend/app/core/crewai_compat.py 를 통해서만 한다.
   → 이 파일을 작성하기 전에 반드시 §4.3 절차대로 실제 설치된 CrewAI 버전의 소스를 읽어 시그니처를 확인한다.
   학습 데이터 기반 추정 코드를 그대로 쓰지 않는다. (CrewAI는 릴리즈가 매우 잦다 — 2026-08-28 기준 최신 1.15.18)
6. 모든 에러는 AC-Exxx 코드 + node_id + hint 를 갖는다. (§9.1, §22.1)

[진행 방식]
- M0 → M1 → M2 → M3 → M4 순서로 진행한다. (§20)
- 각 마일스톤의 DoD를 충족하기 전에 다음으로 넘어가지 않는다.
- 마일스톤마다 실행 가능한 상태를 유지한다.
- 각 단계 끝에서 §21의 해당 수용 기준을 스스로 점검하고 보고한다.

[먼저 물어볼 것]
- 라이선스를 AGPL-3.0 / MIT 중 무엇으로 확정할지 (§2.5)
- 아티팩트 소스 코드 전문 (design/reference/ 에 보관해야 함)

M0부터 시작하라.
```

---

## 📋 부록 A. PRD v2.0 원문 대조표

본 문서가 PRD의 어느 항목을 어떻게 계승·확장했는지 추적표.

| PRD v2.0 항목 | 본 문서 위치 | 처리 |
|---|---|---|
| 1.1 해결할 문제 | §2.2 | 계승 + 2개 문제 추가 |
| 1.2 해결책 | §2.3 | 계승 + 파일 포맷/SSE 추가 |
| 1.3 무상 배포 전략 | §2.5 | 계승 + 라이선스 권고 구체화 |
| 2.1 비주얼 테마 | §3.1 | 계승 (단, §1 아티팩트가 우선) |
| 2.2.1 우클릭 메뉴 | §3.4.1 | 계승 + 카테고리/검색/노드메뉴 상세화 |
| 2.2.2 노드 글로우 | §3.4.2 + §3.3 | 계승 + 상태별 컬러 체계 |
| 2.2.3 와이어 파티클 | §3.4.3 | 계승 + 성능 가드 + reduced-motion |
| 2.2.4 스마트 오토커넥트 | §3.4.4 | 계승 + 포트 타입 기반 필터링 |
| 2.2.5 노드 호버 프리뷰 | §3.4.5 | 계승 + 표시 내용 구체화 |
| 3. 아키텍처 | §4.1 / §4.2 | 계승 + 구현 상세 확장 |
| Canvas Topology Parser | §8 | 6단계 파이프라인으로 확장 |
| CrewAI Execution Core | §10.4 / §11 | 스레드 브릿지 + 상태 머신으로 확장 |

**본 문서에서 신규 추가된 시스템 (🆕)**
1. 디자인 락 프로토콜 (§1)
2. 포트 타입 시스템 & 연결 매트릭스 (§6)
3. `.acanvas.json` 스키마 + 마이그레이션 (§7)
4. Crew / Input / Output / Knowledge / Memory / Human / Router / Guardrail / Note / Group 노드 (§5.7~5.10)
5. 컴파일 파이프라인 & 인스턴스 캐시 (§8)
6. REST API 전체 명세 + 통일 에러 포맷 (§9)
7. SSE 이벤트 카탈로그 + 브릿지 구현 + 역매핑 (§10)
8. Run 상태 머신, 동시성, 취소, Dry Run (§11)
9. BYOK 보안 모델 + 시크릿 스캐너 + SSRF/경로 가드 (§12)
10. Ollama 자동 감지 프로토콜 (§13)
11. 영속성 정책 + 공유 링크 (§14)
12. 템플릿 5종 + 바이럴 루프 설계 (§15)
13. 전체 코드베이스 트리 + Zustand 설계 (§16)
14. 성능 예산 / a11y / i18n (§17)
15. 테스트 전략 + E2E 시나리오 (§18)
16. Docker 원클릭 배포 (§19)
17. 5단계 마일스톤 + 수용 기준 (§20~21)
18. 에러 코드 체계 + 단축키 (§22)
19. Export to Python (§8.5)
20. Task 실행 순서 결정 규칙 + 순번 배지 (§5.5)

---

**문서 끝. 구현 착수 전 §1(디자인 락)을 다시 한 번 읽을 것.**
