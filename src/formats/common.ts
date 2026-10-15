import type { DocSettings } from '../types';

export interface JMark {
  type: string;
  attrs?: Record<string, any>;
}
export interface JNode {
  type: string;
  attrs?: Record<string, any>;
  content?: JNode[];
  text?: string;
  marks?: JMark[];
}

// ---------- 단위 ----------
export const MM_PER_INCH = 25.4;
export const PX_PER_MM = 96 / 25.4;
export const HWPUNIT_PER_MM = 7200 / 25.4;
export const TWIP_PER_MM = 1440 / 25.4;
export const EMU_PER_PX = 9525;

export const mmToPx = (mm: number) => mm * PX_PER_MM;
export const pxToMm = (px: number) => px / PX_PER_MM;
export const hwpToMm = (v: number) => v / HWPUNIT_PER_MM;
export const mmToHwp = (mm: number) => Math.round(mm * HWPUNIT_PER_MM);
/** HWPUNIT(1/7200 inch) → px(1/96 inch) */
export const hwpToPx = (v: number) => v / 75;
export const pxToHwp = (px: number) => Math.round(px * 75);
/** HWPUNIT → pt */
export const hwpToPt = (v: number) => v / 100;
export const ptToHwp = (pt: number) => Math.round(pt * 100);
export const twipToMm = (v: number) => v / TWIP_PER_MM;
export const mmToTwip = (mm: number) => Math.round(mm * TWIP_PER_MM);
export const round = (v: number, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
};

export function defaultSettings(): DocSettings {
  return {
    page: {
      width: 210,
      height: 297,
      marginTop: 20,
      marginBottom: 15,
      marginLeft: 30,
      marginRight: 30,
      marginHeader: 15,
      marginFooter: 15,
      gutter: 0,
      landscape: false,
    },
    header: { text: '', align: 'center' },
    footer: { text: '', align: 'center' },
    pageNumber: { pos: 'none', format: 'digit', start: 1 },
  };
}

export const DEFAULT_FONT = '함초롬바탕';
export const DEFAULT_FONT_SIZE = 10;

// ---------- 바이너리 ----------
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function dataUrlToBytes(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  if (m[2]) return { mime, bytes: base64ToBytes(m[3]) };
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  wmf: 'image/x-wmf',
  emf: 'image/x-emf',
};
export const mimeFromExt = (ext: string) => EXT_MIME[ext.toLowerCase()] || 'application/octet-stream';
export function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('bmp')) return 'bmp';
  if (m.includes('webp')) return 'webp';
  if (m.includes('svg')) return 'svg';
  return 'png';
}

/** 브라우저가 표시할 수 없는 그림(WMF/EMF 등)을 대신할 자리표시 SVG */
export function placeholderImage(label: string, w = 160, h = 90): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#f4f4f4" stroke="#999" stroke-dasharray="4 3"/><text x="50%" y="50%" font-size="12" fill="#666" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${xmlEscape(label)}</text></svg>`;
  return 'data:image/svg+xml;base64,' + bytesToBase64(new TextEncoder().encode(svg));
}

export function isBrowserImage(mime: string) {
  return /image\/(png|jpeg|gif|bmp|webp|svg\+xml)/.test(mime);
}

// ---------- XML ----------
/** ISO 8601 날짜만 통과 (문서 메타데이터를 XML 에 그대로 넣기 전에) */
export function safeIsoDate(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? v : fallback;
}

/** 불러올 수 있는 파일 크기 상한 (바이트) */
export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
/** 압축 파일(HWPX/DOCX) 안의 전체 풀린 크기 상한 */
export const MAX_ZIP_UNCOMPRESSED = 600 * 1024 * 1024;

/** 압축 폭탄 방어: 풀린 크기 합이 상한을 넘으면 거부 */
export function assertZipBudget(zip: { files: Record<string, any> }) {
  let total = 0;
  let count = 0;
  for (const f of Object.values(zip.files)) {
    count++;
    const n = f?._data?.uncompressedSize;
    if (typeof n === 'number' && n > 0) total += n;
    if (total > MAX_ZIP_UNCOMPRESSED || count > 20000) throw new Error('문서 안의 압축 데이터가 너무 큽니다.');
  }
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0에서 허용되지 않는 제어 문자 제거
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function parseXml(str: string): Document {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err && doc.documentElement.nodeName === 'parsererror') throw new Error('XML 파싱 오류: ' + err.textContent);
  return doc;
}

