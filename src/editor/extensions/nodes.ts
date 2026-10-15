import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Table, { TableView } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { viewState } from '../viewState';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType };
    footnote: { insertFootnote: (text: string) => ReturnType; updateFootnote: (pos: number, text: string) => ReturnType };
    overwrite: { toggleOverwrite: () => ReturnType };
  }
}

// ---------------- 그림 (크기 조절·자르기) ----------------
export interface Crop {
  t: number;
  r: number;
  b: number;
  l: number;
}

export const cropOf = (v: any): Crop | null => {
  if (!v) return null;
  const c = { t: +v.t || 0, r: +v.r || 0, b: +v.b || 0, l: +v.l || 0 };
  return c.t || c.r || c.b || c.l ? c : null;
};

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
      /** 잘라 낸 비율 (0~1): 위/오른쪽/아래/왼쪽 */
      crop: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-crop');
          if (!v) return null;
          const [t, r, b, l] = v.split(',').map(Number);
          return cropOf({ t, r, b, l });
        },
        renderHTML: (a: Record<string, any>) => {
          const c = cropOf(a.crop);
          return c ? { 'data-crop': [c.t, c.r, c.b, c.l].join(',') } : {};
        },
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
      handle.title = '끌기: 크기 조절 / Shift+끌기: 자르기';
      wrap.append(img, handle);

      const layout = (w: number | null, h: number | null, crop: Crop | null) => {
        if (crop && w && h) {
          const iw = w / Math.max(0.01, 1 - crop.l - crop.r);
          const ih = h / Math.max(0.01, 1 - crop.t - crop.b);
          wrap.classList.add('cropped');
          wrap.style.width = w + 'px';
          wrap.style.height = h + 'px';
          img.style.width = iw + 'px';
          img.style.height = ih + 'px';
          img.style.marginLeft = -crop.l * iw + 'px';
          img.style.marginTop = -crop.t * ih + 'px';
        } else {
          wrap.classList.remove('cropped');
          wrap.style.width = '';
          wrap.style.height = '';
          img.style.marginLeft = '';
          img.style.marginTop = '';
          img.style.width = w ? w + 'px' : '';
          img.style.height = h ? h + 'px' : '';
        }
      };
      const apply = (n: typeof node) => {
        if (img.getAttribute('src') !== n.attrs.src) img.src = n.attrs.src;
        if (n.attrs.alt) img.alt = n.attrs.alt;
        layout(n.attrs.width, n.attrs.height, cropOf(n.attrs.crop));
      };
      apply(node);
      img.addEventListener('load', () => window.dispatchEvent(new Event('khwp:relayout')));

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cropping = e.shiftKey;
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = wrap.offsetWidth || img.offsetWidth;
        const startH = wrap.offsetHeight || img.offsetHeight;
        const ratio = startH / Math.max(1, startW);
        const c0 = cropOf(current.attrs.crop) || { t: 0, r: 0, b: 0, l: 0 };
        // 자르기 기준: 원본 전체가 화면에 그려질 크기
        const fullW = startW / Math.max(0.01, 1 - c0.l - c0.r);
        const fullH = startH / Math.max(0.01, 1 - c0.t - c0.b);
        let res = { w: startW, h: startH, crop: c0 as Crop | null };
        const move = (ev: MouseEvent) => {
          const dx = (ev.clientX - startX) / viewState.zoom;
          const dy = (ev.clientY - startY) / viewState.zoom;
          if (cropping) {
            const r = Math.min(1 - c0.l - 0.05, Math.max(0, c0.r - dx / fullW));
            const b = Math.min(1 - c0.t - 0.05, Math.max(0, c0.b - dy / fullH));
            const crop = { ...c0, r, b };
            const w = fullW * (1 - crop.l - crop.r);
            const h = fullH * (1 - crop.t - crop.b);
            res = { w, h, crop };
            layout(w, h, crop);
          } else {
            const w = Math.max(16, startW + dx);
            res = { w, h: w * ratio, crop: cropOf(c0) };
            layout(res.w, res.h, res.crop);
          }
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...current.attrs,
              width: Math.round(res.w),
              height: Math.round(res.h),
              crop: cropOf(res.crop),
            }),
          );
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
  constructor(node: PMNode, cellMinWidth: number, view?: EditorView) {
    super(node, cellMinWidth);
    this.applyAttrs(node);
    // 표 전체 선택 손잡이 (왼쪽 위)
    const handle = document.createElement('div');
    handle.className = 'table-handle';
    handle.contentEditable = 'false';
    handle.title = '표 선택 (끌지 말고 누르기) — 선택 후 Delete로 지우기, Ctrl+X/C로 오려 두기·복사';
    handle.textContent = '⊞';
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!view) return;
      selectTableAtDom(view, this.table);
    });
    this.dom.appendChild(handle);
  }
  ignoreMutation(record: any) {
    if (record.target && (record.target as HTMLElement).classList?.contains('table-handle')) return true;
    return super.ignoreMutation(record);
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

/** DOM 속 표를 노드 선택으로 */
export function selectTableAtDom(view: EditorView, table: HTMLElement) {
  try {
    const inside = view.posAtDOM(table, 0);
    const $p = view.state.doc.resolve(inside);
    for (let d = $p.depth; d >= 0; d--) {
      if ($p.node(d).type.name === 'table') {
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, $p.before(d))));
        view.focus();
        return;
      }
    }
  } catch {
    /* 무시 */
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
}).configure({ resizable: true, cellMinWidth: 4, lastColumnResizable: true, allowTableNodeSelection: true, View: KTableView as any });

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

// ---------------- 표 셀 안의 짧은 숫자/영문 낱말 줄바꿈 방지 ----------------
// 한글과 글꼴 너비가 조금 달라 "08:30" 같은 값이 두 줄로 깨지는 것을 막는다.
const NOWRAP_RE = /^[\x21-\x7e]{1,10}$/;
const cellNoWrapKey = new PluginKey<DecorationSet>('cellNoWrap');

function noWrapDecos(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'table' || node.type.name === 'tableRow' || node.type.name === 'tableCell' || node.type.name === 'tableHeader') return true;
    if (node.isTextblock && parent && (parent.type.name === 'tableCell' || parent.type.name === 'tableHeader')) {
      if (NOWRAP_RE.test(node.textContent.trim())) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'k-nowrap' }));
      return false;
    }
    return node.type.name !== 'paragraph';
  });
  return DecorationSet.create(doc, decos);
}

export const CellNoWrap = Extension.create({
  name: 'cellNoWrap',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: cellNoWrapKey,
        state: {
          init: (_c, state) => noWrapDecos(state.doc),
          apply: (tr, old) => (tr.docChanged ? noWrapDecos(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return cellNoWrapKey.getState(state);
          },
        },
      }),
    ];
  },
});
