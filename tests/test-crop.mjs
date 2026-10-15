import { load, readSample } from './harness.mjs';
import fs from 'node:fs';
const m = await load('tests/formats.entry.ts');
const doc = await m.readHwp(readSample('i.hwp'));
let img = null;
const find = (n) => { if (!img && n.type === 'image') img = n; (n.content || []).forEach(find); };
find(doc.content);
img.attrs.crop = { t: 0.1, r: 0.2, b: 0.05, l: 0.15 };
img.attrs.width = 300; img.attrs.height = 200;
const get = (d) => { let x = null; const f = (n) => { if (!x && n.type === 'image') x = n; (n.content || []).forEach(f); }; f(d.content); return x.attrs; };
for (const [w, r, ext] of [[m.writeHwp, m.readHwp, 'hwp'], [m.writeHwpx, m.readHwpx, 'hwpx'], [m.writeDocx, m.readDocx, 'docx']]) {
  const out = await w(doc);
  fs.writeFileSync('tests/.build/crop.' + ext, out);
  const a = get(await r(out));
  console.log(ext, JSON.stringify(a.crop), a.width, a.height);
}
