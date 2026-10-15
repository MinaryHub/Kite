import type { LoadedDoc } from '../../types';
import { DEFAULT_FONT, type JNode, defaultSettings, docNode, paragraph, round } from '../common';
import { fontStack } from '../../fonts';
import { type FontInfo, type PageContent, type PdfImage, extractPage } from './extract';
import { type LayoutCtx, analyzePage, contentBounds, renderContainer, stripPageNumber, typicalLineRatio } from './layout';

/**
 * PDF 불러오기: pdf.js 의 그리기 명령을 해석해 글자(글꼴·크기·색·굵기), 채운 사각형, 선, 그림을 얻고
 * 표 격자·배경 상자·줄 간격을 재구성한다. (PDF는 편집용 구조가 없으므로 완벽한 복원은 불가능하다.)
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

export async function readPdf(data: Uint8Array, onProgress?: (p: number) => void): Promise<LoadedDoc> {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, useSystemFonts: true, fontExtraProperties: true, maxImageSize: 50_000_000 }).promise;
  return convertPdf(pdf, pdfjs.OPS, (page, img) => loadImage(page, img), onProgress);
}

/** pdf.js 문서 → 편집 문서 (테스트에서도 쓰도록 분리) */
export async function convertPdf(pdf: any, OPS: Record<string, number>, imageSrc: (page: any, img: PdfImage) => Promise<string | null>, onProgress?: (p: number) => void): Promise<LoadedDoc> {
  const settings = defaultSettings();
  const warnings: string[] = [];
  let meta: any = {};
  try {
    const m = await pdf.getMetadata();
    meta = { title: m.info?.Title || undefined, author: m.info?.Author || undefined, subject: m.info?.Subject || undefined };
  } catch {
    /* 무시 */
  }

  // 1단계: 모든 페이지 분석 (여백을 문서 전체로 맞추기 위해)
  const pages: { page: any; pc: PageContent; an: ReturnType<typeof analyzePage>; bounds: { x0: number; x1: number; y0: number; y1: number } | null }[] = [];
  let imgCount = 0;
  const pageNums: { pi: number; n: number; dash: boolean; pos: 'bottom-center' | 'top-center' }[] = [];
  for (let pi = 1; pi <= pdf.numPages; pi++) {
    onProgress?.((pi / pdf.numPages) * 0.6);
    const page = await pdf.getPage(pi);
    const vp = page.getViewport({ scale: 1 });
    let pc: PageContent;
    try {
      const ops = await page.getOperatorList();
      pc = extractPage(ops, OPS, (id) => fontOf(page, id), vp);
    } catch {
      warnings.push(`${pi}쪽 내용을 읽지 못했습니다.`);
      pc = { width: vp.width, height: vp.height, glyphs: [], fills: [], segs: [], images: [] };
    }
    imgCount += pc.images.length;
    const an = analyzePage(pc);
    const num = stripPageNumber(an.pageC, pc.height);
    if (num) pageNums.push({ pi, ...num });
    pages.push({ page, pc, an, bounds: contentBounds(an.pageC, an.underlined) });
  }

  const first = pages[0];
  const pageW = first ? first.pc.width : 595;
  const pageH = first ? first.pc.height : 842;
  {
    const wmm = (pageW * 25.4) / 72;
    const hmm = (pageH * 25.4) / 72;
    settings.page.landscape = wmm > hmm;
    settings.page.width = round(Math.min(wmm, hmm), 1);
    settings.page.height = round(Math.max(wmm, hmm), 1);
  }
  // 여백: 페이지들의 내용 범위에서
  const bs = pages.map((p) => p.bounds).filter(Boolean) as { x0: number; x1: number; y0: number; y1: number }[];
  let left = 56;
  let right = pageW - 56;
  let top = 56;
  let bottom = pageH - 56;
  if (bs.length) {
    left = percentileOf(bs.map((b) => b.x0), 0.2);
    right = percentileOf(bs.map((b) => b.x1), 0.8);
    top = Math.min(...bs.map((b) => b.y0));
    bottom = Math.max(...bs.map((b) => b.y1));
    // 오른쪽 여백은 왼쪽과 비슷하게(본문이 짧게 끝난 페이지 때문에 좁아지지 않도록)
    if (right < pageW - left) right = Math.max(right, Math.min(pageW - left, Math.max(...bs.map((b) => b.x1))));
    if (right < pageW - left - 30) right = pageW - left;
  }
  // 쪽 번호가 대부분의 페이지에 있으면 문서의 쪽 번호 설정으로 바꾼다
  if (pages.length > 1 && pageNums.length >= pages.length * 0.6) {
    const f = pageNums[0];
    settings.pageNumber = { pos: f.pos, format: f.dash ? 'dash' : 'digit', start: Math.max(1, f.n - (f.pi - 1)) };
  }
  const pg = settings.page;
  const ptmm = (v: number) => (v * 25.4) / 72;
  pg.marginLeft = clampMm(ptmm(left) - 0.5);
  pg.marginRight = clampMm(ptmm(pageW - right) - 0.5);
  pg.marginTop = clampMm(ptmm(top) - 1);
  pg.marginHeader = 0;
  // 대체 글꼴 등으로 조금 길어져도 다음 쪽으로 넘치지 않도록 아래 여백에 여유를 둔다
  pg.marginBottom = clampMm(Math.min(ptmm(pageH - bottom) - 6, 20));
  pg.marginFooter = 0;
  const L = (pg.marginLeft * 72) / 25.4;
  const R = pageW - (pg.marginRight * 72) / 25.4;
  const T = (pg.marginTop * 72) / 25.4;

  // 2단계: 페이지별 블록
  const blocks: JNode[] = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(0.6 + ((i + 1) / pages.length) * 0.4);
    const { page, pc, an } = pages[i];
    const ctx: LayoutCtx = { imageSrc: (img) => imageSrc(page, img), lineRatio: typicalLineRatio(pc.glyphs), measure: measurer() };
    let res;
    // 글자가 거의 없는 페이지(글자를 그림/도형으로 그린 표지·설명서 등)는 페이지 전체를 그림으로
    const realText = pc.glyphs.filter((g) => !g.invisible && /[\p{L}\p{N}]/u.test(g.ch)).length;
    if (realText < 15 && (pc.images.length || pc.fills.length || pc.segs.length > 10)) {
      const src = await imageSrc(page, { x0: 0, y0: 0, x1: pc.width, y1: pc.height, ref: null });
      if (src) {
        const s = Math.min((R - L) / pc.width, (pageH - T - (pg.marginBottom * 72) / 25.4) / pc.height) * 0.99;
        const img: JNode = { type: 'image', attrs: { src, width: Math.round(pc.width * s * (96 / 72)), height: Math.round(pc.height * s * (96 / 72)) } };
        if (i > 0) blocks.push({ type: 'pageBreak' });
        blocks.push(paragraph({ textAlign: 'center', lineHeight: `${round(pc.height * s + 2, 1)}pt` }, [img]));
        page.cleanup?.();
        continue;
      }
    }
    try {
      res = await renderContainer(an.pageC, { x0: L, y0: T, x1: R, y1: pc.height }, ctx, an.underlined, T);
    } catch (e) {
      warnings.push(`${i + 1}쪽 배치를 재구성하지 못했습니다.`);
      res = { blocks: [] as JNode[], endY: T };
    }
    if (i > 0) blocks.push({ type: 'pageBreak' });
    blocks.push(...res.blocks);
    page.cleanup?.();
  }
  if (imgCount === 0 && pages.every((p) => !p.pc.glyphs.length)) warnings.push('텍스트가 없는 PDF입니다 (스캔 이미지일 수 있음).');
  return { content: docNode(blocks.length ? blocks : [paragraph()]), settings, meta, warnings };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** 화면 글꼴로 글자 폭(pt)을 재는 함수 (캔버스가 없으면 undefined) */
