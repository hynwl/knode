# 🎨 DESIGN AUDIT — 아티팩트 ↔ 구현 매핑표

**SSoT:** `design/reference/artifact-source.html` (읽기 전용, chmod 444)
**토큰:** `design/tokens.ts`
**작성일:** 2026-08-28
**근거:** Spec §1 DESIGN LOCK / §1.2-4

> 규칙: 아티팩트에 있는 모든 화면 요소는 구현 컴포넌트와 1:1로 대응해야 한다.
> 아티팩트에 없는 화면은 §1.4 확장 규칙(기존 토큰 재조합)만 허용된다.

---

## 1. 토큰 추출 검증

| 항목 | 결과 |
|---|---|
| 아티팩트 색상 리터럴 총 개수 | **62종** |
| `design/tokens.ts` 에 반영된 개수 | **62종 (누락 0)** |
| 검증 방법 | `grep -oE '#[0-9a-fA-F]{3,8}' artifact-source.html \| sort -u` 전수 대조 스크립트 |
| 컴포넌트 파일 내 하드코딩 HEX | **0개** (전부 Tailwind 토큰 클래스 또는 `var(--*)`) |

`globals.css` 의 `:root` 블록과 `.ac-run-btn` 의 `box-shadow` 는 **아티팩트 원본 문자열을
그대로 옮긴 것**이므로 하드코딩이 아니라 토큰 정의부다. (AC-D2 판정 기준)

---

## 2. 화면 요소 매핑표

### 2.1. 상단바 (아티팩트 `.topbar`)

