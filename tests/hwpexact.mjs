import CFB from 'cfb';
import * as pako from 'pako';
import fs from 'node:fs';
const f = process.argv[2]; const ids = process.argv.slice(3);
const cfb = CFB.read(fs.readFileSync(f), { type: 'buffer' });
const b = Buffer.from(pako.inflateRaw(Buffer.from(CFB.find(cfb, '/BodyText/Section0').content)));
const hex = (d) => [...d].map(x => x.toString(16).padStart(2, '0')).join(' ');
let o = 0; const rs = [];
while (o + 4 <= b.length) { const h = b.readUInt32LE(o); o += 4; const tag = h & 0x3ff, level = (h >> 10) & 0x3ff; let size = (h >>> 20) & 0xfff; if (size === 0xfff) { size = b.readUInt32LE(o); o += 4; } rs.push({ tag, level, data: b.subarray(o, o + size) }); o += size; }
const seen = {};
rs.forEach((r, i) => { if (r.tag !== 71) return; const v = r.data.readUInt32LE(0); const id = String.fromCharCode((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255); if (!ids.includes(id) || seen[id]) return; seen[id] = 1; console.log(JSON.stringify(id), r.data.length, hex(r.data)); if (rs[i + 1] && rs[i + 1].tag === 72) console.log('  LH', rs[i + 1].data.length, hex(rs[i + 1].data)); });
