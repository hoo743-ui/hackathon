import { loadPref, savePref } from './prefsStore';

const KEY = 'control_token';

/** 제어 토큰: 네이티브는 SecureStore(기기 보안 저장소), 웹 미리보기는 localStorage. */
export async function loadControlToken(): Promise<string | null> {
  return loadPref(KEY);
}

export async function saveControlToken(token: string | null): Promise<void> {
  await savePref(KEY, token);
}
