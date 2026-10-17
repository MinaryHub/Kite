import { useEffect, useRef, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { app } from '../../app/controller';
import { Modal, Seg } from '../widgets';
import { renderMath } from '../../editor/extensions/math';
import { hwpToLatex, latexToHwp } from '../../math/hwpEq';

/** 입력 > 수식: LaTeX 또는 한글 수식 문법으로 쓰고, 바로 그려 보며 넣는다 */

type Syntax = 'latex' | 'hwp';

const TEMPLATES: { label: string; latex: string; hwp: string; title: string }[] = [
  { label: 'a/b', latex: '\\frac{a}{b}', hwp: '{a} over {b}', title: '분수' },
  { label: '√', latex: '\\sqrt{x}', hwp: 'sqrt {x}', title: '제곱근' },
  { label: 'ⁿ√', latex: '\\sqrt[n]{x}', hwp: 'root {n} of {x}', title: 'n제곱근' },
  { label: 'xⁿ', latex: 'x^{n}', hwp: 'x^{n}', title: '위 첨자' },
  { label: 'xᵢ', latex: 'x_{i}', hwp: 'x_{i}', title: '아래 첨자' },
  { label: 'Σ', latex: '\\sum_{i=1}^{n}', hwp: 'sum from {i=1} to {n}', title: '합' },
  { label: '∫', latex: '\\int_{a}^{b}', hwp: 'int from {a} to {b}', title: '적분' },
  { label: 'lim', latex: '\\lim_{x \\to 0}', hwp: 'lim from {x -> 0}', title: '극한' },
  { label: '( )', latex: '\\left( x \\right)', hwp: 'LEFT ( x RIGHT )', title: '늘어나는 괄호' },
  { label: '[⋯]', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', hwp: 'pmatrix{a & b # c & d}', title: '행렬' },
  { label: '{⋯', latex: '\\begin{cases} x & (x \\geq 0) \\\\ -x & (x < 0) \\end{cases}', hwp: 'cases{x & (x >= 0) # -x & (x < 0)}', title: '경우 나누기' },
  { label: 'vec', latex: '\\vec{a}', hwp: 'vec {a}', title: '벡터' },
];
const SYMBOLS: [string, string, string][] = [
  ['α', '\\alpha', 'alpha'], ['β', '\\beta', 'beta'], ['γ', '\\gamma', 'gamma'], ['θ', '\\theta', 'theta'], ['λ', '\\lambda', 'lambda'], ['μ', '\\mu', 'mu'], ['π', '\\pi', 'pi'], ['σ', '\\sigma', 'sigma'], ['ω', '\\omega', 'omega'], ['Δ', '\\Delta', 'DELTA'], ['Σ', '\\Sigma', 'SIGMA'], ['Ω', '\\Omega', 'OMEGA'],
  ['×', '\\times', 'times'], ['÷', '\\div', 'div'], ['±', '\\pm', '+-'], ['·', '\\cdot', 'cdot'], ['≤', '\\leq', '<='], ['≥', '\\geq', '>='], ['≠', '\\neq', '!='], ['≈', '\\approx', 'approx'], ['≡', '\\equiv', 'equiv'], ['∞', '\\infty', 'inf'], ['→', '\\rightarrow', '->'], ['⇒', '\\Rightarrow', '=>'],
  ['∈', '\\in', 'in'], ['⊂', '\\subset', 'subset'], ['∪', '\\cup', 'cup'], ['∩', '\\cap', 'cap'], ['∀', '\\forall', 'forall'], ['∃', '\\exists', 'exist'], ['∂', '\\partial', 'partial'], ['∇', '\\nabla', 'nabla'], ['∴', '\\therefore', 'therefore'], ['°', '^{\\circ}', 'deg'], ['∠', '\\angle', 'angle'], ['⊥', '\\perp', 'perp'],
];

export function MathDialog({ onClose, pos, latex: initLatex, hwp: initHwp }: { onClose: () => void; pos: number | null; latex: string; hwp: string }) {
  const [syntax, setSyntax] = useState<Syntax>(() => (initHwp ? 'hwp' : ((localStorage.getItem('kite:math:syntax') as Syntax) || 'latex')));
  const [src, setSrc] = useState(() => (initHwp ? initHwp : initLatex));
  const preview = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const latex = syntax === 'hwp' ? hwpToLatex(src) : src;

  useEffect(() => {
    if (preview.current) renderMath(preview.current, latex);
  }, [latex]);
  useEffect(() => {
    setTimeout(() => ta.current?.focus(), 0);
  }, []);

  const switchSyntax = (s: Syntax) => {
    if (s === syntax) return;
    // 쓰던 내용을 새 문법으로 옮긴다
    setSrc(s === 'hwp' ? latexToHwp(latex) : latex);
    setSyntax(s);
    try {
      localStorage.setItem('kite:math:syntax', s);
    } catch {
      /* 무시 */
    }
  };
  const insertAtCursor = (text: string) => {
    const el = ta.current;
    if (!el) return setSrc(src + text);
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const pad = a > 0 && !/\s$/.test(src.slice(0, a)) && syntax === 'hwp' ? ' ' : '';
    const next = src.slice(0, a) + pad + text + src.slice(b);
    setSrc(next);
    setTimeout(() => {
      el.focus();
      const c = a + pad.length + text.length;
      el.setSelectionRange(c, c);
    }, 0);
  };

  const ok = () => {
    const ed = app.active?.editor;
    if (!ed) return onClose();
    if (!latex.trim()) return onClose();
    // 한글 수식으로 쓴 것은 그 글을 그대로 지녀 한글 문서로 저장할 때 쓴다
    const hwp = syntax === 'hwp' ? src.trim() : initHwp && latex === initLatex ? initHwp : '';
    if (pos != null && ed.state.doc.nodeAt(pos)?.type.name === 'math') {
      const node = ed.state.doc.nodeAt(pos)!;
      ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex, hwp }));
      try {
        ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
      } catch {
        /* 무시 */
      }
      ed.commands.focus();
    } else ed.chain().focus().insertMath(latex, hwp).run();
    onClose();
  };

  return (
    <Modal
      title={pos != null ? '수식 고치기' : '수식 넣기'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn primary" onClick={ok} disabled={!latex.trim()}>
            {pos != null ? '고치기' : '넣기'}
          </button>
          <button className="btn" onClick={onClose}>
            취소
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="unit">입력 문법</span>
        <Seg
          value={syntax}
          onChange={switchSyntax}
          options={[
            { value: 'latex', label: 'LaTeX', title: '예: \\frac{a}{b}' },
            { value: 'hwp', label: '한글 수식', title: '예: {a} over {b}' },
          ]}
        />
      </div>
      <div className="math-tpl">
        {TEMPLATES.map((t) => (
          <button key={t.label} className="btn small" title={t.title} onClick={() => insertAtCursor(syntax === 'hwp' ? t.hwp : t.latex)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="math-sym">
        {SYMBOLS.map(([g, l, h]) => (
          <button key={g} title={syntax === 'hwp' ? h : l} onClick={() => insertAtCursor(syntax === 'hwp' ? h + ' ' : l + ' ')}>
            {g}
          </button>
        ))}
      </div>
      <textarea
        ref={ta}
        className="math-src"
        rows={4}
        spellCheck={false}
        value={src}
        placeholder={syntax === 'hwp' ? '예: x = {-b +- sqrt {b^2 - 4ac}} over {2a}' : '예: x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'}
        onChange={(e) => setSrc(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            ok();
          }
        }}
      />
      <div className="math-preview" ref={preview} />
      <div className="unit" style={{ marginTop: 6 }}>
        Ctrl+Enter 로 {pos != null ? '고칩니다' : '넣습니다'}. 한글 문서(HWP·HWPX)의 수식은 한글 수식 문법으로 읽고 씁니다.
      </div>
    </Modal>
  );
}
