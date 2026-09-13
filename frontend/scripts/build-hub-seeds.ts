/**
 * Hub 시드 콘텐츠 생성기 (M5-T8 · WORK_PLAN §5.6 P1) — `npm run build:hub-seeds`
 *
 * 레지스트리(`knode-hub`)의 `teams/<slug>/` 10종을 만든다:
 *  - 기존 내장 템플릿 5종 (`src/templates/builtin.ts` 가 단일 진실)
 *  - 이 파일이 정의하는 신규 5종 (레지스트리 전용 — 앱 번들에는 넣지 않는다)
 *
 * 왜 앱 번들이 아니라 여기냐: 내장 템플릿은 **백엔드 없이도 뜨는 갤러리**라
 * i18n 번들 2개를 같이 늘려야 하고(§17.3), 그건 "레지스트리에 팀이 10개 있다"와
 * 아무 상관이 없다. 시드는 레지스트리 콘텐츠지 제품 기능이 아니다.
 *
 * ⚠️ 시드 문서는 **영어로 고정**한다. 레지스트리는 하나뿐인 공용 리포라 언어가
 * 섞이면 목록이 읽히지 않는다. 내장 템플릿 5종도 `applyLocale('en')` 후에 빌드해
 * 캔버스에 박히는 역할·목표까지 영어로 떨어뜨린다(M4-T4 에서 i18n 화한 그 값들).
 *
 * README 는 앱이 기여자에게 주는 것과 **같은 생성기**(`features/publish/submission.ts`)
 * 로 만들고, 사람이 채워야 할 자리(`<!-- ... -->`)만 여기서 손으로 채운다 — 시드가
 * 가이드와 다른 방식으로 만들어지면 가이드가 곧 거짓말이 된다.
 *
 * 썸네일(`preview.png`)은 실 브라우저 캡처라 여기서 못 만든다 —
 * `e2e/tools/hub-previews.spec.ts` 가 이 스크립트의 산출물을 읽어 채운다.
 *
 * ⚠️ 이 파일이 옆의 `export-templates.mjs` 와 달리 **`.ts` 인 것은 취향이 아니다.**
 * tsx 는 `.mjs` 진입점과 그 아래 TS 모듈들을 서로 다른 모듈 그래프(ESM/CJS)로
 * 올려서, `.mjs` 에서 `applyLocale('en')` 을 불러도 `builtin.ts` 안의 `t()` 는
 * 여전히 기본 로케일(ko)을 본다 — 실제로 그렇게 한국어 시드가 한 번 만들어졌다.
 * 진입점을 `.ts` 로 두면 전부 한 그래프에 올라가 로케일이 제대로 걸린다.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyLocale } from '@/i18n';
import { BUILTIN_TEMPLATES, Builder } from '@/templates/builtin';
import { teamReadme } from '@/features/publish/submission';
import type { CanvasDoc, LicenseId } from '@/types/canvas';

applyLocale('en');

const here = dirname(fileURLToPath(import.meta.url));
const hubRoot = process.env.HUB_ROOT ?? resolve(here, '../../../knode-hub');

/** 재실행해도 바이트가 같아야 diff 가 조용하다 (`export-templates.mjs` 와 같은 관례). */
const FROZEN_AT = '2026-09-08T00:00:00.000Z';

/** 시드는 복사되라고 있는 것이다 — 가장 걸림돌이 적은 조건을 고른다 (P-D4). */
const SEED_LICENSE: LicenseId = 'CC0-1.0';
const SEED_AUTHOR = 'Knode';

