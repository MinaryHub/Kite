// 개인정보 찾기·가림: 걸려야 할 것은 걸리고, 비슷한 다른 숫자는 건드리지 않는지
import { load } from './harness.mjs';
const { findPrivacy, maskText, getDocSchema } = await load('tests/check.entry.ts');
const schema = getDocSchema();
const find = (text) => {
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  return findPrivacy(doc).map((h) => [h.kind, h.text]);
};
const expect = [
  ['주민번호 900101-1234567 입니다', ['rrn', '900101-1234567']],
  ['외국인 851231-5123456', ['rrn', '851231-5123456']],
  ['연락처: 010-1234-5678', ['phone', '010-1234-5678']],
  ['휴대폰 01012345678로', ['phone', '01012345678']],
  ['사무실 02-123-4567', ['phone', '02-123-4567']],
  ['031.234.5678 대표', ['phone', '031.234.5678']],
  ['메일 hong.gd@example.co.kr 로', ['email', 'hong.gd@example.co.kr']],
  ['카드 4111-1111-1111-1111', ['card', '4111-1111-1111-1111']],
  ['계좌 110-123-456789 (신한)', ['account', '110-123-456789']],
  ['여권 M12345678', ['passport', 'M12345678']],
  ['면허 11-22-123456-78', ['license', '11-22-123456-78']],
];
const clean = ['2024-01-05 회의', '전화 1588-1234', '문서번호 2024-123', '카드 1234-5678-9012-3456', '991399-1234567 오류', '버전 1.2.3', '총 123,456,789원', 'ISBN 978-89-123-4567-8'];
let fail = 0;
for (const [text, want] of expect) {
  const got = find(text);
  const ok = got.some(([k, t]) => k === want[0] && t === want[1]);
  console.log(ok ? 'OK  ' : 'FAIL', text, JSON.stringify(got));
  if (!ok) fail++;
}
for (const text of clean) {
  const got = find(text);
  console.log(got.length ? 'FAIL' : 'OK  ', '(아님)', text, got.length ? JSON.stringify(got) : '');
  if (got.length) fail++;
}
const masks = [
  [{ kind: 'rrn', text: '900101-1234567' }, false, '900101-1******'],
  [{ kind: 'phone', text: '010-1234-5678' }, false, '010-****-5678'],
  [{ kind: 'email', text: 'hong@example.com' }, false, 'ho**@example.com'],
  [{ kind: 'card', text: '4111-1111-1111-1111' }, false, '****-****-****-1111'],
  [{ kind: 'account', text: '110-123-456789' }, false, '***-***-**6789'],
  [{ kind: 'passport', text: 'M12345678' }, false, 'M*****678'],
  [{ kind: 'rrn', text: '900101-1234567' }, true, '******-*******'],
];
for (const [h, full, want] of masks) {
  const got = maskText(h, full);
  console.log(got === want ? 'OK  ' : 'FAIL', '가림', h.text, '→', got);
  if (got !== want) fail++;
}
console.log(fail ? `실패 ${fail}개` : '모두 OK');
process.exit(fail ? 1 : 0);
