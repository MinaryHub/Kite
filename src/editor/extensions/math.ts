import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import { latexToHwp } from '../../math/hwpEq';

/**
 * 수식 (글자처럼 줄 안에 놓이는 개체). LaTeX 로 저장하고 KaTeX 로 그린다.
 * 한글 문서에서 읽은 수식은 원래 한글 수식 문법(hwp)도 함께 지녀, 고치지 않았으면 그대로 다시 쓴다.
 */
export function renderMath(el: HTMLElement, latex: string, output: 'html' | 'mathml' = 'html') {
  try {
    katex.render(latex || '\\square', el, { throwOnError: false, strict: false, output, displayMode: false });
    el.classList.remove('k-math-err');
  } catch {
    el.textContent = latex;
    el.classList.add('k-math-err');
  }
}

/** 다른 형식(DOCX·ODT·텍스트 등)에 글자로 쓸 때의 모양 */
export const mathPlain = (attrs: { latex?: string; hwp?: string }) => attrs.hwp || latexToHwp(attrs.latex || '') || attrs.latex || '';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertMath: (latex: string, hwp?: string) => ReturnType;
    };
  }
}

export const MathInline = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') || '', renderHTML: (a: Record<string, any>) => ({ 'data-latex': a.latex }) },
      hwp: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-hwp') || '', renderHTML: (a: Record<string, any>) => (a.hwp ? { 'data-hwp': a.hwp } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-latex]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    // HTML 로 내보낼 때도 그린 모양이 보이도록 (data-latex 로 다시 읽는다)
    if (typeof document !== 'undefined') {
      const span = document.createElement('span');
      const attrs = mergeAttributes(HTMLAttributes, { class: 'k-math' });
      for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) span.setAttribute(k, String(v));
      // 내보낸 HTML·붙여넣기는 KaTeX 스타일이 없어도 브라우저가 그리는 MathML 로
      renderMath(span, node.attrs.latex, 'mathml');
      return span;
    }
    return ['span', mergeAttributes(HTMLAttributes, { class: 'k-math' }), node.attrs.latex];
  },
  renderText({ node }) {
    return mathPlain(node.attrs);
  },
  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement('span');
      dom.className = 'k-math';
      dom.contentEditable = 'false';
      let cur = node;
      const draw = () => {
        dom.setAttribute('data-latex', cur.attrs.latex);
        dom.title = '수식 (두 번 눌러 고치기)';
        renderMath(dom, cur.attrs.latex);
      };
      draw();
      dom.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : null;
        window.dispatchEvent(new CustomEvent('kite:edit-math', { detail: { pos, latex: cur.attrs.latex, hwp: cur.attrs.hwp } }));
      });
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'math') return false;
          const changed = n.attrs.latex !== cur.attrs.latex;
          cur = n;
          if (changed) {
            draw();
            const p = typeof getPos === 'function' ? getPos() : undefined;
            if (typeof p === 'number') window.dispatchEvent(new CustomEvent('kite:relayout', { detail: { pos: p } }));
          }
          return true;
        },
        selectNode: () => dom.classList.add('sel'),
        deselectNode: () => dom.classList.remove('sel'),
        ignoreMutation: () => true,
      };
    };
  },
  addCommands() {
    return {
      insertMath:
        (latex, hwp = '') =>
        ({ commands }) =>
          commands.insertContent({ type: 'math', attrs: { latex, hwp } }),
    };
  },
});
