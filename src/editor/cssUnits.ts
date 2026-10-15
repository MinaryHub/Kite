/** CSS 길이 → pt */
export function cssToPt(v: string | null | undefined, basePt = 10): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(-?[\d.]+)\s*(pt|px|mm|cm|in|em|rem|%)?$/i.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  switch ((m[2] || 'px').toLowerCase()) {
    case 'pt':
      return n;
    case 'px':
      return (n * 72) / 96;
    case 'mm':
      return (n * 72) / 25.4;
    case 'cm':
      return (n * 720) / 25.4;
    case 'in':
      return n * 72;
    case 'em':
    case 'rem':
      return n * basePt;
    case '%':
      return (n / 100) * basePt;
  }
  return null;
}

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** line-height CSS 값 정규화: 배수(문자열 "1.6") 또는 "20pt" */
export function normLineHeight(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s || s === 'normal') return null;
  if (/^[\d.]+$/.test(s)) return String(r2(parseFloat(s)));
  if (/%$/.test(s)) return String(r2(parseFloat(s) / 100));
  const pt = cssToPt(s);
  return pt != null ? `${r2(pt)}pt` : null;
}
