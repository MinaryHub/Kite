import type { Editor } from '@tiptap/react';
import { computeGeom } from '../print';
import type { DocSettings } from '../types';

/** 본문 폭에 맞춘 표 삽입 (한글처럼 단 너비를 꽉 채움) */
export function insertTableFull(editor: Editor, settings: DocSettings, rows: number, cols: number, header = false) {
  const g = computeGeom(settings);
  const w = Math.floor((g.contentW - 2) / cols);
  const cell = (isHeader: boolean) => ({
    type: isHeader ? 'tableHeader' : 'tableCell',
    attrs: { colspan: 1, rowspan: 1, colwidth: [w] },
    content: [{ type: 'paragraph' }],
  });
  const table = {
    type: 'table',
    content: Array.from({ length: rows }, (_, r) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, () => cell(header && r === 0)),
    })),
  };
  const { $from } = editor.state.selection;
  const atEnd = $from.depth >= 1 && $from.after(1) >= editor.state.doc.content.size;
  const c = editor.chain().focus().insertContent(table);
  if (atEnd) c.insertContent({ type: 'paragraph' });
  c.run();
}
