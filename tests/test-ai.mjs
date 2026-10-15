import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
await build({ entryPoints: ['electron/ai.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'tests/.build/ai.mjs', logLevel: 'error',
  alias: { electron: path.resolve('tests/ai-electron-stub.mjs') }, banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
const ai = await import(pathToFileURL(path.resolve('tests/.build/ai.mjs')).href);
const run = (req) => new Promise((res) => { const evs = []; ai.startChat(req, (e) => { evs.push(e); if (e.type !== 'delta') res(evs); }); });
const msg = [{ role: 'user', content: '안녕' }];
for (const p of ['claude', 'openai', 'gemini']) ai.setKey(p, null);
console.log('no key  :', JSON.stringify((await run({ id: '1', provider: 'claude', model: 'claude-opus-5-5', system: 's', messages: msg })).pop()));
ai.setKey('claude', 'sk-ant-invalid'); ai.setKey('openai', 'sk-invalid'); ai.setKey('gemini', 'AIza-invalid');
console.log('status  :', JSON.stringify(ai.keyStatus()));
for (const [p, m] of [['claude', 'claude-opus-5-5'], ['openai', 'gpt-5.5'], ['gemini', 'gemini-flash-latest']]) {
  const t0 = Date.now();
  const last = (await run({ id: p, provider: p, model: m, system: 's', messages: msg })).pop();
  console.log(p.padEnd(8), ':', JSON.stringify(last).slice(0, 200), (Date.now() - t0) + 'ms');
}
// abort
ai.setKey('claude', 'sk-ant-invalid');
const p = run({ id: 'ab', provider: 'claude', model: 'claude-opus-5-5', system: 's', messages: msg }); ai.abortChat('ab');
console.log('abort   :', JSON.stringify((await p).pop()));
for (const p of ['claude', 'openai', 'gemini']) ai.setKey(p, null);
