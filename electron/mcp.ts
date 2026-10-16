import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOL_NAMES, MCP_TOOLS, type McpCall, type McpResult } from '../src/mcp/tools';

/**
 * AI 앱 연결 (MCP)
 *
 *  Claude 데스크톱 등 ──stdio──▶ Kite.exe --mcp (다리, 창 없음) ──이름 있는 파이프──▶ 실행 중인 Kite ──IPC──▶ 편집 화면
 *
 *  - 다리는 네트워크 포트를 열지 않는다. 파이프는 같은 사용자만 쓸 수 있고, userData 의 토큰으로 한 번 더 확인한다.
 *  - 처음 연결하는 앱은 Kite 화면에서 허용을 받는다 (앱 이름은 앱이 스스로 밝힌 것이므로 동의 확인용이다).
 *  - 도구는 열린 문서 안에서만 동작한다 (src/mcp/tools.ts).
 */

const LINE_MAX = 8 * 1024 * 1024;

function userDataDir() {
  return app.getPath('userData');
}
/**
 * 파이프 이름은 실행할 때마다 무작위로 만들어 userData 에만 적어 둔다.
 * (이름을 예측할 수 없어야 다른 프로세스가 먼저 같은 이름의 파이프를 만들어 가로챌 수 없다)
 */
