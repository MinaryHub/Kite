// 수식: HWPX 로 저장했다가 다시 열면 수식 개체 그대로, DOCX·HWP 는 한글 수식 글자로
import { load } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const { defaultSettings } = await load('src/formats/common.ts');
const doc = {
  content: { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: '근의 공식: ' },
    { type: 'math', attrs: { latex: '\\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}', hwp: '' } },
    { type: 'text', text: ' 와 ' },
    { type: 'math', attrs: { latex: 'x^{2}', hwp: 'x^2' } },
  ] }] },
  settings: defaultSettings(), meta: {},
};
const find = (n, t, out = []) => { if (n.type === t) out.push(n); (n.content || []).forEach((c) => find(c, t, out)); return out; };
const txt = (n) => n.text ?? (n.content || []).map(txt).join('');
let fail = 0;
const ok = (c, msg) => { if (!c) fail++; console.log(c ? 'OK  ' : 'FAIL', msg); };

const hx = await m.readHwpx(await m.writeHwpx(doc));
const maths = find(hx.content, 'math');
ok(maths.length === 2, 'HWPX 수식 2개 유지 ' + JSON.stringify(maths.map((x) => x.attrs)));
ok(maths[1]?.attrs.hwp === 'x^2', 'HWPX 원래 한글 수식 그대로');
ok(maths[0]?.attrs.latex.replace(/\s/g, '').includes('\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'), 'HWPX LaTeX 로 만든 수식이 같은 모양으로 돌아옴 ' + maths[0]?.attrs.latex);
ok(txt(hx.content).includes('근의 공식'), 'HWPX 글자 유지');

const dx = await m.readDocx(await m.writeDocx(doc));
ok(txt(dx.content).includes('over') && txt(dx.content).includes('x^2'), 'DOCX 는 한글 수식 글자로 "' + txt(dx.content) + '"');
const hw = await m.readHwp(await m.writeHwp(doc));
ok(txt(hw.content).includes('x^2'), 'HWP 는 한글 수식 글자로 "' + txt(hw.content) + '"');
console.log(fail ? `실패 ${fail}` : '모두 OK');
process.exit(fail ? 1 : 0);
