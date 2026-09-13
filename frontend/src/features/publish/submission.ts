/**
 * 게시 번들 → 레지스트리 PR 로 넘어가는 다리 (M5-T8 · WORK_PLAN §5.6 P1).
 *
 * `PublishPreview` 1단계가 "무엇이 공개되는가"(M5-T3)를 보여 준다면, 이 모듈은
 * 2단계 — **그래서 그걸 어떻게 올리는가** — 에 필요한 값들을 만든다. 레지스트리는
 * 계정이 없고 제출은 PR 이므로(P-D1), 사용자가 실제로 손에 쥐어야 하는 건
 * `teams/<slug>/` 아래 놓을 **파일 3개**와 그 자리로 옮기는 명령 몇 줄뿐이다.
 *
 * 여기 있는 것은 전부 순수 함수다 — 화면/다운로드/클립보드 같은 부작용은
 * `PublishPreview.tsx` 가 맡는다(이 파일이 유닛테스트로 고정되는 이유).
 *
 * ⚠️ **README 스캐폴드는 UI 로케일과 무관하게 영어다.** 이 문자열은 화면이 아니라
 * 공용 레지스트리 리포에 **파일로 커밋**된다 — 기여자의 UI 언어에 따라 같은 리포의
 * README 가 한국어/영어로 갈리면 리뷰어도 독자도 곤란해진다(리포 자체가 영어다).
 * 사용자가 쓴 값(이름·설명·역할)은 그대로 실리므로 팀의 언어는 보존된다.
 */

import type { CanvasDoc } from '@/types/canvas';

/** `build_index.py::REQUIRED_TEAM_FILES` 와 같은 이름이어야 한다. */
export const TEAM_DOC_FILENAME = 'team.acanvas.json';
export const TEAM_README_FILENAME = 'README.md';
export const TEAM_PREVIEW_FILENAME = 'preview.png';

/** 디렉터리 이름이 URL 에 그대로 노출되므로 길이를 제한한다. */
const SLUG_MAX = 48;

/**
 * `teams/<slug>/` 디렉터리 이름.
 *
 * `fileIO.ts::slugify` 와 **일부러 다르다**: 저쪽은 내 머신에 떨어질 다운로드
 * 파일명이라 한글을 그대로 살리지만, 이쪽은 공용 리포의 디렉터리명이자 URL 경로다.
 * 한국어 이름("시장 조사 리포트")이 그대로 들어가면 raw URL 이 퍼센트 인코딩으로
 * 뭉개지고 CLI 에서 다루기도 나빠진다. 그래서 **ASCII 로만** 만들고, 남는 글자가
 * 없으면 문서 id 꼬리를 빌려 최소한 서로 충돌하지 않는 이름을 준다.
 */
export function hubSlug(name: string, docId?: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // NFKD 로 분리된 발음기호 제거 (é → e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  if (ascii) return ascii;

  // 이름이 통째로 비ASCII 인 경우(한국어 팀 이름이 정확히 이렇다). 이름을 못 쓰니
  // id 꼬리로라도 서로 다른 디렉터리가 되게 한다 — 사용자가 곧바로 고쳐 쓰라고
  // 화면에서는 편집 가능한 입력으로 보여 준다.
  const tail = (docId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toLowerCase();
  return tail ? `team-${tail}` : 'team';
}

/** 사용자가 직접 고쳐 넣은 슬러그를 안전한 형태로 되돌린다(입력 중에도 호출된다). */
export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SLUG_MAX);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length <= SLUG_MAX;
}

/* ────────────────────────── README 스캐폴드 ────────────────────────── */

