// Expo는 빌드 시 EXPO_PUBLIC_* 를 mobile/app/.env 에서 읽어 인라인한다.
// 실기기(Expo Go)에서는 localhost 가 폰 자신을 가리키므로 Mac의 LAN IP를 넣어야 한다.
export const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';
export const WS_URL: string = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:8000/ws/dashboard';