const OPENAI = { name: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini' };

/* ────────────────────────── 신규 5종 ────────────────────────── */

/** 1. 회의록 → 액션 아이템 (Ollama · 키 0개) */
function meetingNotes() {
  const b = new Builder();
  b.node('input', 40, 40, {
    var_name: 'transcript', label: 'Meeting transcript', input_type: 'textarea',
    default_value: '', required: true,
  });
  const llm = b.node('llm', 40, 300, {
    name: 'Local Llama', provider: 'ollama', model: 'llama3', temperature: 0.2,
  });

  const scribe = b.node('agent', 400, 40, {
    name: 'Scribe',
    role: 'Meeting scribe',
    goal: 'Pull the decisions and open questions out of a raw transcript without inventing any.',
    backstory: 'You have taken minutes for years. You know the difference between what a room decided and what someone merely floated, and you never blur the two.',
  });
  const tracker = b.node('agent', 400, 340, {
    name: 'Action Tracker',
    role: 'Action item tracker',
    goal: 'Turn decisions into action items that name an owner and a due date, and flag the ones that have neither.',
    backstory: 'You have watched enough action items die to know that an item without a name attached is a wish, not a task.',
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Extract Decisions',
    description: 'Read the transcript below and list, separately: (a) decisions that were actually made, (b) open questions left unresolved, (c) anything that was raised and explicitly dropped. Quote the line that supports each item. Do not add anything that is not in the transcript.\n\n{transcript}',
    expected_output: 'Three markdown sections — Decisions, Open questions, Dropped — each a bullet list with a short supporting quote.',
  });
  const t2 = b.node('task', 780, 340, {
    name: 'Write Action Items',
    description: 'Turn the decisions into action items. Each item: what happens, who owns it, by when. If the transcript never named an owner or a date, write "unassigned" or "no date" rather than guessing. End with a one-line summary of what is blocked.',
    expected_output: 'A markdown table (Action | Owner | Due) followed by a one-line blockers note.',
  });

  const crew = b.node('crew', 1160, 190, { name: 'Meeting Notes Crew', process: 'sequential' });
  const out = b.node('output', 1520, 190, { title: 'Action items' });

  for (const a of [scribe, tracker]) {
    b.link(llm, 'llm', a, 'llm');
    b.link(a, 'agent', crew, 'agent');
  }
  b.link(scribe, 'agent', t1, 'agent');
  b.link(tracker, 'agent', t2, 'agent');
  b.link(t1, 'task', t2, 'context');
  for (const t of [t1, t2]) b.link(t, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');

  return b.doc(
    'Meeting Notes to Action Items',
    'Paste a transcript; get decisions, open questions and an owner-and-date action table. Runs entirely on your own Ollama — nothing leaves the machine.',
    [],
    'meeting_notes',
  );
}

/** 2. 채용공고 맞춤 이력서 (OpenAI) */
function resumeTailor() {
  const b = new Builder();
  b.node('input', 40, 40, {
    var_name: 'job_posting', label: 'Job posting', input_type: 'textarea',
    default_value: '', required: true,
  });
  b.node('input', 40, 260, {
    var_name: 'resume', label: 'Your current résumé', input_type: 'textarea',
    default_value: '', required: true,
  });
  const llm = b.node('llm', 40, 480, { ...OPENAI, temperature: 0.4 });

  const analyst = b.node('agent', 400, 40, {
    name: 'Posting Analyst',
    role: 'Job posting analyst',
    goal: 'Separate what a posting actually requires from the boilerplate around it.',
    backstory: 'You have read thousands of postings and learned that the real requirements are usually four or five lines buried in a page of template text.',
  });
  const editor = b.node('agent', 400, 340, {
    name: 'Résumé Editor',
    role: 'Résumé editor',
    goal: 'Rewrite existing experience so the relevant parts lead, without inventing anything that is not already there.',
    backstory: 'You edit; you do not fabricate. If a claim is not supported by the résumé you were given, it does not go in the rewrite.',
  });
  const coach = b.node('agent', 400, 640, {
    name: 'Gap Coach',
    role: 'Interview preparation coach',
    goal: 'Name the gaps honestly and prepare an answer for each one.',
    backstory: 'You have sat on both sides of the table. You know an interviewer will find the gap anyway, so the only question is whether the candidate got there first.',
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Analyze Posting',
    description: 'From the posting below, extract: hard requirements, nice-to-haves, and the words the employer keeps repeating (those are what a screener greps for). Ignore boilerplate about culture and benefits.\n\n{job_posting}',
    expected_output: 'Three lists — Must have, Nice to have, Keywords — with nothing invented.',
  });
  const t2 = b.node('task', 780, 340, {
    name: 'Tailor Résumé',
    description: 'Rewrite the résumé below so the experience matching this posting comes first and uses the employer\'s own vocabulary. Keep every claim traceable to the original — reorder, reword and cut, but never add a skill or a result that is not already stated.\n\n{resume}',
    expected_output: 'A rewritten résumé in markdown, plus a short list of what you moved, reworded or cut and why.',
  });
  const t3 = b.node('task', 780, 640, {
    name: 'Prepare for Gaps',
    description: 'Compare the tailored résumé with the posting requirements. For each requirement the candidate does not clearly meet, write the question an interviewer will ask and a two-sentence honest answer that leans on adjacent experience.',
    expected_output: 'A Q&A list, one entry per gap, ordered by how likely the question is.',
  });

  const crew = b.node('crew', 1160, 340, { name: 'Résumé Tailoring Crew', process: 'sequential' });
  const out = b.node('output', 1520, 340, { title: 'Tailored résumé and interview prep' });

  for (const a of [analyst, editor, coach]) {
    b.link(llm, 'llm', a, 'llm');
    b.link(a, 'agent', crew, 'agent');
  }
  b.link(analyst, 'agent', t1, 'agent');
  b.link(editor, 'agent', t2, 'agent');
  b.link(coach, 'agent', t3, 'agent');
  b.link(t1, 'task', t2, 'context');
  b.link(t2, 'task', t3, 'context');
  for (const t of [t1, t2, t3]) b.link(t, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');

  return b.doc(
    'Résumé Tailor',
    'Reads a job posting and your résumé, puts the matching experience first in the employer\'s own words, then drills you on the gaps it could not paper over.',
    ['OPENAI_API_KEY'],
    'resume_tailor',
  );
}

/**
 * 3. 코드 리뷰 (OpenAI · **hierarchical**)
 *
 * 내장 템플릿 5종은 전부 `sequential` 이라 매니저 LLM 포트(`crew.llm`)를 쓰는
 * 그래프가 레지스트리에 하나도 없었다. `Process` 실측 멤버는 sequential/
 * hierarchical 둘뿐이고(`docs/CREWAI_RECON.md` §5), hierarchical 은 매니저 LLM 이
 * 없으면 AC-E103 으로 막힌다 — 그 연결을 눈으로 보여 주는 시드가 하나는 있어야 한다.
 */
function codeReview() {
  const b = new Builder();
  b.node('input', 40, 40, {
    var_name: 'diff', label: 'Unified diff', input_type: 'textarea',
    default_value: '', required: true,
  });
  const llm = b.node('llm', 40, 300, { ...OPENAI, temperature: 0.2 });
  const manager = b.node('llm', 40, 560, {
    name: 'Manager', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1,
  });

  const correctness = b.node('agent', 400, 40, {
    name: 'Correctness Reviewer',
    role: 'Correctness reviewer',
    goal: 'Find the input that makes this diff do the wrong thing, and say what it does instead.',
    backstory: 'You have reviewed enough code to distrust anything that looks obviously right. You care about edge cases, error paths and the state a change leaves behind when it fails halfway.',
  });
  const tests = b.node('agent', 400, 340, {
    name: 'Test Reviewer',
    role: 'Test reviewer',
    goal: 'Decide whether the tests would actually fail if the change were wrong.',
    backstory: 'You have seen suites that pass no matter what the code does. A test that cannot fail is documentation with a green check next to it.',
  });
  const clarity = b.node('agent', 400, 640, {
    name: 'Clarity Reviewer',
    role: 'Readability reviewer',
    goal: 'Point out the parts a stranger would misread in six months, and only those.',
    backstory: 'You review for the next reader, not for style points. You do not raise naming nits that no one will act on.',
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Review Correctness',
    description: 'Review the diff below for defects. For each finding give: the file and line, the concrete input or state that triggers it, and what goes wrong. Order by severity. If you find nothing, say so plainly instead of padding the list.\n\n{diff}',
    expected_output: 'A severity-ordered list of findings, each with location, trigger and consequence — or an explicit "no correctness issues found".',
  });
  const t2 = b.node('task', 780, 340, {
    name: 'Review Tests',
    description: 'Judge the test changes in the diff. Which behaviours introduced here are not covered? Would the existing assertions fail if the new logic were broken? Name the missing case, not a coverage percentage.',
    expected_output: 'A list of uncovered behaviours and weak assertions, each with the test that should exist.',
  });
  const t3 = b.node('task', 780, 640, {
    name: 'Review Clarity',
    description: 'Point out anything in the diff that a reader unfamiliar with this code would misread: misleading names, a comment that no longer matches, control flow that hides an early return. Skip pure style preferences.',
    expected_output: 'A short list of readability problems, each with the rewrite you would suggest.',
  });

  // hierarchical 은 매니저가 태스크를 배분하므로 태스크끼리 context 로 묶지 않는다.
  const crew = b.node('crew', 1160, 340, {
    name: 'Code Review Crew', process: 'hierarchical', memory: false,
  });
  const out = b.node('output', 1520, 340, { title: 'Review' });

  for (const a of [correctness, tests, clarity]) {
    b.link(llm, 'llm', a, 'llm');
    b.link(a, 'agent', crew, 'agent');
  }
  b.link(manager, 'llm', crew, 'llm'); // AC-E103 이 요구하는 매니저 LLM
  b.link(correctness, 'agent', t1, 'agent');
  b.link(tests, 'agent', t2, 'agent');
  b.link(clarity, 'agent', t3, 'agent');
  for (const t of [t1, t2, t3]) b.link(t, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');

  return b.doc(
    'Code Review Crew',
    'Three reviewers — correctness, tests, readability — working under a manager LLM instead of a fixed order. Paste a unified diff and get findings ranked by what actually breaks.',
    ['OPENAI_API_KEY'],
    'code_review',
  );
}

/**
 * 4. 고객 문의 트리아지 (OpenAI · **사람 검토**)
 *
 * `human` 노드(Spec §5.10)를 쓰는 첫 시드. 초안을 사람이 보고 나가는 흐름은
 * 실제 지원 업무의 기본값인데, 그래프로 그려 놓지 않으면 아무도 그 노드가 있는 줄
 * 모른다.
 */
function supportTriage() {
  const b = new Builder();
  b.node('input', 40, 40, {
    var_name: 'ticket', label: 'Customer message', input_type: 'textarea',
    default_value: '', required: true,
  });
  b.node('input', 40, 260, {
    var_name: 'product', label: 'Product or plan name', input_type: 'text',
    default_value: 'our product', required: true,
  });
  const llm = b.node('llm', 40, 460, { ...OPENAI, temperature: 0.3 });

  const triager = b.node('agent', 400, 40, {
    name: 'Triager',
    role: 'Support triage specialist',
    goal: 'Decide what this message actually is — bug, billing, how-to, or something that needs a human now — and how urgent it is.',
    backstory: 'You have worked a queue long enough to spot the angry-but-trivial and the polite-but-on-fire, and to tell them apart quickly.',
  });
  const drafter = b.node('agent', 400, 340, {
    name: 'Reply Drafter',
    role: 'Support reply writer',
    goal: 'Write a reply that answers the actual question, admits what is unknown, and never promises a fix or a date.',
    backstory: 'You write the way a good support engineer talks: short, specific, no false cheer. You would rather say "I do not know yet, here is what I am checking" than invent a timeline.',
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Triage Ticket',
    description: 'Classify the customer message below about {product}. Output: category (bug / billing / how-to / feature request / escalate), urgency (low / normal / high) with a one-line reason, and the single question that must be answered for this to be resolved.\n\n{ticket}',
    expected_output: 'Category, urgency with reason, and the one blocking question — nothing else.',
  });
  const t2 = b.node('task', 780, 340, {
    name: 'Draft Reply',
    description: 'Write the reply to the customer. Answer the blocking question if it can be answered from the message; if it cannot, ask for exactly the information you need, one item at a time. Do not promise a fix, a refund or a date. Keep it under 150 words.',
    expected_output: 'A ready-to-send reply under 150 words, plus a one-line internal note on what the agent should check before sending.',
  });

  // 사람 검토는 초안 태스크 뒤에 붙는다 — 나가는 것은 사람이 본 문장뿐이다.
  const human = b.node('human', 1160, 620, {
    name: 'Approve Reply',
    prompt: 'Read the drafted reply. Send it as-is, or paste the version you want sent.',
    timeout_s: 900,
    on_timeout: 'abort',
  });

  const crew = b.node('crew', 1160, 190, { name: 'Support Triage Crew', process: 'sequential' });
  const out = b.node('output', 1520, 190, { title: 'Reply and triage note' });

  for (const a of [triager, drafter]) {
    b.link(llm, 'llm', a, 'llm');
    b.link(a, 'agent', crew, 'agent');
  }
  b.link(triager, 'agent', t1, 'agent');
  b.link(drafter, 'agent', t2, 'agent');
  b.link(t1, 'task', t2, 'context');
  for (const t of [t1, t2]) b.link(t, 'task', crew, 'task');
  b.link(t2, 'task', human, 'task');
  b.link(crew, 'result', out, 'result');

  return b.doc(
    'Support Triage Desk',
    'Classifies an incoming customer message, drafts a reply that refuses to invent timelines, and stops for a human to approve before anything is sent.',
    ['OPENAI_API_KEY'],
    'support_triage',
  );
}

/** 5. 경쟁사 가격·기능 추적 (OpenAI + Serper · 검색 + 스크레이프) */
function priceWatch() {
  const b = new Builder();
  b.node('input', 40, 40, {
    var_name: 'competitors', label: 'Competitors (comma separated)', input_type: 'text',
    default_value: 'Notion, Coda, Obsidian', required: true,
  });
  b.node('input', 40, 240, {
    var_name: 'segment', label: 'Plan or segment to compare', input_type: 'text',
    default_value: 'team plans', required: true,
  });
  const llm = b.node('llm', 40, 440, { ...OPENAI, temperature: 0.2 });
  const search = b.node('tool', 40, 640, { name: 'Web Search', tool_id: 'serper_search' });
  const scraper = b.node('tool', 40, 800, { name: 'Page Scraper', tool_id: 'scrape_website' });

  const scout = b.node('agent', 400, 40, {
    name: 'Pricing Scout',
    role: 'Pricing researcher',
    goal: 'Find each competitor\'s current published prices and write down where you found them.',
    backstory: 'You have been burned by stale pricing pages and by prices quoted in blog posts from two years ago. You cite the page you actually read, every time.',
  });
  const analyst = b.node('agent', 400, 340, {
    name: 'Positioning Analyst',
    role: 'Competitive analyst',
    goal: 'Say what the price differences mean for buyers, and refuse to compare things that are not comparable.',
    backstory: 'You have seen enough feature matrices that flatter whoever built them. When two plans cannot be compared on the same axis, you say so instead of forcing a row.',
  });

  const t1 = b.node('task', 780, 40, {
    name: 'Collect Prices',
    description: 'For each of {competitors}, find the current price of their {segment}: the list price, the billing period, what is included and what is gated. Open the vendor\'s own pricing page rather than trusting a summary. Record the URL and the date you saw it for each figure. Mark anything you could not confirm as "unconfirmed" instead of estimating.',
    expected_output: 'One block per competitor: price, period, included, gated, source URL, date — with unconfirmed figures marked.',
  });
  const t2 = b.node('task', 780, 340, {
    name: 'Compare and Position',
    description: 'Build a comparison of the collected prices for {segment}. Where plans are not comparable (different seat definitions, usage limits, bundled services), say that explicitly rather than forcing them into one row. Close with the two or three differences a buyer would actually decide on.',
    expected_output: 'A markdown comparison table, a short list of non-comparable items, and 2–3 deciding differences.',
  });

  const crew = b.node('crew', 1160, 190, { name: 'Price Watch Crew', process: 'sequential' });
  const out = b.node('output', 1520, 190, { title: 'Competitor pricing brief' });

  for (const a of [scout, analyst]) {
    b.link(llm, 'llm', a, 'llm');
    b.link(a, 'agent', crew, 'agent');
  }
  b.link(search, 'tool', scout, 'tool');
  b.link(scraper, 'tool', scout, 'tool');
  b.link(scout, 'agent', t1, 'agent');
  b.link(analyst, 'agent', t2, 'agent');
  b.link(t1, 'task', t2, 'context');
  for (const t of [t1, t2]) b.link(t, 'task', crew, 'task');
  b.link(crew, 'result', out, 'result');

  return b.doc(
    'Competitor Price Watch',
    'Reads competitors\' own pricing pages, records what it saw and where, then compares only the things that are actually comparable.',
    ['OPENAI_API_KEY', 'SERPER_API_KEY'],
    'price_watch',
  );
}

/* ────────────────────────── 시드 목록 ────────────────────────── */

/**
 * `intro` 는 `teamReadme()` 가 남기는 `<!-- ... -->` 자리에 들어간다 — 생성기가
 * 대신 써 줄 수 없는 유일한 문단(왜 이 팀이 있는가)이라 손으로 쓴다.
 */
interface NewTeam {
  slug: string;
  build: () => CanvasDoc;
  difficulty: 1 | 2 | 3;
  tags: string[];
  intro: string;
}

const NEW_TEAMS: NewTeam[] = [
  {
    slug: 'meeting-notes-to-actions', build: meetingNotes, difficulty: 1,
    tags: ['local', 'ollama', 'meetings', 'no-key'],
    intro: 'Most meeting summarizers give you a paragraph nobody reads. This one splits what was **decided** from what was merely **raised**, then forces every decision into an owner-and-date row — the two moves that turn a transcript into something you can chase next week.\n\nIt runs on your own Ollama, so transcripts of internal meetings never leave the machine. That is the point: the meetings most worth summarizing are usually the ones you cannot paste into a hosted model.',
  },
  {
    slug: 'resume-tailor', build: resumeTailor, difficulty: 2,
    tags: ['career', 'writing', 'openai'],
    intro: 'Tailoring a résumé is mostly reordering, not rewriting — but doing it by hand for every posting is tedious enough that people skip it and send the same file everywhere.\n\nThe editor here is explicitly forbidden from inventing experience: it reorders, rewords and cuts, and reports what it changed. The third agent then does the part people avoid — naming the requirements you do **not** meet and preparing an honest answer, because the interviewer will find them anyway.',
  },
  {
    slug: 'code-review-crew', build: codeReview, difficulty: 2,
    tags: ['engineering', 'review', 'hierarchical', 'openai'],
    intro: 'Three reviewers with genuinely different jobs: one hunts for the input that breaks the change, one asks whether the tests would fail if it were wrong, one reads it as a stranger would in six months.\n\nThis is also the reference graph for a **hierarchical** crew. Instead of a fixed task order, a manager LLM (the second LLM node, wired into the Crew\'s `manager llm` port) decides who works on what — which is why the tasks here are not chained with context edges.',
  },
  {
    slug: 'support-triage-desk', build: supportTriage, difficulty: 3,
    tags: ['support', 'human-in-the-loop', 'openai'],
    intro: 'The failure mode of automated support replies is not bad grammar — it is confident invention: a fix that is not planned, a refund nobody approved, a date nobody committed to. The drafter here is told to answer or ask, never to promise.\n\nIt is also the reference graph for the **Human Review** node: the draft stops and waits for a person, who can send it as-is or paste their own version. Nothing reaches a customer that a human did not read.',
  },
  {
    slug: 'competitor-price-watch', build: priceWatch, difficulty: 2,
    tags: ['research', 'pricing', 'search', 'openai', 'serper'],
    intro: 'Pricing research goes stale the moment it is written, and secondhand summaries are stale before that. This crew opens the vendors\' own pricing pages and records a URL and a date next to every figure, marking anything it could not confirm rather than estimating.\n\nThe analyst is instructed to refuse comparisons that do not hold — different seat definitions, bundled services, usage caps — because a tidy table that quietly compares unlike things is worse than no table.',
  },
];

/* ────────────────────────── 조립 ────────────────────────── */

interface SeedMeta {
  slug: string;
  difficulty: 1 | 2 | 3;
  tags: string[];
  requiresKeys: string[];
  estimatedCostUsd?: number;
}

function finalize(doc: CanvasDoc, { slug, difficulty, tags, requiresKeys, estimatedCostUsd }: SeedMeta): CanvasDoc {
  return {
    ...doc,
    id: `cvs_hub_${slug.replace(/-/g, '_')}`,
    author: SEED_AUTHOR,
    license: SEED_LICENSE,
    tags: [...tags].sort(),
    revision: 1,
    forked_from: null,
    created_at: FROZEN_AT,
    updated_at: FROZEN_AT,
    meta: {
      ...doc.meta,
      requires_keys: requiresKeys,
      ...(estimatedCostUsd === undefined ? {} : { estimated_cost_usd: estimatedCostUsd }),
      difficulty,
    },
  };
}

/** 내장 템플릿 → 시드 슬러그/태그 (이름은 로케일마다 달라 슬러그를 못 뽑는다). */
const BUILTIN_SEEDS: Record<string, { slug: string; tags: string[]; intro: string }> = {
  hello: { slug: 'hello-crew', tags: ['starter', 'openai'], intro: 'The smallest crew that still does something: one agent, one task, one result. If you have never run a Knode team before, run this one first — it costs a fraction of a cent and proves your key, your backend and your browser all talk to each other.' },
  blog: { slug: 'blog-and-seo-crew', tags: ['writing', 'seo', 'search', 'openai', 'serper'], intro: 'Research, draft, optimize — the pipeline most content teams run informally, drawn explicitly so you can see where the handoffs are. The SEO agent gets a scraper so it can look at what currently ranks instead of guessing.' },
  market_research: { slug: 'market-research-crew', tags: ['research', 'report', 'search', 'openai', 'serper'], intro: 'Three researchers work independent angles — demand, competitors, trends — and an analyst synthesizes them. The three research tasks are deliberately **not** chained to each other: they only meet in the synthesis task, so one researcher\'s framing does not contaminate the others.' },
  youtube: { slug: 'youtube-script-pipeline', tags: ['video', 'writing', 'openai'], intro: 'Plan, script, then rework the opening. The hook specialist exists as a separate agent for a reason: the same model that just wrote eight minutes of script is the worst judge of whether its first fifteen seconds earn them.' },
  local: { slug: 'local-summarizer', tags: ['local', 'ollama', 'no-key', 'starter'], intro: 'A summarizer that never sends your text anywhere. Point the LLM node at whatever model your Ollama has pulled and it runs offline, for free — the honest starting point for anything you would not paste into a hosted API.' },
};

function main(): void {
  const seeds: Array<{ slug: string; intro: string; doc: CanvasDoc }> = [];

  for (const tpl of BUILTIN_TEMPLATES) {
    const meta = BUILTIN_SEEDS[tpl.id];
    if (!meta) throw new Error(`내장 템플릿 '${tpl.id}' 의 시드 매핑이 없다 — 템플릿이 늘었으면 여기도 늘려야 한다`);
    seeds.push({
      slug: meta.slug,
      intro: meta.intro,
      doc: finalize(tpl.build(), {
        slug: meta.slug,
        difficulty: tpl.difficulty,
        tags: meta.tags,
        requiresKeys: tpl.requiresKeys,
        estimatedCostUsd: tpl.estimatedCostUsd,
      }),
    });
  }

  for (const team of NEW_TEAMS) {
    const doc = team.build();
    seeds.push({
      slug: team.slug,
      intro: team.intro,
      doc: finalize(doc, {
        slug: team.slug,
        difficulty: team.difficulty,
        tags: team.tags,
        requiresKeys: doc.meta.requires_keys,
      }),
    });
  }

  for (const seed of seeds) {
    const dir = join(hubRoot, 'teams', seed.slug);
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, 'team.acanvas.json'), `${JSON.stringify(seed.doc, null, 2)}\n`, 'utf8');

    // 앱이 기여자에게 주는 것과 같은 스캐폴드. 사람이 채울 자리만 여기서 채운다.
    const readme = teamReadme(seed.doc).replace(
      '<!-- A sentence or two on why this team exists and when it is worth running. -->',
      seed.intro,
    );
    writeFileSync(join(dir, 'README.md'), readme, 'utf8');

    console.log(`✓ ${seed.slug} — 노드 ${seed.doc.nodes.length} / 엣지 ${seed.doc.edges.length}`);
  }

  console.log(`\n시드 ${seeds.length}종을 ${join(hubRoot, 'teams')} 에 썼습니다.`);
  console.log('preview.png 는 e2e/tools/hub-previews.spec.ts 가 채웁니다.');
}

main();