interface AgentRow { name: string; role: string; }
interface TaskRow { name: string; expected: string; }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 표 한 칸 — 파이프는 표를 깨고, 줄바꿈은 행을 깬다. 길면 자른다. */
function cell(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function agentsOf(doc: CanvasDoc): AgentRow[] {
  return doc.nodes
    .filter((n) => n.type === 'agent' && !n.ui?.bypassed)
    .map((n) => ({ name: str(n.data.name) || n.id, role: str(n.data.role) }));
}

function tasksOf(doc: CanvasDoc): TaskRow[] {
  return doc.nodes
    .filter((n) => n.type === 'task' && !n.ui?.bypassed)
    .map((n) => ({ name: str(n.data.name) || n.id, expected: str(n.data.expected_output) }));
}

/** LLM 노드가 실제로 쓰는 모델들 — "이 팀을 돌리려면 뭐가 필요한가"의 절반이다. */
function modelsOf(doc: CanvasDoc): string[] {
  const seen = new Set<string>();
  for (const n of doc.nodes) {
    if (n.type !== 'llm') continue;
    const provider = str(n.data.provider);
    const model = str(n.data.model);
    if (model) seen.add(provider ? `${provider}/${model}` : model);
  }
  return [...seen];
}

export interface TeamReadmeOptions {
  /** 앱 리포 URL — 실행 안내에 쓴다. */
  appUrl?: string;
}

/**
 * `teams/<slug>/README.md` 초안. 기여자가 그대로 커밋해도 정보가 있는 문서가 되게
 * 하되, 사람이 채워야 의미가 생기는 자리(왜 만들었는가)는 주석으로 남겨 둔다 —
 * 자동 생성 문장으로 채워 두면 아무도 안 고치고 전부 똑같은 README 가 쌓인다.
 */
export function teamReadme(doc: CanvasDoc, options: TeamReadmeOptions = {}): string {
  const appUrl = options.appUrl ?? 'https://github.com/hynwl/knode';
  const agents = agentsOf(doc);
  const tasks = tasksOf(doc);
  const keys = doc.meta?.requires_keys ?? [];
  const models = modelsOf(doc);

  const lines: string[] = [];
  lines.push(`# ${cell(doc.name || 'Untitled Crew', 80)}`, '');
  if (str(doc.description)) lines.push(cell(doc.description ?? '', 400), '');

  lines.push('|  |  |', '| --- | --- |');
  lines.push(`| Author | ${cell(str(doc.author) || 'anonymous', 60)} |`);
  lines.push(`| License | ${doc.license ?? '_not specified_'} |`);
  lines.push(`| API keys | ${keys.length ? keys.map((k) => `\`${k}\``).join(', ') : 'none — runs locally'} |`);
  if (models.length) lines.push(`| Models | ${models.map((m) => `\`${m}\``).join(', ')} |`);
  lines.push(`| Graph | ${doc.nodes.length} nodes · ${doc.edges.length} edges |`);
  lines.push('');

  lines.push('## What it does', '');
  lines.push('<!-- A sentence or two on why this team exists and when it is worth running. -->', '');

  if (agents.length) {
    lines.push('## Agents', '', '| Agent | Role |', '| --- | --- |');
    for (const a of agents) lines.push(`| ${cell(a.name, 60)} | ${cell(a.role) || '—'} |`);
    lines.push('');
  }

  if (tasks.length) {
    lines.push('## Tasks', '');
    tasks.forEach((t, i) => {
      lines.push(`${i + 1}. **${cell(t.name, 60)}**${t.expected ? ` — expects ${cell(t.expected)}` : ''}`);
    });
    lines.push('');
  }

  lines.push('## Run it', '');
  lines.push(`1. Open [Knode](${appUrl}) (hosted or self-hosted).`);
  lines.push('2. **Templates → Hub → Fork** on this team.');
  lines.push(keys.length
    ? `3. Add ${keys.map((k) => `\`${k}\``).join(' and ')} under **API keys** — they stay in your browser.`
    : '3. No API keys needed. Point the LLM node at a model your Ollama has pulled.');
  lines.push('4. Press **Run**.', '');

  return `${lines.join('\n')}`;
}

/* ────────────────────────── 제출 명령 ────────────────────────── */

export interface SubmissionShellOptions {
  slug: string;
  /** 브라우저가 실제로 떨어뜨린 문서 파일명 (`market-research.acanvas.json`). */
  downloadedDocName: string;
  /** 기여자가 포크한 hub 리포의 로컬 클론 경로 자리. */
  repoDirName?: string;
}

/**
 * 다운로드 폴더 → `teams/<slug>/` 로 옮기고 인덱스를 다시 만드는 최소 명령.
 * 화면에 복사 버튼과 함께 붙는다 — 이름이 셋 다 다르기 때문에(다운로드명 ≠
 * 레지스트리 파일명) 말로 설명하면 반드시 틀린다.
 */
export function submissionShell(options: SubmissionShellOptions): string {
  const { slug, downloadedDocName, repoDirName = 'knode-hub' } = options;
  return [
    `cd ${repoDirName}`,
    `mkdir -p teams/${slug}`,
    `mv ~/Downloads/${downloadedDocName} teams/${slug}/${TEAM_DOC_FILENAME}`,
    `mv ~/Downloads/${TEAM_PREVIEW_FILENAME} teams/${slug}/${TEAM_PREVIEW_FILENAME}`,
    `# paste the README above into teams/${slug}/${TEAM_README_FILENAME}`,
    'python3 scripts/build_index.py',
    `python3 scripts/validate_submission.py ${slug}`,
  ].join('\n');
}

/* ────────────────────────── 파일 이름 ────────────────────────── */

/**
 * 문서 다운로드 파일명. `teams/<slug>/team.acanvas.json` 로 **이름을 바꿔** 넣어야
 * 하지만, 다운로드 자체를 `team.acanvas.json` 으로 주면 팀을 두 개 이상 만들 때
 * `team (1).acanvas.json` 이 되어 오히려 헷갈린다. 슬러그로 받고, 옮기는 명령이
 * 이름 변경까지 한 줄로 보여 준다.
 */
export function bundleFilename(slug: string): string {
  return `${slug}.acanvas.json`;
}
