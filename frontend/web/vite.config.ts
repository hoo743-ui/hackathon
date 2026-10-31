import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const sharedDir = fileURLToPath(new URL('../../shared/src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // VITE_* 변수는 저장소 루트 .env 에서 읽는다.
  envDir: '../..',
  resolve: {
    alias: { '@shared': sharedDir },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'] } },
    },
  },
  server: {
    port: 5173,
    fs: { allow: [webRoot, sharedDir] },
  },
});
