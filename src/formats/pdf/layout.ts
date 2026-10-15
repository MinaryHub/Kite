import { type BorderSide, type JMark, type JNode, borderCss, paragraph, round } from '../common';
import type { FillRect, Glyph, PageContent, PdfImage, Seg } from './extract';

/**
 * 추출한 페이지 내용(글자·사각형·선·그림)으로 편집 가능한 문서 구조를 재구성한다.
 *  - 가로/세로 선이 이어진 격자 → 표 (병합 셀, 셀 배경, 테두리)
 *  - 글자가 들어 있는 채운 사각형 → 배경색 상자(테두리 없는 1칸 표)
 *  - 기준선 간격 → 줄 간격(pt), 문단 사이 간격 → 문단 위 간격
 */

const PT2PX = 96 / 72;
/** 셀 위/아래 안쪽 여백 + 테두리 (pt): 편집기 CSS(0.5mm + 1px) */
const CELL_PADV = 1.4 + 0.75;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const containsPt = (b: Box, x: number, y: number, tol = 0) => x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;
const containsBox = (o: Box, i: Box, tol = 1) => i.x0 >= o.x0 - tol && i.x1 <= o.x1 + tol && i.y0 >= o.y0 - tol && i.y1 <= o.y1 + tol;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// ---------------- 글꼴 ----------------
const FONT_MAP: [RegExp, string][] = [
  [/malgun/i, '맑은 고딕'],
  [/hcr\s*batang|hamchorom\s*batang|함초롬바탕/i, '함초롬바탕'],
  [/hcr\s*dotum|hamchorom\s*dotum|함초롬돋움/i, '함초롬돋움'],
  [/^(H2|HY)gtrE/i, 'HY견고딕'],
  [/^(H2|HY)gtrM/i, 'HY중고딕'],
  [/^(H2|HY)hdrM/i, 'HY헤드라인M'],
  [/^(H2|HY)mjrE/i, 'HY견명조'],
  [/^(H2|HY)mjsM|HYSinMyeongJo/i, 'HY신명조'],
  [/^(H2|HY)gprM/i, 'HY그래픽'],
  [/^(H2|HY)gsrB/i, 'HY궁서B'],
  [/^(H2|HY)porM/i, 'HY엽서M'],
  [/^(H2|HY)mjM/i, 'HY중명조'],
  [/HANBatang|Haansoft\s*Batang/i, '한컴바탕'],
  [/HANDotum|Haansoft\s*Dotum/i, '한컴돋움'],
  [/nanum\s*barun\s*gothic/i, '나눔바른고딕'],
  [/batang/i, '바탕'],
  [/dotum/i, '돋움'],
  [/gulim/i, '굴림'],
  [/gungsuh/i, '궁서'],
  [/nanum\s*gothic/i, '나눔고딕'],
  [/nanum\s*myeongjo/i, '나눔명조'],
  [/nanum\s*square/i, '나눔스퀘어'],
  [/noto\s*sans\s*(cjk|kr)/i, 'Noto Sans KR'],
  [/noto\s*serif\s*(cjk|kr)/i, 'Noto Serif KR'],
  [/times/i, 'Times New Roman'],
  [/arial/i, 'Arial'],
  [/helvetica/i, 'Arial'],
  [/calibri/i, 'Calibri'],
  [/cambria/i, 'Cambria'],
  [/courier/i, 'Courier New'],
  [/symbol/i, 'Symbol'],
  [/wingdings/i, 'Wingdings'],
];

const fontCache = new Map<string, { family: string | null; bold: boolean; italic: boolean }>();
export function cleanFontName(name: string): { family: string | null; bold: boolean; italic: boolean } {
  const hit = fontCache.get(name);
  if (hit) return hit;
  let n = name.replace(/^[A-Z]{6}\+/, '');
  // EUC-KR 바이트가 Latin-1 로 풀린 한글 글꼴 이름 (예: ÈÞ¸Õ¸íÁ¶ → 휴먼명조)
  if (/[\x80-\xff]/.test(n) && !/[^\x00-\xff]/.test(n)) {
    try {
      const dec = new TextDecoder('euc-kr', { fatal: true }).decode(Uint8Array.from(n, (ch) => ch.charCodeAt(0)));
      if (/[가-힣]/.test(dec)) n = dec;
    } catch {
      /* 그대로 */
    }
  }
  // RixGoB, RixMGoEB 처럼 굵기를 끝에 붙인 한글 글꼴 이름도 굵게
  const bold = /bold|black|heavy|semibold|-B$|ExtraBold|,B\b|Bd$/i.test(n) || /[a-z](B|EB|XB|UB|H)$/.test(n);
  const italic = /italic|oblique/i.test(n);
  let res: { family: string | null; bold: boolean; italic: boolean } | null = null;
  for (const [re, fam] of FONT_MAP)
    if (re.test(n)) {
      res = { family: fam, bold, italic };
      break;
    }
  if (!res) {
    const base = n.replace(/[-,](Bold|Italic|Regular|Medium|Light|Black|Heavy|SemiBold|Oblique|BoldItalic|B|R|M|L)+$/i, '').replace(/MT$|PS$/, '');
    res = { family: base && !/^(g_d\d|f\d|T\d|F\d|[A-Z]\d+$|Type3)/i.test(base) ? base : null, bold, italic };
  }
  fontCache.set(name, res);
  return res;
}

// ---------------- 줄 ----------------
interface TLine {
  glyphs: Glyph[];
  x0: number;
  x1: number;
  y: number;
  size: number;
  underline: Set<Glyph>;
}

function buildLines(glyphs: Glyph[], underlined: Set<Glyph>): TLine[] {
  const gs = glyphs.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TLine[] = [];
  for (const g of gs) {
    let line: TLine | null = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
      const l = lines[i];
      if (Math.abs(l.y - g.y) < Math.max(1.2, Math.min(l.size, g.size) * 0.35)) {
        line = l;
        break;
      }
    }
    if (!line) {
      line = { glyphs: [], x0: g.x, x1: g.x + g.w, y: g.y, size: g.size, underline: underlined };
      lines.push(line);
    }
    line.glyphs.push(g);
    if (g.ch.trim() && g.size > line.size) {
      line.size = g.size;
      line.y = g.y;
    }
  }
  for (const l of lines) {
    l.glyphs.sort((a, b) => a.x - b.x);
    // 겹쳐 찍어 만든 굵은 글씨(같은 글자를 살짝 옮겨 두 번)는 하나로
    const out: Glyph[] = [];
    for (const g of l.glyphs) {
      const p = out[out.length - 1];
      if (p && p.ch === g.ch && Math.abs(p.x - g.x) < g.size * 0.2 && Math.abs(p.y - g.y) < 1) {
        if (g.ch.trim()) p.bold = true;
        continue;
      }
      out.push(g);
    }
    l.glyphs = out;
    const vis = out.filter((g) => g.ch.trim());
    l.x0 = vis.length ? vis[0].x : out[0].x;
    const last = vis.length ? vis[vis.length - 1] : out[out.length - 1];
    l.x1 = last.x + last.w;
    if (vis.length) l.size = Math.max(...vis.map((g) => g.size));
  }
  return lines.filter((l) => l.glyphs.some((g) => g.ch.trim())).sort((a, b) => a.y - b.y);
}

const ascentOff = (lh: number, size: number) => lh / 2 + size * 0.38;

/**
 * 대체 글꼴로 그리면 글자 폭이 PDF와 달라 줄바꿈이 바뀐다. 실제 글꼴로 폭을 재서
 * PDF 폭에 맞는 자간(% of size)을 구한다. (측정 함수가 없으면 null)
 */
