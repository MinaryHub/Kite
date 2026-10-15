import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Table, { TableView } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { viewState } from '../viewState';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType };
    footnote: { insertFootnote: (text: string) => ReturnType; updateFootnote: (pos: number, text: string) => ReturnType };
    overwrite: { toggleOverwrite: () => ReturnType };
  }
}

// ---------------- 그림 (크기 조절 가능) ----------------
export const KImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('width') || el.style.width;
          const n = v ? parseFloat(v) : NaN;
          return isNaN(n) ? null : Math.round(n);
        },
        renderHTML: (a: Record<string, any>) => (a.width ? { width: a.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('height') || el.style.height;
          const n = v ? parseFloat(v) : NaN;
          return isNaN(n) ? null : Math.round(n);
        },
        renderHTML: (a: Record<string, any>) => (a.height ? { height: a.height } : {}),
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const wrap = document.createElement('span');
      wrap.className = 'k-image';
      wrap.contentEditable = 'false';
      const img = document.createElement('img');
      img.draggable = false;
      const handle = document.createElement('span');
      handle.className = 'k-image-handle';
      wrap.append(img, handle);

      const apply = (n: typeof node) => {
        img.src = n.attrs.src;
        if (n.attrs.alt) img.alt = n.attrs.alt;
        img.style.width = n.attrs.width ? n.attrs.width + 'px' : '';
        img.style.height = n.attrs.height ? n.attrs.height + 'px' : '';
      };
      apply(node);
      img.addEventListener('load', () => window.dispatchEvent(new Event('khwp:relayout')));

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = img.offsetWidth;
        const startH = img.offsetHeight;
        const ratio = startH / Math.max(1, startW);
        const move = (ev: MouseEvent) => {
          const w = Math.max(16, startW + (ev.clientX - startX) / viewState.zoom);
          img.style.width = w + 'px';
          img.style.height = w * ratio + 'px';
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          const w = Math.round(img.offsetWidth);
          const h = Math.round(img.offsetHeight);
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width: w, height: h }));
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });

      return {
        dom: wrap,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          apply(n);
          return true;
        },
        selectNode: () => wrap.classList.add('selected'),
        deselectNode: () => wrap.classList.remove('selected'),
        ignoreMutation: () => true,
      };
    };
  },
}).configure({ inline: true, allowBase64: true });

// ---------------- 쪽 나누기 ----------------
export const PageBreak = Node.create({
  name: 'pageBreak',
  priority: 1000,
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }, { tag: 'hr[data-type="page-break"]' }];
  },
  renderHTML() {
    return ['div', { 'data-type': 'page-break', class: 'page-break' }];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ state, tr, dispatch }) => {
          const pb = state.schema.nodes.pageBreak.create();
          const para = state.schema.nodes.paragraph;
          if (!state.selection.empty) tr.deleteSelection();
          const $from = tr.selection.$from;
          let caretPos: number;
          if ($from.depth > 1 || !$from.parent.isTextblock) {
            // 표/목록 안: 해당 최상위 블록 뒤에 넣는다
            const after = $from.after(1);
            tr.insert(after, [pb, para.create()]);
            caretPos = after + 2;
          } else if ($from.parentOffset === 0 && $from.parent.content.size > 0) {
            tr.insert($from.before(), pb);
            caretPos = $from.pos + 1;
          } else if ($from.parentOffset === $from.parent.content.size) {
            const after = $from.after();
            const next = tr.doc.resolve(after).nodeAfter;
            if (next && next.isTextblock) {
              tr.insert(after, pb);
              caretPos = after + 2;
            } else {
              tr.insert(after, [pb, para.create($from.parent.attrs)]);
              caretPos = after + 2;
            }
          } else {
            tr.split($from.pos);
            tr.insert($from.pos + 1, pb);
            caretPos = $from.pos + 3;
          }
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caretPos, tr.doc.content.size))));
          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

// ---------------- 각주 ----------------
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-footnote') || '',
        renderHTML: (a: Record<string, any>) => ({ 'data-footnote': a.text }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { class: 'footnote-ref' }), '*'];
  },
  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement('sup');
      dom.className = 'footnote-ref';
      dom.textContent = '*';
      dom.title = node.attrs.text;
      dom.setAttribute('data-footnote', node.attrs.text);
      dom.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : null;
        window.dispatchEvent(new CustomEvent('khwp:edit-footnote', { detail: { pos, text: node.attrs.text } }));
      });
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'footnote') return false;
          dom.title = n.attrs.text;
          dom.setAttribute('data-footnote', n.attrs.text);
          window.dispatchEvent(new Event('khwp:relayout'));
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
  addCommands() {
    return {
      insertFootnote:
        (text) =>
        ({ chain }) =>
          chain().insertContent({ type: 'footnote', attrs: { text } }).run(),
      updateFootnote:
        (pos, text) =>
        ({ tr, dispatch, state }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== 'footnote') return false;
          if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { text }));
          return true;
        },
    };
  },
});

