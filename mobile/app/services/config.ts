// 서버 주소 결정 (맥북 IP 가 Wi-Fi·핫스팟마다 바뀌어도 앱을 다시 설정하지 않도록)
//  1) EXPO_PUBLIC_API_BASE_URL 이 http(s):// 주소면 그대로 사용 (운영 도메인 등)
//  2) 비어 있거나 'auto' 면 → 앱을 불러온 Expo 개발 서버의 호스트(= 맥북 현재 IP) + :8000
//     Expo Go 는 exp://<맥북IP>:8081 에서 앱을 받으므로 그 IP 가 곧 서버 IP 다.
//  3) 웹 미리보기(expo web)는 브라우저 주소의 호스트를 사용
//  4) 모두 없으면 localhost (시뮬레이터 전용)
import Constants from 'expo-constants';

const API_PORT = 8000;

function devServerHost(): string | null {
  const c = Constants as unknown as {
    expoConfig?: { hostUri?: string } | null;
    expoGoConfig?: { debuggerHost?: string } | null;
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } | null;
  };
  const hostUri =
    c.expoConfig?.hostUri ?? c.expoGoConfig?.debuggerHost ?? c.manifest2?.extra?.expoGo?.debuggerHost ?? null;
  if (hostUri) return hostUri.split(':')[0] || null;
  if (typeof window !== 'undefined' && window.location?.hostname) return window.location.hostname;
  return null;
}

function resolveApiBase(): string {
  const env = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();
  if (/^https?:\/\//.test(env)) return env.replace(/\/$/, '');
  const host = devServerHost();
  return host ? `http://${host}:${API_PORT}` : `http://localhost:${API_PORT}`;
}

export const API_BASE_URL: string = resolveApiBase();

const envWs = (process.env.EXPO_PUBLIC_WS_URL ?? '').trim();
export const WS_URL: string = /^wss?:\/\//.test(envWs) ? envWs : `${API_BASE_URL.replace(/^http/, 'ws')}/ws`;
