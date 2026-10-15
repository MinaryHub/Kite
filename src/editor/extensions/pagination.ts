import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { viewState } from '../viewState';

/**
 * 쪽 나누기(페이지네이션) 엔진.
 *
 * 편집기는 하나의 연속된 ProseMirror 문서이고, 쪽 경계에 걸리는 블록/표 줄/문단 줄 앞에
 * 빈 공간(위젯 데코레이션)을 끼워 넣어 다음 쪽 본문 시작 위치로 밀어낸다.
 * 측정은 항상 "공간을 뺀 자연 배치" 상태에서 수행하므로 결과가 안정적이다.
 */

export interface PageGeometry {
  /** 용지 높이(px) */
  pageHeight: number;
  /** 쪽 사이 간격(px) */
  gap: number;
  /** 본문 높이(px) = 용지 높이 - (위쪽+머리말) - (아래쪽+꼬리말) */
  contentHeight: number;
  /** 본문 폭(px) */
  contentWidth: number;
}

export interface PageBreakInfo {
  pos: number;
  height: number;
  kind: 'block' | 'row' | 'line';
}

export interface FootnoteInfo {
  num: number;
  page: number;
  text: string;
  pos: number;
}

export interface LayoutResult {
  pageCount: number;
  footnotes: FootnoteInfo[];
  /** 각 쪽의 시작 문서 위치 (쪽 이동용) */
  pageStarts: number[];
}

interface PState {
  breaks: PageBreakInfo[];
  decos: DecorationSet;
}

export const paginationKey = new PluginKey<PState>('pagination');

export const FN_FONT_PX = 12; // 9pt
export const FN_LINE = 1.5;
export const FN_SEP = 14;

export function estimateFootnoteHeight(text: string, width: number): number {
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? FN_FONT_PX : FN_FONT_PX * 0.55;
  const lines = Math.max(1, Math.ceil((w + 28) / Math.max(50, width)));
  return Math.ceil(lines * FN_FONT_PX * FN_LINE + 2);
}