function fitSpacing(lines: TLine[], ctx: LayoutCtx, avail = Infinity): number | null {
  if (!ctx.measure) return null;
  let pdfW = 0;
  let measW = 0;
  let chars = 0;
  let sizeSum = 0;
  for (const l of lines) {
    let word: Glyph[] = [];
    const flush = () => {
      if (!word.length) return;
      const g0 = word[0];
      const last = word[word.length - 1];
      const fi = cleanFontName(g0.font);
      const m = ctx.measure!(word.map((g) => g.ch).join(''), fi.family, Math.round(g0.size * 2) / 2, g0.bold || fi.bold, fi.italic);
      if (m > 0) {
        pdfW += last.x + last.w - g0.x;
        measW += m;
        chars += word.length;
        sizeSum += g0.size * word.length;
      }
      word = [];
    };
    for (const g of l.glyphs) {
      if (!g.ch.trim()) {
        flush();
        continue;
      }
      const p = word[word.length - 1];
      if (p && (p.font !== g.font || Math.abs(p.size - g.size) > 0.3 || g.x - (p.x + p.w) > g.size * 0.2)) flush();
      word.push(g);
    }
    flush();
  }
  if (chars < 2) return null;
  const size = sizeSum / chars;
  const pct = ((pdfW - measW) / chars / size) * 100;
  if (!isFinite(pct)) return null;
  // 측정 오차로 줄이 넘어가지 않도록 조금 좁게
  let out = pct - 1;
  // 한 줄 문단: 공백까지 포함한 폭이 쓸 수 있는 폭을 넘지 않도록
  if (lines.length === 1 && isFinite(avail)) {
    const l = lines[0];
    const g0 = l.glyphs.find((g) => g.ch.trim()) || l.glyphs[0];
    const fi = cleanFontName(g0.font);
    const text = l.glyphs.map((g) => g.ch).join('').trim();
    const full = ctx.measure(text, fi.family, Math.round(g0.size * 2) / 2, g0.bold || fi.bold, fi.italic);
    const n = [...text].length;
    if (full > 0 && n > 1) out = Math.min(out, ((avail - 2 - full) / n / size) * 100);
  }
  return Math.round(Math.max(-25, Math.min(15, out)));
}

function lineInline(l: TLine, bg: string | null, spacing: number | null = null): JNode[] {
  const out: JNode[] = [];
  let prev: Glyph | null = null;
  let lastKey = '';
  for (const g of l.glyphs) {
    let text = g.ch;
    if (prev) {
      const gap = g.x - (prev.x + prev.w);
      if (gap > g.size * 0.2 && prev.ch.trim() && g.ch.trim()) text = (gap > g.size * 2.2 ? '\t' : ' ') + text;
    }
    prev = g;
    const fi = cleanFontName(g.font);
    const ts: Record<string, any> = { fontSize: Math.round(g.size * 2) / 2 };
    if (fi.family) ts.fontFamily = fi.family;
    const color = visibleColor(g.color, bg);
    if (color) ts.color = color;
    const sp = spacing ?? g.spacing;
    if (sp && Math.abs(sp) >= 1) ts.letterSpacing = Math.max(-50, Math.min(50, sp));
    if (g.hscale && g.hscale !== 100 && g.hscale >= 50 && g.hscale <= 200) ts.fontWidth = g.hscale;
    const marks: JMark[] = [{ type: 'textStyle', attrs: ts }];
    if (g.bold || fi.bold) marks.push({ type: 'bold' });
    if (fi.italic) marks.push({ type: 'italic' });
    if (l.underline.has(g)) marks.push({ type: 'underline' });
    const key = JSON.stringify(marks);
    const last = out[out.length - 1];
    if (last && key === lastKey) last.text += text;
    else {
      // 공백만 다른 글꼴이면 앞 글자에 붙인다
      if (last && !text.trim()) {
        last.text += text;
        continue;
      }
      out.push({ type: 'text', text, marks });
      lastKey = key;
    }
  }
  // 줄 앞뒤 공백은 위치(들여쓰기/정렬)로 이미 반영된다
  while (out.length && !out[0].text!.trim()) out.shift();
  if (out.length) out[0].text = out[0].text!.replace(/^[ \t]+/, '');
  while (out.length && !out[out.length - 1].text!.trim()) out.pop();
  if (out.length) out[out.length - 1].text = out[out.length - 1].text!.replace(/[ \t]+$/, '');
  return out;
}

function lum(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 0;
  return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
}

function visibleColor(c: string, bg: string | null): string | null {
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return null;
  const C = c.toUpperCase();
  if (C === '#000000') return null;
  // 배경 없는 곳의 아주 밝은 글자는 보이도록 검정으로
  if (!bg && lum(C) > 0.88) return null;
  return C;
}

// ---------------- 그릇(페이지 본문/셀/상자) ----------------
interface Container extends Box {
  kind: 'page' | 'cell' | 'box';
  bg: string | null;
  glyphs: Glyph[];
  images: PdfImage[];
  children: (TableModel | BoxModel)[];
  /** 안쪽 왼쪽/오른쪽 여백 (pt) */
  padL: number;
  padR: number;
}

interface CellModel extends Container {
  kind: 'cell';
  row: number;
  col: number;
  rs: number;
  cs: number;
  borders: Partial<Record<'l' | 'r' | 't' | 'b', BorderSide | null>>;
}

interface TableModel extends Box {
  type: 'table';
  xs: number[];
  ys: number[];
  cells: CellModel[];
}

interface BoxModel extends Box {
  type: 'box';
  inner: Container;
}

export interface LayoutCtx {
  imageSrc: (img: PdfImage) => Promise<string | null>;
  /** 글자 폭 측정(pt). 화면 글꼴 기준 */
  measure?: (text: string, family: string | null, sizePt: number, bold: boolean, italic: boolean) => number;
  /** 문단 기본 줄 간격 비(크기 대비) */
  lineRatio: number;
}

// ---------------- 선 정리 / 표 찾기 ----------------
function mergeSegs(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const dir of ['h', 'v'] as const) {
    const list = segs.filter((s) => s.dir === dir).sort((a, b) => a.pos - b.pos || a.a - b.a);
    // 같은 위치끼리 묶는다
    const groups: Seg[][] = [];
    for (const s of list) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g[0].pos - s.pos) < 1.0) g.push(s);
      else groups.push([s]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.a - b.a);
      let cur: Seg | null = null;
      let covered = 0;
      let pieces = 0;
      const finish = () => {
        // 짧은 조각을 늘어놓은 선 → 점선/파선
        if (cur && pieces >= 4 && covered < (cur.b - cur.a) * 0.85) cur.style = covered / pieces <= Math.max(1.2, cur.w * 2.5) ? 'dotted' : 'dashed';
      };
      for (const s of g) {
        if (cur && s.a <= cur.b + 3) {
          covered += Math.max(0, s.b - Math.max(s.a, cur.b));
          pieces++;
          if (s.b > cur.b) cur.b = s.b;
          cur.w = Math.max(cur.w, s.w);
        } else {
          finish();
          cur = { ...s };
          covered = s.b - s.a;
          pieces = 1;
          out.push(cur);
        }
      }
      finish();
    }
  }
  return out;
}

function components(segs: Seg[]): Seg[][] {
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const H = segs.map((s, i) => [s, i] as const).filter(([s]) => s.dir === 'h');
  const V = segs.map((s, i) => [s, i] as const).filter(([s]) => s.dir === 'v');
  const tol = 2.5;
  for (const [h, hi] of H)
    for (const [v, vi] of V) {
      if (v.pos >= h.a - tol && v.pos <= h.b + tol && h.pos >= v.a - tol && h.pos <= v.b + tol) {
        const a = find(hi);
        const b = find(vi);
        if (a !== b) parent[a] = b;
      }
    }
  const groups = new Map<number, Seg[]>();
  segs.forEach((s, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(s);
  });
  return [...groups.values()];
}

