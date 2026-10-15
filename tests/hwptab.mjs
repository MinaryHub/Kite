import CFB from 'cfb';
import * as pako from 'pako';
import fs from 'node:fs';
import path from 'node:path';
const d = process.argv[2];
for (const f of fs.readdirSync(d).filter(x => x.endsWith('.hwp'))) {
  try {
    const cfb = CFB.read(fs.readFileSync(path.join(d, f)), { type: 'buffer' });
    const b = Buffer.from(pako.inflateRaw(Buffer.from(CFB.find(cfb, '/BodyText/Section0').content)));
    let o = 0;
    while (o + 4 <= b.length) { const h = b.readUInt32LE(o); o += 4; const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff; if (size === 0xfff) { size = b.readUInt32LE(o); o += 4; } const data = b.subarray(o, o + size); o += size;
      if (tag === 67) { for (let i = 0; i + 16 <= data.length; i += 2) { if (data.readUInt16LE(i) === 9) { console.log(f, [...data.subarray(i, i + 16)].map(x => x.toString(16).padStart(2, '0')).join(' ')); process.exit(0); } const c = data.readUInt16LE(i); if (c < 32 && c !== 10 && c !== 13 && ![0,24,25,26,27,28,29,30,31].includes(c)) i += 14; } }
    }
  } catch {}
}
