# 최종 수용 기준 자가 점검 (Spec §21) — M4-T10

**점검일:** 2026-09-04
**대상 커밋:** M4-T9(`2e2b73e`) 시점의 트리 + 이 점검에서 나온 수정
**환경:** macOS 24.6.0 / node v22.14.0 / Python 3.12 / crewai 1.15.18 / Ollama 3 모델 설치
**판정 원칙:** 유닛테스트 통과만으로는 PASS 로 치지 않는다. 수용 기준이 **동작**을 말하면
실제로 서버를 띄우고 브라우저를 몰아 그 동작을 확인했다.

> 릴리즈 판정: **20/21 PASS, AC-F9 는 3/5 완주** — 남은 2종은 앱 결함이 아니라
> 무료 웹 검색 키(Serper) 미보유이고, 앱은 실행 전에 `AC-E602` 로 정확히 안내한다.
> 점검 중 실제 결함 **10건**을 발견해 전부 고쳤다(§2). 그중 2건은 사용자가 제공한 실제
> OpenAI 키로 AC-F9 를 시도하다 드러난 것으로, **에러 코드 3종이 실전에서 한 번도
> 발생하지 않고 있었다**(RECON F17).

---

## 1. §21 항목별 판정

### 디자인

| AC | 기준 | 판정 | 근거 |
|---|---|---|---|
| **AC-D1** | 아티팩트와 시각적으로 구분 불가 | ✅ PASS | 같은 뷰포트(1600×950)에서 아티팩트 원본과 구현 화면을 나란히 캡처해 대조. 색·타이포·radius·노드 카드·소켓 행·베지어 엣지·인스펙터 문구까지 일치. 아티팩트에 없는 화면(좌측 노드 라이브러리 / 상태바 / 미니맵 / M3·M4 모달)은 `design/DESIGN_AUDIT.md` §3 에 "기존 토큰 재조합"으로 문서화돼 있고, 이번 점검에서 **M3/M4 추가분 9행이 표에서 빠져 있던 것을 채웠다** |
| **AC-D2** | 컴포넌트 파일 내 하드코딩 HEX 0개 | ✅ PASS *(수정 후)* | 최초 grep 에서 `panels/TemplatesModal.tsx` 의 미리보기 SVG `fill="#fff"` **1건 발견** → 토큰(`fill-header-mark`)으로 교체하고 실브라우저에서 `rgba(255,255,255,0.867)` 로 렌더되는 것 확인. 재발 방지로 `frontend/src/design/noHardcodedColors.test.ts`(56개 소스 전수, 57 테스트) 신규 |
| **AC-D3** | 확장 토큰 5개 이하, 전부 문서화 | ✅ PASS | X1 `borderLight`, X2 `textFaint` — **2개**. `DESIGN_AUDIT.md` DoD 줄이 "1개"로 낡아 있어 정정 |

### 기능