function clusterVals(vals: number[], tol: number): number[] {
  const s = vals.slice().sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const g = out[out.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

function segBox(segs: Seg[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of segs) {
    if (s.dir === 'h') {
      x0 = Math.min(x0, s.a);
      x1 = Math.max(x1, s.b);
      y0 = Math.min(y0, s.pos);
      y1 = Math.max(y1, s.pos);
    } else {
      y0 = Math.min(y0, s.a);
      y1 = Math.max(y1, s.b);
      x0 = Math.min(x0, s.pos);
      x1 = Math.max(x1, s.pos);
    }
  }
  return { x0, y0, x1, y1 };
}

function findTables(segsIn: Seg[], page: Box): { tables: TableModel[]; leftover: Seg[] } {
  const tables: TableModel[] = [];
  const leftover: Seg[] = [];
  const pageArea = area(page);
  const queue: { segs: Seg[]; depth: number }[] = components(segsIn).map((c) => ({ segs: c, depth: 0 }));
  while (queue.length) {
    const { segs, depth } = queue.shift()!;
    const hs = segs.filter((s) => s.dir === 'h');
    const vs = segs.filter((s) => s.dir === 'v');
    const bb = segBox(segs);
    // 점선/파선으로 된 바깥 틀(장식 상자)은 떼어내고 안쪽만 다시 본다
    // (틀 위에 제목 라벨 상자가 걸쳐 있어도 되도록, 긴 점선 가로·세로 각 2개 이상이면 틀로 본다)
    if (depth < 3) {
      const W0 = bb.x1 - bb.x0;
      const H0 = bb.y1 - bb.y0;
      const frame = segs.filter((s) => s.style && s.style !== 'solid' && s.b - s.a > (s.dir === 'h' ? W0 : H0) * 0.2);
      const fh = frame.filter((s) => s.dir === 'h');
      const fv = frame.filter((s) => s.dir === 'v');
      // 가장 왼쪽/오른쪽 세로선이 점선 틀이어야 한다 (안쪽만 점선인 표는 제외)
      const allV = segs.filter((s) => s.dir === 'v');
      const minX = Math.min(...allV.map((v) => v.pos));
      const maxX = Math.max(...allV.map((v) => v.pos));
      const outer = fv.some((v) => v.pos - minX < 1) && fv.some((v) => maxX - v.pos < 1);
      const distinct = (xs: Seg[]) => clusterVals(xs.map((x) => x.pos), 2).length;
      if (distinct(fh) >= 2 && distinct(fv) >= 2 && outer && frame.length < segs.length) {
        for (const c of components(segs.filter((s) => !frame.includes(s)))) queue.push({ segs: c, depth: depth + 1 });
        continue;
      }
    }
    // 가로선 여러 개 + 세로선 1개(바깥 세로선 없는 열린 표)도 표로 본다
    const openTable = vs.length === 1 && hs.length >= 3 && hs.filter((h) => h.b - h.a > (bb.x1 - bb.x0) * 0.8).length >= 2;
    if (hs.length < 2 || (vs.length < 2 && !openTable) || bb.x1 - bb.x0 < 10 || bb.y1 - bb.y0 < 6) {
      leftover.push(...segs);
      continue;
    }
    // 페이지 테두리: 바깥 선을 빼고 다시
    if (area(bb) > pageArea * 0.55 && depth < 2) {
      const rest = segs.filter((s) => !(s.dir === 'h' ? Math.abs(s.pos - bb.y0) < 3 || Math.abs(s.pos - bb.y1) < 3 : Math.abs(s.pos - bb.x0) < 3 || Math.abs(s.pos - bb.x1) < 3));
      if (rest.length < segs.length) {
        for (const c of components(rest)) queue.push({ segs: c, depth: depth + 1 });
        continue;
      }
    }
    const xs = clusterVals([...vs.map((v) => v.pos), bb.x0, bb.x1], 2.2);
    const ys = clusterVals([...hs.map((h) => h.pos), bb.y0, bb.y1], 2.2);
    if (xs.length < 2 || ys.length < 2) {
      leftover.push(...segs);
      continue;
    }
    const nC = xs.length - 1;
    const nR = ys.length - 1;
    if (nC > 120 || nR > 400) {
      leftover.push(...segs);
      continue;
    }
    const hSeg = (yi: number, c: number): Seg | null => {
      const a = xs[c];
      const b = xs[c + 1];
      for (const h of hs) if (Math.abs(h.pos - ys[yi]) < 2.5 && overlap(h.a, h.b, a, b) >= (b - a) * 0.55) return h;
      return null;
    };
    const vSeg = (xi: number, r: number): Seg | null => {
      const a = ys[r];
      const b = ys[r + 1];
      for (const v of vs) if (Math.abs(v.pos - xs[xi]) < 2.5 && overlap(v.a, v.b, a, b) >= (b - a) * 0.55) return v;
      return null;
    };
    const taken: boolean[][] = Array.from({ length: nR }, () => new Array(nC).fill(false));
    const cells: CellModel[] = [];
    for (let r = 0; r < nR; r++)
      for (let c = 0; c < nC; c++) {
        if (taken[r][c]) continue;
        let cs = 1;
        while (c + cs < nC && !taken[r][c + cs] && !vSeg(c + cs, r)) cs++;
        let rs = 1;
        while (r + rs < nR) {
          let open = true;
          for (let k = c; k < c + cs; k++) if (taken[r + rs][k] || hSeg(r + rs, k)) open = false;
          if (!open) break;
          rs++;
        }
        for (let i = r; i < r + rs; i++) for (let k = c; k < c + cs; k++) taken[i][k] = true;
        const side = (s: Seg | null): BorderSide | null => (s ? { w: round(Math.max(0.1, Math.min(5, (s.w * 25.4) / 72)), 2), c: normHex(s.color), s: s.style || 'solid' } : null);
        // 한 변 전체에 걸친 선만 테두리로 본다
        const topS = sideSeg(c, cs, (k) => hSeg(r, k));
        const botS = sideSeg(c, cs, (k) => hSeg(r + rs, k));
        const leftS = sideSeg(r, rs, (k) => vSeg(c, k));
        const rightS = sideSeg(r, rs, (k) => vSeg(c + cs, k));
        cells.push({
          kind: 'cell',
          row: r,
          col: c,
          rs,
          cs,
          x0: xs[c],
          x1: xs[c + cs],
          y0: ys[r],
          y1: ys[r + rs],
          bg: null,
          glyphs: [],
          images: [],
          children: [],
          padL: 0,
          padR: 0,
          borders: { t: side(topS), b: side(botS), l: side(leftS), r: side(rightS) },
        });
      }
    tables.push({ type: 'table', x0: xs[0], x1: xs[nC], y0: ys[0], y1: ys[nR], xs, ys, cells });
  }
  return { tables, leftover };
}

function sideSeg(start: number, n: number, get: (k: number) => Seg | null): Seg | null {
  let first: Seg | null = null;
  for (let k = start; k < start + n; k++) {
    const s = get(k);
    if (!s) return null;
    if (!first || s.w > first.w) first = s;
  }
  return first;
}

function normHex(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : '#000000';
}

// ---------------- 채운 사각형 ----------------
/** 작은 타일(이미지 마스크)들을 이어 붙여 큰 사각형으로 */
function mergeTiles(tilesIn: FillRect[]): FillRect[] {
  // 타일은 작은 조각이어야 한다 (큰 사각형이 격자 칸을 수없이 차지하지 않도록)
  const tiles = tilesIn.filter((t) => t.x1 - t.x0 <= 40 && t.y1 - t.y0 <= 40).slice(0, 20000);
  if (!tiles.length) return [];
  const n = tiles.length;
  const parent = tiles.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const G = 6;
  const grid = new Map<string, number[]>();
  tiles.forEach((t, i) => {
    for (let gx = Math.floor(t.x0 / G); gx <= Math.floor(t.x1 / G); gx++)
      for (let gy = Math.floor(t.y0 / G); gy <= Math.floor(t.y1 / G); gy++) {
        const k = gx + ',' + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(i);
      }
  });
  for (const list0 of grid.values()) {
    const list = list0.length > 200 ? list0.slice(0, 200) : list0;
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const p = tiles[list[a]];
        const q = tiles[list[b]];
        if (p.x0 <= q.x1 + 0.6 && q.x0 <= p.x1 + 0.6 && p.y0 <= q.y1 + 0.6 && q.y0 <= p.y1 + 0.6) {
          const ra = find(list[a]);
          const rb = find(list[b]);
          if (ra !== rb) parent[ra] = rb;
        }
      }
  }
  const groups = new Map<number, FillRect[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(tiles[i]);
  }
  const out: FillRect[] = [];
  for (const g of groups.values()) {
    const bb = { x0: Math.min(...g.map((t) => t.x0)), y0: Math.min(...g.map((t) => t.y0)), x1: Math.max(...g.map((t) => t.x1)), y1: Math.max(...g.map((t) => t.y1)) };
    const byColor = new Map<string, number>();
    let sum = 0;
    for (const t of g) {
      const a = area(t);
      sum += a;
      byColor.set(t.color, (byColor.get(t.color) || 0) + a);
    }
    if (sum < area(bb) * 0.5) continue;
    const color = [...byColor.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ ...bb, color });
  }
  return out;
}