export const localName = (n: Node) => ((n as Element).localName || n.nodeName.replace(/^.*:/, ''));

export function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (!name || localName(c) === name) out.push(c);
  }
  return out;
}

export function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (localName(c) === name) return c;
  return null;
}

/** 하위 모든 요소 중 localName이 일치하는 것 (문서 순서) */
export function descendants(el: Element | Document | null | undefined, name: string): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  const root: Element | null = (el as Document).documentElement !== undefined && (el as Document).nodeType === 9 ? (el as Document).documentElement : (el as Element);
  if (!root) return out;
  if ((el as Document).nodeType === 9 && localName(root) === name) out.push(root);
  const stack: Element[] = [];
  for (let c = root.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  while (stack.length) {
    const n = stack.pop()!;
    if (localName(n) === name) out.push(n);
    for (let c = n.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  }
  return out;
}

export function descendant(el: Element | Document | null | undefined, name: string): Element | null {
  if (!el) return null;
  const root: Element | null = (el as Document).nodeType === 9 ? (el as Document).documentElement : (el as Element);
  if (!root) return null;
  if ((el as Document).nodeType === 9 && localName(root) === name) return root;
  const stack: Element[] = [];
  for (let c = root.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  while (stack.length) {
    const n = stack.pop()!;
    if (localName(n) === name) return n;
    for (let c = n.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  }
  return null;
}

/** 접두사를 무시하고 속성 읽기 */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const v = el.getAttribute(name);
  if (v != null) return v;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.localName === name || a.name.replace(/^.*:/, '') === name) return a.value;
  }
  return null;
}

export const numAttr = (el: Element | null | undefined, name: string, def = 0) => {
  const v = attr(el, name);
  if (v == null || v === '') return def;
  const n = parseFloat(v);
  return isNaN(n) ? def : n;
};

// ---------- 색 ----------
export function normColor(c: string | null | undefined): string | null {
  if (!c) return null;
  c = c.trim();
  if (!c || c === 'none' || c === 'auto' || c === 'transparent') return null;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toUpperCase();
  if (/^#[0-9a-f]{8}$/i.test(c)) return ('#' + c.slice(3)).toUpperCase(); // #AARRGGBB
  if (/^[0-9a-f]{6}$/i.test(c)) return ('#' + c).toUpperCase();
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(c);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const named = NAMED_COLORS[c.toLowerCase()];
  return named || null;
}

export const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  gray: '#808080',
  grey: '#808080',
  darkblue: '#00008B',
  darkcyan: '#008B8B',
  darkgreen: '#006400',
  darkmagenta: '#8B008B',
  darkred: '#8B0000',
  darkyellow: '#808000',
  darkgray: '#A9A9A9',
  lightgray: '#D3D3D3',
  orange: '#FFA500',
  purple: '#800080',
  navy: '#000080',
};