| AC | 기준 | 판정 | 근거 |
|---|---|---|---|
| **AC-F1** | 우클릭으로 모든 노드 타입 추가 | ✅ PASS | 실브라우저 우클릭 → 컨텍스트 메뉴에 14종(Agent/Task/LLM/Tool/Input/Output/Knowledge/Memory/Crew/Human Input/Router/Guardrail/Note/Group) 전부. Agent 추가 후 localStorage 반영까지 확인 |
| **AC-F2** | 비호환 소켓 연결이 물리적으로 불가능 | ✅ PASS | `e2e/03-incompatible-socket.spec.ts` 5케이스(양방향 차단 + 대조군 + 카디널리티 1 교체) |
| **AC-F3** | `context` 사이클 생성 차단 | ✅ PASS | `e2e/04-context-cycle.spec.ts` 4케이스(2단계·3단계 사이클 + 대조군) |
| **AC-F4** | 실행 중 노드가 실행 순서대로 glow | ✅ PASS | **실제 Ollama 크루**(3에이전트/3태스크)를 태우고 300ms 간격 샘플링: `task_7 running`(6.0s) → `task_7 succeeded` + `task_8 running`(25.2s) → `task_8 succeeded` + `task_9 running`(41.1s), 에이전트도 `agent_4→5→6` 같은 순서. 대기 중인 태스크는 `queued` 로 구분됨 |
| **AC-F5** | 실행 중 활성 엣지에 파티클이 흐름 | ✅ PASS | 같은 실행에서 엣지 파티클 개수 0 → 3 → 5 → 6 → (종료 후) 0 |
| **AC-F6** | 실행 완료 후 Output 노드에 결과 렌더링 | ✅ PASS | `로컬 전용 요약봇` 실완주(6,469ms, $0) 후 Output 노드에 마크다운 결과가 렌더됨 |
| **AC-F7** | Export→Import 라운드트립 100% 보존 | ✅ PASS | `e2e/05-export-import-roundtrip.spec.ts` (+ 손상 JSON 거절 케이스) |
| **AC-F8** | Ollama 실행 중이면 모델 목록 자동 표시 | ✅ PASS | 상태바 `Ollama: 3 models`, 인스펙터 모델 콤보박스가 **실제 설치된 모델만** 제시(`llama3:latest · 4.7GB` 등). 미설치 모델을 고르면 즉시 `AC-E702` |
| **AC-F9** | 템플릿 5종이 전부 실행 성공 | ⚠️ **3/5** | 실제 키로 `로컬 전용 요약봇`·`Hello Crew`·`YouTube 대본` **3종 완주**(총 $0.0029). 나머지 2종은 웹 검색 키(`SERPER_API_KEY`) 미보유로 `AC-E602` **정상 거부** — 앱 결함 아님. 상세는 §3 |
| **AC-F10** | Stop 버튼으로 실행 중단 | ✅ PASS | 실행 중(3번째 태스크 진행 중) Stop → `task_9` 가 `cancelled` 로 전이, 파티클 정지, 버튼이 Queue Prompt 로 복귀. 로그가 "진행 중인 태스크가 끝나는 즉시 중단" 이라는 태스크 경계 취소 시맨틱(RECON F15)을 그대로 설명 |

### 신뢰성 / 보안

| AC | 기준 | 판정 | 근거 |
|---|---|---|---|
| **AC-S1** | API 키가 `.acanvas.json` 에 절대 미포함 | ✅ PASS | `e2e/06-secret-scanner-blocks-export.spec.ts` 3케이스(차단 → 해제 → Import 시 마스킹) |
| **AC-S2** | 서버 로그 전체 grep 시 키 원문 0건 | ✅ PASS | 카나리 키를 BYOK 로 넣고 **실제 OpenAI 401 왕복까지** 태운 뒤 서버 로그 1,079줄 grep → 원문 **0건**(마스킹형 `sk-canar****1zzz` 만 등장, 그나마 OpenAI 응답 본문). 리포 전체 파일 grep 0건, 브라우저 DOM 0건 |
| **AC-S3** | 사설 IP 스크래핑 차단 | ✅ PASS | 실서버에 4종 투입 — 클라우드 메타데이터(`169.254.169.254`), 루프백(`127.0.0.1`), 사설 대역(`192.168.0.1`), IPv6 루프백(`[::1]`) **전부 422 `AC-E801`** |
| **AC-S4** | `WORKSPACE_DIR` 밖 파일 읽기 차단 | ✅ PASS | `/etc/passwd`, `../../../../etc/hosts`, `/Users/../etc/shadow` **전부 422 `AC-E802`**. `~`/`$HOME` 은 파이썬도 라이브러리도 확장하지 않아 워크스페이스 안의 리터럴 경로로 봉쇄됨을 별도 확인(= 탈출 아님) |
| **AC-S5** | 백엔드 다운 상태에서 편집·저장·Export 정상 | ✅ PASS | 백엔드를 내린 채 노드 추가 → localStorage 반영 확인. 상태바가 `Backend Offline · 편집은 계속 가능` 을 명시. 나아가 **E2E 33종 전체가 백엔드 프로세스 없이** 통과한다(`playwright.config.ts` 는 프론트만 띄운다) |
| **AC-S6** | SSE 재연결 시 이벤트 누락 없음 | ✅ PASS | 실행 중 스트림을 **강제 절단**하고 `Last-Event-ID: 3` 으로 재연결 → seq `1..9` 수신, **누락 0 / 중복 0**, 마지막이 `run.completed` |

