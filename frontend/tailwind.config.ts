import type { Config } from 'tailwindcss';
import {
  canvas,
  color,
  colorExtra,
  font,
  fontSize,
  letterSpacing,
  lineHeight,
  motion,
  nodeAccent,
  portColor,
  radius,
  shadow,
  size,
  statusColor,
} from '../design/tokens';

/**
 * Tailwind 테마 = design/tokens.ts (아티팩트 실측값).
 * 컴포넌트에는 하드코딩 HEX 를 쓰지 않는다. (Spec §1.5 / AC-D2)
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class', // Dark 가 기본. 라이트 모드로 자동 전환 금지 (Spec §1.3)
  theme: {
    extend: {
      colors: {
        bg: color.bg,
        'grid-dot': color.gridDot,
        surface: {
          DEFAULT: color.surface,
          2: color.surface2,
          3: color.surface3,
        },
        border: {
          DEFAULT: color.border,
          soft: color.borderSoft,
          light: color.borderLight,
        },
        text: {
          DEFAULT: color.text,
          dim: color.textDim,
          faint: color.textFaint,
        },
        indigo: { DEFAULT: color.indigo, soft: color.indigoSoft },
        emerald: { DEFAULT: color.emerald, soft: color.emeraldSoft },
        amber: { DEFAULT: color.amber, soft: color.amberSoft },
        rose: { DEFAULT: color.rose, soft: color.roseSoft },
        run: { a: color.runA, b: color.runB },
        danger: color.danger,

        // 컴포넌트 인라인 실측값
        selection: colorExtra.selection,
        'btn-hover': colorExtra.btnHoverBg,
        'btn-hover-border': colorExtra.btnHoverBorder,
        'run-ink': colorExtra.runInk,
        edge: { DEFAULT: colorExtra.edge, hover: colorExtra.edgeHover },
        socket: colorExtra.socketRing,
        'node-selected': colorExtra.nodeSelected,
        'header-text': colorExtra.headerText,
        'header-mark': colorExtra.headerMarkText,
        focus: { ring: colorExtra.focusRing, bg: colorExtra.focusBg },
        code: { bg: colorExtra.codeBg, text: colorExtra.codeText, kw: colorExtra.codeKeyword },
        raw: colorExtra.rawText,
        overlay: colorExtra.overlay,
        link: colorExtra.linkText,
        log: {
          agent: colorExtra.logAgent,
          tool: colorExtra.logTool,
          ok: colorExtra.logOk,
          warn: colorExtra.logWarn,
          err: colorExtra.logErr,
          final: colorExtra.logFinal,
        },

        // 노드 액센트 / 포트 / 실행 상태
        node: Object.fromEntries(
          Object.entries(nodeAccent).flatMap(([k, v]) => [
            [k, v.base],
            [`${k}-deep`, v.deep],
            [`${k}-port`, v.port],
          ]),
        ) as Record<string, string>,
        port: portColor,
        status: statusColor,
      },
      fontFamily: {
        ui: font.ui.split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
        display: font.display.split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
        mono: font.mono.split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
      },
      fontSize: Object.fromEntries(
        Object.entries(fontSize).map(([k, v]) => [`t${k.replace('.', '_')}`, v]),
      ) as Record<string, string>,
      letterSpacing,
      lineHeight,
      borderRadius: radius,
      boxShadow: shadow,
      spacing: {
        topbar: `${size.topbarHeight}px`,
        console: `${size.consoleHeight}px`,
        'console-head': `${size.consoleHeadHeight}px`,
        inspector: `${size.inspectorWidth}px`,
        node: `${size.nodeWidth}px`,
        'node-header': `${size.nodeHeaderHeight}px`,
        port: `${size.portSize}px`,
      },
      transitionDuration: {
        fast: motion.fast.replace('.', '0.').replace('s', '') + 's',
        toast: motion.toast.replace('.', '0.').replace('s', '') + 's',
        fadein: motion.fadeIn.replace('.', '0.').replace('s', '') + 's',
      },
      keyframes: {
        fadein: { from: { opacity: '0' }, to: { opacity: '1' } },
        'wire-flow': { to: { strokeDashoffset: '-24' } },
        'ring-pulse': {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        fadein: `fadein ${motion.fadeIn} forwards`,
        'wire-flow': 'wire-flow 0.9s linear infinite',
        'ring-pulse': 'ring-pulse 1.6s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      zIndex: { canvas: '1', ports: '5', topbar: '50', dropdown: '80', ctx: '120', modal: '200', toast: '300' },
      backgroundImage: {
        'dot-grid': `radial-gradient(circle, ${color.gridDot} ${canvas ? '1.4px' : '1.4px'}, transparent 1.5px)`,
        'run-btn': `linear-gradient(90deg, ${color.runA}, ${color.runB})`,
        'brand-mark': `linear-gradient(135deg, ${color.indigo} 0 50%, ${color.emerald} 50% 100%)`,
      },
    },
  },
  plugins: [],
};

export default config;
