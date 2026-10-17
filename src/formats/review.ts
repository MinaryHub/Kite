/** 검토 표시(변경 내용·메모)를 다루는 저장용 도우미 (편집기 없이 쓴다) */

/** 저장용: 변경을 모두 받아들인 문서 JSON (변경 기록을 지원하지 않는 형식으로 저장할 때) */
export function acceptAllJson(doc: any): any {
  const walk = (n: any): any => {
    if (!n || typeof n !== 'object') return n;
    if (n.type === 'text') {
      const marks = (n.marks || []).filter((m: any) => m.type !== 'insertion' && m.type !== 'comment');
      if ((n.marks || []).some((m: any) => m.type === 'deletion')) return null;
      return marks.length ? { ...n, marks } : { type: 'text', text: n.text };
    }
    if (!n.content) return n;
    const content = n.content.map(walk).filter((c: any) => c !== null);
    return { ...n, content };
  };
  return walk(doc);
}

/** 문서에 변경 표시나 메모가 있는가 (JSON) */
export function hasReviewMarks(doc: any): { changes: boolean; comments: boolean } {
  let changes = false;
  let comments = false;
  const walk = (n: any) => {
    if (!n || typeof n !== 'object' || (changes && comments)) return;
    for (const m of n.marks || []) {
      if (m.type === 'insertion' || m.type === 'deletion') changes = true;
      if (m.type === 'comment') comments = true;
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return { changes, comments };
}