/** COLORREF(0x00BBGGRR) → #RRGGBB */
export function colorRefToHex(v: number): string {
  const r = v & 0xff;
  const g = (v >> 8) & 0xff;
  const b = (v >> 16) & 0xff;
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------- 노드 빌더 ----------
export function marksKey(marks?: JMark[]): string {
  if (!marks || !marks.length) return '';
  return JSON.stringify(
    [...marks]
      .map((m) => ({ type: m.type, attrs: m.attrs ? sortObj(m.attrs) : undefined }))
      .sort((a, b) => (a.type < b.type ? -1 : 1)),
  );
}

function sortObj(o: Record<string, any>) {
  const out: Record<string, any> = {};
  Object.keys(o)
    .sort()
    .forEach((k) => {
      if (o[k] !== null && o[k] !== undefined) out[k] = o[k];
    });
  return out;
}

/** 기호 글꼴(Wingdings/Symbol)의 사용자 정의 영역 문자 → 표준 유니코드 */
const SYMBOL_PUA: Record<number, string> = {
  0xf06c: '●', 0xf06d: '❍', 0xf06e: '■', 0xf06f: '□', 0xf070: '◻', 0xf071: '❑', 0xf072: '❒',
  0xf073: '⬧', 0xf074: '⧫', 0xf075: '◆', 0xf076: '❖', 0xf077: '⬥', 0xf09f: '•', 0xf0a1: '○',
  0xf0a4: '◉', 0xf0a7: '▪', 0xf0a8: '◻', 0xf0b7: '•', 0xf0d8: '➢', 0xf0e0: '→', 0xf0e8: '➔',
  0xf0f0: '⇨', 0xf0fb: '✗', 0xf0fc: '✓', 0xf0fd: '☒', 0xf0fe: '☑', 0xf0b2: '◊',
};

export function mapSymbols(text: string): string {
  if (!/[\uf020-\uf0ff]/.test(text)) return text;
  return text.replace(/[\uf020-\uf0ff]/g, (ch) => SYMBOL_PUA[ch.charCodeAt(0)] || ch);
}

export function textNode(text: string, marks?: JMark[]): JNode | null {
  if (!text) return null;
  text = mapSymbols(text);
  const n: JNode = { type: 'text', text };
  if (marks && marks.length) n.marks = marks;
  return n;
}

/** 인접한 같은 서식의 텍스트를 합치고 빈 텍스트 제거 */
export function normalizeInline(content: JNode[]): JNode[] {
  const out: JNode[] = [];
  for (const n of content) {
    if (!n) continue;
    if (n.type === 'text') {
      if (!n.text) continue;
      const prev = out[out.length - 1];
      if (prev && prev.type === 'text' && marksKey(prev.marks) === marksKey(n.marks)) {
        prev.text += n.text;
        continue;
      }
      out.push({ ...n });
    } else out.push(n);
  }
  return out;
}

export function paragraph(attrs?: Record<string, any>, content?: JNode[]): JNode {
  const p: JNode = { type: 'paragraph' };
  if (attrs) {
    const a: Record<string, any> = {};
    for (const k of Object.keys(attrs)) if (attrs[k] !== null && attrs[k] !== undefined) a[k] = attrs[k];
    if (Object.keys(a).length) p.attrs = a;
  }
  const c = content ? normalizeInline(content) : [];
  if (c.length) p.content = c;
  return p;
}

export function ensureBlocks(blocks: JNode[]): JNode[] {
  return blocks.length ? blocks : [paragraph()];
}

export function docNode(blocks: JNode[]): JNode {
  return { type: 'doc', content: ensureBlocks(blocks) };
}

/** 노드 트리에서 순수 텍스트 추출 */
export function nodeText(n: JNode): string {
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak') return '\n';
  if (!n.content) return '';
  const inner = n.content.map(nodeText);
  const isBlockContainer = n.content.some((c) => c.type !== 'text' && c.type !== 'hardBreak' && c.type !== 'image' && c.type !== 'footnote');
  return inner.join(isBlockContainer ? '\n' : '');
}

/** 표 셀 그리드 계산: 각 셀의 (row, col) 좌표와 전체 열 수 */
export function tableGrid(table: JNode): { cells: { row: number; col: number; cell: JNode }[][]; cols: number; rows: number } {
  const rows = table.content || [];
  const occupied: boolean[][] = [];
  const out: { row: number; col: number; cell: JNode }[][] = [];
  let maxCols = 0;
  rows.forEach((row, r) => {
    occupied[r] = occupied[r] || [];
    const list: { row: number; col: number; cell: JNode }[] = [];
    let c = 0;
    for (const cell of row.content || []) {
      while (occupied[r][c]) c++;
      const cs = cell.attrs?.colspan || 1;
      const rs = cell.attrs?.rowspan || 1;
      for (let i = 0; i < rs; i++) {
        occupied[r + i] = occupied[r + i] || [];
        for (let j = 0; j < cs; j++) occupied[r + i][c + j] = true;
      }
      list.push({ row: r, col: c, cell });
      c += cs;
      maxCols = Math.max(maxCols, c);
    }
    out.push(list);
  });
  for (const o of occupied) if (o) maxCols = Math.max(maxCols, o.length);
  return { cells: out, cols: maxCols, rows: rows.length };
}

/** 셀 너비 정보로 그리드 열 너비 계산 (px) */
export function gridColumnWidths(table: JNode, totalWidth: number): number[] {
  const g = tableGrid(table);
  const widths: (number | null)[] = new Array(g.cols).fill(null);
  for (const row of g.cells)
    for (const { col, cell } of row) {
      const cw: number[] | null = cell.attrs?.colwidth || null;
      const cs = cell.attrs?.colspan || 1;
      if (cw && cw.length === cs) cw.forEach((w, i) => {
        if (w && widths[col + i] == null) widths[col + i] = w;
      });
    }
  const known = widths.filter((w) => w != null) as number[];
  const knownSum = known.reduce((a, b) => a + b, 0);
  const unknown = widths.length - known.length;
  const rest = unknown ? Math.max(30 * unknown, totalWidth - knownSum) / unknown : 0;
  return widths.map((w) => (w == null ? rest : w));
}

export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0) return [name, ''];
  return [name.slice(0, i), name.slice(i + 1).toLowerCase()];
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** 쪽 번호 서식 */
export function formatPageNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'dash':
      return `- ${n} -`;
    case 'roman':
      return toRoman(n).toLowerCase();
    case 'ROMAN':
      return toRoman(n);
    case 'paren':
      return `(${n})`;
    default:
      return String(n);
  }
}