const pipeFile = () => path.join(userDataDir(), 'mcp-pipe');
function pipePathFor(id: string) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\kite-mcp-${id}` : path.join(userDataDir(), `kite-mcp-${id}.sock`);
}
function newPipeId(): string {
  return crypto.randomBytes(16).toString('hex');
}
/** 실제로 파이프를 연 뒤에만 이름을 기록한다 (열지 못한 이름이 남아 다른 프로세스가 차지할 틈을 주지 않게) */
function publishPipeId(id: string) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const tmp = pipeFile() + '.tmp';
  fs.writeFileSync(tmp, id, { mode: 0o600 });
  fs.renameSync(tmp, pipeFile());
}
function unpublishPipeId() {
  try {
    fs.unlinkSync(pipeFile());
  } catch {
    /* 없음 */
  }
}
function readPipeName(): string | null {
  try {
    const id = fs.readFileSync(pipeFile(), 'utf8').trim();
    return /^[0-9a-f]{32}$/.test(id) ? pipePathFor(id) : null;
  } catch {
    return null;
  }
}

/** 상호 인증: 토큰은 보내지 않고, 상대의 무작위 값에 대한 HMAC 으로 토큰을 안다는 것만 증명한다 */
function proof(token: string, role: 'server' | 'client', a: string, b: string): string {
  return crypto.createHmac('sha256', Buffer.from(token, 'hex')).update(`kite-mcp|${role}|${a}|${b}`).digest('hex');
}
function sameHex(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.length === b.length && /^[0-9a-f]+$/.test(a) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
const tokenFile = () => path.join(userDataDir(), 'mcp-token');
const configFile = () => path.join(userDataDir(), 'mcp.json');

export interface McpConfig {
  enabled: boolean;
  confirmEdits: boolean;
  /** 항상 허용한 앱 이름 */
  allowed: string[];
}

export function readMcpConfig(): McpConfig {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return {
      enabled: c.enabled === true,
      confirmEdits: c.confirmEdits === true,
      allowed: Array.isArray(c.allowed) ? c.allowed.filter((x: unknown) => typeof x === 'string').slice(0, 50) : [],
    };
  } catch {
    return { enabled: false, confirmEdits: false, allowed: [] };
  }
}
function writeMcpConfig(c: McpConfig) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(c, null, 2));
}

function readToken(): string | null {
  try {
    const t = fs.readFileSync(tokenFile(), 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}
function ensureToken(): string {
  const t = readToken();
  if (t) return t;
  const n = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(tokenFile(), n, { mode: 0o600 });
  return n;
}

/** 줄 단위 JSON 읽기 */
function onLines(sock: net.Socket, cb: (msg: any) => void, onBad: () => void) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk: string) => {
    buf += chunk;
    if (buf.length > LINE_MAX) {
      onBad();
      return;
    }
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        cb(JSON.parse(line));
      } catch {
        onBad();
        return;
      }
    }
  });
}
const send = (sock: net.Socket, msg: unknown) => {
  if (!sock.destroyed) sock.write(JSON.stringify(msg) + '\n');
};

// =====================================================================
// 실행 중인 Kite (호스트)
// =====================================================================
let server: net.Server | null = null;
let cfg: McpConfig = { enabled: false, confirmEdits: false, allowed: [] };
const pendingCalls = new Map<string, (r: McpResult) => void>();
let getWindow: () => BrowserWindow | null = () => null;
/** 이번 실행에서만 허용한 앱 */
const sessionAllowed = new Set<string>();
/** 같은 앱의 허용 질문이 겹치지 않게 */
const asking = new Map<string, Promise<boolean>>();

async function approve(client: string): Promise<boolean> {
  if (cfg.allowed.includes(client) || sessionAllowed.has(client)) return true;
  const busy = asking.get(client);
  if (busy) return busy;
  const p = (async () => {
    const win = getWindow();
    if (!win) return false;
    if (win.isMinimized()) win.restore();
    win.focus();
    const r = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'AI 앱 연결',
      message: `'${client}' 이(가) Kite 문서에 연결하려고 합니다.`,
      detail:
        '허용하면 이 앱이 열려 있는 문서를 읽고 고칠 수 있습니다. 문서 내용은 그 앱의 AI 서비스로 전송됩니다.\n' +
        '고친 내용은 Ctrl+Z 로 되돌릴 수 있습니다. 허용 목록은 도구 > AI 앱 연결에서 바꿀 수 있습니다.',
      buttons: ['이번만 허용', '항상 허용', '거부'],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    });
    if (r.response === 0) sessionAllowed.add(client);
    else if (r.response === 1) {
      cfg.allowed = [...cfg.allowed.filter((x) => x !== client), client];
      writeMcpConfig(cfg);
    }
    return r.response !== 2;
  })();
  asking.set(client, p);
  try {
    return await p;
  } finally {
    asking.delete(client);
  }
}

// 편집 화면이 도구 처리기를 설치했다고 알릴 때까지 호출을 보내지 않는다
// (막 켜진 Kite 나 다시 불러오는 중인 화면에 보내면 요청이 사라진다)
let rendererReady = false;
let readyWaiters: (() => void)[] = [];
function waitRendererReady(ms: number): Promise<boolean> {
  if (rendererReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      readyWaiters = readyWaiters.filter((f) => f !== done);
      resolve(false);
    }, ms);
    const done = () => {
      clearTimeout(t);
      resolve(true);
    };
    readyWaiters.push(done);
  });
}

async function callRenderer(client: string, name: string, args: Record<string, any>): Promise<McpResult> {
  const callId = crypto.randomUUID();
  if (!(await waitRendererReady(45000))) return { callId, ok: false, text: 'Kite 화면이 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.' };
  const win = getWindow();
  if (!win || win.isDestroyed()) return { callId, ok: false, text: 'Kite 창이 열려 있지 않습니다.' };
  return new Promise((resolve) => {
    // 수정 확인 창을 사용자가 보는 시간까지 고려해 넉넉히
    const timer = setTimeout(() => {
      pendingCalls.delete(callId);
      resolve({ callId, ok: false, text: 'Kite 가 제시간에 응답하지 않았습니다.' });
    }, 5 * 60 * 1000);
    pendingCalls.set(callId, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    const call: McpCall = { callId, client, name, args, confirmEdits: cfg.confirmEdits };
    win.webContents.send('mcp:call', call);
  });
}

/** 인증된 연결 (허용 취소/끄기 때 바로 끊기 위해) */
const liveConns = new Map<net.Socket, string>();
const isAllowed = (client: string) => cfg.allowed.includes(client) || sessionAllowed.has(client);

function handleConnection(sock: net.Socket) {
  const token = readToken();
  let client = '';
  let state: 'hello' | 'auth' | 'ready' = 'hello';
  let snonce = '';
  let cnonce = '';
  const bad = () => sock.destroy();
  /** 거절 메시지를 다 보낸 뒤 닫는다 (바로 끊으면 응답이 사라질 수 있다) */
  const reject = (error: string) => {
    if (sock.destroyed) return;
    sock.end(JSON.stringify({ type: 'hello', ok: false, error }) + '\n');
    setTimeout(bad, 1000);
  };
  sock.setTimeout(10 * 60 * 1000, bad);
  sock.on('close', () => liveConns.delete(sock));
  onLines(
    sock,
    async (msg) => {
      if (state === 'hello') {
        // 1) { type: 'hello', client, cnonce } → 서버가 토큰을 안다는 증명과 함께 도전값을 보낸다
        if (msg?.type !== 'hello' || !token || typeof msg.cnonce !== 'string' || !/^[0-9a-f]{64}$/.test(msg.cnonce)) {
          return reject('인증에 실패했습니다.');
        }
        cnonce = msg.cnonce;
        snonce = crypto.randomBytes(32).toString('hex');
        client = typeof msg.client === 'string' && msg.client.trim() ? msg.client.trim().slice(0, 60).replace(/[\u0000-\u001f]/g, '') : '알 수 없는 앱';
        state = 'auth';
        send(sock, { type: 'challenge', snonce, proof: proof(token, 'server', cnonce, snonce) });
        return;
      }
      if (state === 'auth') {
        // 2) { type: 'auth', proof } → 클라이언트도 토큰을 아는지 확인한 뒤 사용자 허용
        if (msg?.type !== 'auth' || !token || !sameHex(msg.proof, proof(token, 'client', snonce, cnonce))) {
          return reject('인증에 실패했습니다.');
        }
        if (!cfg.enabled) {
          return reject('Kite 에서 AI 앱 연결이 꺼져 있습니다.');
        }
        const ok = await approve(client);
        if (!ok) return reject('사용자가 연결을 거부했습니다.');
        send(sock, { type: 'hello', ok: true });
        state = 'ready';
        liveConns.set(sock, client);
        return;
      }
      // 3) { type: 'call', id, name, args }
      if (msg?.type !== 'call' || typeof msg.id !== 'string' || !MCP_TOOL_NAMES.has(msg.name)) {
        send(sock, { type: 'result', id: msg?.id, ok: false, text: '알 수 없는 요청입니다.' });
        return;
      }
      // 허용 취소/끄기는 이미 연결된 앱에도 바로 적용
      if (!cfg.enabled || !isAllowed(client)) {
        send(sock, { type: 'result', id: msg.id, ok: false, text: !cfg.enabled ? 'Kite 에서 AI 앱 연결이 꺼져 있습니다.' : '이 앱의 연결 허용이 취소되었습니다.' });
        return bad();
      }
      const args = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
      const r = await callRenderer(client, msg.name, args);
      send(sock, { type: 'result', id: msg.id, ok: r.ok, text: r.text });
    },
    bad,
  );
  sock.on('error', () => {});
}

/** 조건에 맞지 않는 연결을 끊는다 */
function dropConnections(keep: (client: string) => boolean) {
  for (const [sock, client] of liveConns) {
    if (!keep(client)) {
      liveConns.delete(sock);
      sock.destroy();
    }
  }
}

function startServer() {
  if (server) return;
  ensureToken();
  unpublishPipeId();
  const id = newPipeId();
  const name = pipePathFor(id);
  if (process.platform !== 'win32') {
    try {
      fs.unlinkSync(name);
    } catch {
      /* 없음 */
    }
  }
  const srv = net.createServer(handleConnection);
  server = srv;
  srv.on('error', (e) => {
    // 같은 이름이 이미 있으면(무작위라 정상적으로는 없다) 열지 않는다: libuv 는 첫 인스턴스 전용 플래그로 파이프를 만든다
    console.error('[mcp] pipe error', e);
    if (server === srv) server = null;
    unpublishPipeId();
  });
  srv.listen(name, () => {
    if (server === srv) publishPipeId(id);
  });
}
function stopServer() {
  server?.close();
  server = null;
  dropConnections(() => false);
  unpublishPipeId();
}

/** 실행 중인 Kite 에서 호출: 설정에 따라 파이프 서버를 켜고 IPC 를 등록한다 */
export function initMcpHost(win: () => BrowserWindow | null) {
  getWindow = win;
  cfg = readMcpConfig();
  if (cfg.enabled) startServer();
  // 끝낼 때 파이프 이름 기록을 지운다
  app.on('will-quit', () => {
    if (server) unpublishPipeId();
  });

  ipcMain.on('mcp:ready', () => {
    rendererReady = true;
    const w = readyWaiters;
    readyWaiters = [];
    w.forEach((f) => f());
  });
  // 화면을 다시 불러오면 처리기도 다시 설치될 때까지 기다린다
  const hookWindow = () => {
    const w = getWindow();
    if (!w) return setTimeout(hookWindow, 200);
    w.webContents.on('did-start-loading', () => (rendererReady = false));
    w.webContents.on('render-process-gone', () => (rendererReady = false));
  };
  hookWindow();

  ipcMain.on('mcp:result', (_e, r: McpResult) => {
    if (!r || typeof r.callId !== 'string') return;
    const done = pendingCalls.get(r.callId);
    if (!done) return;
    pendingCalls.delete(r.callId);
    done({ callId: r.callId, ok: !!r.ok, text: typeof r.text === 'string' ? r.text.slice(0, 2_000_000) : '' });
  });
  ipcMain.handle('mcp:status', () => ({
    ...cfg,
    running: !!server,
    command: bridgeCommand(),
    claudeConfig: claudeConfigPath(),
    claudeRegistered: isClaudeRegistered(),
    claudeInstalled: isClaudeInstalled(),
  }));
  // Claude 데스크톱 열기: claude:// 주소만 연다 (다른 주소는 받지 않는다)
  ipcMain.handle('mcp:open-claude', async () => {
    if (!isClaudeInstalled()) return false;
    try {
      await shell.openExternal('claude://');
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('mcp:set', (_e, patch: Partial<McpConfig>) => {
    if (patch && typeof patch.enabled === 'boolean') cfg.enabled = patch.enabled;
    if (patch && typeof patch.confirmEdits === 'boolean') cfg.confirmEdits = patch.confirmEdits;
    if (patch && Array.isArray(patch.allowed)) {
      const revoked = cfg.allowed.filter((x) => !patch.allowed!.includes(x));
      cfg.allowed = cfg.allowed.filter((x) => patch.allowed!.includes(x));
      revoked.forEach((x) => sessionAllowed.delete(x));
    }
    writeMcpConfig(cfg);
    if (cfg.enabled) startServer();
    else stopServer();
    // 허용이 취소된 앱의 연결은 바로 끊는다
    dropConnections(isAllowed);
    return { ...cfg, running: !!server };
  });
  ipcMain.handle('mcp:register-claude', () => registerClaudeDesktop());
}

// =====================================================================
// Claude 데스크톱 등록
// =====================================================================
/** AI 앱 설정에 넣을 실행 명령 */
function bridgeCommand(): { command: string; args: string[] } {
  if (app.isPackaged) return { command: process.execPath, args: ['--mcp'] };
  return { command: process.execPath, args: [app.getAppPath(), '--mcp'] };
}
function claudeConfigPath(): string {
  return path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json');
}
/** Claude 데스크톱 설치 여부: claude:// 주소 처리기 또는 설정 폴더 */
function isClaudeInstalled(): boolean {
  try {
    if (app.getApplicationNameForProtocol('claude://')) return true;
  } catch {
    /* 무시 */
  }
  return fs.existsSync(path.dirname(claudeConfigPath()));
}
function isClaudeRegistered(): boolean {
  try {
    const c = JSON.parse(fs.readFileSync(claudeConfigPath(), 'utf8'));
    return !!c?.mcpServers?.kite;
  } catch {
    return false;
  }
}
/** Claude 데스크톱 설정에 kite 서버를 추가한다 (다른 항목은 그대로, 원본은 .bak 으로 보관) */
function registerClaudeDesktop(): { ok: boolean; message: string } {
  const file = claudeConfigPath();
  let conf: any = {};
  try {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      conf = text.trim() ? JSON.parse(text) : {};
      fs.copyFileSync(file, file + '.bak');
    } else if (!fs.existsSync(path.dirname(file))) {
      return { ok: false, message: 'Claude 데스크톱이 설치되어 있지 않은 것 같습니다. 설치하고 한 번 실행한 뒤 다시 시도하세요.' };
    }
  } catch {
    return { ok: false, message: 'Claude 데스크톱 설정 파일을 읽지 못했습니다(형식 오류). 파일을 직접 고쳐 주세요: ' + file };
  }
  if (!conf || typeof conf !== 'object' || Array.isArray(conf)) conf = {};
  if (!conf.mcpServers || typeof conf.mcpServers !== 'object') conf.mcpServers = {};
  conf.mcpServers.kite = bridgeCommand();
  try {
    fs.writeFileSync(file, JSON.stringify(conf, null, 2));
  } catch (e: any) {
    return { ok: false, message: '설정 파일을 쓰지 못했습니다: ' + (e?.message || e) };
  }
  return { ok: true, message: 'Claude 데스크톱에 등록했습니다. Claude 데스크톱을 완전히 끝냈다가(트레이 아이콘 → 끝내기) 다시 실행하세요.' };
}

// =====================================================================
// 다리 (Kite.exe --mcp): AI 앱이 실행하는 창 없는 프로세스
// =====================================================================
export function isMcpBridge(): boolean {
  return process.argv.includes('--mcp');
}

export async function runMcpBridge() {
  let clientName = 'AI 앱';
  type Conn = { sock: net.Socket; pending: Map<string, (r: { ok: boolean; text: string }) => void> };
  let conn: Conn | null = null;
  let connecting: Promise<Conn> | null = null;
  let seq = 0;

  const tryConnect = (): Promise<net.Socket | null> =>
    new Promise((resolve) => {
      const name = readPipeName();
      if (!name) return resolve(null);
      const s = net.connect(name);
      s.once('connect', () => resolve(s));
      s.once('error', () => resolve(null));
    });

  /** Kite 가 꺼져 있으면 켠다 */
  const launchKite = () => {
    const cmd = bridgeCommand();
    const args = cmd.args.filter((a) => a !== '--mcp');
    const child = spawn(cmd.command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  };

  const connect = async (): Promise<Conn> => {
    if (conn && !conn.sock.destroyed) return conn;
    if (connecting) return connecting;
    connecting = (async () => {
      if (!readToken()) throw new Error('Kite 에서 AI 앱 연결이 꺼져 있습니다. Kite 의 도구 > AI 앱 연결에서 켜 주세요.');
      let sock = await tryConnect();
      if (!sock) {
        launchKite();
        for (let i = 0; i < 40 && !sock; i++) {
          await new Promise((r) => setTimeout(r, 500));
          sock = await tryConnect();
        }
      }
      if (!sock) throw new Error('Kite 에 연결하지 못했습니다. Kite 를 실행하고 도구 > AI 앱 연결이 켜져 있는지 확인하세요.');
      const pending = new Map<string, (r: { ok: boolean; text: string }) => void>();
      const c: Conn = { sock, pending };
      const cnonce = crypto.randomBytes(32).toString('hex');
      const hello = new Promise<void>((resolve, reject) => {
        onLines(
          sock!,
          (msg) => {
            if (msg?.type === 'challenge') {
              // 서버가 토큰을 아는지 먼저 확인한다 (가짜 파이프에는 아무것도 보내지 않는다)
              const tk = readToken();
              if (!tk || typeof msg.snonce !== 'string' || !/^[0-9a-f]{64}$/.test(msg.snonce) || !sameHex(msg.proof, proof(tk, 'server', cnonce, msg.snonce))) {
                sock!.destroy();
                return reject(new Error('Kite 인증에 실패했습니다. Kite 를 다시 실행하세요.'));
              }
              send(sock!, { type: 'auth', proof: proof(tk, 'client', msg.snonce, cnonce) });
              return;
            }
            if (msg?.type === 'hello') return msg.ok ? resolve() : reject(new Error(msg.error || '연결이 거부되었습니다.'));
            if (msg?.type === 'result' && typeof msg.id === 'string') {
              const done = pending.get(msg.id);
              pending.delete(msg.id);
              done?.({ ok: !!msg.ok, text: String(msg.text ?? '') });
            }
          },
          () => sock!.destroy(),
        );
        sock!.once('close', () => {
          reject(new Error('Kite 와의 연결이 끊어졌습니다.'));
          for (const done of pending.values()) done({ ok: false, text: 'Kite 와의 연결이 끊어졌습니다.' });
          pending.clear();
          if (conn === c) conn = null;
        });
      });
      send(sock, { type: 'hello', client: clientName, cnonce });
      await hello;
      conn = c;
      return c;
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  };

  const server = new Server({ name: 'kite', title: 'Kite 워드프로세서', version: app.getVersion() }, { capabilities: { tools: {} } });
  server.oninitialized = () => {
    const info = server.getClientVersion();
    if (info?.name) clientName = String((info as any).title || info.name);
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema as any,
      annotations: { readOnlyHint: !t.edits, destructiveHint: t.edits, openWorldHint: false },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (!MCP_TOOL_NAMES.has(name)) return { content: [{ type: 'text' as const, text: `알 수 없는 도구: ${name}` }], isError: true };
    try {
      const c = await connect();
      const id = String(++seq);
      const r = await new Promise<{ ok: boolean; text: string }>((resolve) => {
        c.pending.set(id, resolve);
        send(c.sock, { type: 'call', id, name, args: req.params.arguments || {} });
      });
      return { content: [{ type: 'text' as const, text: r.text }], isError: !r.ok };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: String(e?.message || e) }], isError: true };
    }
  });

  // Electron 주 프로세스의 process.stdin 은 Windows 에서 파이프 입력을 받지 못하므로(곧바로 end)
  // 파일 기술자 0 을 직접 읽는다
  const stdin = fs.createReadStream('', { fd: 0, autoClose: false, highWaterMark: 64 * 1024 });
  stdin.on('end', () => app.exit(0));
  stdin.on('error', () => app.exit(0));
  const transport = new StdioServerTransport(stdin as any, process.stdout);
  transport.onclose = () => app.exit(0);
  await server.connect(transport);
}
