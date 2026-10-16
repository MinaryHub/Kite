// 글상자(textBox)와 탭 정보(폭·채움·종류)가 HWPX 로 저장 후 다시 열어도 유지되는지,
// HWP·DOCX 는 상자를 풀어 안의 문단이 남는지
import { load } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const { defaultSettings } = await load('src/formats/common.ts');
const tab = (width, leader, type) => ({ type: 'text', text: '\t', marks: [{ type: 'tab', attrs: { width, leader, type } }] });
const P = (...content) => ({ type: 'paragraph', attrs: {}, content });
const T = (t) => ({ type: 'text', text: t });
const box = {
  type: 'textBox',
  attrs: { width: 300, height: 120, bg: '#FFEE88', bgImage: null, borderColor: '#336699', borderWidth: 2, radius: '12px', padding: [8, 10, 8, 10] },
  content: [P(T('상자 제목')), P(T('안의 둘째 문단'))],
};
const doc = {
  content: { type: 'doc', content: [P(T('목차 항목'), tab(240.5, 3, 2), T('12')), box, P(T('상자 뒤 문단'))] },
  settings: defaultSettings(),
  meta: {},
};
let fail = 0;
const check = (name, ok, info) => {
  if (!ok) fail++;
  console.log(name, ok ? 'OK' : 'FAIL', info);
};
// HWPX: 상자·탭 모두 유지
{
  const back = await m.readHwpx(await m.writeHwpx(doc));
  const top = back.content.content;
  const p0 = top.find((n) => n.type === 'paragraph' && n.content?.some((c) => c.marks?.some((k) => k.type === 'tab')));
  const tm = p0?.content.find((c) => c.marks?.some((k) => k.type === 'tab'))?.marks.find((k) => k.type === 'tab');
  check('hwpx tab', tm && Math.abs(tm.attrs.width - 240.5) < 0.5 && tm.attrs.leader === 3 && tm.attrs.type === 2, JSON.stringify(tm?.attrs));
  const b = top.find((n) => n.type === 'textBox');
  const a = b?.attrs || {};
  check(
    'hwpx textBox',
    b && Math.abs(a.width - 300) <= 1 && Math.abs(a.height - 120) <= 1 && a.bg === '#FFEE88' && a.borderColor === '#336699' && a.radius === '12px' && b.content.length === 2 && b.content[0].content[0].text === '상자 제목',
    JSON.stringify({ ...a, n: b?.content.length }),
  );
}
// HWP: 탭은 유지, 상자는 문단으로 풀림
{
  const back = await m.readHwp(await m.writeHwp(doc));
  const top = back.content.content;
  const texts = top.filter((n) => n.type === 'paragraph').map((p) => (p.content || []).map((c) => c.text || '').join(''));
  const tm = top.flatMap((n) => n.content || []).find((c) => c.marks?.some((k) => k.type === 'tab'))?.marks.find((k) => k.type === 'tab');
  check('hwp tab', tm && Math.abs(tm.attrs.width - 240.5) < 0.5 && tm.attrs.leader === 3 && tm.attrs.type === 2, JSON.stringify(tm?.attrs));
  check('hwp box unwrapped', texts.includes('상자 제목') && texts.includes('안의 둘째 문단') && !top.some((n) => n.type === 'textBox'), JSON.stringify(texts));
}
// DOCX: 상자 안 문단이 남는다
{
  const back = await m.readDocx(await m.writeDocx(doc));
  const texts = back.content.content.filter((n) => n.type === 'paragraph').map((p) => (p.content || []).map((c) => c.text || '').join(''));
  check('docx box unwrapped', texts.includes('상자 제목') && texts.includes('상자 뒤 문단'), JSON.stringify(texts));
}
process.exit(fail ? 1 : 0);
