import CFB from 'cfb';
import * as pako from 'pako';
import fs from 'node:fs';
const cfb = CFB.read(fs.readFileSync(process.argv[2]), { type: 'buffer' });
const fh = Buffer.from(CFB.find(cfb, '/FileHeader').content);
console.log('version', fh.readUInt32LE(32).toString(16), 'flags', fh.readUInt32LE(36).toString(2));
const b = Buffer.from(pako.inflateRaw(Buffer.from(CFB.find(cfb, '/DocInfo').content)));
let o = 0, faces = [], cs = 0;
while (o + 4 <= b.length) { const h = b.readUInt32LE(o); o += 4; const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff; if (size === 0xfff) { size = b.readUInt32LE(o); o += 4; } const d = b.subarray(o, o + size); o += size;
  if (tag === 19) { const len = d.readUInt16LE(1); faces.push(d.subarray(3, 3 + len * 2).toString('utf16le') + ' attr=' + d[0].toString(16)); }
  if (tag === 21 && cs < 40) { const attr = d.readUInt32LE(46); console.log('cs', cs, 'face', d.readUInt16LE(0), 'size', d.readInt32LE(42), 'attr', attr.toString(2).padStart(32, '0'), 'strike18-20', (attr >>> 18) & 7, 'shape26-29', (attr >>> 26) & 15, 'len', d.length); cs++; }
}
console.log(faces.slice(0, 20).join(' | '));
