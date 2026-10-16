// 한글(한컴오피스)이 자기 폴더에만 두고 쓰는 글꼴(HY헤드라인M, 한컴 윤고딕 등)을 찾아 Kite 에서도 쓸 수 있게 한다.
// 시스템에 설치되지 않은 글꼴이라 브라우저는 모르므로, 파일을 찾아 이름(name 테이블)을 읽고 렌더러에 바이트를 넘긴다.
import fs from 'node:fs';
import path from 'node:path';

export interface PrivateFont {
  /** 글꼴 패밀리 이름들 (한국어·영어 이름 모두) */
  names: string[];
  path: string;
  size: number;
}

const MAX_FONT_BYTES = 64 * 1024 * 1024;
const FONT_EXT = /\.(ttf|otf|ttc)$/i;

/** 한컴 글꼴이 있을 만한 폴더들 */
function candidateDirs(): string[] {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.ProgramW6432, process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean) as string[];
  const out: string[] = [];
  for (const r of roots) {
    for (const sub of ['Hnc', 'HNC', 'Hancom']) {
      const d = path.join(r, sub);
      if (fs.existsSync(d)) out.push(d);
    }
  }
  return out;
}

/** 폴더 아래의 글꼴 파일을 깊이 제한을 두고 찾는다 */
function findFontFiles(dir: string, depth: number, out: string[]) {
  if (depth > 7 || out.length > 2000) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFontFiles(p, depth + 1, out);
    else if (e.isFile() && FONT_EXT.test(e.name)) out.push(p);
  }
}

/** TrueType/OpenType 의 name 테이블에서 패밀리 이름(nameID 1, 16)을 읽는다 (TTC 는 첫 글꼴) */
export function readFontNames(file: string): string[] {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const read = (off: number, len: number) => {
      const b = Buffer.alloc(len);
      const n = fs.readSync(fd!, b, 0, len, off);
      return b.subarray(0, n);
    };
    let base = 0;
    const head = read(0, 16);
    if (head.length < 12) return [];
    const tag = head.toString('latin1', 0, 4);
    if (tag === 'ttcf') base = head.readUInt32BE(12);
    const dir = read(base, 12);
    const numTables = dir.readUInt16BE(4);
    if (numTables > 64) return [];
    const tables = read(base + 12, numTables * 16);
    let nameOff = 0;
    let nameLen = 0;
    for (let i = 0; i < numTables; i++) {
      const o = i * 16;
      if (tables.toString('latin1', o, o + 4) === 'name') {
        nameOff = tables.readUInt32BE(o + 8);
        nameLen = tables.readUInt32BE(o + 12);
      }
    }
    if (!nameOff || nameLen > 1 << 20) return [];
    const nt = read(nameOff, nameLen);
    if (nt.length < 6) return [];
    const count = nt.readUInt16BE(2);
    const strOff = nt.readUInt16BE(4);
    const names = new Set<string>();
    for (let i = 0; i < count && 6 + i * 12 + 12 <= nt.length; i++) {
      const o = 6 + i * 12;
      const platform = nt.readUInt16BE(o);
      const encoding = nt.readUInt16BE(o + 2);
      const nameId = nt.readUInt16BE(o + 6);
      const len = nt.readUInt16BE(o + 8);
      const off = nt.readUInt16BE(o + 10);
      if (nameId !== 1 && nameId !== 16) continue;
      const s = strOff + off;
      if (s + len > nt.length) continue;
      let str = '';
      if (platform === 3 || platform === 0) {
        // UTF-16BE
        for (let k = 0; k + 1 < len; k += 2) str += String.fromCharCode(nt.readUInt16BE(s + k));
      } else if (platform === 1 && encoding === 0) {
        str = nt.toString('latin1', s, s + len);
      } else continue;
      str = str.replace(/\u0000/g, '').trim();
      if (str) names.add(str);
    }
    return [...names];
  } catch {
    return [];
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

let cache: PrivateFont[] | null = null;

/** 한컴 폴더의 글꼴 목록 (처음 한 번만 훑는다) */
export function listPrivateFonts(): PrivateFont[] {
  if (cache) return cache;
  const files: string[] = [];
  for (const d of candidateDirs()) findFontFiles(d, 0, files);
  const out: PrivateFont[] = [];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.size > MAX_FONT_BYTES) continue;
      const names = readFontNames(f);
      if (names.length) out.push({ names, path: f, size: st.size });
    } catch {
      /* 건너뜀 */
    }
  }
  cache = out;
  return out;
}

/** 이름으로 글꼴 파일을 찾아 바이트를 돌려준다 (목록에 있는 파일만 읽는다) */
export function readPrivateFont(name: string): { names: string[]; data: Uint8Array } | null {
  if (typeof name !== 'string' || name.length > 100) return null;
  const want = name.trim().toLowerCase();
  const hit = listPrivateFonts().find((f) => f.names.some((n) => n.toLowerCase() === want));
  if (!hit) return null;
  try {
    return { names: hit.names, data: new Uint8Array(fs.readFileSync(hit.path)) };
  } catch {
    return null;
  }
}
