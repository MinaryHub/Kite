import { useEffect, useRef, useState } from 'react';
import { useApp, useEditorTick } from '../app/hooks';
import { app } from '../app/controller';
import { Icon } from './Icon';
import * as review from '../app/review';
import { authorHue } from '../editor/extensions/trackChanges';

/** 검토 창: 메모와 변경 내용(넣음/지움)을 모아 보고 처리한다 */

const when = (t: number) => {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
};

function Avatar({ name }: { name: string }) {
  return (
    <span className="rv-avatar" style={{ background: `hsl(${authorHue(name)}, 55%, 45%)` }}>
      {(name || '?').slice(0, 1)}
    </span>
  );
}

export function ReviewPanel() {
  const appState = useApp();
  const tab = appState.active;
  const editor = tab?.editor || null;
  useEditorTick(editor);
  const [draft, setDraft] = useState('');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (appState.reviewOpen && appState.commentDraft) {
      setTimeout(() => draftRef.current?.focus(), 0);
      app.commentDraft = false;
    }
  }, [appState.reviewOpen, appState.commentDraft]);

  // 본문의 메모 표시를 누르면 그 메모로
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('.k-comment') as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute('data-comment-id');
      if (id && (tab?.settings.comments || {})[id]) {
        setFocusId(id);
        if (!app.reviewOpen || app.reviewTab !== 'comments') app.set({ reviewOpen: true, reviewTab: 'comments' });
      }
    };
    dom.addEventListener('click', onClick);
    return () => dom.removeEventListener('click', onClick);
  }, [editor]);
  useEffect(() => {
    if (focusId) document.querySelector(`.rv-card[data-id="${focusId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusId]);

  if (!appState.reviewOpen || !tab || !editor) return null;
  const tracking = review.trackingOn(tab);
  const comments = review.commentList(tab);
  const shownComments = comments.filter((c) => showResolved || !c.resolved);
  const rawChanges = review.changes(tab);
  // 같은 사람이 지운 바로 뒤에 넣은 것(또는 같은 변경 id)은 '바꿈' 한 장으로
  const changes: { id: string; ids: string[]; author: string; time: number; from: number; to: number; del: string; ins: string }[] = [];
  for (const c of rawChanges) {
    const prev = changes[changes.length - 1];
    if (prev && prev.author === c.author && ((c.type === 'insertion' && prev.del && !prev.ins && prev.to === c.from) || prev.ids.some((i) => c.ids.includes(i)))) {
      prev.to = Math.max(prev.to, c.to);
      if (c.type === 'insertion') prev.ins += c.text;
      else prev.del += c.text;
      prev.ids.push(...c.ids.filter((i) => !prev.ids.includes(i)));
    } else changes.push({ id: c.id, ids: [...c.ids], author: c.author, time: c.time, from: c.from, to: c.to, del: c.type === 'deletion' ? c.text : '', ins: c.type === 'insertion' ? c.text : '' });
  }
  const hasSel = !editor.state.selection.empty;

  const goto = (from: number, to: number) => {
    if (!isFinite(from)) return;
    editor.chain().setTextSelection({ from, to }).scrollIntoView().run();
  };
  const addDraft = () => {
    const id = review.addComment(draft);
    if (id) {
      setDraft('');
      setFocusId(id);
    }
  };

  return (
    <aside className="side-panel review-panel">
      <div className="ai-head">
        <b>검토</b>
        <span style={{ flex: 1 }} />
        <button className="tb-btn" title="닫기" onClick={() => app.set({ reviewOpen: false })}>
          <Icon name="X" size={14} />
        </button>
      </div>
      <div className="rv-tabs">
        <button className={appState.reviewTab === 'comments' ? 'on' : ''} onClick={() => app.set({ reviewTab: 'comments' })}>
          메모 {comments.filter((c) => !c.resolved).length || ''}
        </button>
        <button className={appState.reviewTab === 'changes' ? 'on' : ''} onClick={() => app.set({ reviewTab: 'changes' })}>
          변경 내용 {changes.length || ''}
        </button>
      </div>

      {appState.reviewTab === 'comments' ? (
        <>
          <div className="rv-new">
            <textarea
              ref={draftRef}
              rows={2}
              value={draft}
              placeholder={hasSel ? '선택한 글자에 달 메모 (Ctrl+Enter)' : '메모를 달 글자를 선택하거나, 커서가 있는 낱말에 답니다 (Ctrl+Enter)'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  addDraft();
                }
              }}
            />
            <button className="btn primary small" onClick={addDraft} disabled={!draft.trim()}>
              메모 달기
            </button>
          </div>
          <label className="check rv-resolved">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            해결한 메모도 보기
          </label>
          <div className="rv-list">
            {shownComments.length === 0 && <div className="chk-empty">메모가 없습니다.</div>}
            {shownComments.map((c) => (
              <div key={c.id} data-id={c.id} className={'rv-card' + (focusId === c.id ? ' sel' : '') + (c.resolved ? ' resolved' : '')} onClick={() => (setFocusId(c.id), goto(c.from, c.to))}>
                <div className="rv-quote">{c.orphan ? '(본문이 지워진 메모)' : `“${c.quote.slice(0, 80)}${c.quote.length > 80 ? '…' : ''}”`}</div>
                <div className="rv-msg">
                  <Avatar name={c.author} />
                  <div>
                    <div className="rv-meta">
                      <b>{c.author}</b> · {when(c.time)}
                    </div>
                    <div className="rv-text">{c.text}</div>
                  </div>
                </div>
                {(c.replies || []).map((r, k) => (
                  <div key={k} className="rv-msg rv-reply">
                    <Avatar name={r.author} />
                    <div>
                      <div className="rv-meta">
                        <b>{r.author}</b> · {when(r.time)}
                      </div>
                      <div className="rv-text">{r.text}</div>
                    </div>
                  </div>
                ))}
                <div className="rv-btns" onClick={(e) => e.stopPropagation()}>
                  {replyFor === c.id ? (
                    <div className="rv-replybox">
                      <textarea
                        rows={2}
                        autoFocus
                        value={reply}
                        placeholder="답글 (Ctrl+Enter)"
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            review.replyComment(c.id, reply);
                            setReply('');
                            setReplyFor(null);
                          } else if (e.key === 'Escape') setReplyFor(null);
                        }}
                      />
                      <button
                        className="btn small primary"
                        onClick={() => {
                          review.replyComment(c.id, reply);
                          setReply('');
                          setReplyFor(null);
                        }}
                      >
                        답글
                      </button>
                    </div>
                  ) : (
                    <>
                      <button className="btn small" onClick={() => (setReplyFor(c.id), setReply(''))}>
                        <Icon name="Reply" size={12} /> 답글
                      </button>
                      <button className="btn small" onClick={() => review.setResolved(c.id, !c.resolved)}>
                        <Icon name="CircleCheck" size={12} /> {c.resolved ? '다시 열기' : '해결'}
                      </button>
                      <button className="btn small" onClick={() => review.deleteComment(c.id)} title="메모 지우기">
                        <Icon name="Trash2" size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="rv-track">
            <label className="switch">
              <input type="checkbox" checked={tracking} onChange={() => review.setTracking(!tracking)} />
              <span>변경 내용 기록 {tracking ? '켜짐' : '꺼짐'}</span>
            </label>
            <span className="rv-me">이름: {review.authorName()}</span>
          </div>
          <div className="chk-actions">
            <button className="btn" onClick={() => app.toast(`${review.resolve(true, { all: true })}개를 받아들였습니다.`)} disabled={!changes.length}>
              <Icon name="CheckCheck" size={14} /> 모두 받아들이기
            </button>
            <button className="btn" onClick={() => app.toast(`${review.resolve(false, { all: true })}개를 되돌렸습니다.`)} disabled={!changes.length}>
              <Icon name="Undo" size={14} /> 모두 되돌리기
            </button>
          </div>
          <div className="rv-list">
            {changes.length === 0 && <div className="chk-empty">{tracking ? '아직 변경이 없습니다. 고치는 내용이 여기에 쌓입니다.' : '변경 내용이 없습니다. "변경 내용 기록"을 켜면 고친 내용이 표시됩니다.'}</div>}
            {changes.map((c, k) => (
              <div key={c.id + k} className="rv-card" onClick={() => goto(c.from, c.to)}>
                <div className="rv-msg">
                  <Avatar name={c.author} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="rv-meta">
                      <b>{c.author}</b> · {c.ins && c.del ? '바꿈' : c.ins ? '넣음' : '지움'} · {when(c.time)}
                    </div>
                    {c.del && (
                      <div className="rv-change del" style={{ ['--tc-hue' as any]: authorHue(c.author) }}>
                        {c.del.slice(0, 160)}
                        {c.del.length > 160 ? '…' : ''}
                      </div>
                    )}
                    {c.ins && (
                      <div className="rv-change ins" style={{ ['--tc-hue' as any]: authorHue(c.author) }}>
                        {c.ins.slice(0, 160)}
                        {c.ins.length > 160 ? '…' : ''}
                      </div>
                    )}
                  </div>
                </div>
                <div className="rv-btns" onClick={(e) => e.stopPropagation()}>
                  <button className="btn small primary" onClick={() => review.resolve(true, { ids: c.ids })}>
                    <Icon name="Check" size={12} /> 받아들이기
                  </button>
                  <button className="btn small" onClick={() => review.resolve(false, { ids: c.ids })}>
                    <Icon name="X" size={12} /> 되돌리기
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
