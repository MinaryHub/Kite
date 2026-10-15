import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/hooks';
import { buildPrintPages, computeGeom } from '../print';
import { Icon } from './Icon';

export function PreviewModal() {
  const app = useApp();
  const tab = app.active;
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.6);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!app.previewOpen || !tab || !ref.current) return;
    const g = computeGeom(tab.settings);
    const pages = buildPrintPages(tab, g);
    ref.current.innerHTML = '';
    pages.forEach((p) => ref.current!.appendChild(p));
    setCount(pages.length);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        app.set({ previewOpen: false });
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [app.previewOpen, tab]);
  if (!app.previewOpen || !tab) return null;
  const close = () => app.set({ previewOpen: false });
  return (
    <div className="preview-modal">
      <div className="pv-bar">
        <b style={{ fontSize: 13 }}>미리 보기</b>
        <span className="unit">
          {tab.title} · {count}쪽
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => setZoom(Math.max(0.2, zoom - 0.1))}>
          <Icon name="ZoomOut" size={14} />
        </button>
        <span style={{ width: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn small" onClick={() => setZoom(Math.min(2, zoom + 0.1))}>
          <Icon name="ZoomIn" size={14} />
        </button>
        <button
          className="btn"
          onClick={() => {
            close();
            setTimeout(() => app.print(), 50);
          }}
        >
          <Icon name="Printer" size={14} /> 인쇄
        </button>
        <button
          className="btn"
          onClick={() => {
            close();
            setTimeout(() => app.exportPdf(), 50);
          }}
        >
          <Icon name="FileDown" size={14} /> PDF로 저장
        </button>
        <button className="btn primary" onClick={close}>
          닫기
        </button>
      </div>
      <div className="pv-body">
        <div className="pv-pages" ref={ref} style={{ zoom } as any} />
      </div>
    </div>
  );
}
