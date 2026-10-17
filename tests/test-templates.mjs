// 서식 문서: 스키마에 맞고, HWPX·HWP·DOCX 로 저장했다 다시 열어도 글과 표가 남는지
import { load } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const schema = m.getDocSchema();
const txt = (n) => n.text ?? (n.content || []).map(txt).join('');
const count = (n, t) => (n.type === t ? 1 : 0) + (n.content || []).reduce((a, c) => a + count(c, t), 0);
let fail = 0;
for (const t of m.TEMPLATES) {
  const b = t.build();
  const msgs = [];
  try {
    schema.nodeFromJSON(b.content).check();
  } catch (e) {
    msgs.push('스키마: ' + e.message);
  }
  const src = txt(b.content).replace(/\s+/g, '');
  const tables = count(b.content, 'table');
  const doc = { content: b.content, settings: b.settings, meta: {} };
  for (const [fmt, w, r] of [['hwpx', m.writeHwpx, m.readHwpx], ['hwp', m.writeHwp, m.readHwp], ['docx', m.writeDocx, m.readDocx]]) {
    try {
      const back = await r(await w(doc));
      const got = txt(back.content).replace(/\s+/g, '');
      const keep = [...src].filter((ch) => got.includes(ch)).length / Math.max(1, src.length);
      if (got.length < src.length * 0.95) msgs.push(`${fmt}: 글 ${got.length}/${src.length}`);
      if (count(back.content, 'table') < tables) msgs.push(`${fmt}: 표 ${count(back.content, 'table')}/${tables}`);
      void keep;
    } catch (e) {
      msgs.push(`${fmt}: ${e.message}`);
    }
  }
  console.log(msgs.length ? 'FAIL' : 'OK  ', t.name.padEnd(14), `표 ${tables}`, msgs.join(' | '));
  if (msgs.length) fail++;
}
console.log(fail ? `실패 ${fail}` : '모두 OK');
process.exit(fail ? 1 : 0);
