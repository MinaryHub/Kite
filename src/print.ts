import type { DocSettings } from './types';
import type { DocTab } from './doc/docTab';
import { PX_PER_MM, formatPageNumber, xmlEscape } from './formats/common';
import { FN_FONT_PX, FN_LINE, FN_SEP } from './editor/extensions/pagination';

export const PAGE_GAP = 18;

export interface PageGeom {
  wMm: number;
  hMm: number;
  W: number;
  H: number;
  /** 본문 시작(위쪽 + 머리말) */
  mt: number;
  /** 본문 끝 아래(아래쪽 + 꼬리말) */
  mb: number;
  ml: number;
  mr: number;
  contentW: number;
  contentH: number;
  gap: number;
  P: number;
}

export function computeGeom(s: DocSettings, gap = PAGE_GAP): PageGeom {
  const p = s.page;
  const wMm = p.landscape ? Math.max(p.width, p.height) : p.width;
  const hMm = p.landscape ? Math.min(p.width, p.height) : p.height;
  const W = wMm * PX_PER_MM;
  const H = hMm * PX_PER_MM;
  const mt = (p.marginTop + p.marginHeader) * PX_PER_MM;
  const mb = (p.marginBottom + p.marginFooter) * PX_PER_MM;
  const ml = (p.marginLeft + p.gutter) * PX_PER_MM;
  const mr = p.marginRight * PX_PER_MM;
  return {
    wMm,
    hMm,
    W,
    H,
    mt,
    mb,
    ml,
    mr,
    contentW: Math.max(40, W - ml - mr),
    contentH: Math.max(40, H - mt - mb),
    gap,
    P: H + gap,
  };
}

export function hfText(text: string, page: number, pages: number, fmt: string): string {
  return text.replace(/\{\{PAGE\}\}/g, formatPageNumber(page, fmt === 'dash' ? 'digit' : fmt)).replace(/\{\{PAGES\}\}/g, String(pages));
}

/** 머리말/꼬리말 영역 위치 (px) */
export function hfZones(s: DocSettings, g: PageGeom) {
  const p = s.page;
  const minH = 6 * PX_PER_MM;
  let hTop = p.marginTop * PX_PER_MM;
  let hH = p.marginHeader * PX_PER_MM;
  if (hH < minH) {
    hH = minH;
    hTop = Math.max(2 * PX_PER_MM, g.mt - minH);
  }
  let fTop = g.H - g.mb;
  let fH = p.marginFooter * PX_PER_MM;
  if (fH < minH) {
    fH = minH;
    fTop = Math.min(g.H - minH - 2 * PX_PER_MM, g.H - g.mb);
  }
  return { header: { top: hTop, height: hH }, footer: { top: fTop, height: fH } };
}

/** k 번째 쪽의 배경 그림 스타일 (PDF 에서 온 쪽 바탕 그림) — 없거나 이상하면 null */
export function pageBackgroundStyle(s: DocSettings, k: number, dy = 0): Record<string, string> | null {
  const b = s.pageBackgrounds?.[k];
  if (!b || typeof b.src !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(b.src)) return null;
  const n = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
  const x = n(b.x), y = n(b.y), w = n(b.w), h = n(b.h);
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
  const px = 96 / 72;
  return {
    backgroundImage: `url("${b.src}")`,
    // dy: 이 요소가 쪽 위끝에서 떨어진 거리(px) — 쪽 경계 가리개에도 같은 배경을 이어 그린다
    backgroundPosition: `${x * px}px ${y * px - dy}px`,
    backgroundSize: `${w * px}px ${h * px}px`,
    backgroundRepeat: 'no-repeat',
  };
}

/** 한 쪽의 머리말/꼬리말/쪽 번호/각주 HTML */
export function pageChromeHtml(tab: DocTab, g: PageGeom, k: number, pageCount: number): string {
  const s = tab.settings;
  const z = hfZones(s, g);
  const num = s.pageNumber.start + k;
  const total = pageCount + s.pageNumber.start - 1;
  let html = '';
  const zone = (def: { text: string; align: string }, top: number, height: number, valign: string) => {
    if (!def.text.trim()) return '';
    return `<div style="position:absolute;left:${g.ml}px;width:${g.contentW}px;top:${top}px;height:${height}px;display:flex;align-items:${valign};justify-content:${def.align === 'left' ? 'flex-start' : def.align === 'right' ? 'flex-end' : 'center'};font-family:'함초롬바탕','HCR Batang','바탕',serif;font-size:9pt;white-space:pre;overflow:hidden">${xmlEscape(hfText(def.text, num, total, s.pageNumber.format))}</div>`;
  };
  html += zone(s.header, z.header.top, z.header.height, 'flex-start');
  html += zone(s.footer, z.footer.top, z.footer.height, 'flex-end');
  if (s.pageNumber.pos !== 'none') {
    const [v, h] = s.pageNumber.pos.split('-');
    const zz = v === 'top' ? z.header : z.footer;
    html += `<div style="position:absolute;left:${g.ml}px;width:${g.contentW}px;top:${zz.top}px;height:${zz.height}px;display:flex;align-items:${v === 'top' ? 'flex-start' : 'flex-end'};justify-content:${h === 'left' ? 'flex-start' : h === 'right' ? 'flex-end' : 'center'};font-family:'함초롬바탕','HCR Batang','바탕',serif;font-size:9pt">${xmlEscape(formatPageNumber(num, s.pageNumber.format))}</div>`;
  }
  const fns = tab.layout.footnotes.filter((f) => f.page === k);
  if (fns.length) {
    html += `<div style="position:absolute;left:${g.ml}px;width:${g.contentW}px;bottom:${g.mb}px;font-family:'함초롬바탕','HCR Batang','바탕',serif;font-size:${FN_FONT_PX}px;line-height:${FN_LINE}">`;
    html += `<div style="width:35%;border-top:1px solid #000;height:${FN_SEP}px"></div>`;
    for (const f of fns) html += `<div style="padding-left:1.6em;text-indent:-1.6em;word-break:keep-all">${f.num}) ${xmlEscape(f.text)}</div>`;
    html += '</div>';
  }
  return html;
}