### 성능

| AC | 기준 | 판정 | 근거 |
|---|---|---|---|
| **AC-P1** | 노드 50개에서 60fps | ✅ PASS | **프로덕션 빌드**(50노드/70엣지)에서 2초 연속 팬·줌 부하: 평균 **120.2fps**, 최악 프레임 **13.3ms**(≈75fps). 뷰포트 transform 이 실제로 변했음을 함께 확인(빈 루프 측정 방지) |
| **AC-P2** | 초기 로드 2초 이내 | ✅ PASS | 프로덕션 빌드 FCP **52ms** / load **69ms**. 50노드 문서를 복원한 상태에서도 FCP 56ms / load 35ms. First Load JS 316kB |

### 문서

| AC | 기준 | 판정 | 근거 |
|---|---|---|---|
| **AC-X1** | README 만 보고 처음 사용자가 실행 성공 | ✅ PASS | 두 경로 모두 실검증 — `docker compose up`(M4-T6 에서 컨테이너 안 실완주) / from-source(이 점검 세션이 README 의 명령 그대로 백엔드를 띄워 사용). 전제조건(Node 18.18+ / Python 3.12)이 빠져 있어 보완. 신규 사용자 도달 시간은 M3 DoD 에서 14.9초로 실측됨 |
| **AC-X2** | 모든 에러 코드에 문서 항목 존재 | ✅ PASS *(수정 후)* | 소스가 실제로 내보내는 코드와 문서를 대조해 **`AC-E001`/`AC-E500` 누락 발견** — 두 코드는 사용자에게 `docs_url` 앵커까지 내려보내면서 문서에 항목이 없어 **링크가 깨져 있었다**. `TRANSPORT_ERRORS` + 생성기 절 추가로 41개 전량 커버 |

---

## 2. 이 점검에서 발견해 고친 결함

유닛테스트가 전부 통과하는 상태에서 나온 것들이다 — 전부 "테스트는 초록인데 사용자에게는
깨져 보이는" 유형이고, 9·10번은 **테스트가 코드의 잘못된 가정을 그대로 복사**하고 있어서
살아남은 경우다.

