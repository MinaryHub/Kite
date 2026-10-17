import type { DocTab } from '../doc/docTab';
import { app } from './controller';
import { isTracking, listChanges, resolveChanges, trackKey, type ChangeItem } from '../editor/extensions/trackChanges';
import { commentRanges, newCommentId, type CommentData } from '../editor/extensions/comments';

/** 검토(변경 내용 추적·메모) 동작 */

/** 변경·메모에 남길 이름 */
export function authorName(): string {
  return (app.prefs.userName || '').trim() || '사용자';
}

export function trackingOn(tab: DocTab | null = app.active): boolean {
  return !!tab && isTracking(tab.editor.state);
}

export function setTracking(on: boolean, tab: DocTab | null = app.active) {
  if (!tab) return;
  const tr = tab.editor.state.tr.setMeta(trackKey, { enabled: on, author: authorName() }).setMeta('addToHistory', false);
  tab.editor.view.dispatch(tr);
  // 다음 입력부터 표시가 맞도록 선택을 다시 알린다
  tab.editor.view.dispatch(tab.editor.state.tr.setSelection(tab.editor.state.selection).setMeta('addToHistory', false));
  app.toast(on ? '변경 내용을 기록합니다. 넣은 글자와 지운 글자가 표시됩니다.' : '변경 내용 기록을 껐습니다.');
  app.emit();
}

/** 이름이 바뀌면 열린 문서들의 추적 작성자도 바꾼다 */
export function refreshAuthor() {
  for (const d of app.docs) {
    const st = trackKey.getState(d.editor.state);
    if (st && st.author !== authorName()) d.editor.view.dispatch(d.editor.state.tr.setMeta(trackKey, { author: authorName() }).setMeta('addToHistory', false));
  }
}

export function changes(tab: DocTab | null = app.active): ChangeItem[] {
  return tab ? listChanges(tab.editor.state.doc) : [];
}

/** 변경을 받아들이거나 거부한다. id(들)를 주면 그 변경만, all 이면 전체, 아니면 선택 범위(빈 선택이면 커서가 놓인 변경) */
export function resolve(accept: boolean, opts: { id?: string; ids?: string[]; all?: boolean } = {}, tab: DocTab | null = app.active): number {
  if (opts.ids?.length) {
    let n = 0;
    for (const id of opts.ids) n += resolve(accept, { id }, tab);
    return n;
  }
  if (!tab) return 0;
  const { state } = tab.editor;
  const sel = state.selection;
  if (!opts.id && !opts.all && sel.empty) {
    // 빈 선택이면 커서가 놓인 변경 (없으면 아무것도 하지 않는다)
    const here = listChanges(state.doc).find((c) => c.from <= sel.from && sel.from <= c.to);
    return here ? resolve(accept, { ids: here.ids }, tab) : 0;
  }
  const range = opts.id || opts.all ? undefined : { from: sel.from, to: sel.to };
  const filter = opts.id ? (c: ChangeItem) => c.ids.includes(opts.id!) : undefined;
  const before = listChanges(state.doc).filter((c) => (!filter || filter(c)) && (!range || (c.from < range.to && c.to > range.from))).length;
  const tr = resolveChanges(state, accept, filter, range);
  if (!tr) return 0;
  tab.editor.view.dispatch(tr);
  return before;
}

// ---------------- 메모 ----------------
function store(tab: DocTab): Record<string, CommentData> {
  if (!tab.settings.comments) tab.settings.comments = {};
  return tab.settings.comments;
}

/** 선택 범위에 메모를 단다 */
export function addComment(text: string, tab: DocTab | null = app.active, author = authorName()): string | null {
  if (!tab || !text.trim()) return null;
  const ed = tab.editor;
  let { from, to } = ed.state.selection;
  if (from === to) {
    // 선택이 없으면 커서가 있는 낱말
    const $p = ed.state.selection.$from;
    const t = $p.parent.textContent;
    let a = $p.parentOffset;
    let b = a;
    while (a > 0 && /\S/.test(t[a - 1])) a--;
    while (b < t.length && /\S/.test(t[b])) b++;
    if (a === b) {
      app.toast('메모를 달 글자를 선택하세요.', 'warn');
      return null;
    }
    from = $p.start() + a;
    to = $p.start() + b;
  }
  const id = newCommentId();
  store(tab)[id] = { author, time: Date.now(), text: text.trim(), replies: [] };
  const tr = ed.state.tr.addMark(from, to, ed.schema.marks.comment.create({ id })).setMeta('trackChanges:skip', true);
  ed.view.dispatch(tr);
  tab.markDirty();
  app.emit();
  return id;
}

export function replyComment(id: string, text: string, tab: DocTab | null = app.active, author = authorName()) {
  if (!tab || !text.trim()) return;
  const c = store(tab)[id];
  if (!c) return;
  c.replies = [...(c.replies || []), { author, time: Date.now(), text: text.trim() }];
  tab.markDirty();
  app.emit();
}

export function editComment(id: string, text: string, tab: DocTab | null = app.active) {
  if (!tab) return;
  const c = store(tab)[id];
  if (!c || !text.trim()) return;
  c.text = text.trim();
  tab.markDirty();
  app.emit();
}

export function setResolved(id: string, resolved: boolean, tab: DocTab | null = app.active) {
  if (!tab) return;
  const c = store(tab)[id];
  if (!c) return;
  c.resolved = resolved;
  tab.markDirty();
  app.emit();
}

/** 메모를 지운다 (본문 표시도 함께) */
export function deleteComment(id: string, tab: DocTab | null = app.active) {
  if (!tab) return;
  const ed = tab.editor;
  const r = commentRanges(ed.state.doc).get(id);
  if (r) {
    const tr = ed.state.tr;
    ed.state.doc.nodesBetween(r.from, r.to, (n, pos) => {
      if (!n.isText) return true;
      for (const m of n.marks) if (m.type.name === 'comment' && m.attrs.id === id) tr.removeMark(pos, pos + n.nodeSize, m);
      return false;
    });
    tr.setMeta('trackChanges:skip', true);
    ed.view.dispatch(tr);
  }
  delete store(tab)[id];
  tab.markDirty();
  app.emit();
}

export interface CommentView extends CommentData {
  id: string;
  from: number;
  to: number;
  quote: string;
  orphan: boolean;
}

/** 메모 목록 (본문 순서, 본문이 지워진 메모는 끝에) */
export function commentList(tab: DocTab | null = app.active): CommentView[] {
  if (!tab) return [];
  const ranges = commentRanges(tab.editor.state.doc);
  const data = tab.settings.comments || {};
  const out: CommentView[] = [];
  for (const [id, c] of Object.entries(data)) {
    const r = ranges.get(id);
    out.push({ ...c, id, from: r?.from ?? Infinity, to: r?.to ?? Infinity, quote: r?.text || '', orphan: !r });
  }
  return out.sort((a, b) => a.from - b.from || a.time - b.time);
}
