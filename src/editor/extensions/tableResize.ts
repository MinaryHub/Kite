import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { TableMap } from '@tiptap/pm/tables';
import { viewState } from '../viewState';

/**
 * 표 크기 조절: 셀 경계(세로선)를 끌어 열 너비를, 아래 경계(가로선)를 끌어 행 높이를 바꾼다.
 * 끄는 선이 쪽 본문 영역의 경계(안쪽 여백선: 왼쪽·오른쪽·아래)에 가까워지면 그 선에 붙는다.
 */

const HIT = 4; // 경계 잡는 범위 (화면 px)
const SNAP = 8; // 여백선에 붙는 거리 (화면 px)
const MIN_COL = 8; // 최소 열 너비 (문서 px)
const MIN_ROW = 8; // 최소 행 높이 (문서 px)

interface Target {
  kind: 'col' | 'row';
  tableEl: HTMLTableElement;
  tablePos: number;
  /** col: 경계 번호(1..열 수) — 그 왼쪽 열의 오른쪽 선 / row: 행 번호 */
  index: number;
}

export const tableResizeKey = new PluginKey('tableResize');

function zoom() {
  return viewState.zoom || 1;
}

/** 셀 DOM → 표 위치와 셀의 격자 범위 */
function cellInfo(view: EditorView, cellEl: HTMLElement) {
  try {
    const $p = view.state.doc.resolve(view.posAtDOM(cellEl, 0));
    let cellDepth = -1;
    for (let d = $p.depth; d > 0; d--) {
      const n = $p.node(d).type.name;
      if (cellDepth < 0 && (n === 'tableCell' || n === 'tableHeader')) cellDepth = d;
      if (n === 'table' && cellDepth > 0) {
        const table = $p.node(d);
        const tableStart = $p.start(d);
        const map = TableMap.get(table);
        const rect = map.findCell($p.before(cellDepth) - tableStart);
        return { table, tablePos: $p.before(d), map, rect };
      }
    }
  } catch {
    /* 무시 */
  }
  return null;
}

