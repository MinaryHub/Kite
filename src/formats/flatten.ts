import { DEFAULT_FONT, DEFAULT_FONT_SIZE, type JMark, type JNode, formatNumber, normColor, toRoman } from './common';

/**
 * 편집기 문서(JSON)를 한글/워드식 "문단 + 표" 구조로 평탄화한다.
 * 목록·제목·인용 등은 들여쓰기와 글머리 문자열로 변환된다.
 */

export interface CharStyle {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sup: boolean;
  sub: boolean;
  highlight: string | null;
  letterSpacing: number;
  fontWidth: number;
  effect: string | null;
}

export interface ParaStyle {
  align: 'left' | 'center' | 'right' | 'justify' | 'distribute';
  indentLeft: number; // pt
  indentRight: number;
  textIndent: number;
  spaceBefore: number;
  spaceAfter: number;
  /** 배수(예: 1.6) 또는 "20pt" */
  lineHeight: string;
  bg: string | null;
  borderBottom: boolean;
  heading: number; // 0 = 본문
  /** 한글 줄 나눔 단위가 글자 */
  breakChar: boolean;
}

/** 탭 하나의 정보 (한글 문서의 탭은 폭·채움·종류를 가진다) */
export interface TabInfo {
  /** 탭이 차지하는 폭(px). 모르면 null → 기본 탭 간격 */
  width: number | null;
  /** 채움 종류 (0 없음, 1 실선, 2 긴 점선, 3 점선, 4 -.-, 5 -..-, 6 원점선, 7 이중선) */
  leader: number;
  /** 탭 종류 (한글 값 그대로) */
  type: number;
}

export type FlatInline =
  | { type: 'text'; text: string; style: CharStyle; link: string | null; tab?: TabInfo | null }
  | { type: 'break' }
  | { type: 'image'; src: string; width: number | null; height: number | null; style: CharStyle; crop: { t: number; r: number; b: number; l: number } | null }
  | { type: 'footnote'; text: string; style: CharStyle };

export interface FlatPara {
  kind: 'para';
  style: ParaStyle;
  /** 빈 문단의 글자 모양 */
  baseChar: CharStyle;
  inlines: FlatInline[];
  pageBreakBefore: boolean;
}

export interface FlatCell {
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
  widthPx: number;
  bg: string | null;
  vAlign: 'top' | 'middle' | 'bottom';
  noBorders: string[];
  /** 굵기/색/종류가 기본과 다른 선 */
  borderCss: string | null;
  blocks: FlatBlock[];
  header: boolean;
}

export interface FlatTable {
  kind: 'table';
  rows: number;
  cols: number;
  colWidthsPx: number[];
  cells: FlatCell[][];
  pageBreakBefore: boolean;
  align: 'left' | 'center' | 'right';
  /** 셀 좌우 안 여백 (px) */
  cellPadPx: number;
  /** 줄 높이 (px, 최소 높이). 없으면 null */
  rowHeightsPx: (number | null)[];
}

/** 글상자 (도형 안의 문단들) */
export interface FlatBox {
  kind: 'box';
  width: number | null;
  height: number | null;
  bg: string | null;
  bgImage: string | null;
  borderColor: string | null;
  borderWidth: number | null;
  /** CSS border-radius 값 ('12px', '50%') */
  radius: string | null;
  /** 안쪽 여백 px [위, 오른쪽, 아래, 왼쪽] */
  padding: number[] | null;
  blocks: FlatBlock[];
  pageBreakBefore: boolean;
}

export type FlatBlock = FlatPara | FlatTable | FlatBox;

/** 글상자를 지원하지 않는 형식을 위해 상자를 풀어 안의 블록만 남긴다 (표 안까지) */
export function unwrapBoxes(blocks: FlatBlock[]): FlatBlock[] {
  const out: FlatBlock[] = [];
  for (const b of blocks) {
    if (b.kind === 'box') {
      const inner = unwrapBoxes(b.blocks);
      if (inner.length && b.pageBreakBefore) inner[0].pageBreakBefore = true;
      out.push(...inner);
    } else if (b.kind === 'table') {
      for (const row of b.cells) for (const c of row) c.blocks = unwrapBoxes(c.blocks);
      out.push(b);
    } else out.push(b);
  }
  return out;
}

export const HEADING_SIZES = [0, 20, 16, 14, 12, 11, 10];

export function defaultChar(): CharStyle {
  return {
    font: DEFAULT_FONT,
    size: DEFAULT_FONT_SIZE,
    color: '#000000',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    sup: false,
    sub: false,
    highlight: null,
    letterSpacing: 0,
    fontWidth: 100,
    effect: null,
  };
}

export function defaultPara(): ParaStyle {
  return {
    align: 'justify',
    indentLeft: 0,
    indentRight: 0,
    textIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    lineHeight: '1.6',
    bg: null,
    borderBottom: false,
    heading: 0,
    breakChar: false,
  };
}

