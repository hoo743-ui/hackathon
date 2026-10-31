export type DataMode = 'live' | 'mock';

const env = import.meta.env;

// VITE_API_BASE_URL을 비우면 웹을 연 주소의 호스트(:8000)를 쓴다.
// → 맥북에서는 localhost, 다른 노트북·폰 브라우저에서는 맥북 LAN IP로 자동 접속 (localhost 하드코딩 방지)
const host = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : 'localhost';
const apiBaseUrl: string = env.VITE_API_BASE_URL || `http://${host}:8000`;

export const config = {
  apiBaseUrl,
  wsUrl: env.VITE_WS_URL || `${apiBaseUrl.replace(/^http/, 'ws')}/ws`,
  /** VITE_DATA_MODE=mock 이면 브라우저 내 가짜 데이터 소스를 사용. 기본값 live */
  defaultDataMode: (env.VITE_DATA_MODE === 'mock' ? 'mock' : 'live') as DataMode,
};
