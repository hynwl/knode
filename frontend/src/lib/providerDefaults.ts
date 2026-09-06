/**
 * 프로바이더를 바꿨을 때 `model` 을 무엇으로 갈아끼울지.
 *
 * 예전엔 프로바이더만 바뀌고 `model` 은 그대로 남았다 — OpenAI → Ollama 로 바꾸면
 * `gpt-4o-mini` 가 그대로 남아 곧바로 `AC-E702`(미설치 모델)로 실행이 잠겼고,
 * 사용자는 모델 칸을 손으로 고쳐야 했다. 프로바이더가 바뀌면 모델도 그 프로바이더
 * 것이어야 한다는 게 유일하게 말이 되는 기본값이다.
 *
 * 고르는 순서는 **실제로 쓸 수 있는 것 우선**이다:
 *   1. 그 프로바이더에서 지금 쓸 수 있는 모델 목록(Ollama = 설치된 것,
 *      원격 = 등록된 키로 조회한 것) 중 선호 접두사와 맞는 것
 *   2. 그 목록의 첫 번째
 *   3. 목록 자체가 없으면(키 미등록·백엔드 꺼짐) 정적 기본값
 *
 * 1번이 있는 이유: `llama3` 라고만 적어 두면 실제 설치명이 `llama3:latest` 인
 * 환경에서 바로 `AC-E702` 가 뜬다. 설치된 이름을 그대로 골라야 실행까지 이어진다.
 */

/** 프로바이더별 선호 모델 접두사 + 목록이 없을 때 쓸 정적 폴백. */
export const PROVIDER_DEFAULT_MODEL: Record<string, { prefer: string; fallback: string }> = {
  // 사용자 요청: Ollama 로 바꾸면 llama3 가 잡히도록.
  ollama: { prefer: 'llama3', fallback: 'llama3' },
  openai: { prefer: 'gpt-4o-mini', fallback: 'gpt-4o-mini' },
  anthropic: { prefer: 'claude-3-5-haiku', fallback: 'claude-3-5-haiku-latest' },
  gemini: { prefer: 'gemini-2.0-flash', fallback: 'gemini-2.0-flash' },
  groq: { prefer: 'llama-3.1-8b', fallback: 'llama-3.1-8b-instant' },
  // 엔드포인트가 사용자 것이라 우리가 아는 이름이 없다. 자유 입력으로 남긴다.
  openai_compatible: { prefer: '', fallback: '' },
};

/**
 * @param provider  새로 고른 프로바이더
 * @param available 지금 그 프로바이더에서 고를 수 있는 모델 이름들 (없으면 빈 배열)
 */
export function defaultModelForProvider(provider: string, available: string[] = []): string {
  const spec = PROVIDER_DEFAULT_MODEL[provider];
  if (!spec) return available[0] ?? '';

  if (spec.prefer) {
    // `llama3` 로 `llama3:latest` 를 집되 `llama3.1` 도 후보로 받는다.
    // 정확히 일치하는 게 있으면 그게 1순위.
    const exact = available.find((m) => m === spec.prefer);
    if (exact) return exact;
    const prefixed = available.find((m) => m.startsWith(spec.prefer));
    if (prefixed) return prefixed;
  }
  return available[0] ?? spec.fallback;
}