// ---------------- 메인 ----------------
export interface PageLayout {
  blocks: JNode[];
  /** 본문 내용의 위/아래/왼쪽/오른쪽 끝 (pt) */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function analyzePage(pc: PageContent) {
  const page: Box = { x0: 0, y0: 0, x1: pc.width, y1: pc.height };
  const pageArea = area(page);
  let glyphs = pc.glyphs;
  let images = pc.images;
  // 스캔 + 투명 글자(OCR): 글자를 살리고 바탕 그림은 뺀다
  const inv = glyphs.filter((g) => g.invisible);
  if (inv.length) {
    const scan = images.filter((im) => area(im) > pageArea * 0.5);
    if (scan.length && inv.length > glyphs.length * 0.5) {
      images = images.filter((im) => !scan.includes(im));
      glyphs = glyphs.map((g) => (g.invisible ? { ...g, invisible: false, color: '#000000' } : g));
    } else glyphs = glyphs.filter((g) => !g.invisible);
  }
  // 글자가 있는 페이지의 전면 배경 그림은 제외
  if (glyphs.length > 20) images = images.filter((im) => area(im) < pageArea * 0.7);

  let segs = mergeSegs(pc.segs.filter((s) => s.color !== '#ffffff' && s.color !== '#FFFFFF'));
  // 합친 뒤에도 선이 너무 많으면(비정상 문서) 표 찾기를 하지 않는다
  if (segs.length > 3000) segs = [];
  const { tables, leftover } = findTables(segs, page);

  // 채운 사각형: 타일 합치기, 흰색·페이지 전체 제외
  const plain = pc.fills.filter((f) => !f.tile);
  // 무늬 타일 덩어리는 같은 자리의 단색 사각형보다 뒤로 (무늬는 바탕색 위의 점일 때가 많다)
  const blobs = mergeTiles(pc.fills.filter((f) => f.tile)).filter(
    (b) => !plain.some((f) => Math.abs(f.x0 - b.x0) < 3 && Math.abs(f.x1 - b.x1) < 3 && Math.abs(f.y0 - b.y0) < 3 && Math.abs(f.y1 - b.y1) < 3),
  );
  const solid = [...blobs, ...plain].filter(
    (f) => !/^#fff(fff)?$/i.test(f.color) && f.color !== 'transparent' && area(f) < pageArea * 0.6 && f.x1 - f.x0 > 3 && f.y1 - f.y0 > 3,
  );
  // 같은 자리의 사각형은 나중 것(위에 그려진 것)만
  const fills: FillRect[] = [];
  for (const f of solid) {
    const same = fills.findIndex((o) => Math.abs(o.x0 - f.x0) < 2 && Math.abs(o.x1 - f.x1) < 2 && Math.abs(o.y0 - f.y0) < 2 && Math.abs(o.y1 - f.y1) < 2);
    if (same >= 0) fills.splice(same, 1);
    fills.push(f);
  }

  // 셀이 너무 많으면 뒤쪽 표는 버린다 (글자 배정 비용 제한)
  let cellBudget = 4000;
  for (let i = 0; i < tables.length; i++) {
    cellBudget -= tables[i].cells.length;
    if (cellBudget < 0) {
      tables.splice(i);
      break;
    }
  }
  // 표 셀 배경
  const usedFill = new Set<FillRect>();
  for (const t of tables)
    for (const c of t.cells) {
      const cx = (c.x0 + c.x1) / 2;
      const cy = (c.y0 + c.y1) / 2;
      for (let i = fills.length - 1; i >= 0; i--) {
        const f = fills[i];
        if (containsPt(f, cx, cy) && containsBox(t, f, 3) && overlap(f.x0, f.x1, c.x0, c.x1) * overlap(f.y0, f.y1, c.y0, c.y1) > area(c) * 0.7) {
          c.bg = normHex(f.color);
          usedFill.add(f);
          break;
        }
      }
    }

  // 상자: 글자를 품은 채운 사각형 (표 셀과 거의 같은 것은 셀 배경으로 이미 처리)
  const boxes: BoxModel[] = [];
  let boxCandidates = 0;
  for (const f of fills) {
    if (usedFill.has(f)) continue;
    if (f.x1 - f.x0 < 15 || f.y1 - f.y0 < 8) continue;
    if (++boxCandidates > 300) break;
    const hasText = glyphs.some((g) => g.ch.trim() && containsPt(f, g.x + g.w / 2, g.y - g.size * 0.3));
    if (!hasText) continue;
    // 표를 감싸는 배경은 무시
    if (tables.some((t) => containsBox(f, t, 1) && area(t) > area(f) * 0.3)) continue;
    boxes.push({ type: 'box', x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, inner: newContainer('box', f, normHex(f.color)) });
  }

  // 표 바로 위/아래에 붙은 같은 폭의 배경 띠(머리글 줄 등)는 표의 행으로 합친다
  for (let bi = boxes.length - 1; bi >= 0; bi--) {
    const b = boxes[bi];
    const t = tables.find((t) => Math.abs(b.x0 - t.x0) < 4 && Math.abs(b.x1 - t.x1) < 4 && (Math.abs(b.y1 - t.y0) < 3 || Math.abs(b.y0 - t.y1) < 3));
    if (!t) continue;
    const above = Math.abs(b.y1 - t.y0) < 3;
    const nC = t.xs.length - 1;
    const color = b.inner.bg;
    if (above) {
      for (const c of t.cells) c.row++;
      t.ys.unshift(b.y0);
      t.y0 = b.y0;
    } else {
      t.ys.push(b.y1);
      t.y1 = b.y1;
    }
    const row = above ? 0 : t.ys.length - 2;
    const y0 = above ? b.y0 : t.ys[t.ys.length - 2];
    const y1 = above ? t.ys[1] : b.y1;
    for (let c = 0; c < nC; c++)
      t.cells.push({ kind: 'cell', row, col: c, rs: 1, cs: 1, x0: t.xs[c], x1: t.xs[c + 1], y0, y1, bg: color, glyphs: [], images: [], children: [], padL: 0, padR: 0, borders: {} });
    t.cells.sort((a, b2) => a.row - b2.row || a.col - b2.col);
    boxes.splice(bi, 1);
  }

  // 밑줄: 표에 쓰이지 않은 가로선 바로 위의 글자
  const underlined = new Set<Glyph>();
  for (const s of leftover.length * glyphs.length > 5e6 ? [] : leftover) {
    if (s.dir !== 'h' || s.w > 2) continue;
    for (const g of glyphs) {
      const d = s.pos - g.y;
      if (d >= -0.5 && d <= g.size * 0.3 && g.x + g.w / 2 >= s.a && g.x + g.w / 2 <= s.b && s.b - s.a < g.size * 60) underlined.add(g);
    }
  }

  // 그릇 트리: 페이지 > (표 셀 | 상자) ...
  const pageC = newContainer('page', page, null);
  const containers: Container[] = [];
  for (const t of tables) for (const c of t.cells) containers.push(c);
  for (const b of boxes) containers.push(b.inner);
  // 작은 그릇부터 찾도록 넓이순
  containers.sort((a, b) => area(a) - area(b));
  const owner = (b: Box, self?: Container): Container => {
    for (const c of containers) {
      if (c === self) continue;
      if (area(c) <= area(b) - 1) continue;
      if (containsBox(c, b, 1.5)) return c;
    }
    return pageC;
  };
  for (const t of tables) {
    const anyCell = t.cells[0];
    const o = owner(t, anyCell);
    // 자기 셀 안에 들어가지 않도록
    if (t.cells.includes(o as CellModel)) pageC.children.push(t);
    else o.children.push(t);
  }
  for (const b of boxes) owner(b, b.inner).children.push(b);
  for (const g of glyphs) {
    const cx = g.x + g.w / 2;
    const cy = g.y - g.size * 0.3;
    let home: Container = pageC;
    for (const c of containers)
      if (containsPt(c, cx, cy)) {
        home = c;
        break;
      }
    home.glyphs.push(g);
  }
  for (const im of images) {
    let home: Container = pageC;
    for (const c of containers)
      if (containsBox(c, im, 2)) {
        home = c;
        break;
      }
    home.images.push(im);
  }
  splitColumns(pageC);
  // 빈 표(글자·그림 없는 장식 테두리)는 버린다
  const hasContent = (c: Container): boolean => c.glyphs.length > 0 || c.images.length > 0 || c.children.some((ch) => (ch.type === 'table' ? ch.cells.some(hasContent) : hasContent(ch.inner)));
  const prune = (c: Container) => {
    c.children = c.children.filter((ch) => (ch.type === 'table' ? ch.cells.some(hasContent) : hasContent(ch.inner)));
    for (const ch of c.children) {
      if (ch.type === 'table') ch.cells.forEach(prune);
      else prune(ch.inner);
    }
  };
  prune(pageC);
  return { pageC, underlined };
}

/**
 * 좌우로 나뉜 구간(예: 견적서 머리의 왼쪽 수신처 / 오른쪽 회사 정보)을 찾아
 * 테두리 없는 2칸 표로 바꾼다. 여러 줄에 걸쳐 공통으로 비어 있는 세로 띠가 있으면 단 구분으로 본다.
 */
function splitColumns(pageC: Container) {
  const lines = buildLines(pageC.glyphs, new Set());
  if (lines.length < 3) return;
  const spansOf = (l: TLine) => {
    const out: [number, number][] = [];
    for (const g of l.glyphs) {
      if (!g.ch.trim()) continue;
      const last = out[out.length - 1];
      if (last && g.x <= last[1] + Math.max(g.size * 2.5, 12)) last[1] = Math.max(last[1], g.x + g.w);
      else out.push([g.x, g.x + g.w]);
    }
    return out;
  };
  const spans = lines.map(spansOf);
  let i = 0;
  while (i < lines.length) {
    const sp = spans[i];
    let best: { a: number; b: number; end: number } | null = null;
    for (let k = 1; k < sp.length; k++) {
      let a = sp[k - 1][1];
      let b = sp[k][0];
      if (b - a < 15) continue;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        const prev = lines[j - 1];
        if (lines[j].y - prev.y > Math.max(prev.size, lines[j].size) * 3.2) break;
        // 띠를 좁혀서라도 비어 있으면 계속
        let na = a;
        let nb = b;
        for (const [x0, x1] of spans[j]) {
          if (x1 <= a || x0 >= b) continue;
          if (x0 < a && x1 > b) {
            na = nb;
            break;
          }
          if (x0 <= a + (b - a) / 2) na = Math.max(na, x1);
          else nb = Math.min(nb, x0);
        }
        if (nb - na < 12) break;
        a = na;
        b = nb;
        end = j;
      }
      const leftN = spans.slice(i, end + 1).filter((s) => s.some(([x0]) => x0 < a)).length;
      const rightN = spans.slice(i, end + 1).filter((s) => s.some(([, x1]) => x1 > b)).length;
      if (end - i >= 2 && leftN >= 2 && rightN >= 2 && (!best || end > best.end)) best = { a, b, end };
    }
    if (!best) {
      i++;
      continue;
    }
    const run = lines.slice(i, best.end + 1);
    const y0 = Math.min(...run.map((l) => l.y - l.size * 1.0));
    const y1 = Math.max(...run.map((l) => l.y + l.size * 0.3));
    const x0 = Math.min(...run.map((l) => l.x0));
    const x1 = Math.max(...run.map((l) => l.x1));
    const mid = (best.a + best.b) / 2;
    const mk = (cx0: number, cx1: number, col: number): CellModel => ({ kind: 'cell', row: 0, col, rs: 1, cs: 1, x0: cx0, x1: cx1, y0, y1, bg: null, glyphs: [], images: [], children: [], padL: 0, padR: 0, borders: {} });
    const left = mk(x0 - 1, mid, 0);
    const right = mk(mid, x1 + 1, 1);
    const inRun = new Set(run.flatMap((l) => l.glyphs));
    pageC.glyphs = pageC.glyphs.filter((g) => {
      if (!inRun.has(g)) return true;
      (g.x + g.w / 2 < mid ? left : right).glyphs.push(g);
      return false;
    });
    pageC.images = pageC.images.filter((im) => {
      if (im.y0 < y0 - 2 || im.y1 > y1 + 2) return true;
      (im.x0 + im.x1 < 2 * mid ? left : right).images.push(im);
      return false;
    });
    const t: TableModel = { type: 'table', x0: left.x0, x1: right.x1, y0, y1, xs: [left.x0, mid, right.x1], ys: [y0, y1], cells: [left, right] };
    // 구간 안에 들어가는 상자/표도 해당 단으로 옮긴다
    pageC.children = pageC.children.filter((ch) => {
      if (!containsBox(t, ch, 2)) return true;
      ((ch.x0 + ch.x1) / 2 < mid ? left : right).children.push(ch);
      return false;
    });
    pageC.children.push(t);
    i = best.end + 1;
  }
}

