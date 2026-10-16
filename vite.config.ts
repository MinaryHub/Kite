import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 개발 서버에서만 HMR 웹소켓을 CSP 에 허용한다 (배포본 CSP 에는 ws: 가 없다) */
const devCsp = () => ({
  name: 'kite-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string) {
    return html.replace("connect-src 'self' data: blob:", "connect-src 'self' data: blob: ws://localhost:5183 http://localhost:5183");
  },
});

export default defineConfig({
  base: './',
  // 정보 창에 보여 줄 빌드 시각
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react(), devCsp()],
  server: { port: 5183, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
