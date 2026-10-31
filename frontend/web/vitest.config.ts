import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sharedDir = fileURLToPath(new URL('../../shared/src', import.meta.url));

// vitest 2.x 는 내부적으로 vite 5 를 사용하므로 vite.config.ts(vite 6)와 분리한다.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@shared': sharedDir },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 테스트는 항상 결정적인 기본값을 사용 (루트 .env 영향 배제)
    env: { VITE_DATA_MODE: 'live' },
  },
});
