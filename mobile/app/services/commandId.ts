import * as Crypto from 'expo-crypto';

/** 탭마다 새 UUID v4. 같은 요청을 재시도할 때는 같은 id를 재사용해 멱등성을 보장한다. */
export function newCommandId(): string {
  return Crypto.randomUUID();
}
