import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { EditorContent } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import type { DocTab } from '../doc/docTab';
import { useApp } from '../app/hooks';
import { computeGeom, hfText, hfZones, PAGE_GAP, type PageGeom } from '../print';
import { formatPageNumber, splitExt } from '../formats/common';
import { applyFormatPainter, insertImagesFromFiles } from '../app/commands';
import { viewState } from '../editor/viewState';
import { FN_FONT_PX, FN_LINE, FN_SEP } from '../editor/extensions/pagination';
import { showContextMenu } from './ContextMenu';
import { platform } from '../platform';

export function PageView({ tab, active }: { tab: DocTab; active: boolean }) {
  const app = useApp();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const wsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => tab.subscribe(force), [tab]);

  const g: PageGeom = computeGeom(tab.settings, PAGE_GAP);
  const zoom = app.zoom;
  const pageCount = Math.max(1, tab.layout.pageCount);
  const stageH = pageCount * g.P - g.gap;

  // 페이지 기하 정보를 페이지네이션 엔진에 전달
  useLayoutEffect(() => {
    const storage = tab.editor.storage.pagination;
    const geo = { pageHeight: g.H, gap: g.gap, contentHeight: g.contentH, contentWidth: g.contentW };
    const prev = storage.geometry;
    if (!prev || prev.pageHeight !== geo.pageHeight || prev.contentHeight !== geo.contentHeight || prev.contentWidth !== geo.contentWidth || prev.gap !== geo.gap) {
      storage.geometry = geo;
      storage.schedule();
    }
  });

  useEffect(() => {
    if (active) {
      viewState.zoom = zoom;
      // 배율·탭 전환은 문서 px 좌표가 그대로이므로 전체가 아니라 필요한 만큼만
      tab.editor.storage.pagination.refresh();
      if (wsRef.current && tab.scrollTop) wsRef.current.scrollTop = tab.scrollTop;
    }
  }, [active, zoom]);

  // 화면 맞춤 / 쪽 이동
  useEffect(() => {
    if (!active) return;
    const onFit = (e: Event) => {
      const mode = (e as CustomEvent).detail as 'width' | 'page';
      const ws = wsRef.current;
      if (!ws) return;
      const zw = (ws.clientWidth - 60) / g.W;
      const zh = (ws.clientHeight - 50) / g.H;
      app.setZoom(mode === 'width' ? zw : Math.min(zw, zh), mode);
    };
    const onStep = (e: Event) => {
      const step = (e as CustomEvent).detail as number;
      const ws = wsRef.current;
      if (!ws) return;
      const cur = Math.round((ws.scrollTop - 24) / (g.P * zoom));
      const target = Math.max(0, Math.min(pageCount - 1, cur + step));
      scrollToPage(target, true);
    };
    const onGoto = (e: Event) => scrollToPage(((e as CustomEvent).detail as number) - 1, true);
    window.addEventListener('kite:fit', onFit);
    window.addEventListener('kite:page-step', onStep);
    window.addEventListener('kite:goto-page', onGoto);
    return () => {
      window.removeEventListener('kite:fit', onFit);
      window.removeEventListener('kite:page-step', onStep);
      window.removeEventListener('kite:goto-page', onGoto);
    };
  });

  // 창 크기 변경 시 맞춤 유지
  useEffect(() => {
    if (!active || app.zoomMode === 'custom') return;
    const ws = wsRef.current;
    if (!ws) return;
    const ro = new ResizeObserver(() => window.dispatchEvent(new CustomEvent('kite:fit', { detail: app.zoomMode })));
    ro.observe(ws);
    return () => ro.disconnect();
  }, [active, app.zoomMode]);

  const scrollToPage = (k: number, moveCaret: boolean) => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.scrollTop = 24 + k * g.P * zoom - 8;
    if (moveCaret) {
      const pos = tab.layout.pageStarts[k];
      if (pos != null) {
        try {
          const $p = tab.editor.state.doc.resolve(Math.min(pos + 1, tab.editor.state.doc.content.size));
          tab.editor.view.dispatch(tab.editor.state.tr.setSelection(TextSelection.near($p)));
          tab.editor.commands.focus();
          ws.scrollTop = 24 + k * g.P * zoom - 8;
        } catch {
          /* 무시 */
        }
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      app.setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }
  };

  // 여백/빈 곳 클릭 → 가까운 위치로 커서 이동
  const onStageMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.ProseMirror') || target.closest('.hf-zone') || target.closest('.fn-area')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const view = tab.editor.view;
    const rect = view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, rect.left + 2), rect.right - 2);
    const y = Math.min(Math.max(e.clientY, rect.top + 2), rect.bottom - 2);
    const hit = view.posAtCoords({ left: x, top: y });
    if (hit) {
      try {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
      } catch {
        /* 무시 */
      }
    }
    view.focus();
  };

  const onDrop = async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    const docs = files.filter((f) => !f.type.startsWith('image/'));
    if (imgs.length) {
      const hit = tab.editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (hit) tab.editor.commands.setTextSelection(hit.pos);
      insertImagesFromFiles(await Promise.all(imgs.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    }
    for (const f of docs) {
      const [, ext] = splitExt(f.name);
      if (!/^(hwp|hwpx|docx|doc|pdf|md|markdown|txt|html?)$/.test(ext)) continue;
      await app.openData(f.name, new Uint8Array(await f.arrayBuffer()), platform.droppedFilePath(f));
    }
  };

  const z = hfZones(tab.settings, g);
  const s = tab.settings;
  const total = pageCount + s.pageNumber.start - 1;

  const pages = [];
  const chrome = [];
  for (let k = 0; k < pageCount; k++) {
    const top = k * g.P;
    pages.push(
      <div key={k} className="paper" style={{ top, width: g.W, height: g.H }}>
        <Corners g={g} />
      </div>,
    );
    // 쪽 경계 가리개 (본문 끝 → 다음 쪽 본문 시작)
    const maskTop = top + g.mt + g.contentH;
    const last = k === pageCount - 1;
    chrome.push(
      <div key={'m' + k} className="mask" style={{ top: maskTop, width: g.W, height: last ? g.mb : g.mb + g.gap + g.mt }}>
        <div className="m-paper" style={{ top: 0, height: g.mb }} />
        {!last && <div className="m-gap" style={{ top: g.mb, height: g.gap }} />}
        {!last && <div className="m-paper" style={{ top: g.mb + g.gap, height: g.mt }} />}
      </div>,
    );
    const num = s.pageNumber.start + k;
    const hfStyle = (align: string): React.CSSProperties => ({
      left: g.ml,
      width: g.contentW,
      justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    });
    chrome.push(
      <div
        key={'h' + k}
        className={'hf-zone' + (s.header.text ? '' : ' empty')}
        data-hint="머리말 (두 번 누르면 편집)"
        style={{ ...hfStyle(s.header.align), top: top + z.header.top, height: z.header.height, alignItems: 'flex-start' }}
        onDoubleClick={() => app.openDialog('headerFooter', { tab: 'header' })}
      >
        {s.header.text ? hfText(s.header.text, num, total, s.pageNumber.format) : ''}
      </div>,
      <div
        key={'f' + k}
        className={'hf-zone' + (s.footer.text ? '' : ' empty')}
        data-hint="꼬리말 (두 번 누르면 편집)"
        style={{ ...hfStyle(s.footer.align), top: top + z.footer.top, height: z.footer.height, alignItems: 'flex-end' }}
        onDoubleClick={() => app.openDialog('headerFooter', { tab: 'footer' })}
      >
        {s.footer.text ? hfText(s.footer.text, num, total, s.pageNumber.format) : ''}
      </div>,
    );
    if (s.pageNumber.pos !== 'none') {
      const [v, h] = s.pageNumber.pos.split('-');
      const zz = v === 'top' ? z.header : z.footer;
      chrome.push(
        <div
          key={'n' + k}
          className="page-num"
          style={{
            top: top + zz.top,
            height: zz.height,
            left: g.ml,
            width: g.contentW,
            display: 'flex',
            alignItems: v === 'top' ? 'flex-start' : 'flex-end',
            justifyContent: h === 'left' ? 'flex-start' : h === 'right' ? 'flex-end' : 'center',
          }}
        >
          {formatPageNumber(num, s.pageNumber.format)}
        </div>,
      );
    }
    const fns = tab.layout.footnotes.filter((f) => f.page === k);
    if (fns.length) {
      chrome.push(
        <div key={'fn' + k} className="fn-area" style={{ left: g.ml, width: g.contentW, top: top + g.mt + g.contentH, transform: 'translateY(-100%)', fontSize: FN_FONT_PX, lineHeight: FN_LINE }}>
          <div className="fn-sep" style={{ height: FN_SEP }} />
          {fns.map((f) => (
            <div key={f.num} className="fn-item" title="두 번 누르면 각주 편집" onDoubleClick={() => app.openDialog('footnote', { pos: findFootnotePos(tab, f.num), text: f.text })}>
              {f.num}) {f.text}
            </div>
          ))}
        </div>,
      );
    }
    chrome.push(
      <div key={'l' + k} className="page-label" style={{ top: top + 4 }}>
        {k + 1}
      </div>,
    );
  }

  return (
    <div
      className={'workspace' + (active ? '' : ' hidden-doc')}
      data-doc={tab.id}
      ref={wsRef}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onScroll={() => window.dispatchEvent(new Event('kite:scroll'))}
    >
      <div className="stage-wrap" style={{ width: g.W * zoom, height: stageH * zoom + 64 }}>
        <div className="stage" ref={stageRef} style={{ width: g.W, height: stageH, transform: `scale(${zoom})` }} onMouseDown={onStageMouseDown}>
          {pages}
          <div
            className="editor-host"
            style={{ left: g.ml, top: g.mt, width: g.contentW }}
            onMouseUp={() => app.painter && setTimeout(applyFormatPainter, 0)}
            onContextMenu={(e) => {
              e.preventDefault();
              showContextMenu(e.clientX, e.clientY, tab);
            }}
          >
            <EditorContent editor={tab.editor} style={{ minHeight: (pageCount - 1) * g.P + g.contentH }} />
          </div>
          <div className="chrome-layer">{chrome}</div>
        </div>
      </div>
    </div>
  );
}

