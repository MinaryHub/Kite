/**
 * 두 문서(사본과 지금)의 글 비교: 문단 단위로 맞춘 뒤, 바뀐 문단은 낱말 단위로 비교한다.
 */

export interface DiffPart {
  type: 'same' | 'del' | 'ins';
  text: string;
}
export interface DiffRow {
  /** same: 같은 문단 · del: 사본에만 · ins: 지금만 · mod: 고친 문단 */
  type: 'same' | 'del' | 'ins' | 'mod';
  parts: DiffPart[];
}

/** 문서 JSON → 문단 글 목록 (표는 칸마다 한 줄) */
export function paragraphsOf(doc: any): string[] {
  const out: string[] = [];
  const text = (n: any): string => (n.type === 'text' ? n.text || '' : n.type === 'hardBreak' ? ' ' : n.type === 'math' ? `[수식 ${n.attrs?.hwp || n.attrs?.latex || ''}]` : n.type === 'image' ? '[그림]' : (n.content || []).map(text).join(''));
  const walk = (n: any) => {
    if (!n) return;
    const kids: any[] = n.content || [];
    const inlineOnly = kids.length > 0 && kids.every((c) => c.type === 'text' || c.type === 'hardBreak' || c.type === 'image' || c.type === 'math' || c.type === 'footnote');
    if (n.type !== 'doc' && (inlineOnly || !kids.length) && n.type !== 'table' && n.type !== 'tableRow') {
      const t = text(n).trim();
      if (t) out.push(t);
      return;
    }
    kids.forEach(walk);
  };
  walk(doc);
  return out;
}

/** 최장 공통 부분열로 맞춘 편집 목록 (앞뒤 같은 부분은 먼저 떼어 낸다) */
function align<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): { type: 'same' | 'del' | 'ins'; a?: T; b?: T }[] {
  let s = 0;
  while (s < a.length && s < b.length && eq(a[s], b[s])) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && eq(a[a.length - 1 - e], b[b.length - 1 - e])) e++;
  const A = a.slice(s, a.length - e);
  const B = b.slice(s, b.length - e);
  const mid: { type: 'same' | 'del' | 'ins'; a?: T; b?: T }[] = [];
  if (A.length * B.length > 4_000_000) {
    // 너무 크면 통째로 바뀐 것으로
    A.forEach((x) => mid.push({ type: 'del', a: x }));
    B.forEach((y) => mid.push({ type: 'ins', b: y }));
  } else {
    const n = A.length;
    const m = B.length;
    const L = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * (m + 1) + j] = eq(A[i], B[j]) ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (eq(A[i], B[j])) mid.push({ type: 'same', a: A[i++], b: B[j++] });
      else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) mid.push({ type: 'del', a: A[i++] });
      else mid.push({ type: 'ins', b: B[j++] });
    }
    while (i < n) mid.push({ type: 'del', a: A[i++] });
    while (j < m) mid.push({ type: 'ins', b: B[j++] });
  }
  return [...a.slice(0, s).map((x, k) => ({ type: 'same' as const, a: x, b: b[k] })), ...mid, ...a.slice(a.length - e).map((x, k) => ({ type: 'same' as const, a: x, b: b[b.length - e + k] }))];
}

function wordDiff(a: string, b: string): DiffPart[] {
  const ta = a.match(/\s+|[^\s]+/g) || [];
  const tb = b.match(/\s+|[^\s]+/g) || [];
  const parts: DiffPart[] = [];
  for (const op of align(ta, tb, (x, y) => x === y)) {
    const text = (op.type === 'ins' ? op.b : op.a) as string;
    const last = parts[parts.length - 1];
    if (last && last.type === op.type) last.text += text;
    else parts.push({ type: op.type, text });
  }
  return parts;
}

/** 비슷한 문단인지 (낱말이 절반 넘게 같으면 '고친 문단'으로 본다) */
function similar(a: string, b: string): boolean {
  const wa = new Set(a.split(/\s+/));
  const wb = b.split(/\s+/);
  const same = wb.filter((w) => wa.has(w)).length;
  return same * 2 >= Math.max(wa.size, wb.length);
}

export function diffDocs(oldDoc: any, newDoc: any): DiffRow[] {
  const ops = align(paragraphsOf(oldDoc), paragraphsOf(newDoc), (x, y) => x === y);
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'same') {
      rows.push({ type: 'same', parts: [{ type: 'same', text: ops[k].a! }] });
      k++;
      continue;
    }
    // 바뀐 덩어리: 지운 문단과 넣은 문단을 차례로 짝지어, 비슷하면 '고친 문단'으로
    const dels: string[] = [];
    const inss: string[] = [];
    while (k < ops.length && ops[k].type !== 'same') {
      if (ops[k].type === 'del') dels.push(ops[k].a!);
      else inss.push(ops[k].b!);
      k++;
    }
    let j = 0;
    for (const d of dels) {
      if (j < inss.length && similar(d, inss[j])) rows.push({ type: 'mod', parts: wordDiff(d, inss[j++]) });
      else rows.push({ type: 'del', parts: [{ type: 'del', text: d }] });
    }
    for (; j < inss.length; j++) rows.push({ type: 'ins', parts: [{ type: 'ins', text: inss[j] }] });
  }
  return rows;
}
