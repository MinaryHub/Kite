// 표 줄 높이가 HWPX/HWP/DOCX 저장 후 다시 열어도 유지되는지
import { load } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const { defaultSettings } = await load('src/formats/common.ts');
const cell = (t) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const doc = {
  content: { type: 'doc', content: [{ type: 'table', content: [
    { type: 'tableRow', attrs: { height: 120 }, content: [cell('a'), cell('b')] },
    { type: 'tableRow', content: [cell('c'), cell('d')] },
  ] }, { type: 'paragraph' }] },
  settings: defaultSettings(), meta: {},
};
const heights = (d) => { const out = []; const walk = (n) => { if (n.type === 'tableRow') out.push(n.attrs?.height ?? null); (n.content || []).forEach(walk); }; walk(d.content); return out; };
let fail = 0;
for (const [name, w, r] of [['hwpx', m.writeHwpx, m.readHwpx], ['hwp', m.writeHwp, m.readHwp], ['docx', m.writeDocx, m.readDocx]]) {
  const bytes = await w(doc);
  const back = await r(bytes);
  const h = heights(back);
  const ok = Math.abs((h[0] || 0) - 120) < 1.5 && (h[1] == null || h[1] < 20);
  if (!ok) fail++;
  console.log(name, ok ? 'OK' : 'FAIL', JSON.stringify(h));
}
process.exit(fail ? 1 : 0);