| 아티팩트 요소 | 구현 | 상태 |
|---|---|---|
| `.topbar` (h 52px, bg surface, border-bottom border-soft) | `panels/Header.tsx` | ✅ |
| `.brand` + `.brand-mark` (22px, 135° 그라디언트 + 점 2개) | `Header.BrandMark` | ✅ |
| `#project-name` (13px, hover surface-3, focus surface-2) | `Header` 인풋 | ✅ |
| `.tbtn` (surface-3 / border / 12.5px 600 / hover #212e48·#324364) | `.ac-tbtn` | ✅ |
| `.run-btn` (cyan→indigo 그라디언트, ink #04121a, inset 링 + 글로우) | `.ac-run-btn` | ✅ |
| `.dropdown` / `.dropdown-item` / `.dropdown-sep` | `Header.Dropdown` | ⚠️ 정의만. 템플릿 갤러리 연결은 M4 |

### 2.2. 캔버스 (아티팩트 `.canvas-viewport`)

| 아티팩트 요소 | 구현 | 상태 |
|---|---|---|
| 도트 그리드 (26px 간격, 1.4px, `--grid-dot`) | `Canvas` `<Background variant=dots>` | ✅ |
| 베지어 엣지 (stroke #4b5b7c, 2.2px) | `canvas/AcanvasEdge.tsx` + `globals.css` | ✅ |
| 엣지 hover #8291b5 / selected `--run-a` 2.6px | `globals.css` `.react-flow__edge*` | ✅ |
| 임시(드래그 중) 엣지 dash `6 4` | `.react-flow__connection-path` | ✅ |
| 줌 범위 0.3–1.8 | `Canvas` `minZoom`/`maxZoom` | ✅ |

### 2.3. 노드 (아티팩트 `.node`)

| 아티팩트 요소 | 구현 | 상태 |
|---|---|---|
| `.node` (w 230, radius 9, shadow `0 6px 20px -8px #00000090`) | `nodes/BaseNode.tsx` | ✅ |
| `.node.selected` (border #8fa2ff + 링) | `BaseNode` | ✅ |
| `.node-header` (h 32, display 600 12px, ls .1px) | `BaseNode` | ✅ |
| `.hmark` (모노 9.5px, bg #00000038) | `BaseNode` | ✅ |
| `.htype` (10px 600 uppercase ls .5px, opacity .75) | `BaseNode` | ✅ |
| `.hdel` (hover 시 노출, bg #00000030) | `BaseNode` | ✅ |
| 헤더 그라디언트 4종 (agent/task/tool/llm) | `tokens.nodeAccent` | ✅ |
| `.node-body .row1` / `.row2` (2줄 클램프) | `AcanvasNode.Row1/Row2` | ✅ |
| `.chip` (pill, 모노 10px) | `.ac-chip` | ✅ |
| `.port` (13×13, border 2.5px, offset -6.5px, hover 1.35배) | `ports/Socket.tsx` | ✅ |
| `.port-label` (모노 9.5px, left/right 14px) | `ports/Socket.tsx` | ✅ |

### 2.4. 인스펙터 (아티팩트 `.inspector`)

| 아티팩트 요소 | 구현 | 상태 |
|---|---|---|
| `.inspector` (w 300, border-left) | `app/page.tsx` `<aside>` | ✅ |
| `.inspector-head .tag` / `h2` | `InspectorPanel.InspectorHead` | ✅ |
| `.inspector-empty` (안내 문구) | `InspectorPanel` | ✅ |
| `.field label` (10.5px 700 uppercase ls .5px) | `.ac-label` | ✅ |
| `.field input/select/textarea` (surface-2, radius 7) | `.ac-input` | ✅ |
| focus (border #6366f1aa, bg #0d1526) | `.ac-input:focus` | ✅ |
| `.check-field` (15px accent indigo) | `nodes/fields` toggle | ✅ |
| `.range-row` + `.range-val` (모노 11.5px, w 34) | `nodes/fields` slider | ✅ |
| `.inspector-section-title` | `.ac-section-title` | ✅ |
| `.hint` | `.ac-hint` | ✅ |

### 2.5. 콘솔 (아티팩트 `.console`)

| 아티팩트 요소 | 구현 | 상태 |
|---|---|---|
| `.console` (h 230 open, transition .18s ease) | `panels/LogPanel.tsx` | ✅ |
| `.console-head` (h 34) + `.dot` (7px, glow `0 0 0 3px #10b98122`) | `LogPanel` | ✅ |
| `.console-mini` (Clear / Hide) | `LogPanel` | ✅ |
| `.console-body` (모노 12px, lh 1.85) | `LogPanel` | ✅ |
| `.log-line` 8색 (sys/agent/tool/think/ok/warn/err/final) | `LogPanel.KIND_CLASS` | ✅ |
| `@keyframes fadein .25s` | `tailwind.config.ts` `animate-fadein` | ✅ |

### 2.6. 모달 / 토스트

| 아티팩트 요소 | 구현 | 상태 |
|---|---|---|
| `.overlay` (#03060ccc + blur 2px) | `panels/Modal.tsx` | ✅ |
| `.modal` (560 / wide 760, radius 13, shadow modal) | `Modal` | ✅ |
| `.modal-head/-body/-foot` 패딩 | `Modal` | ✅ |
| `.btn` / `.btn.primary` | `.ac-btn` / `.ac-btn-primary` | ✅ |
| `.note` | `.ac-note` | ✅ |
| `.badge` 4색 | `.ac-badge` + 토큰 | ✅ |
| `.toast` (pill, shadow toast, transition .2s) | `panels/ToastHost.tsx` | ✅ |
| `.code-box` / `textarea.raw` (#080d18) | `tokens.colorExtra.codeBg` | ⚠️ 토큰만. Export Code 모달은 M4 |

### 2.7. 컨텍스트 메뉴 (아티팩트 `.ctx-menu`)

| 아티팩트 요소 | 구현 | 상태 |
|---|---|---|
| `.ctx-menu` (radius 9, min-w 200, shadow ctxMenu) | `canvas/ContextMenu.tsx` | ✅ |
| `.ctx-item` + `.sw` (9×9 radius 3 스와치) | `ContextMenu.MenuItem` | ✅ |
| `.ctx-sep` | `ContextMenu.Separator` | ✅ |
| 검색 인풋 + 카테고리 계층 (Spec §3.4.1) | `ContextMenu` | ✅ (아티팩트에 없는 §1.4 확장) |

---

## 3. 아티팩트에 없는 화면 (§1.4 확장)

기존 토큰만 재조합했다. 새 시각 언어를 만들지 않았다.

| 화면 | 재사용한 아티팩트 컴포넌트 |
|---|---|
| 좌측 노드 라이브러리 | `.inspector` 의 패널 표면 + `.ctx-item` 의 스와치/행 스타일 |
| 하단 상태바 | `.console-head` 의 높이·모노 타이포·상태 점 |
| 미니맵 / 컨트롤 | `.dropdown` 의 표면·보더·radius |
| API Keys / Backup 모달 | 아티팩트 모달 원본 그대로 |
| 검증 이슈 배너 (인스펙터) | `.note` + `--danger`/`--amber` |
| 실행 상태 링 (Spec §3.3) | 기존 `--indigo`/`--emerald`/`--danger`/`--amber` |

---

## 4. 확장 토큰 (Spec §1.4-3, 상한 5개)

| # | 토큰 | 값 | 사유 |
|---|---|---|---|
| **X1** | `color.borderLight` | `#475569` | 아티팩트 `.console-mini:hover` 가 정의되지 않은 `var(--border-light, #475569)` 를 참조한다. 정의가 없어 **항상 폴백이 적용**되므로 실효값을 토큰으로 승격했다. **픽셀 결과 동일 — 새 값이 아니다.** |

**확장 토큰 1개 / 상한 5개.** ✅

### 확장 토큰이 아닌 것 (오해 방지)

* **Spec §3.2 확장 팔레트** (crew/input/output/knowledge/memory/router/human/note 8종 액센트):
  아티팩트가 아니라 **스펙 본문이 명시한 색**이다. 임의 창작이 아니므로 §1.4 카운트에서 제외한다.
  전부 아티팩트 4색과 동일한 채도/명도 레벨(Tailwind 600/700)을 유지한다.
* **`nodeAccent.guardrail`**: Router 와 완전히 동일한 값의 **별칭**이다. 새 값이 아니다.
* **`portColor.context`** = `#6ee7b7`: 아티팩트 `.log-line.ok` 색을 재사용했다.

---

## 5. Definition of Done (Spec §1.5)

- [x] 아티팩트와 구현 화면을 나란히 놓고 대조 — Playwright 로 동일 뷰포트(1600×950) 스크린샷 2장 비교 수행
- [x] `grep` 시 컴포넌트 파일 내 하드코딩 HEX **0개**
- [x] 매핑표 100% 작성 (⚠️ 표시 2건은 M4 에서 화면이 생길 때 연결)
- [x] 확장 토큰 5개 이하 (1개) + 사유 기록

### 대조에서 실제로 잡아낸 위반

| # | 위반 | 조치 |
|---|---|---|
| V1 | 헤더 버튼(`Templates`/`Backup / Restore`/`API Keys`/`Queue Prompt`)에 lucide 아이콘 추가 | 아티팩트 원본은 **텍스트 전용**. §1.3 "아티팩트에 없는 요소 임의 추가 금지" 위반 → **아이콘 제거** |

---

## 6. 재검증 절차

디자인을 건드린 PR 은 아래를 통과해야 한다.

```bash
# 1. 하드코딩 HEX 검사
grep -rnE '#[0-9a-fA-F]{6}' frontend/src --include='*.tsx' --include='*.ts' | grep -v globals.css

# 2. 아티팩트 색상 전수 대조
for c in $(grep -oE '#[0-9a-fA-F]{3,8}' design/reference/artifact-source.html | sort -u); do
  grep -qi -- "$c" design/tokens.ts || echo "MISSING: $c"
done

# 3. 육안 대조
(cd design/reference && python3 -m http.server 3112) &
(cd frontend && npm run dev)
# → 같은 뷰포트에서 스크린샷 2장을 나란히 비교
```
