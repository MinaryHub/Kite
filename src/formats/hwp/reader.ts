import * as CFB from 'cfb';
import { inflateRaw, inflate } from 'pako';
import type { LoadedDoc } from '../../types';
import {
  type JNode,
  applyNumFormat,
  bytesToDataUrl,
  colorRefToHex,
  defaultSettings,
  docNode,
  hwpToMm,
  hwpToPt,
  hwpToPx,
  isBrowserImage,
  mimeFromExt,
  NumberingCounter,
  paragraph,
  placeholderImage,
  round,
  textNode,
  HWP_NUM_FORMATS,
  HWP_BORDER_WIDTHS,
  hwpBorderStyle,
  borderCss,
  normCrop,
  type BorderSide,
} from '../common';
import { charMarks, paraAttrs, type CharPr, type ParaPr, type BorderFill, type Numbering } from '../hwpx/reader';

/**
 * HWP 5.0 (바이너리, OLE 복합 문서) 읽기.
 * 참고: 한글과컴퓨터 "한글 문서 파일 형식 5.0" 공개 문서.
 */

// ---------- 레코드 ----------
const T = {
  DOCUMENT_PROPERTIES: 16,
  ID_MAPPINGS: 17,
  BIN_DATA: 18,
  FACE_NAME: 19,
  BORDER_FILL: 20,
  CHAR_SHAPE: 21,
  TAB_DEF: 22,
  NUMBERING: 23,
  BULLET: 24,
  PARA_SHAPE: 25,
  STYLE: 26,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  PARA_CHAR_SHAPE: 68,
  PARA_LINE_SEG: 69,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  PAGE_DEF: 73,
  SHAPE_COMPONENT: 76,
  TABLE: 77,
  SHAPE_COMPONENT_PICTURE: 85,
  SHAPE_COMPONENT_CONTAINER: 86,
  CTRL_DATA: 87,
  EQEDIT: 88,
};

interface Rec {
  tag: number;
  level: number;
  data: Uint8Array;
  dv: DataView;
  children: Rec[];
}

function parseRecords(buf: Uint8Array): Rec[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Rec[] = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const h = dv.getUint32(off, true);
    off += 4;
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (off + 4 > buf.length) break;
      size = dv.getUint32(off, true);
      off += 4;
    }
    const data = buf.subarray(off, Math.min(buf.length, off + size));
    out.push({ tag, level, data, dv: new DataView(data.buffer, data.byteOffset, data.byteLength), children: [] });
    off += size;
  }
  return out;
}

function buildTree(recs: Rec[]): Rec[] {
  const roots: Rec[] = [];
  const stack: Rec[] = [];
  for (const r of recs) {
    while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(r);
    else roots.push(r);
    stack.push(r);
  }
  return roots;
}

const u8 = (r: Rec, o: number) => (o < r.data.length ? r.data[o] : 0);
const u16 = (r: Rec, o: number) => (o + 2 <= r.data.length ? r.dv.getUint16(o, true) : 0);
const u32 = (r: Rec, o: number) => (o + 4 <= r.data.length ? r.dv.getUint32(o, true) : 0);
const i32 = (r: Rec, o: number) => (o + 4 <= r.data.length ? r.dv.getInt32(o, true) : 0);
const i8 = (r: Rec, o: number) => (o < r.data.length ? r.dv.getInt8(o) : 0);

function wstr(r: Rec, o: number): { s: string; end: number } {
  const len = u16(r, o);
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(u16(r, o + 2 + i * 2));
  return { s, end: o + 2 + len * 2 };
}