function newContainer(kind: 'page' | 'box', b: Box, bg: string | null): Container {
  return { kind, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, bg, glyphs: [], images: [], children: [], padL: 0, padR: 0 };
}

/** 페이지 아래(또는 위)의 쪽 번호 줄("- 3 -", "3")을 찾아 본문에서 뺀다 */
export function stripPageNumber(pageC: Container, pageH: number): { n: number; dash: boolean; pos: 'bottom-center' | 'top-center' } | null {
  const lines = buildLines(pageC.glyphs, new Set());
  for (const l of [lines[lines.length - 1], lines[0]]) {
    if (!l) continue;
    const bottom = l.y > pageH * 0.88;
    const top = l.y < pageH * 0.08;
    if (!bottom && !top) continue;
    const text = l.glyphs.map((g) => g.ch).join('').trim();
    const m = /^([-–—]?)\s*(\d{1,4})\s*[-–—]?$/.exec(text);
    if (!m) continue;
    const set = new Set(l.glyphs);
    pageC.glyphs = pageC.glyphs.filter((g) => !set.has(g));
    return { n: parseInt(m[2], 10), dash: !!m[1], pos: bottom ? 'bottom-center' : 'top-center' };
  }
  return null;
}

/** 페이지 본문의 내용 범위 */
export function contentBounds(pageC: Container, underlined: Set<Glyph>): Box | null {
  const lines = buildLines(pageC.glyphs, underlined);
  const xs0: number[] = [];
  const xs1: number[] = [];
  const ys0: number[] = [];
  const ys1: number[] = [];
  for (const l of lines) {
    xs0.push(l.x0);
    xs1.push(l.x1);
    ys0.push(l.y - l.size);
    ys1.push(l.y + l.size * 0.3);
  }
  for (const ch of pageC.children) {
    xs0.push(ch.x0);
    xs1.push(ch.x1);
    ys0.push(ch.y0);
    ys1.push(ch.y1);
  }
  for (const im of pageC.images) {
    xs0.push(im.x0);
    xs1.push(im.x1);
    ys0.push(im.y0);
    ys1.push(im.y1);
  }
  if (!xs0.length) return null;
  return { x0: Math.min(...xs0), x1: Math.max(...xs1), y0: Math.min(...ys0), y1: Math.max(...ys1) };
}

