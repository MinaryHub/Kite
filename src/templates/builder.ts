import type { JNode } from '../formats/common';

/**
 * 서식 문서를 짧게 쓰기 위한 도우미. 크기는 pt, 표 열 너비는 mm 로 받는다.
 */

export interface RunOpt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  size?: number;
  color?: string;
  font?: string;
  /** 형광펜 */
  hl?: string;
  /** 자간(%) */
  sp?: number;
}
export type Run = string | ({ t: string } & RunOpt);
export type Inline = Run | Run[];

export interface ParaOpt extends RunOpt {
  align?: 'left' | 'center' | 'right' | 'justify' | 'distribute';
  before?: number;
  after?: number;
  /** 줄 간격 배수 (1.6 = 160%) */
  lh?: number;
  /** 왼쪽 여백(pt) */
  indent?: number;
  /** 첫 줄 들여쓰기(+)/내어쓰기(-) pt */
  first?: number;
  bg?: string;
}

const mmToPx = (mm: number) => Math.round((mm * 96) / 25.4);

function marksOf(o: RunOpt): any[] {
  const m: any[] = [];
  if (o.b) m.push({ type: 'bold' });
  if (o.i) m.push({ type: 'italic' });
  if (o.u) m.push({ type: 'underline' });
  if (o.hl) m.push({ type: 'highlight', attrs: { color: o.hl } });
  const ts: Record<string, any> = {};
  if (o.size) ts.fontSize = o.size;
  if (o.color) ts.color = o.color;
  if (o.font) ts.fontFamily = o.font;
  if (o.sp != null) ts.letterSpacing = o.sp;
  if (Object.keys(ts).length) m.push({ type: 'textStyle', attrs: ts });
  return m;
}

export function runs(content: Inline | undefined, base: RunOpt = {}): JNode[] {
  if (content == null || content === '') return [];
  const list = Array.isArray(content) ? content : [content];
  const out: JNode[] = [];
  for (const r of list) {
    const o: { t: string } & RunOpt = typeof r === 'string' ? { t: r } : r;
    const merged = { ...base, ...o };
    // 줄바꿈 문자는 줄 나눔으로
    o.t.split('\n').forEach((part, k) => {
      if (k) out.push({ type: 'hardBreak' });
      if (part) {
        const marks = marksOf(merged);
        out.push(marks.length ? { type: 'text', text: part, marks } : { type: 'text', text: part });
      }
    });
  }
  return out;
}

function paraAttrs(o: ParaOpt): Record<string, any> | undefined {
  const a: Record<string, any> = {};
  if (o.align && o.align !== 'justify') a.textAlign = o.align;
  if (o.before) a.spaceBefore = o.before;
  if (o.after) a.spaceAfter = o.after;
  if (o.lh) a.lineHeight = String(o.lh);
  if (o.indent) a.indentLeft = o.indent;
  if (o.first) a.textIndent = o.first;
  if (o.bg) a.paraBg = o.bg;
  if (o.size) a.fontSize = o.size;
  return Object.keys(a).length ? a : undefined;
}

/** 문단 */
export function p(content?: Inline, o: ParaOpt = {}): JNode {
  const { align, before, after, lh, indent, first, bg, ...r } = o;
  void align, before, after, lh, indent, first, bg;
  const n: JNode = { type: 'paragraph' };
  const at = paraAttrs(o);
  if (at) n.attrs = at;
  const c = runs(content, r);
  if (c.length) n.content = c;
  return n;
}

/** 빈 줄 */
export const gap = (pt = 6) => p('', { size: pt });

/** 제목 */
export function h(level: 1 | 2 | 3, content: Inline, o: ParaOpt = {}): JNode {
  const n = p(content, o);
  return { ...n, type: 'heading', attrs: { ...(n.attrs || {}), level } };
}

/** 개조식 줄: 기호 + 내어쓰기 (□ ○ - ·) */
export function item(sym: string, content: Inline, level = 0, o: ParaOpt = {}): JNode {
  const indents = [0, 12, 24, 36];
  const hang = sym.length > 1 ? 16 : 12;
  const lead = typeof content === 'string' ? [`${sym} ${content}`] : [`${sym} `, ...(Array.isArray(content) ? content : [content])];
  return p(lead as Run[], { indent: indents[level] + hang, first: -hang, after: 2, lh: 1.6, ...o });
}

export interface CellOpt extends ParaOpt {
  bg?: string;
  span?: number;
  rows?: number;
  valign?: 'top' | 'middle' | 'bottom';
  border?: string;
}
export interface Cell {
  cell: true;
  paras: JNode[];
  o: CellOpt;
  header?: boolean;
}