function ctrlIdOf(r: Rec): string {
  const v = u32(r, 0);
  return String.fromCharCode((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}

function decompress(data: Uint8Array, compressed: boolean): Uint8Array {
  if (!compressed) return data;
  try {
    return inflateRaw(data);
  } catch {
    try {
      return inflate(data);
    } catch {
      return data;
    }
  }
}

// ---------- DocInfo ----------
interface DocInfo {
  charPrs: CharPr[];
  paraPrs: ParaPr[];
  borderFills: BorderFill[]; // 1부터 시작하는 id → index id-1
  numberings: Numbering[]; // 1부터
  bullets: string[]; // 1부터
  binData: Map<number, { ext: string; compress: number }>;
}

function parseDocInfo(recs: Rec[]): DocInfo {
  const info: DocInfo = { charPrs: [], paraPrs: [], borderFills: [], numberings: [], bullets: [], binData: new Map() };
  let counts: number[] = [];
  const fonts: string[][] = [[], [], [], [], [], [], []];
  let faceIdx = 0;
  for (const r of recs) {
    switch (r.tag) {
      case T.ID_MAPPINGS:
        counts = [];
        for (let o = 0; o + 4 <= r.data.length; o += 4) counts.push(i32(r, o));
        break;
      case T.FACE_NAME: {
        // 언어별 순서: 한글, 영문, 한자, 일어, 기타, 기호, 사용자
        let lang = 0;
        let acc = 0;
        for (let l = 0; l < 7; l++) {
          acc += counts[1 + l] || 0;
          if (faceIdx < acc) {
            lang = l;
            break;
          }
        }
        fonts[lang].push(wstr(r, 1).s);
        faceIdx++;
        break;
      }
      case T.BORDER_FILL: {
        const noBorders: string[] = [];
        const sides: Record<string, BorderSide> = {};
        ['l', 'r', 't', 'b'].forEach((side, i) => {
          const type = u8(r, 2 + i * 6);
          if (type === 0) noBorders.push(side);
          else sides[side] = { w: HWP_BORDER_WIDTHS[u8(r, 3 + i * 6)] ?? 0.12, c: colorRefToHex(u32(r, 4 + i * 6)), s: hwpBorderStyle(type) };
        });
        const fillType = u32(r, 32);
        let bg: string | null = null;
        if (fillType & 1) {
          const c = u32(r, 36);
          if (c !== 0xffffffff && (c & 0xff000000) === 0) bg = colorRefToHex(c);
          if (bg === '#FFFFFF') bg = null;
        }
        info.borderFills.push({ bg, noBorders, css: borderCss(sides) });
        break;
      }
      case T.CHAR_SHAPE: {
        const faceId = u16(r, 0);
        const ratio = u8(r, 14);
        const spacing = i8(r, 21);
        const relSz = u8(r, 28) || 100;
        const base = i32(r, 42);
        const attr = u32(r, 46);
        const color = u32(r, 52);
        const shade = u32(r, 60);
        const ulType = (attr >>> 2) & 3;
        const outline = (attr >>> 8) & 7;
        const shadow = (attr >>> 11) & 3;
        let effect: string | null = null;
        if (outline) effect = 'outline';
        if (shadow) effect = 'shadow';
        if (attr & (1 << 13)) effect = 'emboss';
        if (attr & (1 << 14)) effect = 'engrave';
        const shadeHex = shade === 0xffffffff || shade & 0xff000000 ? null : colorRefToHex(shade);
        info.charPrs.push({
          fontFamily: fonts[0][faceId] || fonts[1][u16(r, 2)] || undefined,
          fontSize: round((base / 100) * (relSz / 100), 1) || 10,
          color: colorRefToHex(color),
          bold: !!(attr & 2),
          italic: !!(attr & 1),
          underline: ulType === 1 || ulType === 3,
          // 새 버전은 '종류=1, 모양=15(없음)'을 기본으로 기록하므로 모양까지 확인
          strike: ((attr >>> 18) & 7) !== 0 && ((attr >>> 26) & 15) !== 15,
          sup: !!(attr & (1 << 15)),
          sub: !!(attr & (1 << 16)),
          highlight: shadeHex && shadeHex !== '#FFFFFF' ? shadeHex : null,
          letterSpacing: spacing || undefined,
          fontWidth: ratio && ratio !== 100 ? ratio : undefined,
          textEffect: effect,
        });
        break;
      }
      case T.PARA_SHAPE: {
        const a1 = u32(r, 0);
        // 여백 값은 2배로 저장됨
        const left = i32(r, 4) / 2;
        const right = i32(r, 8) / 2;
        const indent = i32(r, 12) / 2;
        const prev = i32(r, 16) / 2;
        const next = i32(r, 20) / 2;
        let lsType = a1 & 3;
        let lsVal = i32(r, 24);
        if (r.data.length >= 54) {
          lsType = u32(r, 46) & 0x1f;
          lsVal = u32(r, 50);
        }
        let lineHeight: string | null = null;
        if (lsType === 0) lineHeight = lsVal === 160 || !lsVal ? null : String(round(lsVal / 100, 2));
        else if (lsType === 1 || lsType === 3) lineHeight = `${round(hwpToPt(lsVal / 2), 1)}pt`;
        else if (lsType === 2) lineHeight = String(round(1.2 + hwpToPt(lsVal / 2) / 10, 2));
        const alignCode = (a1 >>> 2) & 7;
        const ALIGN = ['justify', 'left', 'right', 'center', 'distribute', 'distribute'];
        const headingType = (a1 >>> 23) & 3;
        const bfId = u16(r, 32);
        info.paraPrs.push({
          align: ALIGN[alignCode] || null,
          indentLeft: hwpToPt(left),
          indentRight: hwpToPt(right),
          textIndent: hwpToPt(indent),
          spaceBefore: hwpToPt(prev),
          spaceAfter: hwpToPt(next),
          lineHeight,
          headingType: ['NONE', 'OUTLINE', 'NUMBER', 'BULLET'][headingType],
          headingIdRef: String(u16(r, 30)),
          headingLevel: (a1 >>> 25) & 7,
          pageBreakBefore: false,
          bg: bfId ? info.borderFills[bfId - 1]?.bg || null : null,
        });
        break;
      }
      case T.NUMBERING: {
        const levels: Numbering['levels'] = [];
        let o = 0;
        for (let l = 0; l < 7 && o + 14 <= r.data.length; l++) {
          const a = u32(r, o);
          o += 12;
          const { s, end } = wstr(r, o);
          o = end;
          levels.push({ text: s, format: HWP_NUM_FORMATS[(a >>> 5) & 0xf] || 'DIGIT', start: 1 });
        }
        const start = u16(r, o);
        o += 2;
        for (let l = 0; l < 7; l++) {
          const st = o + l * 4 + 4 <= r.data.length ? u32(r, o + l * 4) : 0;
          if (levels[l]) levels[l].start = st || start || 1;
        }
        info.numberings.push({ levels });
        break;
      }
      case T.BULLET: {
        const ch = u16(r, 12);
        info.bullets.push(ch >= 0x20 && !(ch >= 0xe000 && ch <= 0xf8ff) ? String.fromCharCode(ch) : '•');
        break;
      }
      case T.BIN_DATA: {
        const a = u16(r, 0);
        const type = a & 0xf;
        if (type === 0) break; // 외부 연결
        const id = u16(r, 2);
        const ext = wstr(r, 4).s;
        info.binData.set(id, { ext, compress: (a >>> 4) & 3 });
        break;
      }
    }
  }
  return info;
}

// ---------- 본문 ----------
const CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
const INLINE_CTRL = new Set([4, 5, 6, 7, 8, 9, 19, 20]);

class HwpConverter {
  outlineNumId = '1';
  counter = new NumberingCounter();
  settingsSet = false;
  private linkHref: string | null = null;

  constructor(
    private info: DocInfo,
    private images: Map<number, string>,
    public settings = defaultSettings(),
    public warnings: string[] = [],
  ) {}

  private charPr(id: number) {
    return this.info.charPrs[id];
  }

  private numberPrefix(pp: ParaPr): string | null {
    if (pp.headingType === 'NONE') return null;
    if (pp.headingType === 'BULLET') return (this.info.bullets[+pp.headingIdRef - 1] || '•') + ' ';
    const numId = pp.headingType === 'OUTLINE' ? this.outlineNumId : pp.headingIdRef;
    const nb = this.info.numberings[+numId - 1];
    if (!nb) return null;
    const lvl = Math.max(0, Math.min(6, pp.headingLevel));
    const def = nb.levels[lvl];
    if (!def || !def.text) return null;
    const vals = this.counter.next(numId, lvl, def.start || 1);
    return applyNumFormat(def.text, vals, nb.levels.map((l) => l.format)) + ' ';
  }

  convertParagraphs(paras: Rec[], inSub: boolean, bg?: string | null): JNode[] {
    const out: JNode[] = [];
    for (const p of paras) if (p.tag === T.PARA_HEADER) out.push(...this.convertPara(p, inSub, bg));
    return out;
  }

  convertPara(p: Rec, inSub: boolean, bg?: string | null): JNode[] {
    const psId = u16(p, 8);
    const breakType = u8(p, 11);
    const pp = this.info.paraPrs[psId];
    const pAttrs = paraAttrs(pp);
    if (bg && !pAttrs.paraBg) pAttrs.paraBg = bg;
    const blocks: JNode[] = [];
    if (!inSub && breakType & 0x05) blocks.push({ type: 'pageBreak' });

    const textRec = p.children.find((c) => c.tag === T.PARA_TEXT);
    const csRec = p.children.find((c) => c.tag === T.PARA_CHAR_SHAPE);
    const ctrls = p.children.filter((c) => c.tag === T.CTRL_HEADER);
    const shapes: [number, number][] = [];
    if (csRec) for (let o = 0; o + 8 <= csRec.data.length; o += 8) shapes.push([u32(csRec, o), u32(csRec, o + 4)]);
    if (!shapes.length) shapes.push([0, 0]);
    let si = 0;
    const shapeAt = (pos: number) => {
      while (si + 1 < shapes.length && shapes[si + 1][0] <= pos) si++;
      return shapes[si][1];
    };

    let inline: JNode[] = [];
    let produced = false;
    const firstCp = this.charPr(shapes[0][1]);
    const firstSize = firstCp?.fontSize || null;
    const fontSize = firstSize && firstSize !== 10 ? firstSize : null;
    const flush = () => {
      if (!inline.length) return;
      blocks.push(paragraph({ ...pAttrs, fontSize }, inline));
      inline = [];
      produced = true;
    };

    const prefix = pp ? this.numberPrefix(pp) : null;
    if (prefix) {
      const t = textNode(prefix, charMarks(firstCp));
      if (t) inline.push(t);
    }

    let ctrlIdx = 0;
    let buf = '';
    let bufShape = -1;
    const pushText = () => {
      if (!buf) return;
      const t = textNode(buf, charMarks(this.charPr(bufShape), this.linkHref));
      if (t) inline.push(t);
      buf = '';
    };
    const addChar = (ch: string, pos: number) => {
      const s = shapeAt(pos);
      if (s !== bufShape) {
        pushText();
        bufShape = s;
      }
      buf += ch;
    };

    if (textRec) {
      const n = textRec.data.length >> 1;
      let i = 0;
      while (i < n) {
        const c = u16(textRec, i * 2);
        if (c >= 32) {
          addChar(String.fromCharCode(c), i);
          i++;
          continue;
        }
        if (CHAR_CTRL.has(c)) {
          if (c === 10) {
            pushText();
            inline.push({ type: 'hardBreak' });
          } else if (c === 24) addChar('-', i);
          else if (c === 30) addChar(' ', i);
          else if (c === 31) addChar(' ', i);
          i++;
          continue;
        }
        if (INLINE_CTRL.has(c)) {
          if (c === 9) addChar('\t', i);
          else if (c === 4) {
            pushText();
            this.linkHref = null;
          }
          i += 8;
          continue;
        }
        // 확장 컨트롤
        pushText();
        const ctrl = ctrls[ctrlIdx++];
        if (ctrl) {
          const res = this.handleCtrl(ctrl, shapeAt(i), inline);
          if (res.length) {
            for (const b of res)
              if (b.type === 'table' && (pAttrs.textAlign === 'center' || pAttrs.textAlign === 'right')) b.attrs = { ...b.attrs, align: pAttrs.textAlign };
            flush();
            blocks.push(...res);
            produced = true;
          }
        }
        i += 8;
      }
      pushText();
    }
    // 텍스트 없이 컨트롤만 있는 경우(구역 정의 등)
    for (; ctrlIdx < ctrls.length; ctrlIdx++) {
      const id = ctrlIdOf(ctrls[ctrlIdx]);
      if (id === 'secd' || id === 'cold' || id === 'head' || id === 'foot' || id === 'pgnp') this.handleCtrl(ctrls[ctrlIdx], 0, inline);
    }
    if (inline.length) flush();
    else if (!produced) blocks.push(paragraph({ ...pAttrs, fontSize }));
    return blocks;
  }

  /** 확장 컨트롤 처리. 블록을 반환하면 문단을 끊고 삽입 */
  private handleCtrl(ctrl: Rec, shapeId: number, inline: JNode[]): JNode[] {
    const id = ctrlIdOf(ctrl);
    switch (id) {
      case 'secd':
        this.handleSecd(ctrl);
        return [];
      case 'tbl ': {
        const t = this.convertTable(ctrl);
        const cap = (t as any).caption as JNode[] | undefined;
        delete (t as any).caption;
        return cap ? [t, ...cap] : [t];
      }
      case 'gso ':
        return this.convertGso(ctrl, inline);
      case 'head':
      case 'foot': {
        const text = this.subText(ctrl, true);
        const target = id === 'head' ? this.settings.header : this.settings.footer;
        if (text && !target.text) {
          target.text = text;
          const firstPara = ctrl.children.find((c) => c.tag === T.PARA_HEADER);
          const pp = firstPara ? this.info.paraPrs[u16(firstPara, 8)] : undefined;
          target.align = pp?.align === 'right' ? 'right' : pp?.align === 'left' ? 'left' : 'center';
        }
        return [];
      }
      case 'fn  ':
      case 'en  ':
        inline.push({ type: 'footnote', attrs: { text: this.subText(ctrl, false) } });
        return [];
      case 'pgnp': {
        const a = u32(ctrl, 4);
        const fmt = a & 0xff;
        const pos = (a >>> 8) & 0xf;
        const POS = ['none', 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'top-right', 'bottom-right', 'top-left', 'bottom-left'];
        this.settings.pageNumber.pos = (POS[pos] || 'bottom-center') as any;
        const dash = u16(ctrl, 14);
        this.settings.pageNumber.format = fmt === 3 ? 'roman' : fmt === 2 ? 'ROMAN' : dash === 0x2d ? 'dash' : 'digit';
        return [];
      }
      case '%hlk': {
        const cmd = wstr(ctrl, 9).s;
        this.linkHref = cmd.split(';')[0].replace(/\\:/g, ':') || null;
        return [];
      }
      case 'eqed': {
        const eq = ctrl.children.find((c) => c.tag === T.EQEDIT);
        const script = eq ? wstr(eq, 4).s : '';
        const t = textNode(script ? `[수식: ${script}]` : '[수식]', [...charMarks(this.charPr(shapeId)), { type: 'italic' }]);
        if (t) inline.push(t);
        return [];
      }
      case 'atno': {
        const type = u32(ctrl, 4) & 0xf;
        const num = u16(ctrl, 8);
        if (type !== 0 && num) {
          const t = textNode(String(num), charMarks(this.charPr(shapeId)));
          if (t) inline.push(t);
        }
        return [];
      }
      default:
        return [];
    }
  }

  private handleSecd(ctrl: Rec) {
    const ol = u16(ctrl, 18);
    if (ol) this.outlineNumId = String(ol);
    if (this.settingsSet) return;
    const pd = ctrl.children.find((c) => c.tag === T.PAGE_DEF);
    if (!pd) return;
    this.settingsSet = true;
    const pg = this.settings.page;
    pg.width = round(hwpToMm(u32(pd, 0)), 1);
    pg.height = round(hwpToMm(u32(pd, 4)), 1);
    pg.marginLeft = round(hwpToMm(u32(pd, 8)), 1);
    pg.marginRight = round(hwpToMm(u32(pd, 12)), 1);
    pg.marginTop = round(hwpToMm(u32(pd, 16)), 1);
    pg.marginBottom = round(hwpToMm(u32(pd, 20)), 1);
    pg.marginHeader = round(hwpToMm(u32(pd, 24)), 1);
    pg.marginFooter = round(hwpToMm(u32(pd, 28)), 1);
    pg.gutter = round(hwpToMm(u32(pd, 32)), 1);
    pg.landscape = (u32(pd, 36) & 1) === 1;
  }

  /** 머리말/각주 등 하위 문단의 텍스트 */
  private subText(ctrl: Rec, pageToken: boolean): string {
    const parts: string[] = [];
    for (const p of ctrl.children) {
      if (p.tag !== T.PARA_HEADER) continue;
      const tr = p.children.find((c) => c.tag === T.PARA_TEXT);
      const cs = p.children.filter((c) => c.tag === T.CTRL_HEADER);
      if (!tr) continue;
      let s = '';
      let k = 0;
      const n = tr.data.length >> 1;
      for (let i = 0; i < n; ) {
        const c = u16(tr, i * 2);
        if (c >= 32) {
          s += String.fromCharCode(c);
          i++;
        } else if (CHAR_CTRL.has(c)) {
          if (c === 10) s += ' ';
          i++;
        } else if (INLINE_CTRL.has(c)) {
          if (c === 9) s += '\t';
          i += 8;
        } else {
          const ct = cs[k++];
          if (ct && ctrlIdOf(ct) === 'atno' && (u32(ct, 4) & 0xf) === 0 && pageToken) s += '{{PAGE}}';
          i += 8;
        }
      }
      parts.push(s);
    }
    return parts.join(' ').trim();
  }

  convertTable(ctrl: Rec): JNode {
    const tbl = ctrl.children.find((c) => c.tag === T.TABLE);
    const nRowsDecl = tbl ? u16(tbl, 4) : 0;
    type Cell = { row: number; col: number; cs: number; rs: number; w: number; node: JNode };
    const cells: Cell[] = [];
    const rowH: number[] = [];
    let cur: { lh: Rec; paras: Rec[] } | null = null;
    const finish = () => {
      if (!cur) return;
      const lh = cur.lh;
      const attrVal = u32(lh, 2);
      const col = u16(lh, 8);
      const row = u16(lh, 10);
      const cs = Math.max(1, u16(lh, 12));
      const rs = Math.max(1, u16(lh, 14));
      const w = hwpToPx(u32(lh, 16));
      // 셀 높이에는 위/아래 안 여백이 들어 있다 (편집기 줄 높이와 맞추려고 뺀다)
      if (rs === 1) rowH[row] = Math.max(rowH[row] || 0, hwpToPx(u32(lh, 20) - CELL_VMARGIN_HWP));
      const bfId = u16(lh, 32);
      const bf = bfId ? this.info.borderFills[bfId - 1] : undefined;
      let content = this.convertParagraphs(cur.paras, true).filter((n) => n.type !== 'pageBreak');
      if (!content.length) content = [paragraph()];
      const va = (attrVal >>> 21) & 3;
      const attrs: Record<string, any> = { colspan: cs, rowspan: rs, colwidth: null };
      if (bf?.bg) attrs.backgroundColor = bf.bg;
      if (bf && bf.noBorders.length) attrs.borderStyle = bf.noBorders.join(' ');
      if (bf?.css) attrs.borderCss = bf.css;
      if (va === 0) attrs.verticalAlign = 'top';
      else if (va === 2) attrs.verticalAlign = 'bottom';
      cells.push({ row, col, cs, rs, w, node: { type: 'tableCell', attrs, content } });
      cur = null;
    };
    // TABLE 레코드 앞의 LIST_HEADER는 캡션
    let seenTable = false;
    let caption: Rec[] | null = null;
    for (const c of ctrl.children) {
      if (c.tag === T.TABLE) {
        seenTable = true;
        continue;
      }
      if (!seenTable) {
        if (c.tag === T.LIST_HEADER) caption = [];
        else if (c.tag === T.PARA_HEADER && caption) caption.push(c);
        continue;
      }
      if (c.tag === T.LIST_HEADER) {
        finish();
        cur = { lh: c, paras: [] };
      } else if (c.tag === T.PARA_HEADER && cur) cur.paras.push(c);
    }
    finish();
    const nColsDecl = tbl ? u16(tbl, 6) : 0;
    const t = assembleTable(cells, nRowsDecl, nColsDecl, hwpToPx(u32(ctrl, 16)), rowH);
    if (tbl) t.attrs = { cellPadding: Math.round(hwpToPx((u16(tbl, 10) + u16(tbl, 12)) / 2) * 10) / 10 };
    if (caption && caption.length) (t as any).caption = this.convertParagraphs(caption, true);
    return t;
  }

  private convertGso(ctrl: Rec, inline: JNode[]): JNode[] {
    const w = Math.round(hwpToPx(u32(ctrl, 16)));
    const h = Math.round(hwpToPx(u32(ctrl, 20)));
    const pics: Rec[] = [];
    const texts: { paras: Rec[] }[] = [];
    const visit = (r: Rec) => {
      let curText: { paras: Rec[] } | null = null;
      for (const c of r.children) {
        if (c.tag === T.SHAPE_COMPONENT_PICTURE) pics.push(c);
        else if (c.tag === T.LIST_HEADER) {
          curText = { paras: [] };
          texts.push(curText);
        } else if (c.tag === T.PARA_HEADER && curText) curText.paras.push(c);
        if (c.tag !== T.PARA_HEADER) visit(c);
      }
    };
    visit(ctrl);
    if (pics.length === 1 && !texts.length) {
      inline.push(this.picture(pics[0], w, h));
      return [];
    }
    const blocks: JNode[] = [];
    for (const p of pics) {
      const sw = Math.round(hwpToPx(Math.abs(i32(p, 20) - i32(p, 12)))) || w;
      const sh = Math.round(hwpToPx(Math.abs(i32(p, 32) - i32(p, 16)))) || h;
      blocks.push(paragraph({ textAlign: 'center' }, [this.picture(p, pics.length === 1 ? w : sw, pics.length === 1 ? h : sh)]));
    }
    for (const t of texts) blocks.push(...this.convertParagraphs(t.paras, true));
    return blocks;
  }

  private picture(p: Rec, w: number, h: number): JNode {
    const binId = u16(p, 71);
    let src = this.images.get(binId);
    if (!src) {
      this.warnings.push(`그림 데이터를 찾을 수 없음 (BIN${binId.toString(16).toUpperCase().padStart(4, '0')})`);
      src = placeholderImage('그림', w || 100, h || 60);
    }
    const ow = p.data.length >= 90 ? u32(p, 82) : Math.abs(i32(p, 20) - i32(p, 12));
    const oh = p.data.length >= 90 ? u32(p, 86) : Math.abs(i32(p, 32) - i32(p, 16));
    let crop = null;
    if (ow > 0 && oh > 0) crop = normCrop(i32(p, 48) / oh, 1 - i32(p, 52) / ow, 1 - i32(p, 56) / oh, i32(p, 44) / ow);
    return { type: 'image', attrs: { src, width: w || null, height: h || null, crop } };
  }
}

/** 셀 목록 → 표 JSON (빈 줄/열 너비 보정 포함) */
/** 한글 셀의 위+아래 안 여백 기본값 (HWPUNIT, 0.5mm×2). 줄 높이를 읽고 쓸 때 빼고 더한다 */
export const CELL_VMARGIN_HWP = 282;

export function assembleTable(
  cells: { row: number; col: number; cs: number; rs: number; w: number; node: JNode }[],
  nRowsDecl: number,
  nColsDecl = 0,
  /** 표 전체 너비(px) — 계산한 너비가 더 크면 이 너비에 맞춤 */
  tableWidth = 0,
  /** 원래 줄 번호별 줄 높이(px, 최소 높이) */
  rowHeights: (number | null)[] = [],
): JNode {
  // 잘못된 값 방어: 칸/줄 합치기 범위를 표 크기 안으로 제한
  const maxCols = nColsDecl > 0 ? nColsDecl : 512;
  cells = cells.filter((c) => c.col < maxCols && c.row < Math.max(nRowsDecl, 1) + 4096);
  for (const c of cells) {
    if (c.col + c.cs > maxCols) c.cs = Math.max(1, maxCols - c.col);
    if (nRowsDecl > 0 && c.row + c.rs > nRowsDecl) c.rs = Math.max(1, nRowsDecl - c.row);
    if (!isFinite(c.w) || c.w > 5000) c.w = 0;
    c.node.attrs!.colspan = c.cs;
    c.node.attrs!.rowspan = c.rs;
  }
  const nRows = Math.max(nRowsDecl, ...cells.map((c) => c.row + c.rs), 0);
  const rowsWithCells = new Set(cells.map((c) => c.row));
  const removed: number[] = [];
  for (let r = 0; r < nRows; r++) if (!rowsWithCells.has(r)) removed.push(r);
  const keptRows: number[] = [];
  for (let r = 0; r < nRows; r++) if (rowsWithCells.has(r)) keptRows.push(r);
  if (removed.length) {
    for (const c of cells) {
      c.rs -= removed.filter((r) => r > c.row && r < c.row + c.rs).length;
      c.node.attrs!.rowspan = Math.max(1, c.rs);
      c.row -= removed.filter((r) => r < c.row).length;
    }
  }
  const byRow = new Map<number, typeof cells>();
  for (const c of cells) {
    if (!byRow.has(c.row)) byRow.set(c.row, []);
    byRow.get(c.row)!.push(c);
  }
  const rows: JNode[] = [...byRow.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const h = rowHeights[keptRows[r]];
      const row: JNode = { type: 'tableRow', content: byRow.get(r)!.sort((a, b) => a.col - b.col).map((c) => c.node) };
      if (h && h > 0 && h < 3000) row.attrs = { height: Math.round(h * 10) / 10 };
      return row;
    });
  const nCols = Math.max(1, ...cells.map((c) => c.col + c.cs));
  // 열 경계 계산: 각 셀의 왼쪽/오른쪽 경계를 전파해 정확한 격자 너비를 구한다
  const x: (number | null)[] = new Array(nCols + 1).fill(null);
  x[0] = 0;
  for (let iter = 0; iter < nCols + 4; iter++) {
    let changed = false;
    for (const c of cells) {
      if (!(c.w > 0)) continue;
      const a = c.col;
      const b = c.col + c.cs;
      if (x[a] != null && x[b] == null) {
        x[b] = x[a]! + c.w;
        changed = true;
      } else if (x[b] != null && x[a] == null) {
        x[a] = x[b]! - c.w;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 알 수 없는 경계는 앞뒤 값 사이를 고르게 채움
  for (let i = 1; i <= nCols; i++) {
    if (x[i] != null) continue;
    let j = i + 1;
    while (j <= nCols && x[j] == null) j++;
    const left = x[i - 1]!;
    const right = j <= nCols ? x[j]! : left + 60 * (j - i);
    for (let k = i; k < j; k++) x[k] = left + ((right - left) * (k - i + 1)) / (j - i + 1);
  }
  for (let i = 1; i <= nCols; i++) if (x[i]! <= x[i - 1]!) x[i] = x[i - 1]! + 4;
  let total = x[nCols]!;
  const scale = tableWidth && total > tableWidth + 1 ? tableWidth / total : 1;
  const bounds = x.map((v) => Math.round(v! * scale));
  total = bounds[nCols];
  const finalW = bounds.slice(1).map((v, i) => Math.max(1, Math.min(2000, v - bounds[i])));
  // 병합 때문에 생긴 아주 좁은 열(셀 안 여백보다 좁음)은 이웃 열에 합친다
  for (let k = finalW.length - 1; k >= 0 && finalW.length > 1; k--) {
    if (finalW[k] >= 8) continue;
    const covering = cells.filter((c) => c.col <= k && k < c.col + c.cs);
    if (covering.some((c) => c.cs === 1)) continue;
    const target = k + 1 < finalW.length ? k + 1 : k - 1;
    finalW[target] += finalW[k];
    finalW.splice(k, 1);
    for (const c of cells) {
      if (c.col <= k && k < c.col + c.cs) c.cs--;
      else if (c.col > k) c.col--;
      c.node.attrs!.colspan = c.cs;
    }
  }
  for (const c of cells) c.node.attrs!.colwidth = finalW.slice(c.col, c.col + c.cs);
  return {
    type: 'table',
    content: rows.length ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph()] }] }],
  };
}

