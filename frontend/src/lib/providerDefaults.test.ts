/**
 * 프로바이더를 바꿀 때 따라오는 모델 기본값.
 *
 * 회귀 대상: 예전엔 프로바이더만 바뀌고 `model` 이 그대로 남아, OpenAI → Ollama 로
 * 바꾸면 `gpt-4o-mini` 가 남아 곧바로 AC-E702 로 실행이 잠겼다.
 */

import { describe, expect, it } from 'vitest';
import { defaultModelForProvider, PROVIDER_DEFAULT_MODEL } from './providerDefaults';
import { PROVIDER_KEY_NAME } from '@/validation/rules';

describe('defaultModelForProvider()', () => {
  it('Ollama 로 바꾸면 설치된 llama3 를 고른다', () => {
    expect(defaultModelForProvider('ollama', ['codellama:latest', 'llama3:latest', 'phi4:latest']))
      .toBe('llama3:latest');
  });

  it('설치명이 정확히 llama3 면 그대로 쓴다', () => {
    expect(defaultModelForProvider('ollama', ['llama3', 'llama3:latest'])).toBe('llama3');
  });

  it('llama3 가 없으면 설치된 것 중 첫 번째로 폴백한다 (AC-E702 를 만들지 않는다)', () => {
    const installed = ['codellama:latest', 'phi4:latest'];
    const picked = defaultModelForProvider('ollama', installed);
    expect(installed).toContain(picked);
  });

  it('감지된 목록이 아예 없으면 정적 폴백을 쓴다', () => {
    expect(defaultModelForProvider('ollama', [])).toBe('llama3');
  });

  it('원격 프로바이더도 선호 모델을 목록에서 고른다', () => {
    expect(defaultModelForProvider('openai', ['gpt-4o', 'gpt-4o-mini'])).toBe('gpt-4o-mini');
    expect(defaultModelForProvider('groq', ['llama-3.1-8b-instant', 'gemma2-9b-it']))
      .toBe('llama-3.1-8b-instant');
  });

  it('openai_compatible 은 우리가 아는 이름이 없으므로 비워 둔다', () => {
    expect(defaultModelForProvider('openai_compatible', [])).toBe('');
  });

  it('모르는 프로바이더는 목록 첫 번째, 목록도 없으면 빈 문자열', () => {
    expect(defaultModelForProvider('who', ['x'])).toBe('x');
    expect(defaultModelForProvider('who', [])).toBe('');
  });

  it('지원 프로바이더 전부에 기본값이 정의돼 있다', () => {
    for (const provider of Object.keys(PROVIDER_KEY_NAME)) {
      expect(PROVIDER_DEFAULT_MODEL[provider], `${provider} 기본 모델 누락`).toBeDefined();
    }
  });
});
