'use client';

import { nodeAccent, type NodeAccentKey } from '@design/tokens';
import { NODE_CATEGORIES, nodeDescription, nodeLabel, nodesByCategory, type NodeDefinition } from '@/nodes/registry';
import { useT, type TFunction } from '@/i18n/react';
import { Modal } from './Modal';

interface TutorialModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "각 노드의 역할" + "노드들이 이루는 층위" 설명 페이지. 상단 헤더의 Tutorial 탭으로 연다.
 *
 * 여기 실리는 이름/설명은 전부 `nodes/registry.ts` 의 `labelKey`/`descriptionKey` 를
 * 그대로 읽는다 — 이 페이지만을 위한 별도 카피를 새로 쓰지 않는다. 그래야 노드 정의가
 * 바뀔 때 이 페이지가 따로 낡지 않는다(단일 진실 공급원 원칙, Spec §5.1).
 * 층위 다이어그램도 마찬가지로 `ports/matrix.ts` 의 실제 연결 규칙을 그림으로 옮긴 것이지
 * 새로 지어낸 개념도가 아니다.
 */
export function TutorialModal({ open, onClose }: TutorialModalProps) {
  const t = useT();
  const grouped = nodesByCategory();

  return (
    <Modal open={open} wide title={t('tutorial.title')} onClose={onClose}>
      <p className="ac-hint !mt-0">{t('tutorial.intro')}</p>

      <LayerDiagram t={t} />

      {NODE_CATEGORIES.map((category) => {
        const defs = grouped[category];
        if (!defs.length) return null;
        return (
          <section key={category} className="flex flex-col gap-2">
            <h4 className="m-0 font-mono text-t10_5 font-semibold uppercase tracking-wide text-text-faint">
              {category}
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {defs.map((def) => <NodeCard key={def.type} def={def} />)}
            </div>
          </section>
        );
      })}
    </Modal>
  );
}

function NodeCard({ def }: { def: NodeDefinition }) {
  const accent = nodeAccent[def.accent];
  return (
    <div className="flex gap-[10px] rounded-2xl border border-border bg-surface-2 p-3">
      <span
        className="flex h-6 w-6 flex-none items-center justify-center rounded-md font-mono text-t9_5 font-bold"
        style={{ background: `${accent.base}26`, color: accent.base }}
      >
        {def.mark}
      </span>
      <div className="flex min-w-0 flex-col gap-[2px]">
        <span className="font-display text-t12_5 font-bold text-text">{nodeLabel(def)}</span>
        <span className="text-t11 leading-snug text-text-dim">{nodeDescription(def)}</span>
      </div>
    </div>
  );
}


/* ────────────────────────────── 층위 다이어그램 ──────────────────────────────
 * `ports/matrix.ts` 의 CONNECTION_MATRIX 를 그대로 그림으로 옮긴 것이지, 새로 지어낸
 * 개념도가 아니다:  재료 → Agent → Task → Crew → Output.
 *
 * 층위를 "선으로 이어진 박스"가 아니라 **가로 밴드**로 나눈 이유: 노드가 14개라
 * 선으로만 그리면 사선이 서로/글자를 가로질러 읽을 수가 없다(첫 버전에서 실제로
 * 그랬다). 밴드 + 왼쪽 번호 열이면 "몇 층이 뭐냐"가 한눈에 잡히고, 설명 문장을
 * 밴드 안에 안전하게 눕힐 수 있다.
 *
 * Input 만 실선이 아닌 점선 테두리다 — 그래프 간선이 아니라 Task 설명의 `{변수}`
 * 자리에 실행 시점에 값으로 꽂히기 때문(Spec §5.8).
 */
const DIAGRAM_W = 720;
const GUTTER_W = 128;     // 왼쪽 "층위 번호 + 이름" 열
const CONTENT_X = 144;    // 밴드 내용이 시작하는 x
const BOX_X = CONTENT_X;
const BOX_W = 156;
const ARROW_X = BOX_X + BOX_W / 2;

/** 밴드 사이 화살표가 들어갈 세로 여백 */
const GAP = 28;

interface BandGeom { y: number; h: number }

