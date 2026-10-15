// 악의적으로 만든 문서(거대한 병합 범위, 압축 폭탄)가 읽기를 멈추게 하지 않는지
import { load, readSample } from './harness.mjs';
import JSZip from 'jszip';

const m = await load('tests/formats.entry.ts');
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(name, ok ? 'OK' : 'FAIL', extra);
  if (!ok) fail++;
};
const timed = async (fn) => {
  const t0 = Date.now();
  let err = null;
  let doc = null;
  try {
    doc = await fn();
  } catch (e) {
    err = e;
  }
  return { ms: Date.now() - t0, err, doc };
};

// 1) HWPX: rowCnt=0, rowSpan=2e9
{
  const zip = await JSZip.loadAsync(readSample('b.hwpx'));
  const sec = Object.keys(zip.files).find((k) => /Contents\/section0\.xml$/i.test(k));
  let xml = await zip.file(sec).async('string');
  const had = /rowSpan="1"/.test(xml);
  xml = xml.replace(/rowCnt="\d+"/, 'rowCnt="0"').replace(/rowSpan="1"/, 'rowSpan="2000000000"').replace(/colSpan="1"/, 'colSpan="2000000000"');
  zip.file(sec, xml);
  const data = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  const r = await timed(() => m.readHwpx(data));
  check('hwpx huge rowSpan', had && !r.err && r.ms < 15000, `${r.ms}ms ${r.err || ''}`);
}

// 2) DOCX: gridSpan=2e9
{
  const zip = await JSZip.loadAsync(readSample('f.docx'));
  let xml = await zip.file('word/document.xml').async('string');
  // 첫 셀 속성에 거대한 gridSpan 을 끼워 넣는다 (없으면 tcPr 자체를 만든다)
  const had = /<w:tcPr>/.test(xml);
  const cell = '<w:tcPr><w:gridSpan w:val="2000000000"/></w:tcPr>';
  if (had) xml = xml.replace(/<w:tcPr>/, '<w:tcPr><w:gridSpan w:val="2000000000"/>');
  else if (/<w:tc>/.test(xml)) xml = xml.replace(/<w:tc>/, '<w:tc>' + cell);
  else xml = xml.replace(/<w:sectPr|<\/w:body>/, (m0) => `<w:tbl><w:tr><w:tc>${cell}<w:p/></w:tc></w:tr></w:tbl>` + m0);
  if (!xml.includes('2000000000')) throw new Error('gridSpan 주입 실패');
  zip.file('word/document.xml', xml);
  const data = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  const r = await timed(() => m.readDocx(data));
  check('docx huge gridSpan', !r.err && r.ms < 15000, `${r.ms}ms ${r.err || ''} (tcPr existed: ${had})`);
}

// 3) 압축 폭탄 DOCX: 0 바이트로 채운 900MB 항목 → 거부
{
  const zip = await JSZip.loadAsync(readSample('f.docx'));
  zip.file('word/media/bomb.bin', new Uint8Array(900 * 1024 * 1024), { compression: 'DEFLATE', compressionOptions: { level: 9 } });
  const data = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  const r = await timed(() => m.readDocx(data));
  check('docx zip bomb rejected', !!r.err && /너무 큽니다/.test(String(r.err?.message)), `${r.ms}ms ${(data.length / 1024) | 0}KB → ${r.err?.message || 'accepted!'}`);
}

// 3b) 머리 정보로는 걸리지 않는 크기(300MB)의 본문 XML: 푸는 도중 항목 상한(256MB)에서 끊겨야 한다
{
  const zip = await JSZip.loadAsync(readSample('f.docx'));
  let xml = await zip.file('word/document.xml').async('string');
  xml = xml.replace('<w:body>', '<w:body>' + ' '.repeat(300 * 1024 * 1024));
  zip.file('word/document.xml', xml, { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const data = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  const r = await timed(() => m.readDocx(data));
  check('docx oversized entry stopped while inflating', !!r.err && /너무 큽니다/.test(String(r.err?.message)), `${r.ms}ms ${(data.length / 1024) | 0}KB → ${r.err?.message || 'accepted!'}`);
}

// 4) 색 속성 주입이 XML 로 새지 않는지
{
  const { defaultSettings } = await load('src/formats/common.ts');
  const bad = 'red; background:url(http://x/t.png)"><x/>';
  const doc = {
    content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { paraBg: bad }, content: [{ type: 'text', text: 'a', marks: [{ type: 'highlight', attrs: { color: bad } }] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [100], backgroundColor: bad }, content: [{ type: 'paragraph' }] }] }] },
    ] },
    settings: defaultSettings(),
    meta: { created: '2024-"><x/>' },
  };
  for (const [name, w] of [['hwpx', m.writeHwpx], ['docx', m.writeDocx]]) {
    const bytes = await w(doc);
    const zip = await JSZip.loadAsync(bytes);
    let leaked = false;
    for (const f of Object.values(zip.files)) {
      if (f.dir) continue;
      const t = await f.async('string');
      if (t.includes('<x/>') || t.includes('url(http')) leaked = true;
    }
    check(`${name} attr injection blocked`, !leaked);
  }
}
process.exit(fail ? 1 : 0);