function Corners({ g }: { g: PageGeom }) {
  const L = 14;
  const x0 = g.ml;
  const x1 = g.W - g.mr;
  const y0 = g.mt;
  const y1 = g.H - g.mb;
  const st = (x: number, y: number, bl: string): React.CSSProperties => ({ left: x, top: y, width: L, height: L, borderWidth: bl });
  return (
    <>
      <div className="corner" style={st(x0 - L, y0 - L, '0 1px 1px 0')} />
      <div className="corner" style={st(x1, y0 - L, '0 0 1px 1px')} />
      <div className="corner" style={st(x0 - L, y1, '1px 1px 0 0')} />
      <div className="corner" style={st(x1, y1, '1px 0 0 1px')} />
    </>
  );
}

function findFootnotePos(tab: DocTab, num: number): number | null {
  let i = 0;
  let found: number | null = null;
  tab.editor.state.doc.descendants((n, pos) => {
    if (found != null) return false;
    if (n.type.name === 'footnote') {
      i++;
      if (i === num) found = pos;
    }
    return true;
  });
  return found;
}

/** 현재 커서가 있는 쪽 (1부터) */
export function caretPage(tab: DocTab): number {
  try {
    const view = tab.editor.view;
    const c = view.coordsAtPos(view.state.selection.head);
    const r = view.dom.getBoundingClientRect();
    const g = computeGeom(tab.settings, PAGE_GAP);
    const y = (c.top - r.top) / (viewState.zoom || 1);
    return Math.max(1, Math.min(tab.layout.pageCount, Math.floor(y / g.P) + 1));
  } catch {
    return 1;
  }
}