type Item =
  | { kind: 'line'; top: number; line: TLine }
  | { kind: 'table'; top: number; t: TableModel }
  | { kind: 'box'; top: number; b: BoxModel }
  | { kind: 'image'; top: number; ims: PdfImage[] }
  | { kind: 'row'; top: number; g: (TableModel | BoxModel)[] };

const BULLET_RE = /^[\s]*([○●◦•·∙ㆍ\-–—□■◇◆▪▫▶▷►※*☐☑✓✔❍❏➢➤>]|\(?\d{1,2}[.)]|\(?[가-힣][.)]\s|[①-⑳]|[ⅰ-ⅹⅠ-Ⅹ][.)]?)/;

/** 그릇 하나의 내용을 블록 목록으로 */
export async function renderContainer(c: Container, bounds: Box, ctx: LayoutCtx, underlined: Set<Glyph>, startY: number): Promise<{ blocks: JNode[]; endY: number }> {
  const lines = buildLines(c.glyphs, underlined);
  // 각 줄에서 다음 줄까지의 기준선 간격 (한 줄짜리 문단의 줄 높이 상한)
  const nextGap = new Map<TLine, number>();
  for (let k = 0; k + 1 < lines.length; k++) {
    const d = lines[k + 1].y - lines[k].y;
    if (d > 0 && d < lines[k].size * 2.5) nextGap.set(lines[k], d);
  }
  const items: Item[] = [];
  for (const l of lines) items.push({ kind: 'line', top: l.y - l.size * 0.9, line: l });
  // 같은 높이에 가로로 나란한 표/상자는 한 줄로 묶는다
  const groups: (TableModel | BoxModel)[][] = [];
  for (const ch of c.children.slice().sort((a, b) => a.y0 - b.y0)) {
    const g = groups.find((gr) =>
      gr.every((o) => overlap(o.y0, o.y1, ch.y0, ch.y1) > Math.min(o.y1 - o.y0, ch.y1 - ch.y0) * 0.5 && overlap(o.x0, o.x1, ch.x0, ch.x1) < 1),
    );
    if (g) g.push(ch);
    else groups.push([ch]);
  }
  for (const g of groups) {
    if (g.length > 1) items.push({ kind: 'row', top: Math.min(...g.map((o) => o.y0)), g });
    else {
      const ch = g[0];
      items.push(ch.type === 'table' ? { kind: 'table', top: ch.y0, t: ch } : { kind: 'box', top: ch.y0, b: ch });
    }
  }
  // 세로 범위가 겹치는 그림들은 한 줄에 나란히
  const rows: PdfImage[][] = [];
  for (const im of c.images.slice().sort((a, b) => a.y0 - b.y0)) {
    // 높이가 비슷하고 세로 범위가 대부분 겹칠 때만 (큰 바탕 그림이 모두를 한 줄로 묶지 않도록)
    const row = rows.find((r) => r.every((o) => overlap(o.y0, o.y1, im.y0, im.y1) > Math.max(o.y1 - o.y0, im.y1 - im.y0) * 0.6));
    if (row) row.push(im);
    else rows.push([im]);
  }
  for (const r of rows) items.push({ kind: 'image', top: Math.min(...r.map((im) => im.y0)), ims: r.sort((a, b) => a.x0 - b.x0) });
  items.sort((a, b) => a.top - b.top);

  const L = bounds.x0;
  const R = bounds.x1;
  const W = R - L;
  const blocks: JNode[] = [];
  let prevBottom = startY;
  let prevBlock: JNode | null = null;

  const gapBefore = (top: number) => Math.max(0, top - prevBottom);
  const setSpace = (attrs: Record<string, any>, gap: number) => {
    if (gap >= 0.8) attrs.spaceBefore = round(Math.min(gap, 400), 1);
  };
  const pushSpacer = (gap: number) => {
    if (gap < 2) return;
    if (prevBlock && prevBlock.type === 'paragraph') {
      const a = (prevBlock.attrs ||= {});
      a.spaceAfter = round((a.spaceAfter || 0) + Math.min(gap, 400), 1);
    } else blocks.push(paragraph({ lineHeight: `${round(Math.min(gap, 400), 1)}pt`, fontSize: 1 }, []));
  };

  // 문단 묶기
  type Para = { lines: TLine[]; pitch: number | null };
  let para: Para | null = null;
  const flushPara = () => {
    if (!para) return;
    const p = para;
    para = null;
    const first = p.lines[0];
    const last = p.lines[p.lines.length - 1];
    const size = first.size;
    let lh = p.pitch ?? Math.max(size * ctx.lineRatio, size * 1.05);
    if (p.pitch == null) {
      const ng = nextGap.get(last);
      if (ng != null) lh = Math.max(size * 1.05, Math.min(lh, ng));
    }
    // 셀: 행 높이를 넘지 않도록 줄 간격을 줄인다
    if (c.kind === 'cell') {
      const avail = (c.y1 - c.y0 - 2 * CELL_PADV) / p.lines.length;
      if (lh > avail) lh = Math.max(size * 1.05, avail);
    }
    const attrs: Record<string, any> = {};
    const firstX = first.x0 - L;
    const contX = p.lines.length > 1 ? Math.min(...p.lines.slice(1).map((l) => l.x0)) - L : firstX;
    const narrow = c.kind !== 'page';
    const align = lineAlign(first, L, R, narrow);
    if (p.lines.length === 1 && align) attrs.textAlign = align;
    else if (p.lines.length > 1 && p.lines.every((l) => lineAlign(l, L, R, narrow) === 'center')) attrs.textAlign = 'center';
    if (!attrs.textAlign) {
      // 한글 의미: indentLeft 는 첫 줄과 나머지 줄 중 왼쪽 것, textIndent 가 음수면 내어쓰기
      const leftX = Math.min(firstX, contX);
      if (leftX > 1) attrs.indentLeft = round(leftX, 1);
      if (Math.abs(firstX - contX) > 1) attrs.textIndent = round(firstX - contX, 1);
      if (p.lines.length > 1) {
        const maxX1 = Math.max(...p.lines.slice(0, -1).map((l) => l.x1));
        if (R - maxX1 > size * 1.2) attrs.indentRight = round(R - maxX1, 1);
      } else if (first.x1 > R + 1) {
        // 한 줄인데 영역을 조금 넘으면 줄바꿈되지 않도록 자간을 약간 줄인다 (생략)
      }
    }
    attrs.lineHeight = `${round(lh, 1)}pt`;
    const top = first.y - ascentOff(lh, size);
    setSpace(attrs, gapBefore(top));
    const sz = Math.round(size * 2) / 2;
    if (sz !== 10) attrs.fontSize = sz;
    const inline: JNode[] = [];
    const spacing = fitSpacing(p.lines, ctx, attrs.textAlign === 'center' ? R - L : R - L - Math.max(0, first.x0 - L));
    for (const l of p.lines) {
      const li = lineInline(l, c.bg, spacing);
      if (inline.length && li.length) {
        const prevT = inline[inline.length - 1];
        const pt = prevT.text || '';
        const nt = li[0].text || '';
        if (!/\s$/.test(pt) && !/^\s/.test(nt) && !(/[A-Za-z]-$/.test(pt))) prevT.text = pt + ' ';
      }
      inline.push(...li);
    }
    const node = paragraph(attrs, inline);
    blocks.push(node);
    prevBlock = node;
    prevBottom = last.y - ascentOff(lh, size) + lh;
  };

  for (const it of items) {
    if (it.kind === 'line') {
      const l = it.line;
      const p = para as Para | null;
      if (p && continues(p, l, L, R, c.kind !== 'page')) {
        const pitch = l.y - p.lines[p.lines.length - 1].y;
        if (p.pitch == null) p.pitch = pitch;
        p.lines.push(l);
        continue;
      }
      flushPara();
      para = { lines: [l], pitch: null };
      continue;
    }
    flushPara();
    if (it.kind === 'image') {
      const ims: { im: PdfImage; src: string }[] = [];
      for (const im of it.ims) {
        const src = await ctx.imageSrc(im);
        if (src) ims.push({ im, src });
      }
      if (!ims.length) continue;
      const x0 = Math.min(...ims.map((e) => e.im.x0));
      const x1 = Math.max(...ims.map((e) => e.im.x1));
      const y0 = Math.min(...ims.map((e) => e.im.y0));
      const y1 = Math.max(...ims.map((e) => e.im.y1));
      // 영역보다 넓으면 비율대로 줄인다 (그림 사이 간격 포함)
      const scale = x1 - x0 > W && W > 20 ? W / (x1 - x0) : 1;
      const content: JNode[] = [];
      ims.forEach((e, k) => {
        if (k > 0) {
          const gap = (e.im.x0 - ims[k - 1].im.x1) * scale;
          if (gap > 1) content.push({ type: 'text', text: ' ', marks: [{ type: 'textStyle', attrs: { letterSpacing: Math.min(500, Math.round(((gap - 3) / 10) * 100)), fontSize: 10 } }] });
        }
        content.push({ type: 'image', attrs: { src: e.src, width: Math.round((e.im.x1 - e.im.x0) * PT2PX * scale), height: Math.round((e.im.y1 - e.im.y0) * PT2PX * scale) } });
      });
      const attrs: Record<string, any> = { lineHeight: `${round((y1 - y0) * scale + 2, 1)}pt` };
      const cx = (x0 + x1) / 2;
      if (Math.abs(cx - (L + R) / 2) < 12 && x0 - L > 10) attrs.textAlign = 'center';
      else if (Math.abs(x1 - R) < 8 && x0 - L > W * 0.3) attrs.textAlign = 'right';
      else if (x0 - L > 3 && scale === 1) attrs.indentLeft = round(x0 - L, 1);
      setSpace(attrs, gapBefore(y0));
      const node = paragraph(attrs, content);
      blocks.push(node);
      prevBlock = node;
      prevBottom = y0 + (y1 - y0) * scale;
      continue;
    }
    if (it.kind === 'row') {
      pushSpacer(gapBefore(it.top));
      const node = await renderSideBySide(it.g, L, R, ctx, underlined);
      blocks.push(node);
      prevBlock = node;
      prevBottom = Math.max(...it.g.map((o) => o.y1));
      continue;
    }
    if (it.kind === 'table') {
      pushSpacer(gapBefore(it.t.y0));
      const node = await renderTable(it.t, L, R, ctx, underlined);
      blocks.push(node);
      prevBlock = node;
      prevBottom = it.t.y1;
      continue;
    }
    // 상자
    const b = it.b;
    pushSpacer(gapBefore(b.y0));
    const node = await renderBox(b, L, R, ctx, underlined);
    blocks.push(node);
    prevBlock = node;
    prevBottom = b.y1;
  }
  flushPara();
  return { blocks, endY: prevBottom };
}

