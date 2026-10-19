import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, FIXED_SPACE, hwpToPx } from '../../formats/common';
import { CELL_VMARGIN_HWP } from '../../formats/hwp/reader';
import { fontStack, fontWeightFallback } from '../../fonts';

/**
 * 한글(HWP)과 같은 글자 폭.
 *
 * 한글은 글자마다 '글꼴의 글자 폭 × 장평 × (1 + 자간)' 만큼 나아간다 (자간·장평 모두 그 글자 폭에 대한 비율).
 * 빈칸은 글꼴과 상관없이 글자 크기의 절반 폭이다. 브라우저의 letter-spacing 은 글자 크기 기준으로 더하는
 * 값이고 장평(font-stretch)은 한글 글꼴에 폭 변형이 없어 먹지 않으므로, 그대로 두면 줄 바꿈 위치가 달라져
 * 쪽이 넘친다. 글자 묶음(텍스트 노드)마다 한글 방식의 폭을 캔버스로 재서, 브라우저 폭과의 차이를
 * 글자 수로 나눈 letter-spacing 을 덧씌운다.
 *
 * HWP/HWPX 에서 연 문서에만 켠다 (DocSettings.hwpMetrics → storage.enabled).
 */
export const hwpMetricsKey = new PluginKey<HState>('hwpMetrics');

interface HState {
  decos: DecorationSet;
  /** 조합(IME) 중에 미룬 범위 */
  pending: [number, number] | null;
}

const PT2PX = 96 / 72;
/** 한글 칸의 위+아래 안 여백 (HWP 리더가 줄 높이에서 뺀 값) */
const CELL_VMARGIN_PX = hwpToPx(CELL_VMARGIN_HWP);
let ctx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

function measure(font: string, text: string): number | null {
  if (ctx === undefined) ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return null;
  if (ctx.font !== font) ctx.font = font;
  return ctx.measureText(text).width;
}

function spaceWidth(font: string): number | null {
  let w = widthCache.get(font);
  if (w == null) {
    const m = measure(font, ' ');
    if (m == null) return null;
    widthCache.set(font, (w = m));
  }
  return w;
}

type Lang = 'base' | 'en' | 'hanja' | 'sym';

/**
 * 한글이 글자 모양의 어느 언어 글꼴로 그리는 글자인가 (빈칸은 null: 앞 글자를 따른다).
 * 영문 = 라틴 문자(기본 라틴·라틴-1·확장, 숫자·문장 부호 포함), 한자 = CJK 한자, 기호 = 그 밖의 부호·기호
 * (△ ｢ ∼ ※ ① 등). 한글·일어 등은 한글 글꼴(base).
 */
function langOf(cp: number): Lang | null {
  if (cp === 0x20 || cp === 0xa0 || cp === FIXED_SPACE) return null;
  if (cp < 0x250) return 'en';
  if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xd7b0 && cp <= 0xd7ff)) return 'base';
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff) || cp >= 0x20000) return 'hanja';
  // 그리스·키릴 문자, 일어 가나 등은 한글 글꼴로
  if (cp < 0x2000 || (cp >= 0x3040 && cp <= 0x30ff)) return 'base';
  return 'sym';
}

