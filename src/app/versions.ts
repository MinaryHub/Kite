import type { DocTab } from '../doc/docTab';

/**
 * 버전 기록: 문서 사본(스냅숏)을 이 컴퓨터의 IndexedDB 에 남긴다.
 * - 저장할 때마다, 편집 중에는 몇 분마다(바뀐 것이 있을 때만), 그리고 사용자가 이름을 붙여 남길 때
 * - 그림 같은 큰 자료(data: 주소)는 따로 한 번만 보관해 사본마다 되풀이하지 않는다
 * - 자동 사본은 문서마다 최근 MAX_AUTO 개만, 이름 붙인 사본은 지우기 전까지 둔다
 */

export interface VersionMeta {
  id: number;
  docKey: string;
  title: string;
  time: number;
  /** 'save' 저장할 때 · 'auto' 편집 중 자동 · 'named' 이름 붙임 · 'restore' 되돌리기 직전 */
  kind: 'save' | 'auto' | 'named' | 'restore';
  label: string;
  chars: number;
  hash: string;
}
interface VersionRow extends VersionMeta {
  body: string;
}

const DB = 'kite-versions';
const MAX_AUTO = 60;
const AUTO_MS = 5 * 60 * 1000;
const BLOB_MIN = 2048;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      const v = d.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
      v.createIndex('doc', 'docKey');
      d.createObjectStore('blobs');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

/** 빠른 문자열 지문 (같은 내용인지 가리는 용도) */
function fnv(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

export const docKey = (tab: DocTab) => (tab.path ? 'file:' + tab.path : 'tab:' + tab.id);

/** 큰 data: 문자열은 blobs 로 빼고 자리에 표시를 남긴다 */
function pack(value: unknown, blobs: Map<string, string>): unknown {
  if (typeof value === 'string') {
    if (value.length >= BLOB_MIN && value.startsWith('data:')) {
      const h = fnv(value);
      blobs.set(h, value);
      return '\u0000blob:' + h;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => pack(v, blobs));
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = pack(v, blobs);
    return o;
  }
  return value;
}
function unpack(value: unknown, blobs: Map<string, string>): unknown {
  if (typeof value === 'string') return value.startsWith('\u0000blob:') ? blobs.get(value.slice(6)) ?? '' : value;
  if (Array.isArray(value)) return value.map((v) => unpack(v, blobs));
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = unpack(v, blobs);
    return o;
  }
  return value;
}

const lastHash = new Map<string, string>();

/** 지금 문서의 사본을 남긴다. 직전 사본과 같으면 (이름 붙이기가 아니면) 남기지 않는다 */
export async function snapshot(tab: DocTab, kind: VersionMeta['kind'], label = ''): Promise<VersionMeta | null> {
  try {
    const d = await db();
    const key = docKey(tab);
    // 처음 저장한 새 문서: 저장 전 사본을 파일 이름 아래로 옮긴다
    if (tab.path) await migrate('tab:' + tab.id, key);
    const blobs = new Map<string, string>();
    const body = JSON.stringify(pack({ content: tab.editor.getJSON(), settings: tab.settings, meta: tab.meta }, blobs));
    const hash = fnv(body);
    if (kind !== 'named') {
      if (!lastHash.has(key)) {
        const prev = (await list(tab))[0];
        if (prev) lastHash.set(key, prev.hash);
      }
      if (lastHash.get(key) === hash) return null;
    }
    const t = d.transaction(['versions', 'blobs'], 'readwrite');
    const bs = t.objectStore('blobs');
    for (const [h, v] of blobs) bs.put(v, h);
    const row: Omit<VersionRow, 'id'> = { docKey: key, title: tab.title, time: Date.now(), kind, label, chars: tab.editor.state.doc.textContent.length, hash, body };
    const id = (await req(t.objectStore('versions').add(row))) as number;
    await new Promise((r) => (t.oncomplete = r));
    lastHash.set(key, hash);
    void prune(key);
    const { body: _b, ...meta } = { ...row, id };
    return meta;
  } catch (e) {
    console.warn('[versions]', e);
    return null;
  }
}

async function migrate(from: string, to: string) {
  const d = await db();
  const t = d.transaction('versions', 'readwrite');
  const idx = t.objectStore('versions').index('doc');
  const rows = (await req(idx.getAll(from))) as VersionRow[];
  for (const r of rows) t.objectStore('versions').put({ ...r, docKey: to });
  await new Promise((r) => (t.oncomplete = r));
}

async function prune(key: string) {
  const d = await db();
  const t = d.transaction('versions', 'readwrite');
  const st = t.objectStore('versions');
  const rows = ((await req(st.index('doc').getAll(key))) as VersionRow[]).sort((a, b) => b.time - a.time);
  rows.filter((r) => r.kind !== 'named').slice(MAX_AUTO).forEach((r) => st.delete(r.id));
}

/** 문서의 사본 목록 (새것부터) */
export async function list(tab: DocTab): Promise<VersionMeta[]> {
  try {
    const d = await db();
    const rows = (await req(d.transaction('versions').objectStore('versions').index('doc').getAll(docKey(tab)))) as VersionRow[];
    return rows.map(({ body: _b, ...m }) => m).sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

/** 사본 내용 */
export async function load(id: number): Promise<{ content: any; settings: any; meta: any } | null> {
  const d = await db();
  const t = d.transaction(['versions', 'blobs']);
  const row = (await req(t.objectStore('versions').get(id))) as VersionRow | undefined;
  if (!row) return null;
  const raw = JSON.parse(row.body);
  const need = new Set<string>();
  row.body.replace(/\\u0000blob:([a-z0-9]+)/g, (_m, h) => (need.add(h), ''));
  const blobs = new Map<string, string>();
  for (const h of need) {
    const v = (await req(t.objectStore('blobs').get(h))) as string | undefined;
    if (v) blobs.set(h, v);
  }
  return unpack(raw, blobs) as any;
}

export async function rename(id: number, label: string) {
  const d = await db();
  const t = d.transaction('versions', 'readwrite');
  const st = t.objectStore('versions');
  const row = (await req(st.get(id))) as VersionRow | undefined;
  if (row) st.put({ ...row, label, kind: label.trim() ? 'named' : row.kind === 'named' ? 'auto' : row.kind });
  await new Promise((r) => (t.oncomplete = r));
}

export async function remove(id: number) {
  const d = await db();
  const t = d.transaction('versions', 'readwrite');
  t.objectStore('versions').delete(id);
  await new Promise((r) => (t.oncomplete = r));
}

/** 편집 중 자동 사본: 바뀐 문서만 몇 분마다 */
let timer: any = null;
export function startAutoVersions(docs: () => DocTab[]) {
  clearInterval(timer);
  timer = setInterval(() => {
    for (const t of docs()) if (t.dirty) void snapshot(t, 'auto');
  }, AUTO_MS);
}
