import type { LoadedDoc } from '../../types';
import { type JMark, type JNode, defaultSettings, docNode, paragraph, round } from '../common';

/**
 * PDF 불러오기: 텍스트 위치 정보로 줄/문단을 재구성하고, 그림은 위치 순서대로 배치한다.
 * (PDF는 편집용 구조가 없으므로 완벽한 복원은 불가능하다.)
 */

let pdfjsPromise: Promise<any> | null = null;
async function getPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib: any = await import('pdfjs-dist');
      // @ts-ignore - Vite ?url import
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return pdfjsPromise;
}

const FONT_MAP: [RegExp, string][] = [
  [/malgun/i, '맑은 고딕'],
  [/hcr\s*batang|hamchorom\s*batang|함초롬바탕/i, '함초롬바탕'],
  [/hcr\s*dotum|hamchorom\s*dotum|함초롬돋움/i, '함초롬돋움'],
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
];

function cleanFontName(name: string): { family: string | null; bold: boolean; italic: boolean } {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  const bold = /bold|black|heavy|semibold|-B$|ExtraBold|,B\b/i.test(n);
  const italic = /italic|oblique/i.test(n);
  for (const [re, fam] of FONT_MAP) if (re.test(n)) return { family: fam, bold, italic };
  const base = n.replace(/[-,](Bold|Italic|Regular|Medium|Light|Black|Heavy|SemiBold|Oblique|BoldItalic|B|R|M|L)+$/i, '').replace(/MT$|PS$/, '');
  return { family: base && !/^(g_d\d|f\d|T\d|F\d)/i.test(base) ? base : null, bold, italic };
}

interface TItem {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  font: string;
}

interface Line {
  y: number;
  x0: number;
  x1: number;
  size: number;
  items: TItem[];
}

type Flow = { kind: 'line'; y: number; line: Line } | { kind: 'image'; y: number; src: string; w: number; h: number; x: number };