| # | 결함 | 어떻게 드러났나 | 조치 |
|---|---|---|---|
| 1 | `TemplatesModal` 미리보기 SVG 의 하드코딩 `#fff` (**AC-D2 위반**) | 릴리즈 grep | 토큰 교체 + 전수 가드 테스트 `noHardcodedColors.test.ts` |
| 2 | `AC-E001`/`AC-E500` 이 문서에 없고 **`docs_url` 앵커가 깨짐** (**AC-X2 위반**) | 소스 코드 ↔ 문서 대조 | `core/errors.py::TRANSPORT_ERRORS` 를 단일 소스로 두고 생성기가 문서 절을 만들게 함 + 소스 기준 커버리지 가드 |
| 3 | **프론트 `ApiIssue` 가 와이어 포맷과 어긋남**(`node_id` vs `nodeId`) → 백엔드가 노드를 지목한 에러를 줘도 Export 모달의 "이 노드 보기" 버튼이 **한 번도 뜨지 않음** (Spec §9.1 MUST) | 실서버 JSON 을 직접 떠서 필드명 대조 | 타입 정정 + `test_frontend_api_issue_matches_wire_format` 경계 가드 |
| 4 | **백엔드 동적 에러 메시지가 영어 UI 에서도 한국어**(Spec §17.3) | 영어 모드로 실행하다 `AC-E602` 토스트가 한국어로 뜸 | `Issue`/`RunWarning` 에 `message_key`/`params` 신설, 검증기·툴 레지스트리·보간기·내보내기 6곳 배선, ko/en 키 6개 추가, 가드 테스트 2종. 실브라우저에서 `AC-E602`·`AC-E201` 이 영어로 뜨는 것 확인 |
| 5 | 잠긴 템플릿의 "Ollama로 대체 실행" 한국어 라벨이 **실제 동작과 다름**(이 템플릿을 Ollama 로 돌리는 게 아니라 *무료 템플릿을 대신 여는* 것) — 무료 템플릿이 이미 열려 있으면 눌러도 화면이 안 바뀌어 "버튼이 고장 났다"로 읽힘 | 실브라우저에서 눌러 보고 캔버스가 그대로여서 추적 | 라벨에 열리는 템플릿 이름을 박음(`대신 '로컬 전용 요약봇' 열기` / `Open '…' instead`). 영문 라벨은 원래 정확했음 |
| 6 | favicon 부재 → 매 페이지 로드마다 `/favicon.ico` 404 | 콘솔 | `app/icon.svg` 추가(헤더 `BrandMark` 와 같은 그림) |
| 7 | `.gitignore` 가 `.env` 만 막아 `.env.keys`/`.env.prod`/`.env.bak` 등이 **커밋 대상**이었음 | 키 파일을 만들려다 `git check-ignore` 가 통과 | `.env*` + `!.env.example`, `*.key` 추가 |
| 8 | 리포 루트에 정본과 중복된 `agentcanvas.html`(디자인 SSoT 사본, **잠금 없이**), `AgentCanvas_Master_Build_Spec_v3.md` | 릴리즈 트리 점검 | 삭제(정본은 `design/reference/artifact-source.html`(444) 과 `docs/`) |
| 9 | **`AC-E601`/`AC-E603`/`AC-E604` 가 실전에서 한 번도 발생하지 않았다** — 분류기가 `litellm.exceptions.*` 로 isinstance 를 하는데 litellm 예외는 **openai 예외의 서브클래스**라, openai SDK 가 직접 던진 예외는 전부 빠져나가 `AC-E501` + 파이썬 repr 원문으로 떨어졌다. 유닛테스트 4개가 **전부 litellm 예외를 만들어 넣고 있어서** 초록인 채로 살아남았다 | 실제 OpenAI 키로 AC-F9 를 돌리다 429 가 `AC-E501` 로 뜸 | openai SDK 베이스 클래스로 매칭(litellm 도 서브클래스라 같이 잡힌다) + **openai 예외로 만든 테스트 5개**(고치기 전 코드로 되돌리면 빨개지는 것 확인). **RECON F17** 로 문서화 |
| 10 | 가장 흔한 두 실패가 generic 버킷으로 감 — 키 미설정은 `AC-E501 OPENAI_API_KEY is required`, 크레딧 소진은 `AC-E603`(힌트 "잠시 후 다시 시도" = **잔액 없는 사용자에게 틀린 안내**) | 같은 실행 | 키 미설정 → `AC-E602`, 잔액 소진 → 신규 `AC-E605`("결제 정보와 잔액을 확인하세요"). 실서버에서 두 경로 모두 확인 |

### 오탐이었던 것 (기록용)

- `~/.ssh/id_rsa` 가 `file_read` 로 통과 → **정상**. 파이썬 `open()` 도 `crewai_tools` 도 `~` 를 확장하지 않아 워크스페이스 안의 `~` 라는 이름의 경로로 해석된다. "차단 실패"로 보고할 뻔했다.
- 에러 토스트가 안 사라짐 → **의도된 동작**(`sticky: true`). 사용자가 못 본 에러가 스스로 사라지면 안 된다는 설계.
- `AC-E404` 가 HTTP 404 와 카탈로그 코드로 **겹침** → 이미 알려진 채로 `test_main.py` 에 근거가 적혀 있었다. 다만 문서에는 설명이 없어 "전송 계층" 절에 구분법을 적었다.

---

## 3. AC-F9 — 템플릿 5종 실행 (3/5 완주, 2종은 무료 키 대기)

2026-09-04 사용자 실제 `OPENAI_API_KEY` 로 전수 시도한 결과다.

