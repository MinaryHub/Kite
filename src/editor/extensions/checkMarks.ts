import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * 문서 검사 결과를 물결 밑줄로 보여 준다 (문서 내용은 바꾸지 않는 장식).
 * 문서가 바뀌면 위치를 따라 옮기고, 고친 곳(글자가 바뀐 곳)의 밑줄은 없앤다.
 */

export interface CheckMark {
  id: string;
  from: number;
  to: number;
  cat: string;
}

export const checkMarksKey = new PluginKey<{ set: DecorationSet; current: string | null }>('checkMarks');

function build(doc: any, marks: CheckMark[], current: string | null): DecorationSet {
  const decos: Decoration[] = [];
  for (const m of marks) {
    if (m.from < 0 || m.to > doc.content.size || m.from >= m.to) continue;
    decos.push(Decoration.inline(m.from, m.to, { class: `chk-mark chk-${m.cat}${m.id === current ? ' chk-current' : ''}`, 'data-chk': m.id }, { id: m.id, cat: m.cat, inclusiveStart: false, inclusiveEnd: false }));
  }
  return DecorationSet.create(doc, decos);
}

export const CheckMarks = Extension.create({
  name: 'checkMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: checkMarksKey,
        state: {
          init: (): { set: DecorationSet; current: string | null } => ({ set: DecorationSet.empty, current: null }),
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(checkMarksKey) as { marks?: CheckMark[]; current?: string | null } | undefined;
            if (meta?.marks) return { set: build(state.doc, meta.marks, meta.current ?? null), current: meta.current ?? null };
            let set = value.set;
            if (tr.docChanged) {
              set = set.map(tr.mapping, tr.doc);
              // 글자가 바뀐 자리의 밑줄은 지운다 (고쳤거나 손으로 바꾼 곳)
              const gone: Decoration[] = [];
              // 각 단계의 바뀐 범위를 뒤 단계들을 거쳐 최종 문서 위치로 옮긴다
              tr.mapping.maps.forEach((map, k) => {
                const rest = tr.mapping.slice(k + 1);
                map.forEach((_os, _oe, ns, ne) => {
                  const a = rest.map(ns, -1);
                  const b = rest.map(ne, 1);
                  gone.push(...set.find(Math.max(0, a - 1), Math.min(tr.doc.content.size, b + 1)));
                });
              });
              if (gone.length) set = set.remove(gone);
            }
            if (meta && 'current' in meta && meta.current !== value.current) {
              // 강조만 바꾼다: 장식을 다시 만든다
              const marks: CheckMark[] = set.find().map((d: any) => ({ id: d.spec.id, from: d.from, to: d.to, cat: d.spec.cat || '' }));
              return { set: build(tr.doc, marks, meta.current ?? null), current: meta.current ?? null };
            }
            return { set, current: value.current };
          },
        },
        props: {
          decorations(state) {
            return checkMarksKey.getState(state)?.set || null;
          },
        },
      }),
    ];
  },
});

/** 지금 남아 있는 밑줄들의 위치 (id → 범위) */
export function currentCheckRanges(state: any): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>();
  const set: DecorationSet | undefined = checkMarksKey.getState(state)?.set;
  for (const d of (set?.find() || []) as any[]) out.set(d.spec.id, { from: d.from, to: d.to });
  return out;
}
