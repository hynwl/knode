/**
 * Export 모달용 초경량 신택스 하이라이터 (Spec §8.5 "신택스 하이라이팅").
 *
 * highlight.js 같은 라이브러리를 붙이지 않은 이유: 기성 테마는 자기 색 팔레트를
 * 통째로 들고 오는데, 이 프로젝트는 아티팩트에서 뽑은 토큰이 단일 진실
 * 공급원이다(§1 디자인 락). 코드 블록 색은 아티팩트에 이미 `code.bg` /
 * `code.text` / `code.kw` 로 존재하고, 나머지(문자열·주석·숫자)는 기존 토큰
 * (emerald / text-faint / amber)을 재사용한다 — 새 색을 도입하지 않는다.
 *
 * 정확도는 "읽기 편할 정도"면 충분하다. 이 결과로 코드를 실행하지 않으며,
 * 오분류가 나도 표시만 달라진다. 값 자체는 항상 원문 그대로 렌더된다.
 *
 * ⚠️ 반환값은 문자열이 아니라 토큰 배열이다 — React 가 텍스트로 렌더하므로
 *    `dangerouslySetInnerHTML` 이 필요 없고, 따라서 주입 경로가 없다.
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number' | 'name';

export interface Token {
  text: string;
  kind: TokenKind;
}

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield',
]);

/**
 * 순서가 곧 우선순위다: **삼중따옴표** → 주석 → 홑따옴표 → 데코레이터 → 숫자 → 단어.
 *
 * 삼중따옴표가 맨 앞이어야 하는 이유가 두 가지다. (1) `"""` 를 홑따옴표 규칙이
 * 먼저 보면 빈 문자열 `""` 로 잘라 먹는다. (2) 생성 파일은 **모듈 docstring 으로
 * 시작**하는데, 그 안의 `pip install` 이나 `from ... import` 같은 안내 문구가
 * 주석·키워드로 잘못 칠해지면 사용자가 처음 보는 화면부터 어색해진다.
 *
 * 그 외 문자열은 줄을 넘지 않는다 — 생성 코드가 여러 줄 값을 줄마다 닫힌
 * 리터럴로 이어 붙이기 때문이다(`python_renderer.py::py_str`).
 */
const PY_TOKEN =
  /("""[\s\S]*?"""|'''[\s\S]*?''')|(#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(@[A-Za-z_]\w*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;

function pythonTokens(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of source.matchAll(PY_TOKEN)) {
    const [text, triple, comment, str, decorator, num, word] = match;
    const start = match.index;
    if (start > cursor) tokens.push({ text: source.slice(cursor, start), kind: 'plain' });

    if (triple) tokens.push({ text, kind: 'string' });
    else if (comment) tokens.push({ text, kind: 'comment' });
    else if (str) tokens.push({ text, kind: 'string' });
    else if (decorator) tokens.push({ text, kind: 'name' });
    else if (num) tokens.push({ text, kind: 'number' });
    else if (word) {
      // 대문자로 시작하면 클래스(Agent/Crew/Task/LLM…)로 본다 — 생성 코드에서는
      // 이 규칙만으로 CrewAI 심볼이 전부 잡힌다.
      const kind: TokenKind = PY_KEYWORDS.has(word) ? 'keyword' : /^[A-Z]/.test(word) ? 'name' : 'plain';
      tokens.push({ text, kind });
    }
    cursor = start + text.length;
  }
  if (cursor < source.length) tokens.push({ text: source.slice(cursor), kind: 'plain' });
  return tokens;
}

/** `.env.example` / `requirements.txt` — `#` 주석과 `KEY=` 이름만 구분한다. */
const LINE_TOKEN = /(#[^\n]*)|^([A-Za-z_][\w-]*)(?==)/gm;

function lineTokens(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of source.matchAll(LINE_TOKEN)) {
    const [text, comment, key] = match;
    const start = match.index;
    if (start > cursor) tokens.push({ text: source.slice(cursor, start), kind: 'plain' });
    tokens.push({ text, kind: comment ? 'comment' : key ? 'keyword' : 'plain' });
    cursor = start + text.length;
  }
  if (cursor < source.length) tokens.push({ text: source.slice(cursor), kind: 'plain' });
  return tokens;
}

export function tokenize(source: string, language: 'python' | 'text' | 'dotenv'): Token[] {
  return language === 'python' ? pythonTokens(source) : lineTokens(source);
}

/** 토큰 종류 → Tailwind 클래스. 전부 기존 디자인 토큰이다. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: '',
  comment: 'text-text-faint',
  string: 'text-emerald',
  keyword: 'text-code-kw',
  number: 'text-amber',
  name: 'text-rose',
};
