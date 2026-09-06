'use client';

/**
 * LLM 노드의 `model` 드롭다운을 **등록된 API 키로 실제 조회한 모델**로 채운다.
 *
 * 원래는 `providerPresets`(백엔드 `model_presets.json`)를 그대로 보여줬는데,
 * 그건 키가 있든 없든 똑같은 정적 목록이라 "고를 수는 있지만 실행하면 터지는"
 * 모델이 섞여 있었다. Ollama 는 이미 설치된 것만 보여주고 있었으니, 원격
 * 프로바이더만 기준이 달랐던 셈이다.
 *
 * 조회는 인스펙터가 LLM 노드를 실제로 열었을 때만 일어난다 — 앱 부팅 때
 * 프로바이더 6종을 전부 찔러 볼 이유가 없다. 결과는 스토어에 캐시되므로
 * 노드를 오갈 때 재조회하지 않고, 백엔드도 5분 캐시를 갖고 있다.
 */

import { useEffect } from 'react';
import { fetchProviderModels } from '@/lib/backendStatus';
import {
  fingerprintKey,
  providerModelsCacheKey,
  useAppStore,
  type ProviderModelProbe,
} from '@/store';
import { useSecretsStore } from '@/store/secrets';
import { PROVIDER_KEY_NAME } from '@/validation/rules';

/** 키가 등록돼 있지 않아 조회 자체를 하지 않은 상태. */
const NO_KEY: ProviderModelProbe = { status: 'failed', models: [], reason: 'no_key', keyFp: 0 };
/** 키로 조회할 수 있는 프로바이더가 아님 (`ollama` 는 자체 감지, `openai_compatible` 은 SSRF 때문에 제외). */
const NOT_PROBEABLE: ProviderModelProbe = { status: 'failed', models: [], reason: 'not_probeable', keyFp: 0 };

/**
 * @param provider LLM 노드의 `provider`
 * @param keyRef   LLM 노드의 `key_ref` (빈 문자열 = 기본 슬롯)
 * @returns `reason: 'not_probeable'` 이면 이 프로바이더는 조회 대상이 아니다
 *          (호출부가 정적 프리셋으로 폴백한다).
 */
export function useProviderModels(provider: string, keyRef: string): ProviderModelProbe {
  const cacheKey = providerModelsCacheKey(provider, keyRef);
  const probe = useAppStore((s) => s.providerModels[cacheKey]);
  const setProviderModels = useAppStore((s) => s.setProviderModels);
  const slots = useSecretsStore((s) => s.slots);

  // 이 프로바이더에 쓸 키가 실제로 등록돼 있는가. `compiler._build_llm` 과 같은 규칙 —
  // 노드가 슬롯을 지목했으면 **그 슬롯만** 보고 기본 키로 폴백하지 않는다.
  const keyName = PROVIDER_KEY_NAME[provider];
  const wantedSlotId = keyRef || keyName || '';
  const keyValue = slots.find((s) => s.id === wantedSlotId)?.value?.trim() ?? '';
  const hasKey = Boolean(keyValue);
  const keyFp = fingerprintKey(keyValue);
  // 백엔드 라우터의 조회 대상 표(`adapters/provider_models.py::FETCHERS`) 미러.
  const probeable = keyName !== null && keyName !== undefined && provider !== 'openai_compatible';

  useEffect(() => {
    if (!probeable || !hasKey) return;
    // ⚠️ 이미 조회했는지는 **스토어에서 직접** 본다. `probe` 를 의존성에 넣으면
    // 바로 아래에서 쓰는 `loading` 이 곧장 이 이펙트를 다시 깨워, 첫 요청의 결과를
    // 버리고 영원히 "불러오는 중" 에 머문다(실브라우저에서 실제로 그랬다).
    //
    // 같은 슬롯이라도 **값이 바뀌었으면** 다시 조회한다 — 잘못 붙여넣은 키를 고쳤는데
    // `invalid_key` 실패가 캐시에 남아 있으면 사용자는 고쳐도 안 고쳐진 것처럼 본다.
    const cached = useAppStore.getState().providerModels[cacheKey];
    if (cached && cached.keyFp === keyFp) return;

    setProviderModels(cacheKey, { status: 'loading', models: [], reason: null, keyFp });
    const payload = useSecretsStore.getState().headerPayload();
    // 결과는 언마운트 여부와 무관하게 항상 쓴다. 캐시는 컴포넌트가 아니라 스토어에
    // 있으므로, 노드 선택을 풀었다고 버리면 다음에 다시 열었을 때 `loading` 이
    // 캐시에 남아 재조회조차 안 된다.
    fetchProviderModels(provider, keyRef, payload).then((result) => {
      setProviderModels(cacheKey, { ...result, keyFp });
    });
  }, [cacheKey, hasKey, keyFp, keyRef, probeable, provider, setProviderModels]);

  if (!probeable) return NOT_PROBEABLE;
  if (!hasKey) return NO_KEY;
  return probe ?? { status: 'loading', models: [], reason: null, keyFp };
}
