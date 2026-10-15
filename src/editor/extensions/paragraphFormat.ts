import { Extension } from '@tiptap/core';
import { cssToPt, normLineHeight, r2 } from '../cssUnits';
import { normColor } from '../../formats/common';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphAttrs: (attrs: Record<string, any>) => ReturnType;
      setTextAlign: (align: string | null) => ReturnType;
      setLineHeight: (lh: string | null) => ReturnType;
      changeLineHeight: (deltaPercent: number) => ReturnType;
      changeIndent: (deltaPt: number) => ReturnType;
    };
  }
}

export const PARA_TYPES = ['paragraph', 'heading'];

const ptAttr = (cssProp: string, styleProp: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => {
    const v = (el.style as any)[cssProp];
    const pt = cssToPt(v);
    return pt ? r2(pt) : null;
  },
  renderHTML: (attrs: Record<string, any>) => {
    const v = attrs[styleProp];
    return v ? { style: `${cssPropName(cssProp)}: ${v}pt` } : {};
  },
});

function cssPropName(p: string) {
  return p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: PARA_TYPES,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const a = el.style.textAlign || el.getAttribute('align');
              if (!a) return null;
              if (a === 'justify' && el.style.textAlignLast === 'justify') return 'distribute';
              if (a === 'start') return 'left';
              if (a === 'end') return 'right';
              return ['left', 'center', 'right', 'justify'].includes(a) ? a : null;
            },
            renderHTML: (attrs: Record<string, any>) => {
              const a = attrs.textAlign;
              if (!a) return {};
              if (a === 'distribute') return { style: 'text-align: justify; text-align-last: justify' };
              return { style: `text-align: ${a}` };
            },
          },
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => normLineHeight(el.style.lineHeight),
            renderHTML: (attrs: Record<string, any>) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
          },
          // 한글 의미: indentLeft = 왼쪽 여백, textIndent = 첫 줄(음수면 내어쓰기).
          // CSS로는 내어쓰기 폭만큼 margin-left를 더하고 text-indent를 음수로 준다.
          indentLeft: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const ml = cssToPt(el.style.marginLeft) || 0;
              const ti = cssToPt(el.style.textIndent) || 0;
              const v = ml - Math.max(0, -ti);
              return v > 0.01 ? r2(v) : null;
            },
            renderHTML: (attrs: Record<string, any>) => {
              const ml = (attrs.indentLeft || 0) + Math.max(0, -(attrs.textIndent || 0));
              return ml ? { style: `margin-left: ${r2(ml)}pt` } : {};
            },
          },
          indentRight: ptAttr('marginRight', 'indentRight'),
          textIndent: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const pt = cssToPt(el.style.textIndent);
              return pt ? r2(pt) : null;
            },
            renderHTML: (attrs: Record<string, any>) => (attrs.textIndent ? { style: `text-indent: ${attrs.textIndent}pt` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const pt = cssToPt(el.style.paddingTop || el.style.marginTop);
              return pt ? r2(pt) : null;
            },
            renderHTML: (attrs: Record<string, any>) => (attrs.spaceBefore ? { style: `padding-top: ${attrs.spaceBefore}pt` } : {}),
          },
          spaceAfter: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const pt = cssToPt(el.style.paddingBottom || el.style.marginBottom);
              return pt ? r2(pt) : null;
            },
            renderHTML: (attrs: Record<string, any>) => (attrs.spaceAfter ? { style: `padding-bottom: ${attrs.spaceAfter}pt` } : {}),
          },
          paraBg: {
            default: null,
            parseHTML: (el: HTMLElement) => normColor(el.getAttribute('data-bg')),
            renderHTML: (attrs: Record<string, any>) => {
              const c = normColor(attrs.paraBg);
              return c ? { 'data-bg': c, style: `background-color: ${c}` } : {};
            },
          },
          /** 빈 문단의 높이 유지를 위한 문단 기본 글자 크기(pt) */
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const pt = cssToPt(el.style.fontSize);
              return pt ? r2(pt) : null;
            },
            renderHTML: (attrs: Record<string, any>) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}pt` } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setParagraphAttrs:
        (attrs) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (PARA_TYPES.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
              changed = true;
              return false;
            }
            return true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      setTextAlign:
        (align) =>
        ({ commands }) =>
          commands.setParagraphAttrs({ textAlign: align === 'justify' ? null : align }),
      setLineHeight:
        (lh) =>
        ({ commands }) =>
          commands.setParagraphAttrs({ lineHeight: lh }),
      changeLineHeight:
        (delta) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (PARA_TYPES.includes(node.type.name)) {
              const cur = node.attrs.lineHeight;
              let pct = 160;
              if (cur && !/pt$/.test(cur)) pct = Math.round(parseFloat(cur) * 100);
              const next = Math.max(50, Math.min(500, pct + delta));
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: next === 160 ? null : String(next / 100) });
              return false;
            }
            return true;
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      changeIndent:
        (delta) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (PARA_TYPES.includes(node.type.name)) {
              const v = Math.max(0, (node.attrs.indentLeft || 0) + delta);
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentLeft: v ? r2(v) : null });
              return false;
            }
            return true;
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () => this.editor.commands.setTextAlign('left'),
      'Mod-Shift-c': () => this.editor.commands.setTextAlign('center'),
      'Mod-Shift-r': () => this.editor.commands.setTextAlign('right'),
      'Mod-Shift-m': () => this.editor.commands.setTextAlign('justify'),
      'Mod-Shift-t': () => this.editor.commands.setTextAlign('distribute'),
      'Alt-Shift-a': () => this.editor.commands.changeLineHeight(10),
      'Alt-Shift-z': () => this.editor.commands.changeLineHeight(-10),
    };
  },
});