function buildDecos(doc: PMNode, breaks: PageBreakInfo[]): DecorationSet {
  const decos: Decoration[] = [];
  for (const b of breaks) {
    if (b.kind === 'row') {
      const node = doc.nodeAt(b.pos);
      if (!node || node.type.name !== 'tableRow') continue;
      decos.push(Decoration.node(b.pos, b.pos + node.nodeSize, { class: 'pg-push-row', style: `--pg-push: ${b.height}px` }));
      continue;
    }
    const block = b.kind === 'block';
    decos.push(
      Decoration.widget(
        b.pos,
        () => {
          const el = document.createElement(block ? 'div' : 'span');
          el.className = block ? 'pg-spacer' : 'pg-spacer pg-line-spacer';
          el.style.height = b.height + 'px';
          el.contentEditable = 'false';
          return el;
        },
        { side: -1, key: `pg-${b.kind}-${b.pos}-${b.height}`, ignoreSelection: true, marks: [] },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

const CONTAINERS = new Set(['bulletList', 'orderedList', 'listItem', 'blockquote', 'taskList', 'taskItem']);

function sameBreaks(a: PageBreakInfo[], b: PageBreakInfo[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].kind !== b[i].kind || Math.abs(a[i].height - b[i].height) > 0.6) return false;
  }
  return true;
}

interface Line {
  top: number;
  bottom: number;
}

function computeLayout(view: EditorView, g: PageGeometry): { breaks: PageBreakInfo[]; result: LayoutResult } | null {
  const root = view.dom as HTMLElement;
  const s = viewState.zoom || 1;
  const rootRect = root.getBoundingClientRect();
  const rootTop = rootRect.top;
  const rel = (y: number) => (y - rootTop) / s;
  const P = g.pageHeight + g.gap;
  const CH = g.contentHeight;

  let page = 0;
  let shift = 0;
  let fnUsed = 0;
  let forceNext = false;
  let lastBottom = 0;
  const breaks: PageBreakInfo[] = [];
  const footnotes: FootnoteInfo[] = [];
  const pageStarts: number[] = [0];

  // 각주 번호 매기기 (문서 순서)
  const refEls = Array.from(root.querySelectorAll('sup.footnote-ref')) as HTMLElement[];
  const refNum = new Map<HTMLElement, number>();
  refEls.forEach((el, i) => {
    refNum.set(el, i + 1);
    if (el.textContent !== String(i + 1)) el.textContent = String(i + 1);
  });

  const MAX_PAGES = 20000;
  const normalize = (top: number) => {
    if (!isFinite(top)) return;
    const target = Math.floor((top + 0.5) / P);
    if (target > page) {
      page = Math.min(target, MAX_PAGES);
      fnUsed = 0;
    }
  };
  const limitFor = (fnH: number) => page * P + CH - fnUsed - (fnH > 0 && fnUsed === 0 ? FN_SEP : 0) - fnH;

  const markPageStart = (docPos: number) => {
    while (pageStarts.length <= page && pageStarts.length < MAX_PAGES) pageStarts.push(docPos);
  };

  /** 단위(블록/줄/표 줄) 배치. 넘치면 다음 쪽으로 민다. */
  const place = (
    top: number,
    bottom: number,
    fnH: number,
    getPos: () => number | null,
    kind: PageBreakInfo['kind'],
    docPos: number,
  ) => {
    if (!isFinite(top) || !isFinite(bottom)) return;
    top += shift;
    bottom += shift;
    normalize(top);
    const pageTop = page * P;
    const overflow = bottom > limitFor(fnH) + 0.5 || top > pageTop + CH;
    if ((forceNext || overflow) && (forceNext || top > pageTop + 0.5)) {
      const pos = getPos();
      if (pos != null) {
        const h = Math.round(((page + 1) * P - top) * 100) / 100;
        if (h > 0) {
          breaks.push({ pos, height: h, kind });
          shift += h;
          top += h;
          bottom += h;
        }
        page++;
        fnUsed = 0;
        normalize(top);
      }
    }
    forceNext = false;
    markPageStart(docPos);
    if (fnH > 0) fnUsed += fnH + (fnUsed === 0 ? FN_SEP : 0);
    if (bottom > page * P + CH + 0.5) {
      const endPage = Math.min(MAX_PAGES, Math.floor((bottom - 0.5) / P));
      if (endPage > page) {
        page = endPage;
        fnUsed = 0;
        markPageStart(docPos);
      }
    }
    lastBottom = Math.max(lastBottom, bottom);
  };

  const collectFootnotes = (el: HTMLElement, pos: number) => {
    const out: { top: number; h: number; num: number; text: string }[] = [];
    el.querySelectorAll('sup.footnote-ref').forEach((ref) => {
      const r = (ref as HTMLElement).getBoundingClientRect();
      const text = ref.getAttribute('data-footnote') || '';
      out.push({ top: rel(r.top), h: estimateFootnoteHeight(text, g.contentWidth), num: refNum.get(ref as HTMLElement) || 0, text });
    });
    return out.map((f) => ({ ...f, pos }));
  };

  const pushFootnotes = (fns: { num: number; text: string; pos: number }[]) => {
    for (const f of fns) footnotes.push({ num: f.num, text: f.text, page, pos: f.pos });
  };

  const getLines = (el: HTMLElement): Line[] => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.height > 0.5)
      .map((r) => ({ top: rel(r.top), bottom: rel(r.bottom) }))
      .sort((a, b) => a.top - b.top);
    const lines: Line[] = [];
    for (const r of rects) {
      const cur = lines[lines.length - 1];
      if (cur) {
        const overlap = Math.min(cur.bottom, r.bottom) - Math.max(cur.top, r.top);
        const minH = Math.min(cur.bottom - cur.top, r.bottom - r.top);
        if (overlap > minH * 0.5) {
          cur.top = Math.min(cur.top, r.top);
          cur.bottom = Math.max(cur.bottom, r.bottom);
          continue;
        }
      }
      lines.push({ ...r });
    }
    return lines;
  };

  const posAtLineStart = (el: HTMLElement, line: Line, from: number, to: number): number | null => {
    const er = el.getBoundingClientRect();
    const midY = rootTop + ((line.top + line.bottom) / 2) * s;
    const res = view.posAtCoords({ left: er.left + 1, top: midY });
    if (!res) return null;
    let p = res.pos;
    for (let tries = 0; tries < 3; tries++) {
      if (p <= from || p >= to) return null;
      try {
        const c = view.coordsAtPos(p, 1);
        const ct = rel(c.top);
        if (ct >= line.top - 3) return p;
      } catch {
        return null;
      }
      p++;
    }
    return null;
  };

  const handleTextblock = (node: PMNode, pos: number) => {
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect();
    const top = rel(r.top);
    const bottom = rel(r.bottom);
    const fns = collectFootnotes(el, pos);
    const fnTotal = fns.reduce((a, f) => a + f.h, 0);

    // 그대로 들어가는지 확인
    const sTop = top + shift;
    const sBottom = bottom + shift;
    let p = page;
    while (sTop >= (p + 1) * P - 0.5) p++;
    const fnUsedHere = p === page ? fnUsed : 0;
    const limit = p * P + CH - fnUsedHere - (fnTotal > 0 && fnUsedHere === 0 ? FN_SEP : 0) - fnTotal;
    if (forceNext || sBottom <= limit + 0.5) {
      place(top, bottom, fnTotal, () => pos, 'block', pos);
      pushFootnotes(fns);
      return;
    }
    const lines = getLines(el);
    if (lines.length < 2) {
      place(top, bottom, fnTotal, () => pos, 'block', pos);
      pushFootnotes(fns);
      return;
    }
    const n = lines.length;
    for (let i = 0; i < n; i++) {
      const uTop = i === 0 ? top : (lines[i - 1].bottom + lines[i].top) / 2;
      const uBottom = i === n - 1 ? bottom : (lines[i].bottom + lines[i + 1].top) / 2;
      const lineFns = fns.filter((f) => f.top >= uTop - 1 && f.top < uBottom);
      const fnH = lineFns.reduce((a, f) => a + f.h, 0);
      if (i === 0) {
        place(uTop, uBottom, fnH, () => pos, 'block', pos);
      } else {
        const line = lines[i];
        place(uTop, uBottom, fnH, () => posAtLineStart(el, line, pos, pos + node.nodeSize), 'line', pos);
      }
      pushFootnotes(lineFns);
    }
  };

  const handleTable = (node: PMNode, pos: number) => {
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect();
    const top = rel(r.top);
    const bottom = rel(r.bottom);
    const fns = collectFootnotes(el, pos);
    const fnTotal = fns.reduce((a, f) => a + f.h, 0);
    const sBottom = bottom + shift;
    let p = page;
    while (top + shift >= (p + 1) * P - 0.5) p++;
    const fnUsedHere = p === page ? fnUsed : 0;
    if (forceNext || sBottom <= p * P + CH - fnUsedHere - fnTotal - (fnTotal ? FN_SEP : 0) + 0.5) {
      place(top, bottom, fnTotal, () => pos, 'block', pos);
      pushFootnotes(fns);
      return;
    }
    const rows: { pos: number; el: HTMLElement }[] = [];
    node.forEach((row, offset) => {
      const rp = pos + 1 + offset;
      const re = view.nodeDOM(rp) as HTMLElement | null;
      if (re instanceof HTMLElement) rows.push({ pos: rp, el: re });
    });
    if (!rows.length) {
      place(top, bottom, fnTotal, () => pos, 'block', pos);
      return;
    }
    rows.forEach((row, i) => {
      const rr = row.el.getBoundingClientRect();
      const uTop = i === 0 ? top : rel(rr.top);
      const uBottom = i === rows.length - 1 ? bottom : rel(rr.bottom);
      const rowFns = collectFootnotes(row.el, pos);
      const fnH = rowFns.reduce((a, f) => a + f.h, 0);
      if (i === 0) place(uTop, uBottom, fnH, () => pos, 'block', pos);
      else place(uTop, uBottom, fnH, () => row.pos, 'row', row.pos);
      pushFootnotes(rowFns);
    });
  };

  const handleOther = (pos: number) => {
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect();
    const fns = collectFootnotes(el, pos);
    place(rel(r.top), rel(r.bottom), fns.reduce((a, f) => a + f.h, 0), () => pos, 'block', pos);
    pushFootnotes(fns);
  };

  const walk = (parent: PMNode, base: number) => {
    parent.forEach((child, offset) => {
      const pos = base + offset;
      const name = child.type.name;
      if (name === 'pageBreak') {
        forceNext = true;
        return;
      }
      if (child.isTextblock) handleTextblock(child, pos);
      else if (name === 'table') handleTable(child, pos);
      else if (CONTAINERS.has(name)) walk(child, pos + 1);
      else handleOther(pos);
    });
  };

  walk(view.state.doc, 0);

  let pageCount = Math.max(page + 1, Math.floor(Math.max(0, lastBottom - 0.5) / P) + 1);
  if (forceNext) pageCount = Math.max(pageCount, page + 2);
  pageCount = Math.min(pageCount, MAX_PAGES);
  while (pageStarts.length < pageCount) pageStarts.push(view.state.doc.content.size);
  return { breaks, result: { pageCount, footnotes, pageStarts } };
}

