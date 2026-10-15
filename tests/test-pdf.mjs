import fs from 'node:fs';
import { load } from './harness.mjs';
const { convertPdf } = await load('src/formats/pdf/reader.ts');
const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const file = process.argv[2];
const data = new Uint8Array(fs.readFileSync(file));
const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, fontExtraProperties: true }).promise;
const t0 = Date.now();
const doc = await convertPdf(pdf, pdfjs.OPS, async () => 'data:image/png;base64,AA==');
console.log('time', Date.now() - t0, 'ms', 'settings', JSON.stringify(doc.settings.page), doc.warnings);
const txt = (n) => n.text ?? (n.content || []).map(txt).join('');
const show = (n, ind = '') => {
  if (n.type === 'paragraph') { const a = { ...(n.attrs || {}) }; console.log(ind + 'P', JSON.stringify(a), '|', txt(n).slice(0, 70), (n.content||[]).filter(x=>x.type==='image').length ? '[IMG]' : ''); }
  else if (n.type === 'table') { console.log(ind + 'TABLE', JSON.stringify(n.attrs), 'rows', n.content.length); n.content.forEach((r, ri) => r.content.forEach((c, ci) => { console.log(ind + `  [${ri},${ci}] ` + JSON.stringify({ ...c.attrs, colwidth: undefined, cw: c.attrs.colwidth?.join('+') })); c.content.forEach((b) => show(b, ind + '     ')); })); }
  else console.log(ind + n.type);
};
const maxB = +(process.argv[3] || 60);
doc.content.content.slice(0, maxB).forEach((b) => show(b));
if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(doc));
