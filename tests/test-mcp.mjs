// AI 앱 연결(MCP) 종단 간 시험: 실제 Kite 창 + Kite --mcp 다리 + MCP SDK 클라이언트
// 사용: npm run build 후  node tests/test-mcp.mjs  (시험용 데이터 폴더를 쓰므로 사용자 설정은 건드리지 않는다)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(import.meta.dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-mcp-test-'));
const sample = path.join(root, '.playwright-mcp', 'samples', 'b.hwpx');
fs.writeFileSync(path.join(userData, 'mcp.json'), JSON.stringify({ enabled: true, confirmEdits: false, allowed: ['kite-test'] }));

const env = { ...process.env, KITE_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(ok ? 'OK  ' : 'FAIL', name, extra);
  if (!ok) fail++;
};

// 1) Kite 실행
const kite = spawn(electron, [root, sample], { env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 9000));

// 2) 다리로 연결
const transport = new StdioClientTransport({ command: electron, args: [root, '--mcp'], env, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', (d) => (stderr += d));
const client = new Client({ name: 'kite-test', version: '1.0.0' });
const text = (r) => r.content?.map((c) => c.text).join('\n') || '';
try {
  await client.connect(transport);
  const tools = await client.listTools();
  check('tools/list', tools.tools.length === 7, tools.tools.map((t) => t.name).join(','));

  const list = await client.callTool({ name: 'list_documents', arguments: {} });
  const docs = JSON.parse(text(list));
  check('list_documents', !list.isError && docs.length >= 1 && docs.some((d) => /b\.hwpx/.test(d.title)), JSON.stringify(docs).slice(0, 160));

  const read = await client.callTool({ name: 'read_document', arguments: { from_block: 0, to_block: 3 } });
  check('read_document', !read.isError && /<!-- block 0 -->/.test(text(read)), text(read).slice(0, 160).replace(/\n/g, ' | '));

  const before = docs.find((d) => d.active).blocks;
  const ins = await client.callTool({ name: 'insert_content', arguments: { markdown: '## MCP 시험 제목\n\n- 첫째 항목\n- 둘째 항목\n\n| 가 | 나 |\n|---|---|\n| 1 | 2 |', position: 'end' } });
  check('insert_content(end)', !ins.isError, text(ins));

  const list2 = JSON.parse(text(await client.callTool({ name: 'list_documents', arguments: {} })));
  const after = list2.find((d) => d.active);
  check('blocks increased & dirty', after.blocks > before && after.unsaved_changes, `${before} → ${after.blocks}`);

  const tail = await client.callTool({ name: 'read_document', arguments: { from_block: after.blocks - 3 } });
  check('inserted content readable', /MCP 시험 제목/.test(text(tail)) && /첫째 항목/.test(text(tail)) && /\| 가/.test(text(tail)), text(tail).slice(-200).replace(/\n/g, ' | '));

  const fr = await client.callTool({ name: 'find_replace', arguments: { find: '첫째 항목', replace: '첫 번째 항목' } });
  check('find_replace', !fr.isError && /1곳/.test(text(fr)), text(fr));

  const rb = await client.callTool({ name: 'replace_blocks', arguments: { from_block: after.blocks - 1, to_block: after.blocks - 1, markdown: '' } });
  check('replace_blocks(delete)', !rb.isError, text(rb));

  const bad = await client.callTool({ name: 'replace_blocks', arguments: { from_block: 999999, to_block: 999999, markdown: 'x' } });
  check('out-of-range rejected', bad.isError === true, text(bad));

  const sel = await client.callTool({ name: 'replace_selection', arguments: { markdown: 'x' } });
  check('replace_selection without selection rejected', sel.isError === true, text(sel));

  const imgs = await client.callTool({ name: 'insert_content', arguments: { markdown: '![추적](https://example.com/t.png) 글', position: 'end' } });
  const tail2 = await client.callTool({ name: 'read_document', arguments: { from_block: Math.max(0, after.blocks - 2) } });
  check('remote image stripped', !imgs.isError && !/example\.com/.test(text(tail2)), text(tail2).slice(-120).replace(/\n/g, ' | '));
} catch (e) {
  check('mcp session', false, String(e?.stack || e) + '\n' + stderr);
} finally {
  await client.close().catch(() => {});
  kite.kill();
}

// 3) 토큰이 틀리면 거부되는지 (파이프에 직접 연결)
{
  const net = await import('node:net');
  const crypto = await import('node:crypto');
  const h = crypto.createHash('sha256').update(userData.toLowerCase()).digest('hex').slice(0, 16);
  const pipe = `\\\\.\\pipe\\kite-mcp-${h}`;
  const kite2 = spawn(electron, [root], { env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 7000));
  const reply = await new Promise((resolve) => {
    const s = net.connect(pipe);
    let buf = '';
    s.on('data', (d) => (buf += d));
    s.on('connect', () => s.write(JSON.stringify({ type: 'hello', token: '0'.repeat(64), client: 'kite-test' }) + '\n'));
    s.on('close', () => resolve(buf));
    s.on('error', (e) => resolve('ERR ' + e.message));
    setTimeout(() => resolve(buf || 'TIMEOUT'), 5000);
  });
  check('wrong token rejected', /"ok":false/.test(String(reply)), String(reply).trim());
  kite2.kill();
}

await new Promise((r) => setTimeout(r, 1000));
try {
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
} catch {
  /* 하위 프로세스가 아직 파일을 잡고 있으면 임시 폴더는 남겨 둔다 */
}
process.exit(fail ? 1 : 0);