export interface PaginationStorage {
  geometry: PageGeometry | null;
  result: LayoutResult;
  listeners: Set<(r: LayoutResult) => void>;
  schedule: () => void;
  enabled: boolean;
}

export const Pagination = Extension.create<{}, PaginationStorage>({
  name: 'pagination',

  addStorage() {
    return {
      geometry: null,
      result: { pageCount: 1, footnotes: [], pageStarts: [0] },
      listeners: new Set(),
      schedule: () => {},
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<PState>({
        key: paginationKey,
        state: {
          init: () => ({ breaks: [], decos: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(paginationKey) as PageBreakInfo[] | undefined;
            if (meta) return { breaks: meta, decos: buildDecos(tr.doc, meta) };
            if (tr.docChanged) {
              return {
                breaks: value.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos, b.kind === 'line' ? 1 : -1) })),
                decos: value.decos.map(tr.mapping, tr.doc),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state)?.decos;
          },
        },
        view(view) {
          let raf = 0;
          let destroyed = false;
          let lastResultKey = '';
          let runsSinceDocChange = 0;
          let lastDoc: PMNode | null = null;

          const run = () => {
            raf = 0;
            if (view.state.doc !== lastDoc) {
              lastDoc = view.state.doc;
              runsSinceDocChange = 0;
            }
            // 배치가 수렴하지 않으면(이론상 없어야 함) 문서가 바뀔 때까지 중단
            if (runsSinceDocChange > 6) return;
            if (destroyed || !storage.geometry || !storage.enabled) return;
            const root = view.dom as HTMLElement;
            if (!root.isConnected || root.offsetParent === null) return;
            if (view.composing) return;
            root.classList.add('pg-measuring');
            let out: ReturnType<typeof computeLayout> = null;
            const t0 = performance.now();
            try {
              out = computeLayout(view, storage.geometry);
            } catch (e) {
              console.error('pagination error', e);
            } finally {
              root.classList.remove('pg-measuring');
            }
            if (!out) return;
            const dt = performance.now() - t0;
            lastCost = dt;
            if (dt > 200) console.debug(`[pagination] ${Math.round(dt)}ms, ${out.result.pageCount}쪽, 나눔 ${out.breaks.length}`);
            const cur = paginationKey.getState(view.state)!;
            if (sameBreaks(cur.breaks, out.breaks)) runsSinceDocChange = 0;
            else if (++runsSinceDocChange > 6) console.warn('[pagination] 배치가 수렴하지 않아 중단합니다.');
            else {
              const tr = view.state.tr.setMeta(paginationKey, out.breaks).setMeta('addToHistory', false);
              view.dispatch(tr);
            }
            const key = JSON.stringify(out.result);
            storage.result = out.result;
            if (key !== lastResultKey) {
              lastResultKey = key;
              storage.listeners.forEach((fn) => fn(out!.result));
            }
          };
          // 큰 문서는 입력이 멈춘 뒤에 다시 배치 (타자 지연 방지)
          let lastCost = 0;
          let timer: any = null;
          const schedule = () => {
            if (destroyed) return;
            if (lastCost > 60) {
              clearTimeout(timer);
              timer = setTimeout(() => {
                if (!raf) raf = requestAnimationFrame(run);
              }, Math.min(800, 150 + lastCost * 2));
              return;
            }
            if (!raf) raf = requestAnimationFrame(run);
          };
          storage.schedule = schedule;
          const onCompEnd = () => setTimeout(schedule, 0);
          view.dom.addEventListener('compositionend', onCompEnd);
          window.addEventListener('khwp:relayout', schedule);
          const ro = new ResizeObserver(() => schedule());
          ro.observe(view.dom);
          (document as any).fonts?.ready?.then(schedule);
          schedule();
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy() {
              destroyed = true;
              if (raf) cancelAnimationFrame(raf);
              clearTimeout(timer);
              ro.disconnect();
              view.dom.removeEventListener('compositionend', onCompEnd);
              window.removeEventListener('khwp:relayout', schedule);
            },
          };
        },
      }),
    ];
  },
});
