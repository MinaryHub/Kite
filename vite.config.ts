import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/** 개발 서버에서만 HMR 웹소켓을 CSP 에 허용한다 (배포본 CSP 에는 ws: 가 없다) */
const devCsp = () => ({
  name: 'kite-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string) {
    return html.replace("connect-src 'self' data: blob:", "connect-src 'self' data: blob: ws://localhost:5183 http://localhost:5183");
  },
});

/**
 * pdf.js 가 PDF 를 읽을 때 쓰는 보조 자료(색 변환·그림 해독 wasm, ICC, 한중일 CMap, 기본 글꼴)를
 * 화면과 같은 곳(pdfjs/)에 둔다. 없으면 일부 PDF 는 그리는 데 수 분이 걸리거나 글자를 못 읽는다.
 */
const PDFJS_ASSETS = ['wasm', 'iccs', 'cmaps', 'standard_fonts'];
const pdfjsAssets = () => {
  const root = path.resolve('node_modules/pdfjs-dist');
  let outDir = 'dist';
  return {
    name: 'kite-pdfjs-assets',
    configResolved(c: any) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    configureServer(server: any) {
      server.middlewares.use('/pdfjs/', (req: any, res: any, next: any) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const [dir, ...rest] = rel.split('/');
        const file = path.resolve(root, dir, ...rest);
        if (!PDFJS_ASSETS.includes(dir) || !file.startsWith(path.join(root, dir) + path.sep) || !fs.existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      for (const dir of PDFJS_ASSETS) fs.cpSync(path.join(root, dir), path.join(outDir, 'pdfjs', dir), { recursive: true });
    },
  };
};

export default defineConfig({
  base: './',
  // 정보 창에 보여 줄 빌드 시각
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react(), devCsp(), pdfjsAssets()],
  server: { port: 5183, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