export async function readPdf(data: Uint8Array, onProgress?: (p: number) => void): Promise<LoadedDoc> {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  const settings = defaultSettings();
  const warnings: string[] = [];
  const blocks: JNode[] = [];
  const fontInfo = new Map<string, { family: string | null; bold: boolean; italic: boolean }>();
  let meta: any = {};
  try {
    const m = await pdf.getMetadata();
    meta = { title: m.info?.Title || undefined, author: m.info?.Author || undefined, subject: m.info?.Subject || undefined };
  } catch {
    /* 무시 */
  }

  let imgCount = 0;
  for (let pi = 1; pi <= pdf.numPages; pi++) {
    onProgress?.(pi / pdf.numPages);
    const page = await pdf.getPage(pi);
    const vp = page.getViewport({ scale: 1 });
    const pageW = vp.width;
    const pageH = vp.height;
    if (pi === 1) {
      const wmm = (pageW * 25.4) / 72;
      const hmm = (pageH * 25.4) / 72;
      settings.page.landscape = wmm > hmm;
      settings.page.width = round(Math.min(wmm, hmm), 1);
      settings.page.height = round(Math.max(wmm, hmm), 1);
    }
    const flows: Flow[] = [];

    // 글꼴/그림 (연산자 목록)
    let ops: any = null;
    try {
      ops = await page.getOperatorList();
    } catch {
      /* 무시 */
    }
    const tc = await page.getTextContent();
    for (const it of tc.items as any[]) {
      if (!it.str || fontInfo.has(it.fontName)) continue;
      let name = '';
      try {
        if (page.commonObjs.has(it.fontName)) name = page.commonObjs.get(it.fontName)?.name || '';
      } catch {
        /* 무시 */
      }
      const st = tc.styles?.[it.fontName];
      const info = cleanFontName(name || st?.fontFamily || '');
      fontInfo.set(it.fontName, info);
    }

    if (ops) {
      try {
        const OPS = pdfjs.OPS;
        let ctm = [1, 0, 0, 1, 0, 0];
        const stack: number[][] = [];
        const mul = (m1: number[], m2: number[]) => [
          m1[0] * m2[0] + m1[1] * m2[2],
          m1[0] * m2[1] + m1[1] * m2[3],
          m1[2] * m2[0] + m1[3] * m2[2],
          m1[2] * m2[1] + m1[3] * m2[3],
          m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
          m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
        ];
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          const args = ops.argsArray[i];
          if (fn === OPS.save) stack.push(ctm);
          else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
          else if (fn === OPS.transform) ctm = mul(args, ctm);
          else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
            const w = Math.hypot(ctm[0], ctm[1]);
            const h = Math.hypot(ctm[2], ctm[3]);
            if (w < 8 || h < 8 || imgCount > 300) continue;
            let src: string | null = null;
            try {
              const obj = fn === OPS.paintInlineImageXObject ? args[0] : await getObj(page, args[0]);
              src = imageToDataUrl(obj);
            } catch {
              src = null;
            }
            if (!src) continue;
            imgCount++;
            const top = ctm[5] + Math.min(0, ctm[3]) + h;
            flows.push({ kind: 'image', y: top, src, w: (w * 96) / 72, h: (h * 96) / 72, x: ctm[4] });
          }
        }
      } catch (e) {
        warnings.push('일부 그림을 가져오지 못했습니다.');
      }
    }

    // 텍스트 항목
    const items: TItem[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue;
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
      if (!it.str.trim() && !it.str) continue;
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width || 0, size, font: it.fontName });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Line[] = [];
    for (const it of items) {
      let line = lines.find((l) => Math.abs(l.y - it.y) < Math.min(l.size, it.size) * 0.45);
      if (!line) {
        line = { y: it.y, x0: it.x, x1: it.x + it.w, size: it.size, items: [] };
        lines.push(line);
      }
      line.items.push(it);
      line.x0 = Math.min(line.x0, it.x);
      line.x1 = Math.max(line.x1, it.x + it.w);
      if (it.str.trim()) line.size = Math.max(line.size, it.size);
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      if (l.items.every((i) => !i.str.trim())) continue;
      flows.push({ kind: 'line', y: l.y + l.size * 0.8, line: l });
    }
    flows.sort((a, b) => b.y - a.y);

    const textLines = flows.filter((f) => f.kind === 'line').map((f) => (f as any).line as Line);
    const leftM = textLines.length ? percentile(textLines.map((l) => l.x0), 0.1) : 72;
    // 오른쪽 여백은 대개 왼쪽과 같다고 보고, 본문이 더 넓으면 그에 맞춘다
    const textRight = textLines.length ? percentile(textLines.map((l) => l.x1), 0.95) : pageW - 72;
    const sym = pageW - leftM;
    const beyond = textLines.filter((l) => l.x1 > sym + 6).length;
    const rightM = textLines.length && beyond > textLines.length * 0.3 ? Math.min(percentile(textLines.map((l) => l.x1), 0.9), pageW - 10) : sym;
    if (pi === 1 && textLines.length) {
      const topY = Math.max(...textLines.map((l) => l.y + l.size));
      const botY = Math.min(...textLines.map((l) => l.y));
      const pg = settings.page;
      pg.marginLeft = clampMm((leftM * 25.4) / 72);
      pg.marginRight = clampMm(((pageW - rightM) * 25.4) / 72);
      pg.marginTop = clampMm(((pageH - topY) * 25.4) / 72 - 3);
      pg.marginHeader = 0;
      pg.marginBottom = clampMm((botY * 25.4) / 72 - 3);
      pg.marginFooter = 0;
    }

    if (pi > 1) blocks.push({ type: 'pageBreak' });
    let cur: { inline: JNode[]; attrs: Record<string, any>; last: Line } | null = null;
    const flush = () => {
      if (cur) blocks.push(paragraph(cur.attrs, cur.inline));
      cur = null;
    };
    let prevBottomY: number | null = null;
    for (const f of flows) {
      if (f.kind === 'image') {
        flush();
        const center = Math.abs(f.x + (f.w * 72) / 96 / 2 - pageW / 2) < 30;
        blocks.push(paragraph(center ? { textAlign: 'center' } : {}, [{ type: 'image', attrs: { src: f.src, width: Math.round(f.w), height: Math.round(f.h) } }]));
        prevBottomY = f.y - (f.h * 72) / 96;
        continue;
      }
      const l = f.line;
      const inline = lineInline(l, fontInfo);
      const lineH = l.size * 1.2;
      const gap: number = prevBottomY == null ? 0 : prevBottomY - (l.y + l.size);
      const indent = l.x0 - leftM;
      const lineW = l.x1 - l.x0;
      const center =
        indent > l.size * 2 &&
        lineW < (rightM - leftM) * 0.9 &&
        (Math.abs(indent - (rightM - l.x1)) < l.size * 1.5 || Math.abs((l.x0 + l.x1) / 2 - pageW / 2) < l.size * 1.2);
      const right = !center && indent > (rightM - leftM) * 0.4 && (Math.abs(rightM - l.x1) < l.size * 1.5 || Math.abs(textRight - l.x1) < l.size * 1.5);
      const c = cur as { inline: JNode[]; attrs: Record<string, any>; last: Line } | null;
      const continues =
        c &&
        !center &&
        !right &&
        !c.attrs.textAlign &&
        Math.abs(c.last.size - l.size) < 0.6 &&
        gap < lineH * 0.9 &&
        c.last.x1 > rightM - l.size * 3 &&
        Math.abs(l.x0 - (leftM + (c.attrs.indentLeft || 0))) < l.size * 2.5;
      if (continues && c) {
        const lastText = c.inline[c.inline.length - 1];
        const needSpace = lastText && lastText.type === 'text' && !/[\s-]$/.test(lastText.text || '') && /^[A-Za-z0-9]/.test(firstText(inline)) && /[A-Za-z0-9.,]$/.test(lastText.text || '');
        if (needSpace || (lastText?.type === 'text' && /[가-힣.,)]$/.test(lastText.text || '') && /^[가-힣(]/.test(firstText(inline)))) c.inline.push({ type: 'text', text: ' ' });
        c.inline.push(...inline);
        c.last = l;
      } else {
        flush();
        const attrs: Record<string, any> = {};
        if (center) attrs.textAlign = 'center';
        else if (right) attrs.textAlign = 'right';
        else if (indent > 3) attrs.indentLeft = round(indent, 1);
        if (gap > lineH * 0.8) attrs.spaceBefore = round(Math.min(gap - lineH * 0.3, 40), 1);
        const sz = Math.round(l.size * 2) / 2;
        if (sz !== 10) attrs.fontSize = sz;
        cur = { inline, attrs, last: l };
      }
      prevBottomY = l.y - l.size * 0.25;
    }
    flush();
    page.cleanup?.();
  }
  if (imgCount === 0 && blocks.every((b) => !b.content)) warnings.push('텍스트가 없는 PDF입니다 (스캔 이미지일 수 있음).');
  return { content: docNode(blocks), settings, meta, warnings };
}

