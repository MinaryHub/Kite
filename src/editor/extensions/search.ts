import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchState {
  query: string;
  options: SearchOptions;
  matches: { from: number; to: number }[];
  current: number;
  decos: DecorationSet;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      setSearch: (query: string, options?: Partial<SearchOptions>) => ReturnType;
      clearSearch: () => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

export const searchKey = new PluginKey<SearchState>('search');

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildRegex(query: string, o: SearchOptions): RegExp | null {
  if (!query) return null;
  let src = o.regex ? query : escapeRe(query);
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, o.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

function findMatches(doc: PMNode, re: RegExp | null) {
  const out: { from: number; to: number }[] = [];
  if (!re) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) {
          map.push(pos + 1 + offset + i);
        }
        text += child.text;
      } else {
        map.push(pos + 1 + offset);
        text += '￼';
      }
    });
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const from = map[m.index];
      const to = map[m.index + m[0].length - 1] + 1;
      out.push({ from, to });
      if (out.length > 20000) return false;
    }
    return false;
  });
  return out;
}

function makeDecos(doc: PMNode, matches: { from: number; to: number }[], current: number) {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'search-match current' : 'search-match' })),
  );
}

const emptyOptions: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

export const Search = Extension.create({
  name: 'search',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', options: emptyOptions, matches: [], current: -1, decos: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
            if (meta) {
              const query = meta.query ?? prev.query;
              const options = meta.options ?? prev.options;
              const matches = query ? findMatches(tr.doc, buildRegex(query, options)) : [];
              let current = meta.current ?? prev.current;
              if (current >= matches.length) current = matches.length ? 0 : -1;
              return { query, options, matches, current, decos: makeDecos(tr.doc, matches, current) };
            }
            if (tr.docChanged && prev.query) {
              const matches = findMatches(tr.doc, buildRegex(prev.query, prev.options));
              const current = Math.min(prev.current, matches.length - 1);
              return { ...prev, matches, current, decos: makeDecos(tr.doc, matches, current) };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return searchKey.getState(state)?.decos;
          },
        },
      }),
    ];
  },

  addCommands() {
    const select = (tr: any, m: { from: number; to: number }) => {
      tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
      tr.scrollIntoView();
    };
    return {
      setSearch:
        (query, options) =>
        ({ tr, dispatch, state }) => {
          const prev = searchKey.getState(state)!;
          if (dispatch) dispatch(tr.setMeta(searchKey, { query, options: { ...prev.options, ...options }, current: 0 }));
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query: '', current: -1 }));
          return true;
        },
      findNext:
        () =>
        ({ tr, dispatch, state }) => {
          const s = searchKey.getState(state)!;
          if (!s.matches.length) return false;
          const head = state.selection.to;
          let idx = s.matches.findIndex((m) => m.from >= head);
          if (idx < 0) idx = 0;
          if (dispatch) {
            select(tr, s.matches[idx]);
            dispatch(tr.setMeta(searchKey, { current: idx }));
          }
          return true;
        },
      findPrev:
        () =>
        ({ tr, dispatch, state }) => {
          const s = searchKey.getState(state)!;
          if (!s.matches.length) return false;
          const head = state.selection.from;
          let idx = -1;
          for (let i = s.matches.length - 1; i >= 0; i--)
            if (s.matches[i].to <= head) {
              idx = i;
              break;
            }
          if (idx < 0) idx = s.matches.length - 1;
          if (dispatch) {
            select(tr, s.matches[idx]);
            dispatch(tr.setMeta(searchKey, { current: idx }));
          }
          return true;
        },
      replaceCurrent:
        (rep) =>
        ({ tr, dispatch, state }) => {
          const s = searchKey.getState(state)!;
          const { from, to } = state.selection;
          const m = s.matches.find((x) => x.from === from && x.to === to) || s.matches[s.current];
          if (!m) return false;
          if (dispatch) {
            const marks = state.doc.resolve(m.from + 1).marks();
            if (rep) tr.replaceWith(m.from, m.to, state.schema.text(rep, marks));
            else tr.delete(m.from, m.to);
            tr.setSelection(TextSelection.create(tr.doc, m.from + rep.length));
            tr.setMeta(searchKey, {});
            dispatch(tr);
          }
          return true;
        },
      replaceAll:
        (rep) =>
        ({ tr, dispatch, state }) => {
          const s = searchKey.getState(state)!;
          if (!s.matches.length) return false;
          if (dispatch) {
            for (let i = s.matches.length - 1; i >= 0; i--) {
              const m = s.matches[i];
              const marks = state.doc.resolve(m.from + 1).marks();
              if (rep) tr.replaceWith(m.from, m.to, state.schema.text(rep, marks));
              else tr.delete(m.from, m.to);
            }
            tr.setMeta(searchKey, {});
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

export function getSearchState(state: any): SearchState | undefined {
  return searchKey.getState(state);
}
