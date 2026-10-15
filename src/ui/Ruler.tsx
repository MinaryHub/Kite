import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { useApp, useEditorTick } from '../app/hooks';
import { computeGeom } from '../print';
import { PX_PER_MM } from '../formats/common';

const PT_TO_PX = 96 / 72;

export function Ruler() {
  const app = useApp();
  const tab = app.active;
  useEditorTick(tab?.editor);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState<{ kind: 'first' | 'left' | 'right'; x: number } | null>(null);

  useEffect(() => {
    const h = () => force();
    window.addEventListener('kite:scroll', h);
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('kite:scroll', h);
      window.removeEventListener('resize', h);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tab) return;
    const stage = document.querySelector(`[data-doc="${tab.id}"] .stage`) as HTMLElement | null;
    const row = rowRef.current;
    if (!stage || !row) return;
    const off = stage.getBoundingClientRect().left - row.getBoundingClientRect().left;
    if (Math.abs(off - offset) > 0.5) setOffset(off);
  });

  const g = tab ? computeGeom(tab.settings) : null;
  const z = app.zoom;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = g.W * z;
    c.width = Math.round(w * dpr);
    c.height = Math.round(22 * dpr);
    c.style.width = w + 'px';
    c.style.height = '22px';
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#d9dde3';
    ctx.fillRect(0, 3, w, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(g.ml * z, 3, g.contentW * z, 16);
    ctx.strokeStyle = '#7b8494';
    ctx.fillStyle = '#4b5361';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const mm = PX_PER_MM * z;
    const startMm = -g.ml / PX_PER_MM;
    const endMm = (g.W - g.ml) / PX_PER_MM;
    ctx.beginPath();
    for (let m = Math.ceil(startMm); m <= endMm; m++) {
      const x = g.ml * z + m * mm + 0.5;
      let h = 2;
      if (m % 10 === 0) h = 7;
      else if (m % 5 === 0) h = 4;
      if (mm < 2.2 && m % 5 !== 0) continue;
      ctx.moveTo(x, 19);
      ctx.lineTo(x, 19 - h);
      if (m % 10 === 0 && m !== 0) ctx.fillText(String(Math.abs(m / 10)), x, 11);
    }
    ctx.stroke();
  });

  if (!tab || !g || !app.view.ruler) return null;
  const p = tab.editor.state.selection.$from.parent;
  const isPara = p.type.name === 'paragraph' || p.type.name === 'heading';
  const left = isPara ? p.attrs.indentLeft || 0 : 0;
  const first = isPara ? p.attrs.textIndent || 0 : 0;
  const right = isPara ? p.attrs.indentRight || 0 : 0;
  const base = g.ml * z;
  const xLeft = base + left * PT_TO_PX * z;
  const xFirst = base + (left + first) * PT_TO_PX * z;
  const xRight = base + (g.contentW - right * PT_TO_PX) * z;

  const startDrag = (kind: 'first' | 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const init = { left, first, right };
    setDrag({ kind, x: e.clientX });
    const move = (ev: MouseEvent) => {
      setDrag({ kind, x: ev.clientX });
      const dPt = Math.round(((ev.clientX - startX) / z / PT_TO_PX) * 2) / 2;
      const attrs: Record<string, any> = {};
      if (kind === 'left') {
        attrs.indentLeft = Math.max(0, init.left + dPt) || null;
      } else if (kind === 'first') {
        attrs.textIndent = init.first + dPt || null;
      } else attrs.indentRight = Math.max(0, init.right - dPt) || null;
      tab.editor.commands.setParagraphAttrs(attrs);
    };
    const up = () => {
      setDrag(null);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      tab.editor.commands.focus();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const tri = (down: boolean) => (
    <svg width="11" height="8" viewBox="0 0 11 8">
      <path d={down ? 'M0 0 H11 L5.5 7 Z' : 'M5.5 0 L11 7 H0 Z'} fill="#5a6475" stroke="#3b4350" strokeWidth="0.6" />
    </svg>
  );

  return (
    <div className="ruler-row" ref={rowRef}>
      <div className="ruler" style={{ marginLeft: offset, width: g.W * z }}>
        <canvas ref={canvasRef} />
        {isPara && (
          <>
            <div className="r-marker first" style={{ left: xFirst }} title={`첫 줄 ${first}pt`} onMouseDown={startDrag('first')}>
              {tri(true)}
            </div>
            <div className="r-marker left" style={{ left: xLeft }} title={`왼쪽 여백 ${left}pt`} onMouseDown={startDrag('left')}>
              {tri(false)}
            </div>
            <div className="r-marker right" style={{ left: xRight }} title={`오른쪽 여백 ${right}pt`} onMouseDown={startDrag('right')}>
              {tri(false)}
            </div>
          </>
        )}
      </div>
      {drag && <div className="r-guide" style={{ left: drag.x }} />}
    </div>
  );
}
