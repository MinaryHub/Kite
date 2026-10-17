/**
 * PDF 에 들어 있는 글꼴을 편집 화면에서 쓸 수 있게 만든다.
 *
 * pdf.js 는 PDF 글꼴을 OpenType 으로 바꿔 주지만, 그 문자 표(cmap)는 실제 유니코드가 아니라
 * pdf.js 내부 코드(fontChar)로 되어 있다. 그리기 명령의 글자마다 유니코드와 fontChar 가 함께 오므로
 * 둘을 이어 "유니코드 → 글리프" 문자 표를 새로 써 넣는다. 나머지 표(글리프 모양·폭)는 그대로 둔다.
 */

interface Table {
  tag: string;
  data: Uint8Array;
}

function readTables(buf: Uint8Array): { flavor: number; tables: Table[] } | null {
  if (buf.length < 12) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flavor = dv.getUint32(0);
  // TrueType(0x00010000), 'OTTO'(CFF), 'true'
  if (flavor !== 0x00010000 && flavor !== 0x4f54544f && flavor !== 0x74727565) return null;
  const n = dv.getUint16(4);
  if (12 + n * 16 > buf.length || n > 100) return null;
  const tables: Table[] = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(buf[r], buf[r + 1], buf[r + 2], buf[r + 3]);
    const off = dv.getUint32(r + 8);
    const len = dv.getUint32(r + 12);
    if (off + len > buf.length) return null;
    tables.push({ tag, data: buf.subarray(off, off + len) });
  }
  return { flavor, tables };
}

/** 기존 cmap 에서 코드 → 글리프 번호 찾기 함수 */
function cmapLookup(cmap: Uint8Array): ((code: number) => number) | null {
  if (cmap.length < 4) return null;
  const dv = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const n = dv.getUint16(2);
  const subs: { pid: number; eid: number; off: number; fmt: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = 4 + i * 8;
    if (r + 8 > cmap.length) break;
    const off = dv.getUint32(r + 4);
    if (off + 2 > cmap.length) continue;
    subs.push({ pid: dv.getUint16(r), eid: dv.getUint16(r + 2), off, fmt: dv.getUint16(off) });
  }
  // 윈도우 유니코드(3,10 / 3,1) → 기호(3,0) → 유니코드(0,*) → 매킨토시(1,0) 순서
  const rank = (s: (typeof subs)[number]) => (s.pid === 3 && s.eid === 10 ? 0 : s.pid === 3 && s.eid === 1 ? 1 : s.pid === 3 && s.eid === 0 ? 2 : s.pid === 0 ? 3 : 4);
  const fns: ((code: number) => number)[] = [];
  for (const s of subs.sort((a, b) => rank(a) - rank(b))) {
    const o = s.off;
    try {
      if (s.fmt === 4) {
        const segX2 = dv.getUint16(o + 6);
        const ends = o + 14;
        const starts = ends + segX2 + 2;
        const deltas = starts + segX2;
        const ranges = deltas + segX2;
        fns.push((code) => {
          if (code > 0xffff) return 0;
          for (let i = 0; i < segX2; i += 2) {
            const end = dv.getUint16(ends + i);
            if (code > end) continue;
            const start = dv.getUint16(starts + i);
            if (code < start) return 0;
            const delta = dv.getInt16(deltas + i);
            const ro = dv.getUint16(ranges + i);
            if (!ro) return (code + delta) & 0xffff;
            const gi = ranges + i + ro + (code - start) * 2;
            if (gi + 2 > cmap.length) return 0;
            const g = dv.getUint16(gi);
            return g ? (g + delta) & 0xffff : 0;
          }
          return 0;
        });
      } else if (s.fmt === 12) {
        const groups = dv.getUint32(o + 12);
        fns.push((code) => {
          for (let i = 0; i < groups; i++) {
            const r = o + 16 + i * 12;
            const a = dv.getUint32(r);
            const b = dv.getUint32(r + 4);
            if (code >= a && code <= b) return dv.getUint32(r + 8) + (code - a);
          }
          return 0;
        });
      } else if (s.fmt === 6) {
        const first = dv.getUint16(o + 6);
        const count = dv.getUint16(o + 8);
        fns.push((code) => (code >= first && code < first + count ? dv.getUint16(o + 10 + (code - first) * 2) : 0));
      } else if (s.fmt === 0) {
        fns.push((code) => (code < 256 ? cmap[o + 6 + code] : 0));
      }
    } catch {
      /* 다음 표 */
    }
  }
  if (!fns.length) return null;
  return (code) => {
    for (const f of fns) {
      const g = f(code);
      if (g) return g;
    }
    return 0;
  };
}