/** 한 텍스트 노드의 폭 보정: 언어별 글꼴이 다른 곳에서 나눈 조각마다 글꼴과 letter-spacing */
function decosFor(node: PMNode, pos: number, parent: PMNode, out: Decoration[]) {
  const text = node.text || '';
  if (!text || text.includes('\t')) return;
  let ts: Record<string, any> | null = null;
  let bold = false;
  let italic = false;
  for (const m of node.marks) {
    const n = m.type.name;
    if (n === 'textStyle') ts = m.attrs;
    else if (n === 'bold') bold = true;
    else if (n === 'italic') italic = true;
    else if (n === 'superscript' || n === 'subscript' || n === 'tab') return;
  }
  // 제목 문단처럼 글자 크기를 문단 모양이 정하는 경우는 잴 수 없으므로 건드리지 않는다
  const sizePt = +(ts?.fontSize || parent.attrs?.fontSize || (parent.type.name === 'heading' ? 0 : DEFAULT_FONT_SIZE));
  if (!(sizePt > 0)) return;
  const family = String(ts?.fontFamily || DEFAULT_FONT);
  const lf: Record<string, string> = ts?.langFonts && typeof ts.langFonts === 'object' ? ts.langFonts : {};
  const ratio = Math.max(50, Math.min(200, +(ts?.fontWidth || 100)));
  const spacing = Math.max(-50, Math.min(50, +(ts?.letterSpacing || 0)));
  const f = (ratio / 100) * (1 + spacing / 100);
  const sizePx = sizePt * PT2PX;

  // 글꼴이 같은 글자끼리 조각으로 (빈칸은 앞 조각에 붙인다)
  const segs: { from: number; to: number; font: string }[] = [];
  let i = 0;
  for (const ch of text) {
    const lang = langOf(ch.codePointAt(0)!);
    const font = lang && lang !== 'base' && typeof lf[lang] === 'string' ? lf[lang] : lang ? family : null;
    const last = segs[segs.length - 1];
    if (last && (font == null || font === last.font)) last.to = i + ch.length;
    else segs.push({ from: i, to: i + ch.length, font: font ?? family });
    i += ch.length;
  }
  segs.forEach((s, k) => {
    const part = text.slice(s.from, s.to);
    const other = s.font !== family;
    const weight = bold ? 'bold' : fontWeightFallback(s.font) || 'normal';
    const stack = fontStack(s.font, { canvas: true });
    const canvasFont = `${italic ? 'italic ' : ''}${weight} ${sizePx}px ${stack}`;
    // 한글은 굵게 해도 글자 폭이 그대로다 (굵은 글꼴이 따로 있어도 보통 글꼴의 폭). 목표 폭은 보통 굵기로 잰다
    const plainFont = weight === 'normal' ? canvasFont : `${italic ? 'italic ' : ''}normal ${sizePx}px ${stack}`;
    // 빈칸과 나머지 글자를 따로 맞춘다: 글자는 letter-spacing, 빈칸은 word-spacing 으로
    // (한데 섞어 나누면 줄 끝 글자가 뒤 빈칸 몫까지 떠안아 줄 바꿈 자리가 달라진다)
    const glyphs = part.replace(/[  ]/g, '');
    const spaces = part.length - glyphs.length;
    const n = Array.from(glyphs).length;
    let ls = 0;
    let ws = 0;
    if (n && (f !== 1 || plainFont !== canvasFont)) {
      const wb = measure(canvasFont, glyphs);
      const wp = plainFont === canvasFont ? wb : measure(plainFont, glyphs);
      if (wb == null || wp == null) return;
      // 한글 폭: 글자마다 (보통 굵기의) 글꼴 폭 × 장평 × (1 + 자간)
      ls = (f * wp - wb) / n;
    }
    if (spaces) {
      const sb = spaceWidth(canvasFont);
      if (sb == null) return;
      // 빈칸은 글꼴과 상관없이 글자 크기의 절반 × 장평 × (1 + 자간)
      ws = f * (sizePx / 2) - sb - ls;
    }
    if (!isFinite(ls)) ls = 0;
    if (!isFinite(ws)) ws = 0;
    if (Math.abs(ls) < 0.005 && Math.abs(ws) < 0.005 && !other) return;
    const style = `letter-spacing: ${ls.toFixed(3)}px` + (spaces ? `; word-spacing: ${ws.toFixed(3)}px` : '') + (other ? `; font-family: ${fontStack(s.font)}` : '');
    // 앞뒤로 글자를 칠 때 꾸밈이 따라 늘어나게 (조각 사이에서는 앞 조각만)
    out.push(Decoration.inline(pos + s.from, pos + s.to, { style }, { inclusiveStart: k === 0, inclusiveEnd: true }));
  });
}