async function renderBox(b: BoxModel, L: number, R: number, ctx: LayoutCtx, underlined: Set<Glyph>): Promise<JNode> {
  const W = R - L;
  const inner = b.inner;
  const lines2 = buildLines(inner.glyphs, underlined);
  const pad = lines2.length ? Math.max(1, Math.min(14, Math.min(...lines2.map((l) => l.x0)) - b.x0)) : 4;
  const content = await renderContainer(inner, { x0: b.x0 + pad, y0: b.y0, x1: b.x1 - pad, y1: b.y1 }, ctx, underlined, b.y0 + 1.4);
  const after = Math.max(0, b.y1 - 1.4 - content.endY);
  const cblocks = content.blocks.length ? content.blocks : [paragraph()];
  const lastB = cblocks[cblocks.length - 1];
  if (after >= 0.8 && lastB.type === 'paragraph') (lastB.attrs ||= {}).spaceAfter = round(Math.min(after, 400), 1);
  const attrs: Record<string, any> = { colspan: 1, rowspan: 1, colwidth: [Math.round((b.x1 - b.x0) * PT2PX)], borderStyle: 'l r t b', verticalAlign: 'top' };
  if (inner.bg) attrs.backgroundColor = inner.bg;
  const tAttrs: Record<string, any> = { cellPadding: Math.round(pad * PT2PX) };
  const bc = (b.x0 + b.x1) / 2;
  if (Math.abs(bc - (L + R) / 2) < 6 && b.x1 - b.x0 < W - 10) tAttrs.align = 'center';
  return { type: 'table', attrs: tAttrs, content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs, content: cblocks }] }] };
}

/** 가로로 나란한 표/상자들 → 테두리 없는 한 행 표의 칸들 */
async function renderSideBySide(group: (TableModel | BoxModel)[], L: number, R: number, ctx: LayoutCtx, underlined: Set<Glyph>): Promise<JNode> {
  const g = group.slice().sort((a, b) => a.x0 - b.x0);
  const cells: JNode[] = [];
  const x0 = g[0].x0;
  for (let k = 0; k < g.length; k++) {
    const ch = g[k];
    // 칸 너비: 다음 것의 시작까지 (사이 간격 포함)
    const right = k + 1 < g.length ? g[k + 1].x0 : ch.x1;
    const node = ch.type === 'table' ? await renderTable(ch, ch.x0, ch.x1, ctx, underlined) : await renderBox(ch, ch.x0, ch.x1, ctx, underlined);
    if (node.attrs) delete node.attrs.align;
    // 칸 안의 위쪽 어긋남은 빈 줄로
    const top = Math.min(...g.map((o) => o.y0));
    const content: JNode[] = [];
    if (ch.y0 - top > 2) content.push(paragraph({ lineHeight: `${round(ch.y0 - top, 1)}pt`, fontSize: 1 }, []));
    content.push(node);
    cells.push({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [Math.max(4, Math.round((right - ch.x0) * PT2PX))], borderStyle: 'l r t b', verticalAlign: 'top' }, content });
  }
  const tAttrs: Record<string, any> = { cellPadding: 0 };
  const W = R - L;
  const gx1 = g[g.length - 1].x1;
  if (Math.abs((x0 + gx1) / 2 - (L + R) / 2) < 8 && gx1 - x0 < W - 10) tAttrs.align = 'center';
  return { type: 'table', attrs: tAttrs, content: [{ type: 'tableRow', content: cells }] };
}