export function charKey(c: CharStyle): string {
  return [c.font, c.size, c.color, +c.bold, +c.italic, +c.underline, +c.strike, +c.sup, +c.sub, c.highlight, c.letterSpacing, c.fontWidth, c.effect].join('|');
}

export function paraKey(p: ParaStyle): string {
  return [p.align, p.indentLeft, p.indentRight, p.textIndent, p.spaceBefore, p.spaceAfter, p.lineHeight, p.bg, +p.borderBottom, +p.breakChar].join('|');
}

function applyMarks(base: CharStyle, marks: JMark[] | undefined): { style: CharStyle; link: string | null; tab: TabInfo | null } {
  const s = { ...base };
  let link: string | null = null;
  let tab: TabInfo | null = null;
  for (const m of marks || []) {
    switch (m.type) {
      case 'tab':
        tab = { width: m.attrs?.width ? +m.attrs.width : null, leader: +(m.attrs?.leader || 0), type: +(m.attrs?.type || 0) };
        break;
      case 'bold':
        s.bold = true;
        break;
      case 'italic':
        s.italic = true;
        break;
      case 'underline':
        s.underline = true;
        break;
      case 'strike':
        s.strike = true;
        break;
      case 'superscript':
        s.sup = true;
        break;
      case 'subscript':
        s.sub = true;
        break;
      case 'code':
        s.font = 'D2Coding';
        break;
      case 'highlight':
        s.highlight = normColor(m.attrs?.color) || '#FFFF00';
        break;
      case 'link':
        link = m.attrs?.href || null;
        s.underline = true;
        if (s.color === '#000000') s.color = '#0563C1';
        break;
      case 'textStyle': {
        const a = m.attrs || {};
        if (a.fontFamily) s.font = String(a.fontFamily).split(',')[0].replace(/['"]/g, '').trim();
        if (a.fontSize) s.size = +a.fontSize;
        if (a.color) s.color = normalizeHex(a.color) || s.color;
        if (a.letterSpacing) s.letterSpacing = +a.letterSpacing;
        if (a.fontWidth) s.fontWidth = +a.fontWidth;
        if (a.textEffect) s.effect = a.textEffect;
        break;
      }
    }
  }
  return { style: s, link, tab };
}

function normalizeHex(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toUpperCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
}

const BULLETS: Record<string, string> = {
  disc: '•',
  circle: '○',
  square: '■',
  'k-dash': '-',
  'k-arrow': '➢',
  'k-check': '✓',
  'k-diamond': '◆',
  'k-ref': '※',
  'k-filled-circle': '●',
  'k-hollow-square': '□',
};

export function bulletChar(listStyle: string | null | undefined, depth: number): string {
  if (listStyle && BULLETS[listStyle]) return BULLETS[listStyle];
  return ['•', '◦', '▪'][depth % 3];
}

export function orderedLabel(n: number, listStyle: string | null | undefined): string {
  switch (listStyle) {
    case 'lower-alpha':
    case 'lower-latin':
      return formatNumber(n, 'LATIN_SMALL') + '.';
    case 'upper-alpha':
    case 'upper-latin':
      return formatNumber(n, 'LATIN_CAPITAL') + '.';
    case 'lower-roman':
      return toRoman(n).toLowerCase() + '.';
    case 'upper-roman':
      return toRoman(n) + '.';
    case 'hangul':
    case 'korean-hangul-formal':
      return formatNumber(n, 'HANGUL_SYLLABLE') + '.';
    case 'hangul-consonant':
      return formatNumber(n, 'HANGUL_JAMO') + '.';
    case 'k-circled':
      return formatNumber(n, 'CIRCLED_DIGIT');
    case 'k-paren':
      return `(${n})`;
    case 'k-paren-hangul':
      return `(${formatNumber(n, 'HANGUL_SYLLABLE')})`;
    default:
      return n + '.';
  }
}

interface Ctx {
  indent: number;
  baseChar: CharStyle;
  quote: boolean;
  mono: boolean;
}

export function flattenDoc(doc: JNode): FlatBlock[] {
  return flattenBlocks(doc.content || [], { indent: 0, baseChar: defaultChar(), quote: false, mono: false });
}

export function flattenBlocks(nodes: JNode[], ctx: Ctx): FlatBlock[] {
  const out: FlatBlock[] = [];
  let pendingBreak = false;
  const push = (b: FlatBlock) => {
    if (pendingBreak) {
      b.pageBreakBefore = true;
      pendingBreak = false;
    }
    out.push(b);
  };
  for (const n of nodes) {
    switch (n.type) {
      case 'pageBreak':
        pendingBreak = true;
        break;
      case 'paragraph':
        push(flattenPara(n, ctx, 0));
        break;
      case 'heading':
        push(flattenPara(n, ctx, n.attrs?.level || 1));
        break;
      case 'codeBlock': {
        const p = flattenPara({ type: 'paragraph', content: codeContent(n) }, { ...ctx, mono: true }, 0);
        p.style.bg = p.style.bg || '#F4F4F4';
        p.style.align = 'left';
        push(p);
        break;
      }
      case 'blockquote':
        for (const b of flattenBlocks(n.content || [], { ...ctx, indent: ctx.indent + 20, quote: true })) push(b);
        break;
      case 'horizontalRule': {
        const p = flattenPara({ type: 'paragraph' }, ctx, 0);
        p.style.borderBottom = true;
        push(p);
        break;
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        let num = n.attrs?.start || 1;
        const depth = Math.round(ctx.indent / 20);
        for (const li of n.content || []) {
          let label: string;
          if (n.type === 'bulletList') label = bulletChar(n.attrs?.listStyle, depth);
          else if (n.type === 'orderedList') label = orderedLabel(num, n.attrs?.listStyle);
          else label = li.attrs?.checked ? '☑' : '☐';
          num++;
          const childCtx: Ctx = { ...ctx, indent: ctx.indent + 20 };
          const blocks = flattenBlocks(li.content || [], childCtx);
          const first = blocks.find((b) => b.kind === 'para') as FlatPara | undefined;
          if (first) {
            const st = first.inlines.find((i) => i.type === 'text') as any;
            const style = st ? st.style : first.baseChar;
            first.inlines.unshift({ type: 'text', text: label + ' ', style, link: null });
            // 내어쓰기: 첫 줄은 목록 들여쓰기 위치, 둘째 줄부터는 글머리 너비만큼 안쪽
            const hang = Math.round(Math.max(10, style.size * (label.length * 0.6 + 0.6)));
            first.style.indentLeft = first.style.indentLeft - 20 + hang;
            first.style.textIndent = -hang;
          }
          for (const b of blocks) push(b);
        }
        break;
      }
      case 'table':
        push(flattenTable(n, ctx));
        break;
      case 'textBox':
        push(flattenBox(n, ctx));
        break;
      default:
        if (n.content) for (const b of flattenBlocks(n.content, ctx)) push(b);
    }
  }
  if (pendingBreak) {
    const p = flattenPara({ type: 'paragraph' }, ctx, 0);
    p.pageBreakBefore = true;
    out.push(p);
  }
  return out;
}

function codeContent(n: JNode): JNode[] {
  const text = (n.content || []).map((c) => c.text || '').join('');
  const out: JNode[] = [];
  text.split('\n').forEach((line, i) => {
    if (i) out.push({ type: 'hardBreak' });
    if (line) out.push({ type: 'text', text: line });
  });
  return out;
}

function flattenPara(n: JNode, ctx: Ctx, level: number): FlatPara {
  const a = n.attrs || {};
  const style = defaultPara();
  if (a.textAlign) style.align = a.textAlign;
  if (a.lineHeight) style.lineHeight = String(a.lineHeight);
  style.indentLeft = (a.indentLeft || 0) + ctx.indent;
  style.indentRight = a.indentRight || 0;
  style.textIndent = a.textIndent || 0;
  style.spaceBefore = a.spaceBefore || 0;
  style.spaceAfter = a.spaceAfter || 0;
  style.bg = normColor(a.paraBg);
  style.heading = level;
  style.breakChar = !!a.breakChar;
  const base: CharStyle = { ...ctx.baseChar };
  if (level) {
    base.size = HEADING_SIZES[level] || 10;
    base.bold = true;
    if (!a.spaceBefore) style.spaceBefore = level <= 2 ? 12 : 6;
    if (!a.spaceAfter) style.spaceAfter = level <= 2 ? 6 : 3;
  }
  if (ctx.mono) base.font = 'D2Coding';
  if (ctx.quote) base.color = base.color === '#000000' ? '#444444' : base.color;
  if (a.fontSize) base.size = a.fontSize;
  const inlines: FlatInline[] = [];
  for (const c of n.content || []) {
    if (c.type === 'text') {
      const { style: cs, link, tab } = applyMarks(base, c.marks);
      const prev = inlines[inlines.length - 1];
      // 탭 정보가 붙은 글자는 따로 둔다 (탭 하나짜리 텍스트)
      if (!tab && prev && prev.type === 'text' && !prev.tab && charKey(prev.style) === charKey(cs) && prev.link === link) prev.text += c.text || '';
      else inlines.push({ type: 'text', text: c.text || '', style: cs, link, tab });
    } else if (c.type === 'hardBreak') inlines.push({ type: 'break' });
    else if (c.type === 'image') {
      const { style: cs } = applyMarks(base, c.marks);
      inlines.push({ type: 'image', src: c.attrs?.src, width: c.attrs?.width || null, height: c.attrs?.height || null, style: cs, crop: c.attrs?.crop || null });
    } else if (c.type === 'footnote') {
      inlines.push({ type: 'footnote', text: c.attrs?.text || '', style: applyMarks(base, c.marks).style });
    }
  }
  const firstText = inlines.find((i) => i.type === 'text') as any;
  return { kind: 'para', style, baseChar: firstText ? firstText.style : base, inlines, pageBreakBefore: false };
}

function flattenBox(n: JNode, ctx: Ctx): FlatBox {
  const a = n.attrs || {};
  const num = (v: any) => (Number.isFinite(+v) && +v > 0 ? +v : null);
  const pad = Array.isArray(a.padding) && a.padding.length === 4 ? a.padding.map((v: any) => Math.max(0, +v || 0)) : null;
  return {
    kind: 'box',
    width: num(a.width),
    height: num(a.height),
    bg: normColor(a.bg),
    bgImage: typeof a.bgImage === 'string' && a.bgImage ? a.bgImage : null,
    borderColor: normColor(a.borderColor),
    borderWidth: num(a.borderWidth),
    radius: typeof a.radius === 'string' && /^[\d.]+(px|%)$/.test(a.radius) ? a.radius : null,
    padding: pad,
    blocks: flattenBlocks(n.content || [], ctx),
    pageBreakBefore: false,
  };
}

function flattenTable(n: JNode, ctx: Ctx): FlatTable {
  const rowsJ = n.content || [];
  const occupied: boolean[][] = [];
  const cells: FlatCell[][] = [];
  const cellWidths = new Map<FlatCell, number[] | null>();
  let maxCols = 0;
  rowsJ.forEach((row, r) => {
    occupied[r] = occupied[r] || [];
    const list: FlatCell[] = [];
    let c = 0;
    for (const cell of row.content || []) {
      while (occupied[r][c]) c++;
      const cs = cell.attrs?.colspan || 1;
      const rs = cell.attrs?.rowspan || 1;
      for (let i = 0; i < rs; i++) {
        occupied[r + i] = occupied[r + i] || [];
        for (let j = 0; j < cs; j++) occupied[r + i][c + j] = true;
      }
      const cw: number[] | null = cell.attrs?.colwidth || null;
      const va = cell.attrs?.verticalAlign;
      const fc: FlatCell = {
        row: r,
        col: c,
        colspan: cs,
        rowspan: rs,
        widthPx: cw ? cw.reduce((x: number, y: number) => x + (y || 0), 0) : 0,
        bg: normColor(cell.attrs?.backgroundColor),
        vAlign: va === 'top' ? 'top' : va === 'bottom' ? 'bottom' : 'middle',
        noBorders: cell.attrs?.borderStyle ? String(cell.attrs.borderStyle).split(/\s+/).filter(Boolean) : [],
        borderCss: cell.attrs?.borderCss || null,
        blocks: flattenBlocks(cell.content || [], { ...ctx, indent: 0 }),
        header: cell.type === 'tableHeader',
      };
      cellWidths.set(fc, cw);
      list.push(fc);
      c += cs;
      maxCols = Math.max(maxCols, c);
    }
    cells.push(list);
  });
  for (const o of occupied) if (o) maxCols = Math.max(maxCols, o.length);
  // 열 너비
  const widths: (number | null)[] = new Array(maxCols).fill(null);
  for (const row of cells)
    for (const cell of row) {
      const cw = cellWidths.get(cell);
      if (cw && cw.length === cell.colspan) cw.forEach((w, i) => {
        if (w && widths[cell.col + i] == null) widths[cell.col + i] = w;
      });
    }
  const known = widths.filter((w) => w != null) as number[];
  const DEFAULT_TOTAL = 567; // A4 본문 폭 약 150mm (px)
  const rest = widths.length - known.length;
  const each = rest ? Math.max(40, (DEFAULT_TOTAL - known.reduce((a, b) => a + b, 0)) / rest) : 0;
  const colWidthsPx = widths.map((w) => (w == null ? each : w));
  for (const row of cells) for (const cell of row) if (!cell.widthPx) cell.widthPx = colWidthsPx.slice(cell.col, cell.col + cell.colspan).reduce((a, b) => a + b, 0);
  const cellPadPx = n.attrs?.cellPadding != null ? +n.attrs.cellPadding : 6.8;
  const rowHeightsPx = rowsJ.map((r) => ((r.attrs?.height ?? 0) > 0 ? +r.attrs!.height : null));
  return { kind: 'table', rows: rowsJ.length, cols: maxCols, colWidthsPx, cells, pageBreakBefore: false, align: n.attrs?.align || 'left', cellPadPx, rowHeightsPx };
}
