const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32

/** 의존성 없는 ULID 생성기 (시간 정렬 가능 + 랜덤). */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i]! % 32];
  return time + rand;
}

/** 짧은 접두사 ID (노드/엣지용). */
export function shortId(prefix: string): string {
  return `${prefix}_${ulid().slice(-10).toLowerCase()}`;
}