| 템플릿 | 필요 키 | 결과 | 시간 | 토큰 | 실비용 |
|---|---|---|---:|---:|---:|
| 로컬 전용 요약봇 | 없음 | ✅ **완주** (Ollama `llama3`) | 6.5s | — | $0 |
| Hello Crew | `OPENAI_API_KEY` | ✅ **완주** | 4.2s | 359 | $0.00013 |
| YouTube 대본 파이프라인 | `OPENAI_API_KEY` | ✅ **완주** (에이전트 3 / 태스크 3 + `youtube_search` 툴) | 30.9s | 7,131 | $0.00273 |
| SEO 블로그 작성팀 | + `SERPER_API_KEY` | ⛔ `AC-E602` 로 **정상 거부** | — | — | — |
| 시장 조사 리포트 | + `SERPER_API_KEY` | ⛔ `AC-E602` 로 **정상 거부** | — | — | — |

**3종 실완주 총 지출: $0.0029.** 남은 2종은 앱 결함이 아니라 웹 검색 키 미보유이며,
`AC-E602`("\"Serper 웹 검색\" 에 필요한 키가 없습니다: SERPER_API_KEY")로 **실행 전에**
정확히 안내된다 — 이 안내 자체가 §2 의 4번(동적 메시지 i18n)·10번(코드 분류) 수정 결과다.
[serper.dev](https://serper.dev) 무료 티어(2,500 쿼리)로 키를 발급하면 5/5 가 닫힌다.

### 부수 관찰 — 비용 추정치 정확도

실측으로 두 추정치를 대조할 수 있게 됐다.

| | Hello Crew | YouTube |
|---|---:|---:|
| 템플릿 카드 표기 | $0.002 | $0.015 |
| Dry Run 추정기 | $0.0003 | $0.0010 |
| **실제** | **$0.00013** | **$0.00273** |

`runtime/cost.py` 의 Dry Run 추정기(프롬프트 글자 수 기반)가 **2~3배 오차**로 훨씬
정확하고, 손으로 적어 둔 **템플릿 카드 라벨이 5~15배 과대**다. 카드 라벨은 사용자가
실행 전에 보는 숫자이므로 언젠가 실측값에 맞춰 낮추는 게 맞다 — 다만 과대 추정은
"생각보다 싸다"는 방향이라 사용자를 놀라게 하지 않고, §21 항목도 아니라서
이번 릴리즈에서는 건드리지 않았다.

---

## 4. 회귀 방지로 남긴 것

이번 점검에서 나온 결함은 대부분 "한 번 확인하고 문서에만 적어둔 기준"이 조용히 되돌아간 것이다.
그래서 **판정을 문장이 아니라 테스트로** 남겼다.

| 가드 | 지키는 것 |
|---|---|
| `frontend/src/design/noHardcodedColors.test.ts` | AC-D2 — 컴포넌트에 색 리터럴이 다시 스며드는 것 |
| `backend/tests/test_errors_doc.py::test_every_code_used_in_source_has_a_doc_anchor` | AC-X2 — 카탈로그 **밖에서** raise 되는 코드까지 |
| `backend/tests/test_schemas.py::test_frontend_api_issue_matches_wire_format` | 프론트/백엔드 **필드명** 경계 |
| `backend/tests/test_schemas.py::test_backend_dynamic_messages_carry_translatable_keys` | §17.3 — 동적 메시지가 번역 경로에서 빠지는 것 |
| `backend/tests/test_schemas.py::test_issue_params_are_i18n_keys_not_translated_strings` | 번역문을 params 에 굳혀 넣는 실수 |
| `backend/tests/test_runtime_manager.py` "RECON F17" 절 (7개) | 프로바이더 예외 분류 — **openai SDK 가 실제로 던지는 객체**로 검증 |

전체 스위트: **백엔드 755 · 프론트 387 · E2E 33** 통과, `tsc --noEmit` 클린, `next lint` 0 에러(경고 4건은 M4-T7 이후 동일 베이스라인).
