/**
 * AgentCanvas — Design Tokens
 * ============================================================================
 * SSoT: design/reference/artifact-source.html  (Spec §1 DESIGN LOCK)
 *
 * ⚠️ 이 파일의 모든 값은 아티팩트 원본에서 **실측 추출**한 것이다.
 *    - 새 값을 창작하지 않는다. 조정하지 않는다. "더 예쁘게" 금지. (Spec §1.3)
 *    - 아티팩트에 등장하는 색 리터럴 62종이 100% 여기에 존재한다.
 *    - 확장 토큰은 design/DESIGN_AUDIT.md 의 "확장 토큰" 섹션에 사유와 함께 기록된다.
 *
 * 사용처
 *    - frontend/tailwind.config.ts  → Tailwind 테마로 주입
 *    - frontend/src/app/globals.css → CSS 커스텀 프로퍼티로 방출
 *    - 컴포넌트는 이 토큰만 참조한다. 하드코딩 HEX 0개. (Spec §1.5)
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. COLOR — 아티팩트 :root 변수 (원본 그대로)
 * ────────────────────────────────────────────────────────────────────────── */
export const color = {
  /** 캔버스 최하단 배경 */
  bg: '#0b1220',
  /** 도트 그리드 점 색 */
  gridDot: '#1e2b42',
  /** 패널·노드 기본 표면 */
  surface: '#141d30',
  /** 입력 필드·콘솔 등 함몰 표면 */
  surface2: '#0e1626',
  /** 버튼·드롭다운 등 융기 표면 */
  surface3: '#1a253c',
  /** 기본 보더 */
  border: '#25324a',
  /** 구분선용 약한 보더 */
  borderSoft: '#1b2438',
  /**
   * 아티팩트 `.console-mini:hover` 의 `var(--border-light, #475569)` 폴백값.
   * 원본에 --border-light 정의가 없어 항상 이 폴백이 적용된다 → 실효값을 토큰으로 승격.
   * (픽셀 결과 동일. DESIGN_AUDIT §확장토큰 X1 참조)
   */
  borderLight: '#475569',

  text: '#e7ecf5',
  textDim: '#93a1bb',
  /**
   * ⚠️ 아티팩트 원본은 `#5b6785` 지만 **접근성 사유로 상향한 유일한 색**이다
   * (Spec §17.2 "본문 텍스트 대비율 4.5:1 이상" MUST).
   *
   * 원본 `#5b6785` 실측 대비율: surface 2.98 / surface-2 3.21 / bg 3.32 /
   * surface-3 2.71 — 네 배경 전부 4.5:1 미달. 그런데 이 토큰은 `.ac-hint`
   * (필드 설명문) · `.ac-note`(안내 박스) · `.ac-label`(필드 라벨) ·
   * 상태바 전체 · 로그 타임스탬프 · 빈 상태 안내문 등 **명백한 본문/라벨
   * 텍스트** 79곳에 쓰인다 → 장식이 아니라 읽어야 하는 글자다.
   *
   * 색상(H)·채도(S)는 원본과 **동일**하게 두고 명도(L 0.439 → 0.585)만
   * 4.5:1 을 넘는 **최솟값**까지 올렸다. 실측: surface 5.06 / surface-2 5.44 /
   * bg 5.63 / surface-3 4.60 / code-bg 5.84 — 전부 통과.
   * `--text-dim`(#93a1bb) 과는 여전히 1.28:1 차이가 있어 위계도 유지된다.
   * 근거·재현 스크립트는 `frontend/src/design/contrast.test.ts` 가 고정한다.
   * (DESIGN_AUDIT §4 확장토큰 X2)
   */
  textFaint: '#818da9',

  indigo: '#6366f1',
  indigoSoft: '#4f46e5',
  emerald: '#10b981',
  emeraldSoft: '#059669',
  amber: '#f59e0b',
  amberSoft: '#d97706',
  rose: '#fb7185',
  roseSoft: '#e11d48',

  /** Queue Prompt 그라디언트 시작 (cyan) */
  runA: '#22d3ee',
  /** Queue Prompt 그라디언트 끝 (indigo) */
  runB: '#6366f1',
  danger: '#f87171',
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 2. COLOR — 아티팩트 컴포넌트에 인라인으로 박혀 있던 값들
 *    (변수화되어 있지 않았을 뿐, 전부 원본 실측값이다)
 * ────────────────────────────────────────────────────────────────────────── */
export const colorExtra = {
  /** ::selection 배경 (indigo 40%) */
  selection: '#6366f166',

  /** .tbtn:hover 배경 / 보더 */
  btnHoverBg: '#212e48',
  btnHoverBorder: '#324364',

  /** .run-btn 텍스트 (그라디언트 위 다크 잉크) */
  runInk: '#04121a',

  /** 엣지 */
  edge: '#4b5b7c',
  edgeHover: '#8291b5',
  /** 소켓 기본 링 & 임시(드래그 중) 엣지 — edgeHover와 동일 값 */
  socketRing: '#8291b5',

  /** 선택된 노드 하이라이트 */
  nodeSelected: '#8fa2ff',

  /** 노드 헤더 텍스트 */
  headerText: '#eef1fb',
  /** 헤더 내 모노 마크 배경 / 텍스트 */
  headerMarkBg: '#00000038',
  headerMarkText: '#ffffffdd',
  /** 헤더 삭제 버튼 */
  headerDel: '#ffffffcc',
  headerDelHoverBg: '#00000030',

  /** 입력 포커스 */
  focusRing: '#6366f1aa',
  focusBg: '#0d1526',

  /** 코드 박스 / raw textarea 배경 */
  codeBg: '#080d18',
  codeText: '#d7e0f5',
  rawText: '#cbd5f0',
  /** 코드 키워드 하이라이트 */
  codeKeyword: '#c792ea',

  /** 모달 오버레이 */
  overlay: '#03060ccc',

  /** 로그 라인 색 (Spec §3.3 상태색과 별개 — 콘솔 전용) */
  logAgent: '#a5b4fc',
  logTool: '#fcd34d',
  logOk: '#6ee7b7',
  logWarn: '#fbbf24',
  logErr: '#fca5a5',
  logFinal: '#67e8f9',

  /** 배지 (badge.indigo/emerald/amber/rose) */
  badgeIndigoBg: '#4f46e522',
  badgeIndigoText: '#a5b4fc',
  badgeEmeraldBg: '#05966922',
  badgeEmeraldText: '#6ee7b7',
  badgeAmberBg: '#d9770622',
  badgeAmberText: '#fcd34d',
  badgeRoseBg: '#e11d4822',
  badgeRoseText: '#fda4af',

  /** 콘솔 헤드 상태 점 글로우 */
  consoleDotGlow: '#10b98122',

  /**
   * 본문 링크(Output 노드 마크다운 `.ac-markdown a`) 색.
   * `--indigo`(#6366f1) 를 쓰면 surface 3.77 / surface-3 3.42 로 4.5:1 에 미달한다
   * (Spec §17.2). **새 값이 아니라 `badgeIndigoText` 와 동일한 별칭**이다
   * (`nodeAccent.guardrail` 과 같은 방식). 실측 7.67~9.07 — 통과.
   */
  linkText: '#a5b4fc',
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 3. NODE ACCENT — 노드 헤더 그라디언트
 *    원본 4종(agent/task/tool/llm)은 아티팩트 실측.
 *    나머지는 Spec §3.2가 "동일 채도/명도 레벨"로 명시한 확장 팔레트.
 * ────────────────────────────────────────────────────────────────────────── */
export const nodeAccent = {
  // ── 아티팩트 원본 (Spec §3.1) ──
  agent: { base: color.indigoSoft, deep: '#4338ca', port: color.indigo },
  task: { base: color.emeraldSoft, deep: '#047857', port: color.emerald },
  tool: { base: color.amberSoft, deep: '#b45309', port: color.amber },
  llm: { base: color.roseSoft, deep: '#be123c', port: color.rose },

  // ── Spec §3.2 확장 팔레트 (신규 노드 타입) ──
  crew: { base: '#7c3aed', deep: '#5b21b6', port: '#a78bfa' },
  input: { base: '#0891b2', deep: '#0e7490', port: '#22d3ee' },
  output: { base: '#0d9488', deep: '#0f766e', port: '#2dd4bf' },
  knowledge: { base: '#c2410c', deep: '#9a3412', port: '#fb923c' },
  memory: { base: '#4338ca', deep: '#3730a3', port: '#818cf8' },
  router: { base: '#a16207', deep: '#854d0e', port: '#facc15' },
  human: { base: '#be123c', deep: '#9f1239', port: '#fb7185' },
  /** Guardrail 은 Router 와 같은 Flow 계열 → 동일 액센트를 재사용한다 (신규 토큰 아님) */
  guardrail: { base: '#a16207', deep: '#854d0e', port: '#facc15' },
  note: { base: '#475569', deep: '#334155', port: '#94a3b8' },
  group: { base: '#475569', deep: '#334155', port: '#94a3b8' },
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 4. PORT TYPE COLOR — Spec §6.1 소켓 색 (아티팩트 .port.io-* 우선)
 * ────────────────────────────────────────────────────────────────────────── */
export const portColor = {
  llm: color.rose,
  agent: color.indigo,
  task: color.emerald,
  tool: color.amber,
  context: '#6ee7b7', // emerald 밝게 — 아티팩트 .log-line.ok 와 동일 값 재사용
  knowledge: '#fb923c',
  memory: '#818cf8',
  result: '#2dd4bf',
  text: '#22d3ee', // = runA
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 5. RUN STATUS — Spec §3.3 실행 상태 시각화
 *    (아티팩트에 실행 상태 표현이 없어 Spec §3.3 값을 사용. 전부 기존 팔레트 재사용)
 * ────────────────────────────────────────────────────────────────────────── */
export const statusColor = {
  idle: color.border,
  queued: color.textDim,
  running: color.indigo,
  succeeded: color.emerald,
  failed: color.danger,
  skipped: '#475569',
  cancelled: color.amber,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 6. TYPOGRAPHY
 * ────────────────────────────────────────────────────────────────────────── */
export const font = {
  ui: "'Manrope','Helvetica Neue',system-ui,'Segoe UI',sans-serif",
  display: "'Sora','Helvetica Neue',system-ui,'Segoe UI',sans-serif",
  mono: "'IBM Plex Mono','SFMono-Regular',monospace",
} as const;

/** 아티팩트에 실제로 등장하는 폰트 크기 전량 (px) */
export const fontSize = {
  '9.5': '9.5px', // .port-label, .hmark
  '10': '10px', // .htype, .chip, .badge, .inspector .tag
  '10.5': '10.5px', // .field label, .hint, .section-title
  '11': '11px', // .dropdown-item small, .console-mini
  '11.5': '11.5px', // .row2, .note, .console title, .range-val, textarea.raw
  '12': '12px', // .node-header, .console-body, .code-box, .hdel
  '12.5': '12.5px', // 기본 UI 텍스트, .tbtn, .btn, .field input
  '13': '13px', // .run-btn, #project-name
  '15': '15px', // .brand, modal h3, inspector h2
  '18': '18px', // .modal-head .x
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const letterSpacing = {
  tightest: '.1px', // .node-header
  tight: '.2px', // .brand, .run-btn
  normal: '.3px', // .console title
  wide: '.4px', // .hmark
  wider: '.5px', // .htype, .field label
  widest: '.6px', // .inspector .tag, .section-title
} as const;

export const lineHeight = {
  tight: '1.4', // .row2
  snug: '1.5', // textarea, .hint
  normal: '1.6', // .note
  relaxed: '1.65', // .code-box
  loose: '1.85', // .console-body
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 7. RADIUS
 * ────────────────────────────────────────────────────────────────────────── */
export const radius = {
  xs: '3px', // .ctx-item .sw
  sm: '4px', // .hmark, .hdel
  md: '6px', // .brand-mark, .dropdown-item, .ctx-item, .console-mini
  lg: '7px', // #project-name, .field input
  xl: '8px', // .tbtn, .run-btn, .btn, .node-header top, .note
  '2xl': '9px', // .node, .dropdown, .ctx-menu, .code-box, textarea.raw
  '3xl': '10px', // --radius (기본값)
  '4xl': '13px', // .modal
  pill: '20px', // .chip, .badge, .toast
  full: '50%', // .port
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 8. SHADOW
 * ────────────────────────────────────────────────────────────────────────── */
export const shadow = {
  node: '0 6px 20px -8px #00000090',
  nodeSelected: `0 0 0 1px ${colorExtra.nodeSelected}, 0 10px 28px -8px #000000a0`,
  dropdown: '0 12px 32px -8px #000000aa',
  ctxMenu: '0 16px 40px -10px #000000c0',
  modal: '0 30px 80px -20px #000000d0',
  toast: '0 12px 30px -8px #000000a0',
  runBtn: `0 0 0 1px rgba(255,255,255,.08) inset, 0 4px 16px -4px #22d3ee55`,
  consoleDot: `0 0 0 3px ${colorExtra.consoleDotGlow}`,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 9. LAYOUT / SIZE — 아티팩트 실측 치수
 * ────────────────────────────────────────────────────────────────────────── */
export const size = {
  topbarHeight: 52, // .topbar
  consoleHeight: 230, // .console.open
  consoleHeadHeight: 34,
  inspectorWidth: 300, // .inspector
  nodeWidth: 230, // NODE_W
  nodeHeaderHeight: 32,
  brandMark: 22,
  portSize: 13, // .port (border 2.5px 포함)
  portBorder: 2.5,
  portOffset: -6.5, // 노드 경계 기준 소켓 중심 정렬
  gridSize: 26, // 도트 그리드 간격 (× zoom)
  gridDotRadius: 1.4,
  dropdownMinWidth: 220,
  ctxMenuMinWidth: 200,
  modalWidth: 560,
  modalWidthWide: 760,
  /** 노드 타입별 최소 높이 (아티팩트 .type-* min-height) */
  nodeMinHeight: { agent: 144, task: 164, tool: 110, llm: 128 },
  /** 노드 타입별 본문 상단 패딩 = 소켓 영역 확보 (아티팩트 .type-* .node-body) */
  nodeBodyPadTop: { agent: 56, task: 82, tool: 26, llm: 26 },
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 10. MOTION — 아티팩트 transition/animation 실측
 * ────────────────────────────────────────────────────────────────────────── */
export const motion = {
  /** .tbtn 색/배경 전환 */
  fast: '.12s',
  /** .console 열림/닫힘 */
  panel: '.18s ease',
  /** .toast */
  toast: '.2s',
  /** .log-line fadein */
  fadeIn: '.25s',
  /** 노드 호버 프리뷰 지연 (Spec §3.4.5) */
  hoverPreviewDelayMs: 400,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 11. CANVAS BEHAVIOR — 아티팩트 카메라 상수
 * ────────────────────────────────────────────────────────────────────────── */
export const canvas = {
  zoomMin: 0.3,
  zoomMax: 1.8,
  /** wheel deltaY → scale 배율: Math.pow(1.0012, -deltaY) */
  zoomFactorBase: 1.0012,
  /** 엣지 곡률: dx = max(60, |x2-x1| / 1.6) */
  edgeCurveMinDx: 60,
  edgeCurveDivisor: 1.6,
  edgeWidth: 2.2,
  edgeWidthSelected: 2.6,
  edgeWidthTemp: 2,
  edgeTempDash: '6 4',
  /** 파티클 애니메이션 성능 가드 (Spec §3.4.3) */
  maxAnimatedEdges: 30,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 12. CSS 변수 방출기 — globals.css / 런타임 공용
 * ────────────────────────────────────────────────────────────────────────── */
export const cssVariables: Record<string, string> = {
  '--bg': color.bg,
  '--grid-dot': color.gridDot,
  '--surface': color.surface,
  '--surface-2': color.surface2,
  '--surface-3': color.surface3,
  '--border': color.border,
  '--border-soft': color.borderSoft,
  '--border-light': color.borderLight,
  '--text': color.text,
  '--text-dim': color.textDim,
  '--text-faint': color.textFaint,
  '--indigo': color.indigo,
  '--indigo-soft': color.indigoSoft,
  '--emerald': color.emerald,
  '--emerald-soft': color.emeraldSoft,
  '--amber': color.amber,
  '--amber-soft': color.amberSoft,
  '--rose': color.rose,
  '--rose-soft': color.roseSoft,
  '--run-a': color.runA,
  '--run-b': color.runB,
  '--danger': color.danger,
  '--radius': radius['3xl'],
  '--font-ui': font.ui,
  '--font-display': font.display,
  '--font-mono': font.mono,
};

export const tokens = {
  color,
  colorExtra,
  nodeAccent,
  portColor,
  statusColor,
  font,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  shadow,
  size,
  motion,
  canvas,
  cssVariables,
} as const;

export type NodeAccentKey = keyof typeof nodeAccent;
export type PortColorKey = keyof typeof portColor;
export type RunStatusKey = keyof typeof statusColor;

export default tokens;
