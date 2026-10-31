import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** 작은 앱 설정 저장소. 네이티브는 SecureStore(이미 사용 중), 웹 미리보기는 localStorage. 실패해도 앱은 기본값으로 동작. */
export async function loadPref(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function savePref(key: string, value: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // 저장 실패는 다음 실행 시 기본값으로 돌아갈 뿐 — 무시
  }
}
