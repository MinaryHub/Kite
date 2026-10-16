// 한글 줄 나눔 단위(글자/어절)가 HWPX·HWP 저장 후 다시 열어도 유지되는지
import { load } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const { defaultSettings } = await load('src/formats/common.ts');
const P = (t, breakChar) => ({ type: 'paragraph', attrs: breakChar ? { breakChar: true } : {}, content: [{ type: 'text', text: t }] });
const doc = { content: { type: 'doc', content: [P('글자 단위 문단', true), P('어절 단위 문단', false)] }, settings: defaultSettings(), meta: {} };
let fail = 0;
for (const [name, w, r] of [['hwpx', m.writeHwpx, m.readHwpx], ['hwp', m.writeHwp, m.readHwp]]) {
  const back = await r(await w(doc));
  const ps = back.content.content.filter((n) => n.type === 'paragraph' && n.content?.length);
  const got = ps.map((p) => !!p.attrs?.breakChar);
  const ok = got[0] === true && got[1] === false;
  if (!ok) fail++;
  console.log(name, ok ? 'OK' : 'FAIL', JSON.stringify(got));
}
process.exit(fail ? 1 : 0);