/** 유니코드 → 글리프 번호 쌍으로 cmap (형식 4 + 형식 12) 을 만든다 */
function buildCmap(pairs: [number, number][]): Uint8Array {
  pairs.sort((a, b) => a[0] - b[0]);
  // 형식 12: 연속 구간
  const groups: [number, number, number][] = [];
  for (const [u, g] of pairs) {
    const last = groups[groups.length - 1];
    if (last && u === last[1] + 1 && g === last[2] + (u - last[0])) last[1] = u;
    else groups.push([u, u, g]);
  }
  // 형식 4: BMP 만, 같은 구간을 delta 로 (구간마다 글리프가 연속)
  const bmp = groups.filter((x) => x[0] <= 0xfffe).map((x) => [x[0], Math.min(x[1], 0xfffe), x[2]] as [number, number, number]);
  const segs = [...bmp, [0xffff, 0xffff, 0] as [number, number, number]];
  const segX2 = segs.length * 2;
  const len4 = 16 + segs.length * 8;
  const len12 = 16 + groups.length * 12;
  const head = 4 + 2 * 8;
  const out = new Uint8Array(head + len4 + len12);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0);
  dv.setUint16(2, 2);
  // (3,1) → 형식 4, (3,10) → 형식 12
  dv.setUint16(4, 3);
  dv.setUint16(6, 1);
  dv.setUint32(8, head);
  dv.setUint16(12, 3);
  dv.setUint16(14, 10);
  dv.setUint32(16, head + len4);
  let o = head;
  const log2 = Math.floor(Math.log2(segs.length));
  const searchRange = 2 * 2 ** log2;
  dv.setUint16(o, 4);
  dv.setUint16(o + 2, len4);
  dv.setUint16(o + 4, 0);
  dv.setUint16(o + 6, segX2);
  dv.setUint16(o + 8, searchRange);
  dv.setUint16(o + 10, log2);
  dv.setUint16(o + 12, segX2 - searchRange);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  segs.forEach(([a, b, g], i) => {
    dv.setUint16(ends + i * 2, b);
    dv.setUint16(starts + i * 2, a);
    dv.setUint16(deltas + i * 2, a === 0xffff ? 1 : (g - a) & 0xffff);
    dv.setUint16(ranges + i * 2, 0);
  });
  o = head + len4;
  dv.setUint16(o, 12);
  dv.setUint16(o + 2, 0);
  dv.setUint32(o + 4, len12);
  dv.setUint32(o + 8, 0);
  dv.setUint32(o + 12, groups.length);
  groups.forEach(([a, b, g], i) => {
    const r = o + 16 + i * 12;
    dv.setUint32(r, a);
    dv.setUint32(r + 4, b);
    dv.setUint32(r + 8, g);
  });
  return out;
}

function checksum(d: Uint8Array): number {
  let sum = 0;
  const n = Math.ceil(d.length / 4);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    sum = (sum + (((d[k] << 24) | ((d[k + 1] || 0) << 16) | ((d[k + 2] || 0) << 8) | (d[k + 3] || 0)) >>> 0)) >>> 0;
  }
  return sum;
}

function writeFont(flavor: number, tables: Table[]): Uint8Array {
  tables = tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  let size = 12 + n * 16;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const log2 = Math.floor(Math.log2(n));
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  dv.setUint16(6, 16 * 2 ** log2);
  dv.setUint16(8, log2);
  dv.setUint16(10, n * 16 - 16 * 2 ** log2);
  let off = 12 + n * 16;
  let headOff = -1;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    let data = t.data;
    if (t.tag === 'head' && data.length >= 12) {
      data = data.slice();
      new DataView(data.buffer).setUint32(8, 0);
      headOff = off;
    }
    dv.setUint32(r + 4, checksum(data));
    dv.setUint32(r + 8, off);
    dv.setUint32(r + 12, data.length);
    out.set(data, off);
    off += (data.length + 3) & ~3;
  });
  if (headOff >= 0) dv.setUint32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/**
 * @param data pdf.js 가 만든 OpenType 글꼴
 * @param chars 유니코드 코드 포인트 → pdf.js fontChar 코드 포인트
 * @returns 유니코드 문자 표로 바꾼 글꼴과 담긴 코드 포인트들 (못 바꾸면 null)
 */
export function unicodeFont(data: Uint8Array, chars: Map<number, number>): { font: Uint8Array; codes: number[] } | null {
  const parsed = readTables(data);
  if (!parsed) return null;
  const cmapT = parsed.tables.find((t) => t.tag === 'cmap');
  if (!cmapT) return null;
  const lookup = cmapLookup(cmapT.data);
  if (!lookup) return null;
  const pairs: [number, number][] = [];
  for (const [u, fc] of chars) {
    // 제어 문자·서로게이트·비문자는 넣지 않는다
    if (u < 0x20 || (u >= 0xd800 && u <= 0xdfff) || u === 0xfffe || u === 0xffff || u > 0x10ffff) continue;
    // 공백류는 넣지 않는다: 일부 PDF 는 공백 코드가 다른 글리프를 가리키고(엑셀의 굴림 등),
    // 공백 폭은 어차피 낱말 위치에 맞춰 자간으로 정한다
    if (u === 0x20 || u === 0xa0 || u === 0x3000 || (u >= 0x2000 && u <= 0x200b) || u === 0x202f || u === 0x205f || u === 0xfeff) continue;
    const g = lookup(fc);
    if (g) pairs.push([u, g]);
  }
  if (!pairs.length) return null;
  const tables = parsed.tables.filter((t) => t.tag !== 'cmap' && t.tag !== 'DSIG');
  tables.push({ tag: 'cmap', data: buildCmap(pairs) });
  return { font: writeFont(parsed.flavor, tables), codes: pairs.map((p) => p[0]) };
}

/** CSS unicode-range 값 (연속 구간으로 묶음) */
export function unicodeRange(codes: number[]): string {
  const s = [...new Set(codes)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `U+${s[i].toString(16)}` : `U+${s[i].toString(16)}-${s[j].toString(16)}`);
    i = j + 1;
  }
  return out.join(', ');
}
