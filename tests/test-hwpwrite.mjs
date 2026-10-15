import { load, readSample } from './harness.mjs';
import fs from 'node:fs';
const m = await load('tests/formats.entry.ts');
const f = process.argv[2];
const r = f.endsWith('.docx') ? m.readDocx : f.endsWith('.hwp') ? m.readHwp : m.readHwpx;
const doc = await r(readSample(f));
const count = (d) => { const c = {}; const w = (n) => { c[n.type] = (c[n.type] || 0) + 1; (n.content || []).forEach(w); }; w(d.content); return c; };
const txt = (n) => n.type === 'text' ? n.text : (n.content || []).map(txt).join('');
const out = await m.writeHwp(doc);
fs.writeFileSync('tests/.build/out-' + f.replace(/\.\w+$/, '') + '.hwp', out);
const back = await m.readHwp(out);
console.log(f, 'bytes', out.length);
console.log(' orig', JSON.stringify(count(doc)));
console.log(' back', JSON.stringify(count(back)));
console.log(' text same', txt(doc.content) === txt(back.content), txt(doc.content).length, txt(back.content).length);
console.log(' settings same', JSON.stringify(doc.settings) === JSON.stringify(back.settings), JSON.stringify(back.settings).slice(0, 300));
const a = txt(doc.content), b = txt(back.content); if (a !== b) { let i = 0; while (a[i] === b[i]) i++; console.log(' diff at', i, JSON.stringify(a.slice(i - 20, i + 40)), JSON.stringify(b.slice(i - 20, i + 40))); }