function firstText(inline: JNode[]): string {
  const t = inline.find((i) => i.type === 'text');
  return t?.text || '';
}

function lineInline(l: Line, fonts: Map<string, { family: string | null; bold: boolean; italic: boolean }>): JNode[] {
  const out: JNode[] = [];
  let prev: TItem | null = null;
  for (const it of l.items) {
    let text = it.str;
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (gap > it.size * 0.22 && !/\s$/.test(prev.str) && !/^\s/.test(text)) text = (gap > it.size * 2.5 ? '\t' : ' ') + text;
    }
    prev = it;
    if (!text) continue;
    const fi = fonts.get(it.font);
    const marks: JMark[] = [];
    const ts: Record<string, any> = { fontSize: Math.round(it.size * 2) / 2 };
    if (fi?.family) ts.fontFamily = fi.family;
    marks.push({ type: 'textStyle', attrs: ts });
    if (fi?.bold) marks.push({ type: 'bold' });
    if (fi?.italic) marks.push({ type: 'italic' });
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.marks) === JSON.stringify(marks)) last.text += text;
    else out.push({ type: 'text', text, marks });
  }
  return out;
}

function percentile(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}

function clampMm(v: number) {
  return round(Math.max(5, Math.min(60, v)), 1);
}

function getObj(page: any, id: string): Promise<any> {
  return new Promise((resolve) => {
    try {
      if (page.objs.has(id)) return resolve(page.objs.get(id));
      page.objs.get(id, (o: any) => resolve(o));
      setTimeout(() => resolve(null), 3000);
    } catch {
      resolve(null);
    }
  });
}

function imageToDataUrl(img: any): string | null {
  if (!img) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (img.bitmap) {
    canvas.width = img.bitmap.width;
    canvas.height = img.bitmap.height;
    ctx.drawImage(img.bitmap, 0, 0);
  } else if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  } else if (img.data && img.width && img.height) {
    canvas.width = img.width;
    canvas.height = img.height;
    const id = ctx.createImageData(img.width, img.height);
    const src = img.data as Uint8ClampedArray;
    const n = img.width * img.height;
    if (src.length === n * 4) id.data.set(src);
    else if (src.length === n * 3) {
      for (let i = 0, j = 0; i < n; i++) {
        id.data[j++] = src[i * 3];
        id.data[j++] = src[i * 3 + 1];
        id.data[j++] = src[i * 3 + 2];
        id.data[j++] = 255;
      }
    } else if (src.length === n) {
      for (let i = 0, j = 0; i < n; i++) {
        id.data[j++] = src[i];
        id.data[j++] = src[i];
        id.data[j++] = src[i];
        id.data[j++] = 255;
      }
    } else {
      // 1비트 흑백 등
      const rowBytes = Math.ceil(img.width / 8);
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0;
          const k = (y * img.width + x) * 4;
          id.data[k] = id.data[k + 1] = id.data[k + 2] = v;
          id.data[k + 3] = 255;
        }
    }
    ctx.putImageData(id, 0, 0);
  } else return null;
  return canvas.toDataURL(canvas.width * canvas.height > 1200 * 1200 ? 'image/jpeg' : 'image/png', 0.9);
}