/** from~to 에 걸친 글 덩어리(textblock)들의 보정 */
function decosIn(doc: PMNode, from: number, to: number, out: Decoration[]) {
  doc.nodesBetween(from, to, (node, pos, parent, index) => {
    // 줄 높이(최소)는 칸의 위아래 안 여백을 뺀 값으로 저장되어 있다. 한글의 칸 높이는 여백을 포함하므로 되돌린다
    // (범위에 통째로 든 줄만: 일부만 다시 할 때 같은 줄에 겹쳐 달지 않게)
    if (node.type.name === 'tableRow') {
      const h = +node.attrs?.height;
      if (h > 0 && pos >= from && pos + node.nodeSize <= to) out.push(Decoration.node(pos, pos + node.nodeSize, { style: `height: ${(h + CELL_VMARGIN_PX).toFixed(1)}px; --row-h: ${(h + CELL_VMARGIN_PX).toFixed(1)}px` }));
      return true;
    }
    if (!node.isTextblock) return true;
    let maxPt = 0;
    node.forEach((child, off) => {
      if (!child.isText) return;
      const ts = child.marks.find((m) => m.type.name === 'textStyle');
      maxPt = Math.max(maxPt, +(ts?.attrs.fontSize || node.attrs?.fontSize || DEFAULT_FONT_SIZE));
      decosFor(child, pos + 1 + off, node, out);
    });
    // 줄 높이 = 문단에서 가장 큰 글자 크기 × 줄 간격 (한글처럼). 글자 묶음은 줄 높이에 관여하지 않으므로(hwp-metrics CSS)
    // 문단의 글자 크기(줄 높이의 기준)를 그 크기로 맞춘다
    if (node.type.name !== 'paragraph') return false;
    const own = +(node.attrs?.fontSize || DEFAULT_FONT_SIZE);
    const size = maxPt > 0 ? maxPt : own;
    const styles: string[] = [];
    if (size !== own) styles.push(`font-size: ${size}pt`);
    // 한글은 줄 간격의 여백을 모두 글자 아래에 둔다 (CSS 는 위아래로 반씩). 글자를 반만큼 올려 그리고,
    // 칸의 마지막 줄 아래 여백은 칸 높이에 넣지 않으므로 뺀다
    const lead = leadingPt(node.attrs?.lineHeight, size);
    if (Math.abs(lead) > 0.05) {
      styles.push(`transform: translateY(${(-lead / 2).toFixed(2)}pt)`);
      const inCell = parent && (parent.type.name === 'tableCell' || parent.type.name === 'tableHeader');
      if (inCell && index === parent!.childCount - 1) styles.push(`margin-bottom: ${(-lead).toFixed(2)}pt`);
    }
    if (styles.length) out.push(Decoration.node(pos, pos + node.nodeSize, { style: styles.join('; ') }));
    return false;
  });
}

/** 줄 높이에서 글자 크기를 뺀 여백(pt): lineHeight 는 배수("1.6") 또는 "12pt", 없으면 기본 160% */
function leadingPt(lineHeight: unknown, size: number): number {
  const v = typeof lineHeight === 'string' ? lineHeight.trim() : lineHeight == null ? '' : String(lineHeight);
  if (!v) return size * 0.6;
  if (/pt$/.test(v)) return (parseFloat(v) || size) - size;
  const n = parseFloat(v);
  return isFinite(n) && n > 0 ? size * (n - 1) : 0;
}

function buildAll(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  decosIn(doc, 0, doc.content.size, out);
  return DecorationSet.create(doc, out);
}

/** 트랜잭션이 바꾼 범위 (새 문서 기준) */
function changedRange(tr: Transaction): [number, number] | null {
  let f = Infinity;
  let t = -Infinity;
  tr.mapping.maps.forEach((m, i) => {
    const rest = tr.mapping.slice(i + 1);
    m.forEach((_os, _oe, ns, ne) => {
      f = Math.min(f, rest.map(ns, -1));
      t = Math.max(t, rest.map(ne, 1));
    });
    // 서식(자간·장평·글자 크기 등)이나 문단 속성만 바꾼 단계는 위치가 그대로라 맵이 비어 있다. 그 단계의 범위로 잡는다
    const s = tr.steps[i] as any;
    if (!s) return;
    let a: number | null = null;
    let b: number | null = null;
    if (typeof s.from === 'number' && typeof s.to === 'number') [a, b] = [s.from, s.to];
    else if (typeof s.pos === 'number') [a, b] = [s.pos, s.pos + 1];
    if (a == null || b == null) return;
    const after = tr.mapping.slice(i);
    f = Math.min(f, after.map(a, -1));
    t = Math.max(t, after.map(b, 1));
  });
  return f <= t ? [f, t] : null;
}

