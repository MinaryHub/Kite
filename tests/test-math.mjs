// 한글 수식 ↔ LaTeX 변환: 기대한 LaTeX 가 나오고, KaTeX 가 오류 없이 그리고, 되돌린 한글 수식도 같은 LaTeX 가 되는지
import { load } from './harness.mjs';
const { hwpToLatex, latexToHwp, katex } = await load('tests/math.entry.ts');
const cases = [
  ['{a+b} over 2', '\\frac{a+b}{2}'],
  ['1 over 2', '\\frac{1}{2}'],
  ['x^2 + y^2 = r^2', 'x^{2} + y^{2} = r^{2}'],
  ['sqrt {x+1}', '\\sqrt{x+1}'],
  ['root 3 of x', '\\sqrt[3]{x}'],
  ['sum from {i=1} to n x_i', '\\sum_{i=1}^{n} x_{i}'],
  ['int from 0 to 1 f(x) dx', '\\int_{0}^{1} f(x) dx'],
  ['lim from {x -> 0} {sin x} over x = 1', '\\lim_{x \\rightarrow 0} \\frac{\\sin x}{x} = 1'],
  ['alpha + beta = GAMMA', '\\alpha + \\beta = \\Gamma'],
  ['a times b cdot c', 'a \\times b \\cdot c'],
  ['LEFT ( a over b RIGHT )', '\\left( \\frac{a}{b} \\right)'],
  ['pmatrix{a & b # c & d}', '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}'],
  ['x <= 3', 'x \\leq 3'],
  ['vec a', '\\vec{a}'],
  ['"속도" = d over t', '\\text{속도} = \\frac{d}{t}'],
  ['SQRT {b^2 -4ac}', '\\sqrt{b^{2} -4ac}'],
];
let fail = 0;
for (const [hwp, want] of cases) {
  const got = hwpToLatex(hwp);
  let err = '';
  try {
    katex.renderToString(got, { throwOnError: true, strict: false });
  } catch (e) {
    err = e.message;
  }
  const back = latexToHwp(got);
  const again = hwpToLatex(back);
  const n = (x) => x.replace(/\s+/g, '');
  const ok = n(got) === n(want) && !err && n(again) === n(got);
  console.log(ok ? 'OK  ' : 'FAIL', JSON.stringify(hwp), '→', JSON.stringify(got), err ? 'KaTeX: ' + err : '', n(again) !== n(got) ? `되돌림 ${JSON.stringify(back)} → ${JSON.stringify(again)}` : '');
  if (!ok) fail++;
}
console.log(fail ? `실패 ${fail}개` : '모두 OK');
process.exit(fail ? 1 : 0);
