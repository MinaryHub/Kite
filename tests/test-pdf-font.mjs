// PDF 에 든 글꼴을 유니코드 문자 표로 바꾼 결과가 원래 글리프를 가리키는지
// 사용법: node tests/test-pdf-font.mjs 파일.pdf [쪽수]
import fs from 'node:fs';
import { load } from './harness.mjs';
const { unicodeFont, unicodeRange } = await load('src/formats/pdf/embedfont.ts');
const { extractPage } = await load('src/formats/pdf/extract.ts');
const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');

const file = process.argv[2];
if (!file) {
  console.log('사용법: node tests/test-pdf-font.mjs 파일.pdf [쪽수]');
  process.exit(0);
}
const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, fontExtraProperties: true, verbosity: 0 }).promise;

/** sfnt 의 cmap 에서 코드 → 글리프 (형식 4·12) */
function glyphOf(font, code) {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const n = dv.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (String.fromCharCode(font[r], font[r + 1], font[r + 2], font[r + 3]) === 'cmap') cmap = dv.getUint32(r + 8);
  }
  if (cmap < 0) return -1;
  const subs = dv.getUint16(cmap + 2);
  for (let i = 0; i < subs; i++) {
    const off = cmap + dv.getUint32(cmap + 4 + i * 8 + 4);
    const fmt = dv.getUint16(off);
    if (fmt === 12) {
      const groups = dv.getUint32(off + 12);
      for (let k = 0; k < groups; k++) {
        const r = off + 16 + k * 12;
        const a = dv.getUint32(r), b = dv.getUint32(r + 4);
        if (code >= a && code <= b) return dv.getUint32(r + 8) + (code - a);
      }
    }
  }
  for (let i = 0; i < subs; i++) {
    const off = cmap + dv.getUint32(cmap + 4 + i * 8 + 4);
    if (dv.getUint16(off) !== 4) continue;
    const segX2 = dv.getUint16(off + 6);
    const ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      if (code > dv.getUint16(ends + s)) continue;
      const st = dv.getUint16(starts + s);
      if (code < st) return 0;
      const ro = dv.getUint16(ranges + s);
      const d = dv.getInt16(deltas + s);
      if (!ro) return (code + d) & 0xffff;
      const g = dv.getUint16(ranges + s + ro + (code - st) * 2);
      return g ? (g + d) & 0xffff : 0;
    }
  }
  return 0;
}

let fail = 0;
let fonts = 0;
const maxPages = +(process.argv[3] || 3);
for (let pi = 1; pi <= Math.min(maxPages, pdf.numPages); pi++) {
  const page = await pdf.getPage(pi);
  const ops = await page.getOperatorList();
  const vp = page.getViewport({ scale: 1 });
  const pc = extractPage(ops, pdfjs.OPS, (id) => {
    const o = page.commonObjs.has(id) ? page.commonObjs.get(id) : null;
    return o ? { name: o.name || '', bold: !!o.bold, italic: !!o.italic, fontMatrix: o.fontMatrix, vertical: !!o.vertical } : null;
  }, vp);
  for (const [fid, chars] of pc.fontChars) {
    const o = page.commonObjs.get(fid);
    if (!o?.data) continue;
    fonts++;
    const made = unicodeFont(o.data, chars);
    if (!made) {
      console.log('  변환 못 함', o.name);
      continue;
    }
    // 원래 글꼴에서 fontChar 가 가리키던 글리프 == 새 글꼴에서 유니코드가 가리키는 글리프
    let bad = 0;
    for (const [u, fc] of chars) {
      if (u < 0x20) continue;
      const g0 = glyphOf(o.data, fc);
      const g1 = glyphOf(made.font, u);
      if (g0 > 0 && g0 !== g1) bad++;
    }
    if (bad) fail++;
    console.log(`p${pi} ${o.name}: 글자 ${chars.size}, 범위 ${unicodeRange(made.codes).length}자, 어긋남 ${bad}`, bad ? 'FAIL' : 'OK');
  }
}
console.log(fonts ? (fail ? `실패 ${fail}` : '모두 OK') : '들어 있는 글꼴 없음');
process.exit(fail ? 1 : 0);