/** 범위를 감싸는 글 덩어리들의 보정을 새로 한다 */
function refresh(set: DecorationSet, doc: PMNode, range: [number, number]): DecorationSet {
  const size = doc.content.size;
  let from = Math.max(0, Math.min(size, range[0]));
  let to = Math.max(from, Math.min(size, range[1]));
  // 범위가 걸친 글 덩어리 전체로 넓힌다
  doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    from = Math.min(from, pos);
    to = Math.max(to, pos + node.nodeSize);
    return false;
  });
  const out: Decoration[] = [];
  decosIn(doc, from, to, out);
  // find 는 범위에 닿기만 한 이웃 것도 돌려주므로 안에 든 것만 지운다
  const old = set.find(from, to).filter((d) => d.from >= from && d.to <= to);
  return set.remove(old).add(doc, out);
}

export const HwpMetrics = Extension.create<object, { enabled: boolean }>({
  name: 'hwpMetrics',

  addStorage() {
    return { enabled: false };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<HState>({
        key: hwpMetricsKey,
        state: {
          init: () => ({ decos: DecorationSet.empty, pending: null }),
          apply(tr, value, _old, state) {
            if (!storage.enabled) return value.decos === DecorationSet.empty ? value : { decos: DecorationSet.empty, pending: null };
            const meta = tr.getMeta(hwpMetricsKey) as 'all' | 'pending' | undefined;
            if (meta === 'all') return { decos: buildAll(state.doc), pending: null };
            let { decos, pending } = value;
            if (tr.docChanged) {
              decos = decos.map(tr.mapping, tr.doc);
              if (pending) pending = [tr.mapping.map(pending[0], -1), tr.mapping.map(pending[1], 1)];
              const r = changedRange(tr);
              // 처음 내용을 넣을 때(문서 전체가 바뀜)는 통째로
              if (r && r[0] <= 0 && r[1] >= tr.doc.content.size) return { decos: buildAll(tr.doc), pending: null };
              if (r) {
                // 한글 조합 중에는 글자 묶음의 꾸밈을 바꾸면 조합이 깨지므로, 끝난 뒤에 한다
                if (tr.getMeta('composition')) pending = pending ? [Math.min(pending[0], r[0]), Math.max(pending[1], r[1])] : r;
                else decos = refresh(decos, tr.doc, r);
              }
            }
            if (meta === 'pending' && pending) {
              decos = refresh(decos, tr.doc, pending);
              pending = null;
            }
            return { decos, pending };
          },
        },
        props: {
          decorations(state) {
            return hwpMetricsKey.getState(state)?.decos;
          },
        },
        view(view) {
          // 글꼴이 새로 올라오면 폭이 바뀌므로 다시 잰다 (쪽 나누기도 같은 때 다시 돈다)
          const fonts: FontFaceSet | undefined = typeof document !== 'undefined' ? (document as any).fonts : undefined;
          const onFonts = () => {
            widthCache.clear();
            if (storage.enabled && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(hwpMetricsKey, 'all').setMeta('addToHistory', false));
          };
          const onCompEnd = () =>
            setTimeout(() => {
              if (view.isDestroyed || view.composing || !hwpMetricsKey.getState(view.state)?.pending) return;
              view.dispatch(view.state.tr.setMeta(hwpMetricsKey, 'pending').setMeta('addToHistory', false));
            }, 0);
          fonts?.addEventListener('loadingdone', onFonts);
          view.dom.addEventListener('compositionend', onCompEnd);
          return {
            destroy() {
              fonts?.removeEventListener('loadingdone', onFonts);
              view.dom.removeEventListener('compositionend', onCompEnd);
            },
          };
        },
      }),
    ];
  },
});
