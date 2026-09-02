import { describe, expect, it } from 'vitest';
import { tokenize } from './syntax';

/**
 * 하이라이터의 **유일한 하드 요구사항**은 "원문을 한 글자도 바꾸지 않는다" 다.
 * 색 분류가 틀리면 보기만 이상하지만, 토큰을 흘리거나 겹쳐 내면 사용자가 복사한
 * 코드가 실제로 깨진다. 그래서 분류가 아니라 **가역성**을 고정한다.
 */
const SAMPLES = [
  '',
  'x = 1',
  "llm = LLM(model='openai/gpt-4o')  # 주석",
  'description=(\n    \'여러\\n\'\n    \'줄\'\n)',
  '# 한글 주석과 이모지 ⚠️\nOPENAI_API_KEY=',
  'text = "따옴표 \\" 이스케이프"',
  '@tool("Weather")\ndef weather(city: str) -> str:\n    return "x"',
  'n = 3.14\nflag = True\nnothing = None',
  '# 닫히지 않은 따옴표 \' 가 있는 줄\nnext_line = 1',
];

describe('tokenize', () => {
  for (const language of ['python', 'dotenv', 'text'] as const) {
    it.each(SAMPLES)(`[${language}] 토큰을 이으면 원문 그대로다: %j`, (source) => {
      expect(tokenize(source, language).map((t) => t.text).join('')).toBe(source);
    });
  }

  it('파이썬 키워드·문자열·주석·클래스명을 구분한다', () => {
    const kinds = new Map(
      tokenize("agent = Agent(role='r')  # 메모", 'python').map((t) => [t.text.trim(), t.kind]),
    );
    expect(kinds.get('Agent')).toBe('name');
    expect(kinds.get("'r'")).toBe('string');
    expect(kinds.get('# 메모')).toBe('comment');
    expect(kinds.get('agent')).toBe('plain');
  });

  it('모듈 docstring 을 통째로 문자열로 본다', () => {
    // 생성 파일은 항상 docstring 으로 시작한다. 그 안의 `from ... import` 안내
    // 문구가 키워드로, `# ...` 가 주석으로 칠해지면 첫 화면부터 어색해진다.
    const source = '"""제목\n\n    pip install -r requirements.txt\n    from crewai import Crew  # 안내\n"""\nimport os';
    const tokens = tokenize(source, 'python');
    const docstring = tokens[0]!;
    expect(docstring.kind).toBe('string');
    expect(docstring.text.endsWith('"""')).toBe(true);
    expect(docstring.text).toContain('from crewai import Crew');
    // docstring 바깥의 진짜 import 는 여전히 키워드다
    expect(tokens.find((t) => t.text === 'import')?.kind).toBe('keyword');
  });

  it('dotenv 는 키 이름과 주석만 구분한다', () => {
    const tokens = tokenize('# 설명\nOPENAI_API_KEY=', 'dotenv');
    expect(tokens.find((t) => t.text === 'OPENAI_API_KEY')?.kind).toBe('keyword');
    expect(tokens.find((t) => t.text === '# 설명')?.kind).toBe('comment');
  });
});