function measurer(): LayoutCtx['measure'] {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      measureCtx = null;
    }
  }
  const mc = measureCtx;
  if (!mc) return undefined;
  const cache = new Map<string, number>();
  return (text, family, sizePt, bold, italic) => {
    const font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${sizePt}pt ${fontStack(family || DEFAULT_FONT)}`;
    const key = font + '|' + text;
    let w = cache.get(key);
    if (w == null) {
      mc.font = font;
      w = (mc.measureText(text).width * 72) / 96;
      cache.set(key, w);
    }
    return w;
  };
}

function fontOf(page: any, id: string): FontInfo | null {
  try {
    const o = page.commonObjs.has(id) ? page.commonObjs.get(id) : null;
    if (!o) return null;
    return { name: o.name || o.loadedName || '', bold: !!(o.bold || o.black), italic: !!o.italic, fontMatrix: o.fontMatrix || [0.001, 0, 0, 0.001, 0, 0], vertical: !!o.vertical };
  } catch {
    return null;
  }
}

const pageRenders = new WeakMap<any, Promise<HTMLCanvasElement | null>>();

/** 그림 객체를 직접 못 읽으면 페이지를 그려서 그 영역을 잘라 쓴다 */
function renderPage(page: any): Promise<HTMLCanvasElement | null> {
  let p = pageRenders.get(page);
  if (!p) {
    p = (async () => {
      try {
        const vp = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
        return canvas;
      } catch {
        return null;
      }
    })();
    pageRenders.set(page, p);
  }
  return p;
}

async function loadImage(page: any, img: PdfImage): Promise<string | null> {
  try {
    const obj = typeof img.ref === 'string' ? await getObj(page, img.ref) : img.ref;
    const url = imageToDataUrl(obj);
    if (url && url.length > 100) return url;
  } catch {
    /* 아래에서 다시 */
  }
  const canvas = await renderPage(page);
  if (!canvas) return null;
  const s = 2;
  const w = Math.max(1, Math.round((img.x1 - img.x0) * s));
  const h = Math.max(1, Math.round((img.y1 - img.y0) * s));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(canvas, Math.round(img.x0 * s), Math.round(img.y0 * s), w, h, 0, 0, w, h);
  return out.toDataURL(w * h > 1200 * 1200 ? 'image/jpeg' : 'image/png', 0.9);
}

function percentileOf(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)))];
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
  if (!canvas.width || !canvas.height) return null;
  return canvas.toDataURL(canvas.width * canvas.height > 1200 * 1200 ? 'image/jpeg' : 'image/png', 0.9);
}
