import { ipcMain, type WebContents } from 'electron';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * 실시간 공동 편집(실험): 같은 네트워크의 Kite 끼리 문서 변경(Yjs 메시지)을 주고받는 중계.
 * - 여는 쪽(호스트): 이 컴퓨터에 작은 WebSocket 서버를 띄우고, 접속 코드를 아는 쪽만 받는다
 * - 들어가는 쪽(참가): 호스트 주소와 코드로 접속한다
 * 렌더러는 네트워크에 직접 닿지 않고 IPC 로 이 모듈과만 주고받는다.
 */

const DEFAULT_PORT = 47800;
const MAX_PEERS = 16;
const MAX_MSG = 64 * 1024 * 1024;

type Ev = { type: 'msg'; data: Uint8Array } | { type: 'peers'; count: number } | { type: 'open' } | { type: 'closed'; reason: string };

let owner: WebContents | null = null;
let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let guest: WebSocket | null = null;
let code = '';
let port = 0;

const send = (e: Ev) => {
  if (owner && !owner.isDestroyed()) owner.send('collab:event', e);
};

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

/** 읽기 쉬운 접속 코드 (헷갈리는 글자 0/O, 1/I 제외) */
function newCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += abc[b[i] % abc.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}

function stopAll(reason = '') {
  if (guest) {
    guest.removeAllListeners();
    try {
      guest.close();
    } catch {
      /* 무시 */
    }
    guest = null;
  }
  if (wss) {
    for (const c of wss.clients) c.terminate();
    wss.close();
    wss = null;
  }
  if (server) {
    server.close();
    server = null;
  }
  code = '';
  port = 0;
  if (reason) send({ type: 'closed', reason });
}

function peersCount() {
  return wss ? [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN).length : 0;
}

async function host(wc: WebContents, wantPort?: number): Promise<{ port: number; code: string; addresses: string[] }> {
  stopAll();
  owner = wc;
  code = newCode();
  const tryListen = (p: number) =>
    new Promise<number>((resolve, reject) => {
      const s = http.createServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });
      s.once('error', reject);
      s.listen(p, '0.0.0.0', () => {
        server = s;
        resolve((s.address() as any).port);
      });
    });
  let p = wantPort || DEFAULT_PORT;
  for (let k = 0; ; k++) {
    try {
      port = await tryListen(p);
      break;
    } catch (e: any) {
      if (e?.code !== 'EADDRINUSE' || k > 20) throw e;
      p++;
    }
  }
  wss = new WebSocketServer({
    server: server!,
    maxPayload: MAX_MSG,
    verifyClient: (info: { req: http.IncomingMessage }) => {
      const u = new URL(info.req.url || '/', 'http://x');
      const given = (u.searchParams.get('code') || '').toUpperCase();
      return given.length === code.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(code)) && peersCount() < MAX_PEERS;
    },
  });
  wss.on('connection', (ws) => {
    ws.binaryType = 'nodebuffer';
    send({ type: 'peers', count: peersCount() });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      // 호스트 화면과 다른 참가자들에게 그대로 전한다
      send({ type: 'msg', data: new Uint8Array(data) });
      for (const c of wss!.clients) if (c !== ws && c.readyState === WebSocket.OPEN) c.send(data, { binary: true });
    });
    ws.on('close', () => send({ type: 'peers', count: peersCount() }));
  });
  return { port, code, addresses: lanAddresses() };
}

function join(wc: WebContents, address: string, joinCode: string): Promise<boolean> {
  stopAll();
  owner = wc;
  let hostPart = address.trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
  if (!/:\d+$/.test(hostPart)) hostPart += ':' + DEFAULT_PORT;
  if (!/^[A-Za-z0-9.\-]+:\d{2,5}$/.test(hostPart) && !/^\[[0-9a-fA-F:]+\]:\d{2,5}$/.test(hostPart)) throw new Error('주소 형식이 올바르지 않습니다. 예: 192.168.0.10:47800');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${hostPart}/?code=${encodeURIComponent(joinCode.trim().toUpperCase())}`, { maxPayload: MAX_MSG, handshakeTimeout: 8000 });
    guest = ws;
    ws.binaryType = 'nodebuffer';
    let opened = false;
    ws.on('open', () => {
      opened = true;
      send({ type: 'open' });
      resolve(true);
    });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) send({ type: 'msg', data: new Uint8Array(data) });
    });
    ws.on('unexpected-response', (_req, res) => {
      reject(new Error(res.statusCode === 401 ? '접속 코드가 맞지 않습니다.' : `접속하지 못했습니다 (${res.statusCode}).`));
    });
    ws.on('error', (e: any) => {
      if (!opened) reject(new Error(e?.code === 'ECONNREFUSED' ? '호스트에 연결하지 못했습니다. 주소와, 호스트가 공동 편집을 열어 두었는지 확인하세요.' : String(e?.message || e)));
    });
    ws.on('close', () => {
      if (guest === ws) {
        guest = null;
        if (opened) send({ type: 'closed', reason: '호스트와 연결이 끊겼습니다.' });
      }
    });
  });
}

export function setupCollab() {
  ipcMain.handle('collab:host', (e, wantPort?: number) => host(e.sender, typeof wantPort === 'number' ? wantPort : undefined));
  ipcMain.handle('collab:join', (e, address: string, joinCode: string) => {
    if (typeof address !== 'string' || typeof joinCode !== 'string' || address.length > 200 || joinCode.length > 32) throw new Error('입력이 올바르지 않습니다.');
    return join(e.sender, address, joinCode);
  });
  ipcMain.handle('collab:stop', () => stopAll());
  ipcMain.on('collab:send', (e, data: Uint8Array) => {
    if (e.sender !== owner || !(data instanceof Uint8Array) || data.byteLength > MAX_MSG) return;
    const buf = Buffer.from(data);
    if (guest && guest.readyState === WebSocket.OPEN) guest.send(buf, { binary: true });
    if (wss) for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(buf, { binary: true });
  });
}
