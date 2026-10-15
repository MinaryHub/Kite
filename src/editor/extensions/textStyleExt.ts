import { Extension } from '@tiptap/core';
import { cssToPt, r2 } from '../cssUnits';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textStyleExt: {
      setFontSize: (pt: number | null) => ReturnType;
      changeFontSize: (delta: number) => ReturnType;
      setLetterSpacing: (percent: number | null) => ReturnType;
      setFontWidth: (percent: number | null) => ReturnType;
      setTextEffect: (effect: string | null) => ReturnType;
      setTextStyleAttrs: (attrs: Record<string, any>) => ReturnType;
    };
  }
}

export const TEXT_EFFECT_CSS: Record<string, string> = {
  outline: '-webkit-text-stroke: 0.6px currentColor; color: transparent',
  shadow: 'text-shadow: 0.08em 0.08em 0 #b0b0b0',
  emboss: 'text-shadow: -1px -1px 0 #fff, 1px 1px 0 #999',
  engrave: 'text-shadow: 1px 1px 0 #fff, -1px -1px 0 #999',
};

export const TextStyleExt = Extension.create({
  name: 'textStyleExt',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const pt = cssToPt(el.style.fontSize);
              return pt ? r2(pt) : null;
            },
            renderHTML: (a: Record<string, any>) => (a.fontSize ? { style: `font-size: ${a.fontSize}pt` } : {}),
          },
          /** 자간 (%) : 글자 크기 대비 */
          letterSpacing: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const ls = el.style.letterSpacing;
              if (!ls) return null;
              const m = /^(-?[\d.]+)em$/.exec(ls);
              if (m) return Math.round(parseFloat(m[1]) * 100);
              return null;
            },
            renderHTML: (a: Record<string, any>) => (a.letterSpacing ? { style: `letter-spacing: ${a.letterSpacing / 100}em` } : {}),
          },
          /** 장평 (%) */
          fontWidth: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute('data-font-width');
              return v ? parseInt(v, 10) : null;
            },
            renderHTML: (a: Record<string, any>) =>
              a.fontWidth && a.fontWidth !== 100
                ? { 'data-font-width': a.fontWidth, style: `font-stretch: ${Math.max(50, Math.min(200, a.fontWidth))}%` }
                : {},
          },
          /** 외곽선/그림자/양각/음각 */
          textEffect: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-effect') || null,
            renderHTML: (a: Record<string, any>) =>
              a.textEffect && TEXT_EFFECT_CSS[a.textEffect]
                ? { 'data-effect': a.textEffect, style: TEXT_EFFECT_CSS[a.textEffect] }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextStyleAttrs:
        (attrs) =>
        ({ chain }) =>
          chain().setMark('textStyle', attrs).removeEmptyTextStyle().run(),
      setFontSize:
        (pt) =>
        ({ commands }) =>
          commands.setTextStyleAttrs({ fontSize: pt }),
      changeFontSize:
        (delta) =>
        ({ editor, commands }) => {
          const cur = editor.getAttributes('textStyle').fontSize || paragraphFontSize(editor) || 10;
          const next = Math.max(1, Math.min(4096, r2(cur + delta)));
          return commands.setTextStyleAttrs({ fontSize: next });
        },
      setLetterSpacing:
        (v) =>
        ({ commands }) =>
          commands.setTextStyleAttrs({ letterSpacing: v || null }),
      setFontWidth:
        (v) =>
        ({ commands }) =>
          commands.setTextStyleAttrs({ fontWidth: v && v !== 100 ? v : null }),
      setTextEffect:
        (e) =>
        ({ commands }) =>
          commands.setTextStyleAttrs({ textEffect: e }),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-e': () => this.editor.commands.changeFontSize(1),
      'Alt-Shift-r': () => this.editor.commands.changeFontSize(-1),
      'Mod-]': () => this.editor.commands.changeFontSize(1),
      'Mod-[': () => this.editor.commands.changeFontSize(-1),
    };
  },
});

function paragraphFontSize(editor: any): number | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.attrs && n.attrs.fontSize) return n.attrs.fontSize;
  }
  return null;
}