// ---------------- 글머리표 / 문단 번호 모양 ----------------
const listStyleAttr = {
  listStyle: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.listStyleType || null,
    renderHTML: (a: Record<string, any>) => (a.listStyle ? { style: `list-style-type: ${a.listStyle}` } : {}),
  },
};

export const KBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...listStyleAttr };
  },
});

export const KOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...listStyleAttr };
  },
});

// ---------------- 표 ----------------
const cellAttrs = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: (a: Record<string, any>) =>
      a.backgroundColor ? { 'data-bg': a.backgroundColor, style: `background-color: ${a.backgroundColor}` } : {},
  },
  verticalAlign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.verticalAlign || el.getAttribute('valign') || null,
    renderHTML: (a: Record<string, any>) => (a.verticalAlign ? { style: `vertical-align: ${a.verticalAlign}` } : {}),
  },
  /** 선 굵기/색/종류 (t:0.5mm solid #00A651;...) */
  borderCss: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-border-css') || null,
    renderHTML: (a: Record<string, any>) => {
      if (!a.borderCss) return {};
      const names: Record<string, string> = { t: 'top', b: 'bottom', l: 'left', r: 'right' };
      const style = String(a.borderCss)
        .split(';')
        .map((p: string) => {
          const [k, v] = p.split(':');
          return names[k] && v ? `border-${names[k]}: ${v}` : '';
        })
        .filter(Boolean)
        .join('; ');
      return { 'data-border-css': a.borderCss, style };
    },
  },
  borderStyle: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-border') || null,
    renderHTML: (a: Record<string, any>) => (a.borderStyle ? { 'data-border': a.borderStyle } : {}),
  },
};

export const KTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

export const KTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

/** 표 속성(테두리 없음, 셀 안 여백, 정렬)을 <table>에 반영하는 NodeView */
class KTableView extends TableView {
  constructor(node: PMNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.applyAttrs(node);
  }
  update(node: PMNode) {
    const ok = super.update(node);
    if (ok) this.applyAttrs(node);
    return ok;
  }
  applyAttrs(node: PMNode) {
    const t = this.table as HTMLTableElement;
    if (node.attrs.borderless) t.setAttribute('data-borderless', 'true');
    else t.removeAttribute('data-borderless');
    if (node.attrs.cellPadding != null) t.style.setProperty('--cell-px', node.attrs.cellPadding + 'px');
    else t.style.removeProperty('--cell-px');
    const align = node.attrs.align;
    t.style.marginLeft = align === 'center' || align === 'right' ? 'auto' : '';
    t.style.marginRight = align === 'center' ? 'auto' : '';
  }
}

export const KTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderless: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-borderless') === 'true',
        renderHTML: (a: Record<string, any>) => (a.borderless ? { 'data-borderless': 'true' } : {}),
      },
      /** 셀 왼쪽/오른쪽 안 여백 (px) */
      cellPadding: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.style.getPropertyValue('--cell-px');
          return v ? parseFloat(v) : null;
        },
        renderHTML: (a: Record<string, any>) => (a.cellPadding != null ? { style: `--cell-px: ${a.cellPadding}px` } : {}),
      },
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-align') || null,
        renderHTML: (a: Record<string, any>) => (a.align ? { 'data-align': a.align } : {}),
      },
    };
  },
}).configure({ resizable: true, cellMinWidth: 20, lastColumnResizable: true, allowTableNodeSelection: true, View: KTableView as any });

// ---------------- 탭 키 / 수정(겹쳐쓰기) 모드 ----------------
const overwriteKey = new PluginKey('overwrite');

export const KeyboardExtras = Extension.create({
  name: 'keyboardExtras',
  priority: 50,
  addStorage() {
    return { overwrite: false };
  },
  addCommands() {
    return {
      toggleOverwrite:
        () =>
        ({ editor }) => {
          editor.storage.keyboardExtras.overwrite = !editor.storage.keyboardExtras.overwrite;
          editor.view.dispatch(editor.state.tr.setMeta('overwrite-toggle', true));
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d).type.name;
          if (n === 'tableCell' || n === 'tableHeader' || n === 'listItem' || n === 'taskItem') return false;
        }
        return this.editor.commands.insertContent('\t');
      },
      Insert: () => this.editor.commands.toggleOverwrite(),
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: overwriteKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (!storage.overwrite || from !== to || view.composing) return false;
            const $pos = view.state.doc.resolve(from);
            const end = Math.min($pos.end(), from + text.length);
            if (end <= from) return false;
            const tr = view.state.tr.insertText(text, from, end);
            tr.setSelection(TextSelection.create(tr.doc, from + text.length));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
