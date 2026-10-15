import { load, readSample } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const doc = await m.readHwp(readSample(process.argv[2] || 'r.hwp'));
console.log(JSON.stringify(doc.settings.page));
const pg = doc.settings.page; const bodyPx = (pg.width - pg.marginLeft - pg.marginRight) * 96 / 25.4;
console.log('body px', bodyPx.toFixed(1));
let ti = 0;
const walk = (n) => { if (n.type === 'table' && ti < 4) { ti++; const rows = n.content; let maxW = 0; rows.forEach((r, i) => { const w = r.content.reduce((a, c) => a + (c.attrs.colwidth || []).reduce((x, y) => x + y, 0), 0); maxW = Math.max(maxW, w); }); console.log('table', ti, 'rows', rows.length, 'row0 cells', rows[0].content.length, 'max row width', maxW, JSON.stringify(n.attrs)); rows.slice(0, 3).forEach(r => console.log('   ', r.content.map(c => c.attrs.colspan + 'x' + c.attrs.rowspan + ':' + (c.attrs.colwidth || []).join('+')).join(' | '))); }
  (n.content || []).forEach(walk); };
walk(doc.content);
const pua = new Map(); const w2 = (n) => { if (n.type === 'text') for (const ch of n.text) { const c = ch.codePointAt(0); if (c >= 0xe000 && c <= 0xf8ff) pua.set(c.toString(16), (pua.get(c.toString(16)) || 0) + 1); } (n.content || []).forEach(w2); }; w2(doc.content);
console.log('PUA chars', JSON.stringify([...pua]));