/** 화면에 보이는 열 경계의 x 좌표(화면 px, 0..열 수) */
function columnEdges(tableEl: HTMLTableElement, view: EditorView, tablePos: number, table: PMNode, map: TableMap): number[] {
  const edges: (number | null)[] = new Array(map.width + 1).fill(null);
  const tableStart = tablePos + 1;
  const seen = new Set<number>();
  for (let i = 0; i < map.map.length; i++) {
    const pos = map.map[i];
    if (seen.has(pos)) continue;
    seen.add(pos);
    const rect = map.findCell(pos);
    const dom = view.nodeDOM(tableStart + pos) as HTMLElement | null;
    if (!dom || !dom.getBoundingClientRect) continue;
    const r = dom.getBoundingClientRect();
    if (edges[rect.left] == null) edges[rect.left] = r.left;
    if (edges[rect.right] == null) edges[rect.right] = r.right;
  }
  const t = tableEl.getBoundingClientRect();
  if (edges[0] == null) edges[0] = t.left;
  if (edges[map.width] == null) edges[map.width] = t.right;
  // 알 수 없는 경계는 앞뒤 사이를 고르게
  for (let i = 1; i < map.width; i++) {
    if (edges[i] != null) continue;
    let j = i + 1;
    while (edges[j] == null) j++;
    const a = edges[i - 1]!;
    const b = edges[j]!;
    for (let k = i; k < j; k++) edges[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  void table;
  return edges as number[];
}

/** 쪽 본문 경계(화면 좌표) */
function pageBounds(view: EditorView, clientY: number) {
  const root = view.dom as HTMLElement;
  const r = root.getBoundingClientRect();
  const s = zoom();
  const geo = (view as any).__kGeometry?.() as { pageHeight: number; gap: number; contentHeight: number; contentWidth: number } | null;
  const contentW = geo ? geo.contentWidth : root.offsetWidth;
  const left = r.left;
  const right = r.left + contentW * s;
  let bottom: number | null = null;
  let top: number | null = null;
  if (geo) {
    const P = geo.pageHeight + geo.gap;
    const k = Math.max(0, Math.floor((clientY - r.top) / s / P));
    top = r.top + k * P * s;
    bottom = r.top + (k * P + geo.contentHeight) * s;
  }
  return { left, right, top, bottom };
}

function snapTo(v: number, targets: (number | null)[]): { v: number; snapped: number | null } {
  let best: number | null = null;
  for (const t of targets) if (t != null && Math.abs(v - t) <= SNAP && (best == null || Math.abs(v - t) < Math.abs(v - best))) best = t;
  return best == null ? { v, snapped: null } : { v: best, snapped: best };
}

function findTarget(view: EditorView, e: MouseEvent): Target | null {
  const target = e.target as HTMLElement | null;
  if (!target?.closest) return null;
  // 바깥 테두리 위에서는 셀이 아니라 표 감싸개가 잡힌다
  const host = target.closest('td, th, .tableWrapper, table') as HTMLElement | null;
  if (!host || !view.dom.contains(host)) return null;
  const tableEl = (host.tagName === 'TD' || host.tagName === 'TH' ? host.closest('table') : host.tagName === 'TABLE' ? host : host.querySelector(':scope > table')) as HTMLTableElement | null;
  if (!tableEl) return null;
  const x = e.clientX;
  const y = e.clientY;
  let rowHit: { el: HTMLElement; top: boolean } | null = null;
  for (const tr of Array.from(tableEl.rows)) {
    for (const cell of Array.from(tr.cells)) {
      const r = cell.getBoundingClientRect();
      if (y >= r.top - HIT && y <= r.bottom + HIT) {
        const nearRight = Math.abs(x - r.right) <= HIT;
        const nearLeft = Math.abs(x - r.left) <= HIT;
        if (nearRight || nearLeft) {
          const info = cellInfo(view, cell);
          if (!info) continue;
          if (nearRight) return { kind: 'col', tableEl, tablePos: info.tablePos, index: info.rect.right };
          if (info.rect.left > 0) return { kind: 'col', tableEl, tablePos: info.tablePos, index: info.rect.left };
        }
      }
      if (!rowHit && x >= r.left && x <= r.right) {
        if (Math.abs(y - r.bottom) <= HIT) rowHit = { el: cell, top: false };
        else if (Math.abs(y - r.top) <= HIT) rowHit = { el: cell, top: true };
      }
    }
  }
  if (rowHit) {
    const info = cellInfo(view, rowHit.el);
    if (!info) return null;
    if (!rowHit.top) return { kind: 'row', tableEl, tablePos: info.tablePos, index: info.rect.bottom - 1 };
    if (info.rect.top > 0) return { kind: 'row', tableEl, tablePos: info.tablePos, index: info.rect.top - 1 };
  }
  return null;
}

function setCursor(view: EditorView, kind: 'col' | 'row' | null) {
  const d = view.dom as HTMLElement;
  d.classList.toggle('resize-cursor', kind === 'col');
  d.classList.toggle('row-resize-cursor', kind === 'row');
}

/** 끄는 동안 보여 주는 안내선 */
function makeGuide(kind: 'col' | 'row') {
  const g = document.createElement('div');
  g.className = 'k-resize-guide ' + kind;
  document.body.appendChild(g);
  const tip = document.createElement('div');
  tip.className = 'k-resize-tip';
  document.body.appendChild(tip);
  return {
    move(x: number, y: number, len: { a: number; b: number }, snapped: boolean, text: string) {
      if (kind === 'col') Object.assign(g.style, { left: x + 'px', top: len.a + 'px', height: len.b - len.a + 'px', width: '' });
      else Object.assign(g.style, { top: y + 'px', left: len.a + 'px', width: len.b - len.a + 'px', height: '' });
      g.classList.toggle('snapped', snapped);
      tip.textContent = text;
      Object.assign(tip.style, { left: x + 12 + 'px', top: y + 12 + 'px' });
    },
    remove() {
      g.remove();
      tip.remove();
    },
  };
}

const pxToMm = (px: number) => Math.round(((px * 25.4) / 96) * 10) / 10;

function startDrag(view: EditorView, t: Target, e: MouseEvent) {
  const info = (() => {
    const node = view.state.doc.nodeAt(t.tablePos);
    if (!node || node.type.name !== 'table') return null;
    return { table: node, map: TableMap.get(node) };
  })();
  if (!info) return;
  const { table, map } = info;
  const s = zoom();
  const tRect = t.tableEl.getBoundingClientRect();
  const guide = makeGuide(t.kind);
  let finish: (() => void) | null = null;

  if (t.kind === 'col') {
    const edges = columnEdges(t.tableEl, view, t.tablePos, table, map);
    const b = t.index;
    const last = b === map.width;
    const minX = edges[b - 1] + MIN_COL * s;
    const maxX = last ? Infinity : edges[b + 1] - MIN_COL * s;
    let x = edges[b];
    const update = (ev: MouseEvent) => {
      const pb = pageBounds(view, ev.clientY);
      const sn = snapTo(ev.clientX, [pb.left, pb.right]);
      x = Math.max(minX, Math.min(maxX, sn.v));
      const snapped = sn.snapped != null && x === sn.snapped;
      const top = snapped && pb.top != null && pb.bottom != null ? Math.min(tRect.top, pb.top) : tRect.top;
      const bottom = snapped && pb.bottom != null ? Math.max(tRect.bottom, pb.bottom) : tRect.bottom;
      const w = (x - edges[b - 1]) / s;
      guide.move(x, ev.clientY, { a: top, b: bottom }, snapped, `${pxToMm(w)} mm${snapped ? ' · 여백선' : ''}`);
    };
    update(e);
    finish = () => {
      const widths = edges.slice(1).map((v, i) => (v - edges[i]) / s);
      const d = (x - edges[b]) / s;
      if (Math.abs(d) < 0.5) return;
      widths[b - 1] += d;
      if (!last) widths[b] -= d;
      setColumnWidths(view, t.tablePos, widths.map((w) => Math.max(MIN_COL, Math.round(w))));
    };
    return track(update, () => {
      guide.remove();
      finish?.();
    });
  }

  // 행 높이
  const rows = Array.from(t.tableEl.querySelectorAll(':scope > tbody > tr, :scope > tr')) as HTMLElement[];
  const rowEl = rows[t.index];
  if (!rowEl) {
    guide.remove();
    return;
  }
  const rowTop = rowEl.getBoundingClientRect().top;
  let y = rowEl.getBoundingClientRect().bottom;
  const update = (ev: MouseEvent) => {
    const pb = pageBounds(view, ev.clientY);
    const sn = snapTo(ev.clientY, [pb.bottom, pb.top]);
    y = Math.max(rowTop + MIN_ROW * s, sn.v);
    const snapped = sn.snapped != null && y === sn.snapped;
    const a = snapped ? Math.min(tRect.left, pb.left) : tRect.left;
    const bb = snapped ? Math.max(tRect.right, pb.right) : tRect.right;
    guide.move(ev.clientX, y, { a, b: bb }, snapped, `${pxToMm((y - rowTop) / s)} mm${snapped ? ' · 여백선' : ''}`);
  };
  update(e);
  return track(update, () => {
    guide.remove();
    const h = Math.round((y - rowTop) / s);
    if (Math.abs(y - rowEl.getBoundingClientRect().bottom) < 0.5 * s) return;
    setRowHeight(view, t.tablePos, t.index, Math.max(MIN_ROW, h));
  });
}

function track(move: (e: MouseEvent) => void, done: () => void) {
  const onMove = (e: MouseEvent) => {
    e.preventDefault();
    move(e);
  };
  const onUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    move(e);
    done();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    document.querySelectorAll('.k-resize-guide, .k-resize-tip').forEach((n) => n.remove());
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('keydown', onKey, true);
}

/** 모든 셀의 colwidth 를 열 너비 배열에 맞춘다 */
export function setColumnWidths(view: EditorView, tablePos: number, widths: number[]) {
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return;
  const map = TableMap.get(table);
  const tr = view.state.tr;
  const seen = new Set<number>();
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    const rect = map.findCell(pos);
    const cell = table.nodeAt(pos)!;
    const cw = widths.slice(rect.left, rect.right);
    const old = cell.attrs.colwidth as number[] | null;
    if (old && old.length === cw.length && old.every((v, i) => v === cw[i])) continue;
    tr.setNodeMarkup(tablePos + 1 + pos, null, { ...cell.attrs, colwidth: cw });
  }
  if (tr.docChanged) view.dispatch(tr.scrollIntoView());
}

export function setRowHeight(view: EditorView, tablePos: number, rowIndex: number, height: number | null) {
  const table = view.state.doc.nodeAt(tablePos);
  if (!table || rowIndex >= table.childCount) return;
  let pos = tablePos + 1;
  for (let i = 0; i < rowIndex; i++) pos += table.child(i).nodeSize;
  const row = table.child(rowIndex);
  view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...row.attrs, height }));
}

export const TableResize = Extension.create({
  name: 'tableResize',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: tableResizeKey,
        view: (view) => {
          // 쪽 크기 정보 (페이지 나누기 확장의 storage)
          (view as any).__kGeometry = () => (editor.storage as any).pagination?.geometry || null;
          return {};
        },
        props: {
          handleDOMEvents: {
            mousemove(view, e) {
              if (!view.editable || e.buttons) return false;
              const t = findTarget(view, e);
              setCursor(view, t ? t.kind : null);
              return false;
            },
            mouseleave(view) {
              setCursor(view, null);
              return false;
            },
            mousedown(view, e) {
              if (!view.editable || e.button !== 0) return false;
              const t = findTarget(view, e);
              if (!t) return false;
              e.preventDefault();
              setCursor(view, null);
              startDrag(view, t, e);
              return true;
            },
          },
        },
      }),
    ];
  },
});
