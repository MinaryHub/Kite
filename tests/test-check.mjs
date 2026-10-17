// 문서 검사 규칙: 걸려야 할 것은 걸리고, 바른 문장은 건드리지 않는지
import { load } from './harness.mjs';
const { runRules, getDocSchema } = await load('tests/check.entry.ts');
const schema = getDocSchema();
const cats = new Set(['spelling', 'spacing', 'official', 'plain', 'punct']);
const check = (text) => {
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  return runRules(doc, cats).map((i) => [i.text, i.fix]);
};
const expect = [
  ['일이 잘 됬다', ['됬', '됐']],
  ['몇일 뒤에 보자', ['몇일', '며칠']],
  ['내일 연락할께요', ['할께', '할게']],
  ['그렇게 할수있다', ['할수있', '할 수 있']],
  ['비가 올것같다', ['올것같', '올 것 같']],
  ['학교에 갈때는 조심', ['갈때', '갈 때']],
  ['날씨가 좋지않다', ['좋지않', '좋지 않']],
  ['회의는 2024.1.5 에 한다', ['2024.1.5', '2024. 1. 5.']],
  ['2024년 3월 15일까지 제출', ['2024년 3월 15일', '2024. 3. 15.']],
  ['오후 3시에 시작', ['오후 3시', '15:00']],
  ['첨부: 계획서 1부', ['첨부:', '붙임:']],
  ['익일 처리', ['익일', '다음 날']],
  ['두  칸 띄움', ['  ', ' ']],
  ['안되요', ['안되요', '안 돼요']],
];
const clean = ['바라마지않는 바입니다', '일이 잘 됐다', '며칠 뒤에 보자', '연락할게요', '그렇게 할 수 있다', '회의는 2024. 1. 5.에 한다', '물을 마셨다', '사람들이 모였다', '15:00에 시작', '알 수 없음', '할 것이다'];
let fail = 0;
for (const [text, want] of expect) {
  const got = check(text);
  const ok = got.some(([a, b]) => a === want[0] && b === want[1]);
  if (!ok) fail++;
  console.log(ok ? 'OK  ' : 'FAIL', text, '→', JSON.stringify(got));
}
for (const text of clean) {
  const got = check(text);
  if (got.length) fail++;
  console.log(got.length ? 'FAIL' : 'OK  ', '(바른 문장)', text, got.length ? JSON.stringify(got) : '');
}
console.log(fail ? `실패 ${fail}` : '모두 OK');
process.exit(fail ? 1 : 0);
