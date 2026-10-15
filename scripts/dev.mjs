import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildElectron } from './build-electron.mjs';

const require = createRequire(import.meta.url);
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
await buildElectron(true);
const electronPath = require('electron');
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: (() => {
    const e = { ...process.env, VITE_DEV_SERVER_URL: url };
    delete e.ELECTRON_RUN_AS_NODE;
    return e;
  })(),
});
child.on('close', (code) => { server.close(); process.exit(code ?? 0); });