function LayerDiagram({ t }: { t: TFunction }) {
  const a = (k: NodeAccentKey) => nodeAccent[k].base;

  // 밴드 y/h — 위에서부터 쌓아 내려간다.
  const b1: BandGeom = { y: 8, h: 104 };
  const b2: BandGeom = { y: b1.y + b1.h + GAP, h: 84 };
  const b3: BandGeom = { y: b2.y + b2.h + GAP, h: 112 };
  const b4: BandGeom = { y: b3.y + b3.h + GAP, h: 84 };
  const b5: BandGeom = { y: b4.y + b4.h + GAP, h: 76 };
  const utils: BandGeom = { y: b5.y + b5.h + 22, h: 54 };
  const height = utils.y + utils.h + 8;

  const resources: { key: NodeAccentKey; dashed?: boolean }[] = [
    { key: 'llm' }, { key: 'tool' }, { key: 'knowledge' }, { key: 'memory' }, { key: 'input', dashed: true },
  ];
  const resourceW = 102;
  const resourceGap = 13;

  const flowTags: NodeAccentKey[] = ['human', 'router', 'guardrail'];

  return (
    <div className="rounded-2xl border border-border-soft bg-surface-3 p-3">
      <svg
        viewBox={`0 0 ${DIAGRAM_W} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={t('tutorial.diagramAria')}
        className="block"
      >
        {/* ── 1. 재료 ── */}
        <Band n={1} geom={b1} accent={a('llm')} name={t('tutorial.layer1Name')} />
        {resources.map((r, i) => (
          <NodeBox
            key={r.key}
            x={CONTENT_X + i * (resourceW + resourceGap)}
            y={b1.y + 26}
            w={resourceW}
            h={32}
            accent={a(r.key)}
            label={t(`node.${r.key}.label`)}
            dashed={r.dashed}
          />
        ))}
        <Desc x={CONTENT_X} y={b1.y + 78} maxW={DIAGRAM_W - 8 - CONTENT_X} text={t('tutorial.layer1Desc')} />

        <FlowArrow x={ARROW_X} from={b1.y + b1.h} to={b2.y} color={a('agent')} />

        {/* ── 2. 실행 주체 ── */}
        <Band n={2} geom={b2} accent={a('agent')} name={t('tutorial.layer2Name')} />
        <NodeBox x={BOX_X} y={b2.y + 22} w={BOX_W} h={34} accent={a('agent')} label={t('node.agent.label')} strong />
        <Desc x={BOX_X + BOX_W + 18} y={b2.y + 40} maxW={DIAGRAM_W - 8 - (BOX_X + BOX_W + 18)} text={t('tutorial.layer2Desc')} />

        <FlowArrow x={ARROW_X} from={b2.y + b2.h} to={b3.y} color={a('task')} />

        {/* ── 3. 작업 (+ 흐름 제어) ── */}
        <Band n={3} geom={b3} accent={a('task')} name={t('tutorial.layer3Name')} />
        <NodeBox x={BOX_X} y={b3.y + 22} w={BOX_W} h={34} accent={a('task')} label={t('node.task.label')} strong />
        <text
          x={BOX_X + BOX_W + 18} y={b3.y + 15}
          fontSize={10} fontFamily="var(--font-mono)" fill="var(--text-faint)"
        >
          {t('tutorial.layer3Flow')}
        </text>
        {flowTags.map((key, i) => (
          <NodeBox
            key={key}
            x={BOX_X + BOX_W + 18 + i * 122}
            y={b3.y + 26}
            w={112}
            h={26}
            accent={a(key)}
            label={t(`node.${key}.label`)}
            small
          />
        ))}
        <Desc x={CONTENT_X} y={b3.y + 84} maxW={DIAGRAM_W - 8 - CONTENT_X} text={t('tutorial.layer3Desc')} />

        <FlowArrow x={ARROW_X} from={b3.y + b3.h} to={b4.y} color={a('crew')} />

        {/* ── 4. 오케스트레이션 ── */}
        <Band n={4} geom={b4} accent={a('crew')} name={t('tutorial.layer4Name')} />
        <NodeBox x={BOX_X} y={b4.y + 22} w={BOX_W} h={34} accent={a('crew')} label={t('node.crew.label')} strong />
        <Desc x={BOX_X + BOX_W + 18} y={b4.y + 40} maxW={DIAGRAM_W - 8 - (BOX_X + BOX_W + 18)} text={t('tutorial.layer4Desc')} />

        <FlowArrow x={ARROW_X} from={b4.y + b4.h} to={b5.y} color={a('output')} />

        {/* ── 5. 출력 ── */}
        <Band n={5} geom={b5} accent={a('output')} name={t('tutorial.layer5Name')} />
        <NodeBox x={BOX_X} y={b5.y + 20} w={BOX_W} h={32} accent={a('output')} label={t('node.output.label')} strong />
        <Desc x={BOX_X + BOX_W + 18} y={b5.y + 36} maxW={DIAGRAM_W - 8 - (BOX_X + BOX_W + 18)} text={t('tutorial.layer5Desc')} />

        {/* ── 파이프라인 밖: 캔버스 전용 ── */}
        <rect
          x={8} y={utils.y} width={DIAGRAM_W - 16} height={utils.h} rx={12}
          fill="none" stroke="var(--border)" strokeDasharray="4 4"
        />
        <text
          x={GUTTER_W / 2} y={utils.y + 36} textAnchor="middle"
          fontSize={11.5} fontWeight={700} fontFamily="var(--font-display)" fill="var(--text-dim)"
        >
          {t('tutorial.utilsName')}
        </text>
        <NodeBox x={CONTENT_X} y={utils.y + 14} w={112} h={26} accent={a('note')} label={t('node.note.label')} small />
        <NodeBox x={CONTENT_X + 122} y={utils.y + 14} w={112} h={26} accent={a('group')} label={t('node.group.label')} small />
        <Desc x={CONTENT_X + 256} y={utils.y + 34} maxW={DIAGRAM_W - 8 - (CONTENT_X + 256)} text={t('tutorial.utilsDesc')} />
      </svg>
    </div>
  );
}

/** 층위 한 칸: 배경 + 왼쪽 액센트 스트라이프 + 번호 배지 + 이름 */
function Band({ n, geom, accent, name }: { n: number; geom: BandGeom; accent: string; name: string }) {
  const midY = geom.y + geom.h / 2;
  return (
    <g>
      <rect
        x={8} y={geom.y} width={DIAGRAM_W - 16} height={geom.h} rx={12}
        fill="var(--surface-2)" stroke="var(--border-soft)"
      />
      {/* 왼쪽 액센트 스트라이프 — 층위마다 색이 다르다는 걸 한눈에 */}
      <rect x={8} y={geom.y + 10} width={3} height={geom.h - 20} rx={1.5} fill={accent} />
      <circle cx={GUTTER_W / 2} cy={midY - 9} r={11} fill={`${accent}26`} stroke={accent} strokeWidth={1.2} />
      <text
        x={GUTTER_W / 2} y={midY - 5} textAnchor="middle"
        fontSize={11} fontWeight={700} fontFamily="var(--font-mono)" fill={accent}
      >
        {n}
      </text>
      <text
        x={GUTTER_W / 2} y={midY + 16} textAnchor="middle"
        fontSize={11} fontWeight={700} fontFamily="var(--font-display)" fill="var(--text)"
      >
        {name}
      </text>
    </g>
  );
}

/** 노드 박스. `dashed` 는 그래프 간선이 아닌 것(Input), `strong` 은 파이프라인 본체. */
function NodeBox({
  x, y, w, h, accent, label, strong, small, dashed,
}: {
  x: number; y: number; w: number; h: number;
  accent: string; label: string;
  strong?: boolean; small?: boolean; dashed?: boolean;
}) {
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h} rx={8}
        fill={strong ? `${accent}33` : `${accent}1f`}
        stroke={accent}
        strokeWidth={strong ? 1.6 : 1.2}
        strokeDasharray={dashed ? '5 3' : undefined}
      />
      <text
        x={x + w / 2} y={y + h / 2 + (small ? 3.5 : 4.5)}
        textAnchor="middle"
        fontSize={small ? 10.5 : strong ? 13 : 11.5}
        fontWeight={strong ? 700 : 600}
        fontFamily="var(--font-display)"
        fill={accent}
      >
        {label}
      </text>
    </g>
  );
}

/** 밴드와 밴드 사이 화살표 */
function FlowArrow({ x, from, to, color }: { x: number; from: number; to: number; color: string }) {
  const headH = 8;
  return (
    <g opacity={0.75}>
      <line x1={x} y1={from + 3} x2={x} y2={to - headH} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <path d={`M ${x - 5.5} ${to - headH} L ${x + 5.5} ${to - headH} L ${x} ${to - 0.5} z`} fill={color} />
    </g>
  );
}

const DESC_FONT_SIZE = 11.5;
const DESC_LINE_H = 15;

/**
 * 폭에 맞춰 단어 단위로 자른다. SVG `<text>` 는 자동 줄바꿈이 없어서, 넘치면 그냥
 * 그림 밖으로 흘러나간다 — 한국어보다 긴 영어 문장에서 실제로 그랬다(측정 618px
 * vs 가용 568px). 폰트 메트릭을 못 재는 시점이라 글자 폭을 어림한다: 한글은
 * 대략 폰트 크기만큼, 라틴 문자는 그 절반 정도.
 */
function wrapText(text: string, maxW: number): string[] {
  const charW = (ch: string) => (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(ch) ? DESC_FONT_SIZE : DESC_FONT_SIZE * 0.54);
  const widthOf = (str: string) => [...str].reduce((sum, ch) => sum + charW(ch), 0);
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && widthOf(candidate) > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 밴드 안 설명. 색/크기를 본문 수준으로 올려 읽히게 한다. */
function Desc({ x, y, maxW, text }: { x: number; y: number; maxW: number; text: string }) {
  const lines = wrapText(text, maxW);
  return (
    <text x={x} y={y} fontSize={DESC_FONT_SIZE} fontFamily="var(--font-ui)" fill="var(--text-dim)">
      {lines.map((line, i) => (
        <tspan key={line} x={x} dy={i === 0 ? 0 : DESC_LINE_H}>{line}</tspan>
      ))}
    </text>
  );
}