export interface PageBox {
  el: HTMLElement;
  top: number;
  bottom: number;
}

/** 편집기 최상위 블록들의 세로 위치 (쪽 나누기 공간은 제외) */
export function collectPageBoxes(root: HTMLElement): PageBox[] {
  const children = Array.from(root.children) as HTMLElement[];
  return children
    .filter((el) => !el.classList.contains('pg-spacer') && !el.classList.contains('ProseMirror-gapcursor'))
    .map((el) => ({ el, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }));
}

/** k 번째 쪽: 편집 화면의 블록 사본을 쪽 안 자리에 놓고 머리말·꼬리말·쪽 번호·각주를 붙인다 */
export function buildPrintPage(tab: DocTab, g: PageGeom, k: number, boxes: PageBox[], pageCount: number): HTMLElement {
  const page = document.createElement('div');
  page.className = 'print-page';
  page.style.width = `${g.wMm}mm`;
  page.style.height = `${g.hMm}mm`;
  const bg = pageBackgroundStyle(tab.settings, k);
  if (bg) Object.assign(page.style, bg);
  const body = document.createElement('div');
  body.className = 'print-body';
  Object.assign(body.style, { left: `${g.ml}px`, top: `${g.mt}px`, width: `${g.contentW}px`, height: `${g.contentH}px` });
  const content = document.createElement('div');
  content.className = 'kdoc-content';
  Object.assign(content.style, { position: 'relative', width: `${g.contentW}px`, height: `${g.contentH}px` });
  const y0 = k * g.P;
  const y1 = y0 + g.contentH;
  for (const b of boxes) {
    if (b.bottom <= y0 || b.top >= y1) continue;
    const clone = b.el.cloneNode(true) as HTMLElement;
    clone.style.position = 'absolute';
    clone.style.top = `${b.top - y0}px`;
    clone.style.left = '0';
    clone.style.right = '0';
    clone.classList.remove('pg-measuring');
    clone.querySelectorAll('.selectedCell').forEach((e) => e.classList.remove('selectedCell'));
    clone.querySelectorAll('.search-match').forEach((e) => e.classList.remove('search-match', 'current'));
    content.appendChild(clone);
  }
  body.appendChild(content);
  page.appendChild(body);
  const chrome = document.createElement('div');
  chrome.innerHTML = pageChromeHtml(tab, g, k, pageCount);
  while (chrome.firstChild) page.appendChild(chrome.firstChild);
  return page;
}

/** 편집 화면의 배치를 그대로 쪽 단위로 잘라 인쇄용 DOM을 만든다 */
export function buildPrintPages(tab: DocTab, g: PageGeom): HTMLElement[] {
  const boxes = collectPageBoxes(tab.editor.view.dom as HTMLElement);
  const pageCount = Math.max(1, tab.layout.pageCount);
  const pages: HTMLElement[] = [];
  for (let k = 0; k < pageCount; k++) pages.push(buildPrintPage(tab, g, k, boxes, pageCount));
  return pages;
}

async function waitImages(el: HTMLElement) {
  const imgs = Array.from(el.querySelectorAll('img'));
  await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {}))));
}

export async function withPrintRoot<T>(tab: DocTab, fn: (g: PageGeom) => Promise<T>): Promise<T> {
  const g = computeGeom(tab.settings);
  document.getElementById('print-root')?.remove();
  document.getElementById('print-style')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  for (const p of buildPrintPages(tab, g)) root.appendChild(p);
  const style = document.createElement('style');
  style.id = 'print-style';
  style.textContent = `@page { size: ${g.wMm}mm ${g.hMm}mm; margin: 0; }`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  await waitImages(root);
  try {
    return await fn(g);
  } finally {
    root.remove();
    style.remove();
  }
}
