import { load } from './harness.mjs';
import fs from 'node:fs';
const m = await load('tests/formats.entry.ts');
const T = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const P = (attrs, ...content) => ({ type: 'paragraph', attrs, content });
const cell = (text, attrs = {}) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [140], ...attrs }, content: [P({}, T(text))] });
const doc = {
  content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [T('K-HWP 기능 시험 문서')] },
    P({}, T('보통 글자, '), T('진하게', [{ type: 'bold' }]), T(', '), T('기울임', [{ type: 'italic' }]), T(', '), T('밑줄', [{ type: 'underline' }]), T(', '), T('취소선', [{ type: 'strike' }]), T(', '), T('빨간 14pt 맑은 고딕', [{ type: 'textStyle', attrs: { color: '#FF0000', fontSize: 14, fontFamily: '맑은 고딕' } }]), T(', '), T('형광펜', [{ type: 'highlight', attrs: { color: '#FFFF00' } }]), T(' 그리고 H'), T('2', [{ type: 'subscript' }]), T('O, x'), T('2', [{ type: 'superscript' }]), T('.')),
    P({ textAlign: 'center' }, T('가운데 정렬 문단')),
    P({ textAlign: 'right' }, T('오른쪽 정렬 문단')),
    P({ indentLeft: 20, textIndent: -15, lineHeight: '2' }, T('내어쓰기 15pt, 왼쪽 여백 20pt, 줄 간격 200% 문단입니다. 이 문단은 길게 써서 두 줄 이상이 되도록 합니다. 한글 문서 편집기에서 내어쓰기가 바르게 보이는지 확인합니다.')),
    P({ spaceBefore: 10, spaceAfter: 10, paraBg: '#DDEEFF' }, T('문단 위/아래 10pt, 배경색 있는 문단')),
    P({}, T('각주가 있는 문장'), { type: 'footnote', attrs: { text: '이것은 각주 내용입니다.' } }, T(' 과 '), T('하이퍼링크', [{ type: 'link', attrs: { href: 'https://www.hancom.com' } }]), T('.')),
    { type: 'bulletList', content: [{ type: 'listItem', content: [P({}, T('글머리표 항목 1'))] }, { type: 'listItem', content: [P({}, T('글머리표 항목 2'))] }] },
    { type: 'orderedList', attrs: { listStyle: 'hangul' }, content: [{ type: 'listItem', content: [P({}, T('가 번호 항목'))] }, { type: 'listItem', content: [P({}, T('나 번호 항목'))] }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('구분', { backgroundColor: '#D9D9D9' }), cell('내용', { backgroundColor: '#D9D9D9', colspan: 2, colwidth: [140, 140] })] },
      { type: 'tableRow', content: [cell('병합', { rowspan: 2 }), cell('셀 1'), cell('셀 2')] },
      { type: 'tableRow', content: [cell('셀 3'), cell('셀 4', { verticalAlign: 'bottom' })] },
    ] },
    { type: 'pageBreak' },
    P({}, T('둘째 쪽 첫 문단입니다.\t탭 뒤 글자')),
  ] },
  settings: { page: { width: 210, height: 297, marginTop: 20, marginBottom: 15, marginLeft: 30, marginRight: 30, marginHeader: 15, marginFooter: 15, gutter: 0, landscape: false }, header: { text: 'K-HWP 시험 머리말', align: 'right' }, footer: { text: '꼬리말 {{PAGE}}쪽', align: 'left' }, pageNumber: { pos: 'bottom-center', format: 'dash', start: 1 } },
  meta: { title: 'K-HWP 시험', author: 'K-HWP' },
};
fs.writeFileSync('tests/.build/rich.hwp', await m.writeHwp(doc, { pageCount: 2 }));
fs.writeFileSync('tests/.build/rich.hwpx', await m.writeHwpx(doc, { pageCount: 2 }));
fs.writeFileSync('tests/.build/rich.docx', await m.writeDocx(doc));
const back = await m.readHwp(fs.readFileSync('tests/.build/rich.hwp'));
console.log(JSON.stringify(back.settings), JSON.stringify(back.content).includes('footnote'));
