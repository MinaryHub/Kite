import CFB from 'cfb';
import * as pako from 'pako';
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]);
const cfb = CFB.read(buf, { type: 'buffer' });
console.log(cfb.FullPaths.join(' | '));
const get = (p) => { const e = CFB.find(cfb, p); return e ? Buffer.from(e.content) : null; };
const dec = (b) => Buffer.from(pako.inflateRaw(b));
function recs(b) { const out = []; let o = 0; while (o + 4 <= b.length) { const h = b.readUInt32LE(o); o += 4; const tag = h & 0x3ff, level = (h >> 10) & 0x3ff; let size = (h >>> 20) & 0xfff; if (size === 0xfff) { size = b.readUInt32LE(o); o += 4; } out.push({ tag, level, data: b.subarray(o, o + size) }); o += size; } return out; }
const hex = (d, n = 200) => [...d.subarray(0, n)].map(x => x.toString(16).padStart(2, '0')).join(' ');
const which = process.argv[3];
const fh = get('/FileHeader'); console.log('FH', hex(fh, 48));
if (which === 'docinfo') {
  const seen = {};
  for (const r of recs(dec(get('/DocInfo')))) { seen[r.tag] = (seen[r.tag] || 0) + 1; if (seen[r.tag] > 2) continue; console.log(r.tag, 'L' + r.level, 'len', r.data.length, '::', hex(r.data, 120)); }
} else {
  let i = 0;
  for (const r of recs(dec(get('/BodyText/Section0')))) { if (i++ > +(process.argv[4] || 40)) break; console.log(r.tag, 'L' + r.level, 'len', r.data.length, '::', hex(r.data, 100)); }
}