export async function readHwp(data: Uint8Array): Promise<LoadedDoc> {
  const cfb = CFB.read(data, { type: 'array' });
  const find = (name: string) => {
    const lower = name.toLowerCase();
    const idx = cfb.FullPaths.findIndex((p) => p.toLowerCase().endsWith('/' + lower) || p.toLowerCase() === lower);
    return idx >= 0 ? cfb.FileIndex[idx] : null;
  };
  const header = find('FileHeader');
  if (!header) throw new Error('HWP 파일이 아닙니다 (FileHeader 없음). HWP 3.x 이하 형식은 지원하지 않습니다.');
  const hb = new Uint8Array(header.content as any);
  const sig = new TextDecoder('ascii').decode(hb.subarray(0, 17));
  if (sig !== 'HWP Document File') throw new Error('HWP 5.0 형식이 아닙니다.');
  const hdv = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
  const flags = hdv.getUint32(36, true);
  const compressed = (flags & 1) === 1;
  if (flags & 2) throw new Error('암호가 설정된 문서는 열 수 없습니다.');
  if (flags & 4) throw new Error('배포용 문서는 열 수 없습니다.');

  const docInfoEntry = find('DocInfo');
  if (!docInfoEntry) throw new Error('DocInfo 스트림이 없습니다.');
  const info = parseDocInfo(parseRecords(decompress(new Uint8Array(docInfoEntry.content as any), compressed)));

  const warnings: string[] = [];
  const images = new Map<number, string>();
  for (const [id, b] of info.binData) {
    const name = `BIN${id.toString(16).toUpperCase().padStart(4, '0')}.${b.ext}`;
    const e = find('BinData/' + name) || find(name);
    if (!e) continue;
    let bytes = new Uint8Array(e.content as any);
    const comp = b.compress === 0 ? compressed : b.compress === 1;
    if (comp) bytes = decompress(bytes, true);
    const mime = mimeFromExt(b.ext);
    images.set(id, isBrowserImage(mime) ? bytesToDataUrl(bytes, mime) : placeholderImage(`그림(${b.ext.toUpperCase()})`));
  }

  const conv = new HwpConverter(info, images, defaultSettings(), warnings);
  const blocks: JNode[] = [];
  for (let i = 0; ; i++) {
    const sec = find(`BodyText/Section${i}`);
    if (!sec) break;
    const recs = buildTree(parseRecords(decompress(new Uint8Array(sec.content as any), compressed)));
    if (i > 0 && blocks.length) blocks.push({ type: 'pageBreak' });
    blocks.push(...conv.convertParagraphs(recs, false));
  }
  while (blocks.length && blocks[0].type === 'pageBreak') blocks.shift();
  return { content: docNode(blocks), settings: conv.settings, meta: {}, warnings: [...new Set(warnings)].slice(0, 20) };
}
