import CFB from 'cfb';
import * as pako from 'pako';
import fs from 'node:fs';
import path from 'node:path';
const want = new Set(['head', 'foot', 'fn  ', 'pgnp', '%hlk', 'atno']);
const found = {};
const hex = (d, n = 120) => [...d.subarray(0, n)].map(x => x.toString(16).padStart(2, '0')).join(' ');
function recs(b) { const out = []; let o = 0; while (o + 4 <= b.length) { const h = b.readUInt32LE(o); o += 4; const tag = h & 0x3ff, level = (h >> 10) & 0x3ff; let size = (h >>> 20) & 0xfff; if (size === 0xfff) { size = b.readUInt32LE(o); o += 4; } out.push({ tag, level, data: b.subarray(o, o + size) }); o += size; } return out; }
const dirs = process.argv.slice(2);
for (const d of dirs) for (const f of fs.readdirSync(d)) {
  if (!f.toLowerCase().endsWith('.hwp')) continue;
  try {
    const cfb = CFB.read(fs.readFileSync(path.join(d, f)), { type: 'buffer' });
    const fh = Buffer.from(CFB.find(cfb, '/FileHeader').content);
    const comp = fh.readUInt32LE(36) & 1;
    for (let s = 0; s < 3; s++) {
      const e = CFB.find(cfb, '/BodyText/Section' + s); if (!e) break;
      let b = Buffer.from(e.content); if (comp) b = Buffer.from(pako.inflateRaw(b));
      const rs = recs(b);
      rs.forEach((r, i) => {
        if (r.tag !== 71) return;
        const v = r.data.readUInt32LE(0); const id = String.fromCharCode((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
        if (!want.has(id) || found[id]) return;
        found[id] = true;
        console.log('==', id, f);
        // 부모 문단 텍스트
        for (let j = i - 1; j >= 0 && j > i - 6; j--) if (rs[j].tag === 67) { console.log('  PARA_TEXT', hex(rs[j].data, 80)); break; }
        console.log('  ', r.tag, 'L' + r.level, r.data.length, hex(r.data));
        for (let j = i + 1; j < rs.length && rs[j].level > r.level && j < i + 8; j++) console.log('  ', rs[j].tag, 'L' + rs[j].level, rs[j].data.length, hex(rs[j].data, 80));
      });
    }
  } catch (e) {}
}
console.log(Object.keys(found));
