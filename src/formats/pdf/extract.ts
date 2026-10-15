/**
 * pdf.js 연산자 목록(getOperatorList)을 직접 해석해 페이지의 글자·채운 사각형·선·그림을 뽑는다.
 * 좌표는 모두 뷰포트 기준(pt, 왼쪽 위 원점, y는 아래로 증가)이다.
 */

export type Mat = [number, number, number, number, number, number];

export interface Glyph {
  ch: string;
  x: number;
  /** 기준선 y */
  y: number;
  /** 진행 폭 */
  w: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  color: string;
  /** 자간 (% of size) */
  spacing: number;
  /** 장평 (%) */
  hscale: number;
  invisible: boolean;
}

export interface FillRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  /** 이미지 마스크 타일에서 온 것 */
  tile?: boolean;
}

export interface Seg {
  /** 'h': y 고정, a..b 는 x 범위 / 'v': x 고정, a..b 는 y 범위 */
  dir: 'h' | 'v';
  pos: number;
  a: number;
  b: number;
  w: number;
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface PdfImage {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** objs id 또는 인라인 이미지 데이터 */
  ref: string | any;
}

export interface PageContent {
  width: number;
  height: number;
  glyphs: Glyph[];
  fills: FillRect[];
  segs: Seg[];
  images: PdfImage[];
}

export interface FontInfo {
  name: string;
  bold: boolean;
  italic: boolean;
  fontMatrix: number[];
  vertical: boolean;
}

export const mul = (m1: number[], m2: number[]): Mat => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

interface State {
  ctm: Mat;
  fill: string;
  stroke: string;
  fillAlpha: number;
  lineWidth: number;
  dash: number[];
  font: FontInfo | null;
  fontId: string;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  render: number;
  rise: number;
  tm: Mat;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
}

const cloneState = (s: State): State => ({ ...s });

/**
 * @param OPS pdf.js 의 OPS 상수
 * @param getFont 글꼴 id → 정보
 * @param viewport 뷰포트 변환 행렬과 크기
 */
export function extractPage(ops: { fnArray: number[]; argsArray: any[] }, OPS: Record<string, number>, getFont: (id: string) => FontInfo | null, viewport: { transform: number[]; width: number; height: number }): PageContent {
  const glyphs: Glyph[] = [];
  const fills: FillRect[] = [];
  const segs: Seg[] = [];
  const images: PdfImage[] = [];
  let st: State = {
    ctm: viewport.transform.slice(0, 6) as Mat,
    fill: '#000000',
    stroke: '#000000',
    fillAlpha: 1,
    lineWidth: 1,
    dash: [],
    font: null,
    fontId: '',
    fontSize: 10,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    render: 0,
    rise: 0,
    tm: [1, 0, 0, 1, 0, 0],
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
  };
  const stack: State[] = [];
  const W = viewport.width;
  const H = viewport.height;

  const unitRect = (m: number[]) => {
    const pts = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };

  const scaleOf = (m: number[]) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

  const addLine = (p: [number, number], q: [number, number], w: number, color: string) => {
    const style: Seg['style'] = st.dash.length && st.dash.some((v) => v > 0) ? (st.dash[0] <= st.lineWidth * 2.5 ? 'dotted' : 'dashed') : 'solid';
    const dx = Math.abs(p[0] - q[0]);
    const dy = Math.abs(p[1] - q[1]);
    // 점선을 아주 짧은 조각(0.3pt 안팎)으로 그리는 경우도 있다
    if (dy < 0.8 && dx > 0.15 && dx >= dy) segs.push({ dir: 'h', pos: (p[1] + q[1]) / 2, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]), w, color, style });
    else if (dx < 0.8 && dy > 0.15 && dy > dx) segs.push({ dir: 'v', pos: (p[0] + q[0]) / 2, a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]), w, color, style });
  };

  const addFillRect = (r: { x0: number; y0: number; x1: number; y1: number }, color: string, tile = false) => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (w <= 0 || h <= 0) return;
    if (r.x1 < 0 || r.y1 < 0 || r.x0 > W || r.y0 > H) return;
    // 가는 사각형은 선으로 본다
    if (!tile && h <= 2.2 && w > 2.5) segs.push({ dir: 'h', pos: (r.y0 + r.y1) / 2, a: r.x0, b: r.x1, w: h, color });
    else if (!tile && w <= 2.2 && h > 2.5) segs.push({ dir: 'v', pos: (r.x0 + r.x1) / 2, a: r.y0, b: r.y1, w, color });
    else fills.push({ ...r, color, tile });
  };

  const doPath = (paintOp: number, data: ArrayLike<number> | null) => {
    if (!data) return;
    const isStroke = paintOp === OPS.stroke || paintOp === OPS.closeStroke || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke || paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke;
    const isFill = paintOp === OPS.fill || paintOp === OPS.eoFill || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke || paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke;
    if (!isStroke && !isFill) return;
    // 하위 경로로 나눈다
    const subs: { pts: [number, number][]; curve: boolean; closed: boolean }[] = [];
    let cur: { pts: [number, number][]; curve: boolean; closed: boolean } | null = null;
    const m = st.ctm;
    for (let i = 0; i < data.length; ) {
      const op = data[i++];
      if (op === 0) {
        cur = { pts: [apply(m, data[i], data[i + 1])], curve: false, closed: false };
        subs.push(cur);
        i += 2;
      } else if (op === 1) {
        cur?.pts.push(apply(m, data[i], data[i + 1]));
        i += 2;
      } else if (op === 2) {
        if (cur) {
          cur.curve = true;
          cur.pts.push(apply(m, data[i + 4], data[i + 5]));
        }
        i += 6;
      } else if (op === 3) {
        if (cur) {
          cur.curve = true;
          cur.pts.push(apply(m, data[i + 2], data[i + 3]));
        }
        i += 4;
      } else if (op === 4) {
        if (cur) cur.closed = true;
      } else break;
    }
    const lw = Math.max(0.1, st.lineWidth * scaleOf(m));
    for (const s of subs) {
      if (s.pts.length < 2) continue;
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      const bb = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      const isRect = !s.curve && s.pts.length >= 4 && s.pts.length <= 5 && s.pts.every((p) => (Math.abs(p[0] - bb.x0) < 0.3 || Math.abs(p[0] - bb.x1) < 0.3) && (Math.abs(p[1] - bb.y0) < 0.3 || Math.abs(p[1] - bb.y1) < 0.3));
      const big = bb.x1 - bb.x0 > 12 && bb.y1 - bb.y0 > 8;
      if (isFill && st.fill !== 'transparent' && st.fillAlpha > 0.15) {
        if (isRect || (s.curve && big && (s.closed || s.pts.length > 4))) addFillRect(bb, st.fill);
      }
      if (isStroke && st.stroke !== 'transparent') {
        if (s.curve) {
          // 둥근 모서리 상자 등: 바깥 사각형으로 본다
          if (big && (s.closed || Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 2)) {
            addLine([bb.x0, bb.y0], [bb.x1, bb.y0], lw, st.stroke);
            addLine([bb.x0, bb.y1], [bb.x1, bb.y1], lw, st.stroke);
            addLine([bb.x0, bb.y0], [bb.x0, bb.y1], lw, st.stroke);
            addLine([bb.x1, bb.y0], [bb.x1, bb.y1], lw, st.stroke);
          }
          continue;
        }
        for (let k = 1; k < s.pts.length; k++) addLine(s.pts[k - 1], s.pts[k], lw, st.stroke);
        if (s.closed || paintOp === OPS.closeStroke || paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke) addLine(s.pts[s.pts.length - 1], s.pts[0], lw, st.stroke);
      }
    }
  };

  const showText = (arr: any[]) => {
    const font = st.font;
    if (!font || !arr) return;
    const fs = st.fontSize;
    if (!fs) return;
    const fm = font.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
    const M = mul(st.tm, st.ctm);
    // 회전된 글자(워터마크 등)는 건너뛴다
    const dirX = M[0];
    const dirY = M[1];
    const rotated = Math.abs(dirY) > Math.abs(dirX) * 0.18;
    const sizeDev = Math.hypot(M[2], M[3]) * Math.abs(fs);
    const xScale = Math.hypot(M[0], M[1]);
    const hs = st.hScale;
    const bold = font.bold || st.render === 2 || st.render === 6;
    const invisible = st.render === 3 || st.render === 7;
    const color = st.render === 1 || st.render === 5 ? st.stroke : st.fill;
    const spacingPct = fs ? Math.round(((st.charSpacing * hs) / Math.abs(fs)) * 100) : 0;
    let x = 0;
    for (const g of arr) {
      if (typeof g === 'number') {
        x -= (g * fs) / 1000;
        continue;
      }
      if (!g) continue;
      const spacing = (g.isSpace ? st.wordSpacing : 0) + st.charSpacing;
      const adv = (g.width || 0) * fm[0] * fs + spacing;
      if (!rotated) {
        const [px, py] = apply(M, st.x + x * hs, st.y + st.rise);
        // 아래아(U+119E, 조합용 자모)로 쓴 가운뎃점은 호환 자모 ㆍ로
        const ch = typeof g.unicode === 'string' ? g.unicode.replace(/\u119E/g, '\u318D') : '';
        if (ch && px > -5 && px < W + 5 && py > -5 && py < H + 5)
          glyphs.push({
            ch,
            x: px,
            y: py,
            w: Math.abs(((g.width || 0) * fm[0] * fs + spacing) * hs * xScale),
            size: sizeDev,
            font: font.name,
            bold,
            italic: font.italic,
            color,
            spacing: spacingPct,
            hscale: Math.round(hs * 100),
            invisible,
          });
      }
      x += adv;
    }
    st.x += x * hs;
  };

  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const a = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push(cloneState(st));
        break;
      case OPS.restore:
        if (stack.length) st = stack.pop()!;
        break;
      case OPS.transform:
        st.ctm = mul(a, st.ctm);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(cloneState(st));
        if (Array.isArray(a?.[0]) || ArrayBuffer.isView(a?.[0])) st.ctm = mul(Array.from(a[0] as number[]), st.ctm);
        break;
      case OPS.paintFormXObjectEnd:
        if (stack.length) st = stack.pop()!;
        break;
      case OPS.beginGroup:
        stack.push(cloneState(st));
        if (a?.[0]?.matrix) st.ctm = mul(Array.from(a[0].matrix as number[]), st.ctm);
        break;
      case OPS.endGroup:
        if (stack.length) st = stack.pop()!;
        break;
      case OPS.setLineWidth:
        st.lineWidth = a[0];
        break;
      case OPS.setDash:
        st.dash = Array.isArray(a?.[0]) ? a[0] : [];
        break;
      case OPS.setFillRGBColor:
        st.fill = typeof a[0] === 'string' ? a[0] : rgbHex(a);
        break;
      case OPS.setStrokeRGBColor:
        st.stroke = typeof a[0] === 'string' ? a[0] : rgbHex(a);
        break;
      case OPS.setFillTransparent:
        st.fill = 'transparent';
        break;
      case OPS.setStrokeTransparent:
        st.stroke = 'transparent';
        break;
      case OPS.setFillColorN:
        // 패턴/음영 채우기: 색을 알 수 없다
        if (typeof a?.[0] === 'string' && /^#/.test(a[0])) st.fill = a[0];
        else if (a?.[0] === 'TilingPattern' || a?.[0] === 'Shading' || Array.isArray(a?.[0])) st.fill = 'transparent';
        break;
      case OPS.setGState:
        for (const [k, v] of (a?.[0] || []) as [string, any][]) {
          if (k === 'LW') st.lineWidth = v;
          else if (k === 'D' && Array.isArray(v)) st.dash = Array.isArray(v[0]) ? v[0] : [];
          else if (k === 'ca') st.fillAlpha = v;
          else if (k === 'Font' && Array.isArray(v)) {
            const f = typeof v[0] === 'string' ? getFont(v[0]) : null;
            if (f) {
              st.font = f;
              st.fontId = v[0];
            }
            st.fontSize = v[1];
          }
        }
        break;
      case OPS.constructPath: {
        const d = a?.[1]?.[0];
        doPath(a[0], d && typeof d === 'object' && 'length' in d ? d : null);
        break;
      }
      case OPS.beginText:
        st.tm = [1, 0, 0, 1, 0, 0];
        st.x = st.y = st.lineX = st.lineY = 0;
        break;
      case OPS.setFont: {
        const f = getFont(a[0]);
        st.font = f;
        st.fontId = a[0];
        st.fontSize = a[1] < 0 ? -a[1] : a[1];
        break;
      }
      case OPS.setCharSpacing:
        st.charSpacing = a[0];
        break;
      case OPS.setWordSpacing:
        st.wordSpacing = a[0];
        break;
      case OPS.setHScale:
        st.hScale = a[0] / 100;
        break;
      case OPS.setLeading:
        st.leading = -a[0];
        break;
      case OPS.setTextRenderingMode:
        st.render = a[0];
        break;
      case OPS.setTextRise:
        st.rise = a[0];
        break;
      case OPS.moveText:
        st.x = st.lineX += a[0];
        st.y = st.lineY += a[1];
        break;
      case OPS.setLeadingMoveText:
        st.leading = a[1];
        st.x = st.lineX += a[0];
        st.y = st.lineY += a[1];
        break;
      case OPS.setTextMatrix: {
        const m = a.length === 1 ? a[0] : a;
        st.tm = Array.from(m as number[]) as Mat;
        st.x = st.y = st.lineX = st.lineY = 0;
        break;
      }
      case OPS.nextLine:
        st.x = st.lineX += 0;
        st.y = st.lineY += st.leading;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        showText(a[0]);
        break;
      case OPS.nextLineShowText:
        st.x = st.lineX;
        st.y = st.lineY += st.leading;
        showText(a[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        st.wordSpacing = a[0];
        st.charSpacing = a[1];
        st.x = st.lineX;
        st.y = st.lineY += st.leading;
        showText(a[2]);
        break;
      case OPS.paintImageMaskXObject:
      case OPS.paintSolidColorImageMask:
      case OPS.paintImageMaskXObjectRepeat: {
        if (st.fill === 'transparent') break;
        const img = a?.[0];
        if (fn === OPS.paintImageMaskXObject && img && !isSolidMask(img)) break;
        addFillRect(unitRect(st.ctm), st.fill, true);
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageXObjectRepeat: {
        const r = unitRect(st.ctm);
        if (r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4) break;
        images.push({ ...r, ref: a[0] });
        break;
      }
    }
  }
  return { width: W, height: H, glyphs, fills, segs, images };
}

function rgbHex(a: number[]): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(a[0]) + h(a[1]) + h(a[2]);
}

/** 마스크 대부분이 칠해지는(또는 비는) 단색 타일인지 */
function isSolidMask(img: any): boolean {
  const d: Uint8Array | undefined = img?.data;
  if (!d || !img.width || !img.height) return true;
  const rowBytes = Math.ceil(img.width / 8);
  if (d.length < rowBytes * img.height) return true;
  let ones = 0;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) if ((d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) ones++;
  const frac = ones / (img.width * img.height);
  return frac > 0.9 || frac < 0.1;
}
