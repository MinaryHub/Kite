import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * 메모 (Word 의 메모, 한글의 메모): 본문 범위에 메모 id 표시를 달고, 메모 내용은 문서 설정(settings.comments)에 둔다.
 * 메모가 겹칠 수 있도록 같은 종류 표시를 여러 개 허용한다 (excludes: '').
 */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-comment-id]', getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute('data-comment-id') }) }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes({ class: 'k-comment', 'data-comment-id': HTMLAttributes.id }), 0],
});

export interface CommentReply {
  author: string;
  time: number;
  text: string;
}

export interface CommentData {
  author: string;
  time: number;
  text: string;
  resolved?: boolean;
  replies?: CommentReply[];
}

let seq = 0;
export const newCommentId = () => `m${Date.now().toString(36)}${(++seq).toString(36)}`;

/** 문서에서 메모가 달린 범위들 (id → 첫 위치·끝 위치·본문 글자) */
export function commentRanges(doc: PMNode): Map<string, { from: number; to: number; text: string }> {
  const out = new Map<string, { from: number; to: number; text: string }>();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== 'comment' || !m.attrs.id) continue;
      const r = out.get(m.attrs.id);
      if (r) {
        r.to = pos + node.nodeSize;
        if (r.text.length < 200) r.text += node.text;
      } else out.set(m.attrs.id, { from: pos, to: pos + node.nodeSize, text: node.text || '' });
    }
    return false;
  });
  return out;
}