export function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

const HANGUL_SYL = '가나다라마바사아자차카타파하';
const HANGUL_JAMO = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const CIRCLED_HANGUL = '㉮㉯㉰㉱㉲㉳㉴㉵㉶㉷㉸㉹㉺㉻';
const CIRCLED_JAMO = '㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩㉪㉫㉬㉭';
const IDEO = '一二三四五六七八九十';
const HANGUL_NUM = ['일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'];

/** 한글 문단 번호 형식(numFormat) → 문자열 */
export function formatNumber(n: number, fmt: string): string {
  const pick = (s: string) => s[(n - 1) % s.length] || String(n);
  switch (fmt) {
    case 'CIRCLED_DIGIT':
      return n >= 1 && n <= 20 ? CIRCLED[n - 1] : String(n);
    case 'ROMAN_CAPITAL':
      return toRoman(n);
    case 'ROMAN_SMALL':
      return toRoman(n).toLowerCase();
    case 'LATIN_CAPITAL':
      return String.fromCharCode(65 + ((n - 1) % 26));
    case 'LATIN_SMALL':
      return String.fromCharCode(97 + ((n - 1) % 26));
    case 'CIRCLED_LATIN_CAPITAL':
      return String.fromCharCode(0x24b6 + ((n - 1) % 26));
    case 'CIRCLED_LATIN_SMALL':
      return String.fromCharCode(0x24d0 + ((n - 1) % 26));
    case 'HANGUL_SYLLABLE':
      return pick(HANGUL_SYL);
    case 'CIRCLED_HANGUL_SYLLABLE':
      return pick(CIRCLED_HANGUL);
    case 'HANGUL_JAMO':
      return pick(HANGUL_JAMO);
    case 'CIRCLED_HANGUL_JAMO':
      return pick(CIRCLED_JAMO);
    case 'HANGUL_PHONETIC':
      return n <= 10 ? HANGUL_NUM[n - 1] : String(n);
    case 'IDEOGRAPH':
    case 'CIRCLED_IDEOGRAPH':
      return n <= 10 ? IDEO[n - 1] : String(n);
    default:
      return String(n);
  }
}

/** HWP 바이너리 번호 형식 코드 → HWPX 이름 */
export const HWP_NUM_FORMATS = [
  'DIGIT', 'CIRCLED_DIGIT', 'ROMAN_CAPITAL', 'ROMAN_SMALL', 'LATIN_CAPITAL', 'LATIN_SMALL',
  'CIRCLED_LATIN_CAPITAL', 'CIRCLED_LATIN_SMALL', 'HANGUL_SYLLABLE', 'CIRCLED_HANGUL_SYLLABLE',
  'HANGUL_JAMO', 'CIRCLED_HANGUL_JAMO', 'HANGUL_PHONETIC', 'IDEOGRAPH', 'CIRCLED_IDEOGRAPH',
];