function lineAlign(l: TLine, L: number, R: number, narrow = false): 'center' | 'right' | null {
  const W = R - L;
  const indent = l.x0 - L;
  const rightGap = R - l.x1;
  const mid = (l.x0 + l.x1) / 2;
  if (narrow) {
    // 표 셀: 좁으므로 양쪽 여백이 거의 같으면 가운데
    if (indent > 0.3 && (l.x1 - l.x0 < W * 0.85 || indent > l.size) && Math.abs(indent - rightGap) < Math.max(2.5, l.size * 0.45)) return 'center';
    if (indent > W * 0.3 && Math.abs(rightGap) < Math.max(l.size * 0.6, 2.5)) return 'right';
    return null;
  }
  if (indent > Math.max(l.size * 1.5, 6) && Math.abs(mid - (L + R) / 2) < Math.max(l.size * 0.8, 4) && l.x1 - l.x0 < W * 0.92) return 'center';
  if (indent > W * 0.35 && Math.abs(rightGap) < Math.max(l.size * 0.9, 3)) return 'right';
  return null;
}

function continues(p: { lines: TLine[]; pitch: number | null }, l: TLine, L: number, R: number, narrow: boolean): boolean {
  const prev = p.lines[p.lines.length - 1];
  const first = p.lines[0];
  if (Math.abs(prev.size - l.size) > 0.6) return false;
  const pitch = l.y - prev.y;
  if (pitch < prev.size * 0.95 || pitch > prev.size * 2.3) return false;
  if (p.pitch != null && Math.abs(pitch - p.pitch) > 1.5) return false;
  const fa = lineAlign(first, L, R, narrow);
  // 셀 안의 가운데 정렬 여러 줄은 한 문단으로
  if (narrow && fa === 'center' && lineAlign(l, L, R, narrow) === 'center') return true;
  // 앞 줄이 오른쪽 끝까지 찼어야 이어지는 줄
  if (prev.x1 < R - Math.max(prev.size * 2.5, (R - L) * 0.06)) return false;
  if (fa === 'center' || fa === 'right') return false;
  // 새 글머리(○, -, 1. 등)로 시작하면 새 문단
  const text = l.glyphs.map((g) => g.ch).join('');
  if (BULLET_RE.test(text)) return false;
  if (p.lines.length > 1) return Math.abs(l.x0 - p.lines[1].x0) < Math.max(2, l.size * 0.5);
  return l.x0 >= L - 3 && l.x0 <= first.x0 + l.size * 8 && l.x0 >= Math.min(first.x0, L) - 3;
}

async function renderTable(t: TableModel, L: number, R: number, ctx: LayoutCtx, underlined: Set<Glyph>): Promise<JNode> {
  const nR = t.ys.length - 1;
  const colW = t.xs.slice(1).map((x, i) => Math.max(1, Math.round((x - t.xs[i]) * PT2PX)));
  // 셀 안쪽 여백: 왼쪽 정렬 글자들의 최소 들여쓰기
  let pad = Infinity;
  const cellLines = new Map<CellModel, TLine[]>();
  for (const c of t.cells) {
    const ls = buildLines(c.glyphs, underlined);
    cellLines.set(c, ls);
    for (const l of ls) if (l.x0 - c.x0 < c.x1 - l.x1 - 3) pad = Math.min(pad, l.x0 - c.x0);
  }
  if (!isFinite(pad)) pad = 2.5;
  pad = Math.max(1, Math.min(6, pad));
  const PADV = CELL_PADV;
  const rows: JNode[][] = Array.from({ length: nR }, () => []);
  const nodeOf = new Map<CellModel, JNode>();
  const sorted = t.cells.slice().sort((a, b) => a.row - b.row || a.col - b.col);
  for (const c of sorted) {
    const content = await renderContainer(c, { x0: c.x0 + pad, y0: c.y0, x1: c.x1 - pad, y1: c.y1 }, ctx, underlined, c.y0 + PADV);
    const blocks = content.blocks.length ? content.blocks : [paragraph()];
    const ls = cellLines.get(c)!;
    const attrs: Record<string, any> = { colspan: c.cs, rowspan: c.rs, colwidth: colW.slice(c.col, c.col + c.cs) };
    if (c.bg) attrs.backgroundColor = c.bg;
    if (ls.length || c.children.length || c.images.length) {
      const first = blocks[0];
      const topGap = (first.attrs?.spaceBefore as number) || 0;
      const botGap = Math.max(0, c.y1 - PADV - content.endY);
      if (Math.abs(topGap - botGap) < Math.max(2, (topGap + botGap) * 0.2)) {
        attrs.verticalAlign = 'middle';
        if (first.attrs) delete first.attrs.spaceBefore;
      } else {
        attrs.verticalAlign = 'top';
        const lastB = blocks[blocks.length - 1];
        if (botGap >= 0.8 && lastB.type === 'paragraph') (lastB.attrs ||= {}).spaceAfter = round(Math.min(botGap, 400), 1);
      }
    }
    // 테두리
    const sides: Partial<Record<'l' | 'r' | 't' | 'b', BorderSide>> = {};
    const none: string[] = [];
    for (const k of ['l', 'r', 't', 'b'] as const) {
      const s = c.borders[k];
      if (s) sides[k] = s;
      else none.push(k);
    }
    const css = borderCss(sides);
    if (css) attrs.borderCss = css;
    if (none.length) attrs.borderStyle = none.join(' ');
    const cellNode: JNode = { type: 'tableCell', attrs, content: blocks };
    nodeOf.set(c, cellNode);
    rows[c.row].push(cellNode);
  }
  // 셀이 하나도 시작하지 않는 행은 없애고 rowspan을 줄인다
  const empty: number[] = [];
  for (let r = 0; r < nR; r++) if (!rows[r].length) empty.push(r);
  if (empty.length) {
    for (const c of sorted) {
      const lost = empty.filter((r) => r > c.row && r < c.row + c.rs).length;
      if (lost) nodeOf.get(c)!.attrs!.rowspan = Math.max(1, c.rs - lost);
    }
  }
  const tAttrs: Record<string, any> = { cellPadding: Math.round(pad * PT2PX) };
  const tc = (t.x0 + t.x1) / 2;
  if (Math.abs(tc - (L + R) / 2) < 6 && t.x1 - t.x0 < R - L - 10) tAttrs.align = 'center';
  return { type: 'table', attrs: tAttrs, content: rows.filter((r) => r.length).map((r) => ({ type: 'tableRow', content: r })) };
}

/** 페이지에서 쓰는 대표 줄 간격 비율(기준선 간격 / 글자 크기) */
export function typicalLineRatio(glyphs: Glyph[]): number {
  const lines = buildLines(glyphs, new Set());
  const ratios: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1];
    const b = lines[i];
    if (Math.abs(a.size - b.size) > 0.5 || Math.abs(a.x0 - b.x0) > a.size * 3) continue;
    const r = (b.y - a.y) / a.size;
    if (r > 1.0 && r < 2.2) ratios.push(r);
  }
  if (ratios.length < 3) return 1.6;
  ratios.sort((x, y) => x - y);
  return ratios[Math.floor(ratios.length / 2)];
}
