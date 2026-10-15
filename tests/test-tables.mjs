import { load, readSample } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const f = process.argv[2];
const doc = await (f.endsWith('.hwp') ? m.readHwp : m.readHwpx)(readSample(f));
let maxW = 0, maxCols = 0, maxRowspan = 0, maxColspan = 0, tables = 0, depth = 0, maxDepth = 0, widest = 0;
const walk = (n, d) => {
  if (n.type === 'table') { tables++; maxDepth = Math.max(maxDepth, d); let w = 0; (n.content[0]?.content || []).forEach(c => w += (c.attrs.colwidth || []).reduce((a, b) => a + b, 0)); widest = Math.max(widest, w); }
  if (n.type === 'tableCell') { for (const w of n.attrs.colwidth || []) maxW = Math.max(maxW, w); maxRowspan = Math.max(maxRowspan, n.attrs.rowspan); maxColspan = Math.max(maxColspan, n.attrs.colspan); }
  if (n.type === 'tableRow') maxCols = Math.max(maxCols, n.content.length);
  (n.content || []).forEach(c => walk(c, d + (n.type === 'table' ? 1 : 0)));
};
walk(doc.content, 0);
console.log({ tables, maxW, maxCols, maxRowspan, maxColspan, maxDepth, widest });
const attrsBig = []; const w2 = (n) => { if (n.attrs) for (const [k, v] of Object.entries(n.attrs)) if (typeof v === 'number' && Math.abs(v) > 5000) attrsBig.push(n.type + '.' + k + '=' + v); (n.content || []).forEach(w2); }; w2(doc.content);
console.log(attrsBig.slice(0, 20));