/**
 * 문단 번호 카운터 (개요/번호 문단의 번호 문자열을 계산해 본문 앞에 붙이기 위함)
 */
export class NumberingCounter {
  private counters = new Map<string, number[]>();
  next(numId: string, level: number, start = 1): number[] {
    let arr = this.counters.get(numId);
    if (!arr) {
      arr = new Array(10).fill(0);
      this.counters.set(numId, arr);
    }
    arr[level] = (arr[level] || start - 1) + 1;
    for (let i = level + 1; i < arr.length; i++) arr[i] = 0;
    for (let i = 0; i < level; i++) if (!arr[i]) arr[i] = 1;
    return arr.slice();
  }
}

/** "^1.^2" 같은 형식 문자열에 번호 대입 */
export function applyNumFormat(template: string, values: number[], formats: string[]): string {
  return template
    .replace(/\^(\d)/g, (_, d) => {
      const i = parseInt(d, 10) - 1;
      return formatNumber(values[i] || 1, formats[i] || 'DIGIT');
    })
    .replace(/[\u0000-\u0006]/g, (ch) => {
      const i = ch.charCodeAt(0);
      return formatNumber(values[i] || 1, formats[i] || 'DIGIT');
    });
}

// ---------- 그림 자르기 ----------
/** 잘라 낸 비율(0~1). 모두 0이면 null */
export function normCrop(t: number, r: number, b: number, l: number): { t: number; r: number; b: number; l: number } | null {
  const c = (v: number) => (isFinite(v) ? Math.max(0, Math.min(0.95, Math.round(v * 10000) / 10000)) : 0);
  const x = { t: c(t), r: c(r), b: c(b), l: c(l) };
  if (x.l + x.r > 0.95 || x.t + x.b > 0.95) return null;
  return x.t || x.r || x.b || x.l ? x : null;
}

// ---------- 셀 테두리 ----------
export interface BorderSide {
  /** 굵기 mm */
  w: number;
  c: string;
  s: 'solid' | 'dashed' | 'dotted' | 'double';
}

/** 기본(0.12mm 검은 실선)과 다른 쪽만 "t:0.5mm solid #00A651;b:..." 형식으로 */
export function borderCss(sides: Partial<Record<'l' | 'r' | 't' | 'b', BorderSide>>): string | null {
  const parts: string[] = [];
  for (const k of ['t', 'b', 'l', 'r'] as const) {
    const v = sides[k];
    if (!v) continue;
    if (v.s === 'solid' && v.w <= 0.15 && (v.c === '#000000' || !v.c)) continue;
    parts.push(`${k}:${Math.max(0.1, v.w)}mm ${v.s} ${v.c || '#000000'}`);
  }
  return parts.length ? parts.join(';') : null;
}

export function parseBorderCss(v: string | null | undefined): Partial<Record<'l' | 'r' | 't' | 'b', BorderSide>> {
  const out: Partial<Record<'l' | 'r' | 't' | 'b', BorderSide>> = {};
  if (!v) return out;
  for (const part of v.split(';')) {
    const m = /^([lrtb]):([\d.]+)mm (\w+) (#[0-9A-Fa-f]{6})$/.exec(part.trim());
    if (m) out[m[1] as 'l'] = { w: parseFloat(m[2]), s: m[3] as any, c: m[4].toUpperCase() };
  }
  return out;
}

export const HWP_BORDER_WIDTHS = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];
export function hwpBorderStyle(type: number): BorderSide['s'] {
  if (type === 2 || type === 6 || type === 4 || type === 5) return 'dashed';
  if (type === 3 || type === 7) return 'dotted';
  if (type >= 8 && type <= 10) return 'double';
  return 'solid';
}
export function hwpxBorderStyle(type: string): BorderSide['s'] {
  if (/DASH/.test(type)) return 'dashed';
  if (/DOT|CIRCLE/.test(type)) return 'dotted';
  if (/DOUBLE|THICK|THIN/.test(type) && type !== 'SOLID') return 'double';
  return 'solid';
}