/** 칸: 글자(여러 문단은 배열의 배열 대신 \n\n 으로) 또는 문단 노드 목록 */
export function c(content: Inline | JNode[] = '', o: CellOpt = {}): Cell {
  // 표 칸은 왼쪽 정렬이 기본 (양쪽 정렬은 좁은 칸에서 글자 사이가 벌어진다)
  o = { align: 'left', ...o };
  const { bg, span, rows, valign, border, ...po } = o;
  void bg, span, rows, valign, border;
  let paras: JNode[];
  if (Array.isArray(content) && content.length && typeof content[0] === 'object' && 'type' in (content[0] as any)) paras = content as JNode[];
  else if (typeof content === 'string' && content.includes('\n\n')) paras = content.split('\n\n').map((t) => p(t, po));
  else paras = [p(content as Inline, po)];
  return { cell: true, paras, o };
}
/** 머리 칸 (회색 바탕, 굵게, 가운데) */
export const th = (content: Inline, o: CellOpt = {}) => c(content, { bg: '#EDEFF3', b: true, align: 'center', valign: 'middle', ...o });

export interface TableOpt {
  /** 열 너비 mm */
  widths: number[];
  borderless?: boolean;
  /** 줄 높이 mm (모든 줄) */
  rowHeight?: number;
  heights?: (number | null)[];
  align?: 'left' | 'center' | 'right';
}

/**
 * 칸 테두리 "t:2px solid #333;l:none" → 형식 변환기가 아는 꼴로:
 * 선은 borderCss("t:0.5mm solid #333333"), 없는 변은 borderStyle("l r")
 */
function borderAttrs(spec: string): Record<string, string> {
  const css: string[] = [];
  const none: string[] = [];
  for (const part of spec.split(';')) {
    const m = /^\s*([lrtb])\s*:\s*(.+?)\s*$/.exec(part);
    if (!m) continue;
    if (m[2] === 'none') {
      none.push(m[1]);
      continue;
    }
    const w = /([\d.]+)(px|mm)/.exec(m[2]);
    const mm = w ? (w[2] === 'px' ? Math.max(0.1, Math.round(parseFloat(w[1]) * 0.2646 * 10) / 10) : parseFloat(w[1])) : 0.12;
    const style = /dashed|dotted|double/.exec(m[2])?.[0] || 'solid';
    let color = /#([0-9a-fA-F]{3,6})\b/.exec(m[2])?.[1] || '000000';
    if (color.length === 3) color = color.split('').map((ch) => ch + ch).join('');
    css.push(`${m[1]}:${mm}mm ${style} #${color.toUpperCase()}`);
  }
  const out: Record<string, string> = {};
  if (css.length) out.borderCss = css.join(';');
  if (none.length) out.borderStyle = none.join(' ');
  return out;
}

export function table(rows: (Cell | string)[][], o: TableOpt): JNode {
  // 각 칸의 실제 열 위치를 세어 colwidth 를 나눠 준다 (합친 칸·세로 합침 고려)
  const occupied: boolean[][] = [];
  const content: JNode[] = rows.map((row, ri) => {
    occupied[ri] = occupied[ri] || [];
    let col = 0;
    const cells: JNode[] = row.map((raw) => {
      const cell = typeof raw === 'string' ? c(raw) : raw;
      while (occupied[ri][col]) col++;
      const span = cell.o.span || 1;
      const rs = cell.o.rows || 1;
      for (let r = 0; r < rs; r++) for (let k = 0; k < span; k++) (occupied[ri + r] = occupied[ri + r] || [])[col + k] = true;
      const widths = o.widths.slice(col, col + span).map(mmToPx);
      col += span;
      const attrs: Record<string, any> = { colspan: span, rowspan: rs, colwidth: widths.length === span ? widths : null };
      if (cell.o.bg) attrs.backgroundColor = cell.o.bg;
      if (cell.o.valign) attrs.verticalAlign = cell.o.valign;
      if (cell.o.border) Object.assign(attrs, borderAttrs(cell.o.border));
      return { type: 'tableCell', attrs, content: cell.paras };
    });
    const h = o.heights?.[ri] ?? o.rowHeight;
    return { type: 'tableRow', ...(h ? { attrs: { height: mmToPx(h) } } : {}), content: cells };
  });
  const attrs: Record<string, any> = {};
  if (o.borderless) attrs.borderless = true;
  if (o.align) attrs.align = o.align;
  return { type: 'table', ...(Object.keys(attrs).length ? { attrs } : {}), content };
}

/** 오늘 날짜 (공문 표기 2026. 10. 17.) */
export function today(style: 'dot' | 'korean' = 'dot'): string {
  const d = new Date();
  if (style === 'korean') return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 채워 넣을 자리 표시 (옅은 노란 바탕) */
export const blank = (t: string, o: RunOpt = {}): { t: string } & RunOpt => ({ t, hl: '#FFF4C2', ...o });
