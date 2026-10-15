import { useEffect, useRef, useState } from 'react';
import { useApp, useEditorTick } from '../app/hooks';
import { getSearchState } from '../editor/extensions/search';
import { Icon } from './Icon';

export function FindPanel() {
  const app = useApp();
  const tab = app.active;
  const editor = tab?.editor;
  useEditorTick(editor);
  const [query, setQuery] = useState('');
  const [rep, setRep] = useState('');
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const mode = app.findOpen;

  useEffect(() => {
    if (!mode || !editor) return;
    const { from, to } = editor.state.selection;
    if (to > from && to - from < 200) {
      const t = editor.state.doc.textBetween(from, to, ' ');
      if (t && !t.includes('\n')) setQuery(t);
    }
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
  }, [mode]);

  useEffect(() => {
    if (!mode || !editor) return;
    editor.commands.setSearch(query, opts);
  }, [query, opts, mode, editor]);

  useEffect(() => {
    if (!mode && editor) editor.commands.clearSearch();
  }, [mode]);

  if (!mode || !editor) return null;
  const st = getSearchState(editor.state);
  const count = st?.matches.length || 0;
  const cur = st && st.current >= 0 && count ? st.current + 1 : 0;
  const close = () => {
    app.set({ findOpen: null });
    editor.commands.focus();
  };
  const next = () => {
    if (!editor.commands.findNext() && query) app.toast('찾는 내용이 없습니다.', 'info', 1500);
  };
  const prev = () => editor.commands.findPrev();

  return (
    <div className="find-panel" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), close())}>
      <div className="fp-row">
        <Icon name="Search" size={14} />
        <input
          ref={inputRef}
          type="text"
          placeholder="찾을 내용"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.shiftKey ? prev() : next();
            }
          }}
        />
        <span className="fp-count">{query ? `${cur}/${count}` : ''}</span>
        <button className="tb-btn" title="이전 찾기 (Shift+Enter)" onClick={prev}>
          <Icon name="ArrowUp" size={14} />
        </button>
        <button className="tb-btn" title="다음 찾기 (Enter)" onClick={next}>
          <Icon name="ArrowDown" size={14} />
        </button>
        <button className="tb-btn" title={mode === 'find' ? '바꾸기 열기' : '바꾸기 닫기'} onClick={() => app.set({ findOpen: mode === 'find' ? 'replace' : 'find' })}>
          <Icon name="Replace" size={14} />
        </button>
        <button className="tb-btn" title="닫기 (Esc)" onClick={close}>
          <Icon name="X" size={14} />
        </button>
      </div>
      {mode === 'replace' && (
        <div className="fp-row">
          <span style={{ width: 14 }} />
          <input
            type="text"
            placeholder="바꿀 내용"
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                editor.commands.replaceCurrent(rep);
                editor.commands.findNext();
              }
            }}
          />
          <button
            className="btn small"
            disabled={!count}
            onClick={() => {
              editor.commands.replaceCurrent(rep);
              editor.commands.findNext();
            }}
          >
            바꾸기
          </button>
          <button
            className="btn small"
            disabled={!count}
            onClick={() => {
              const n = count;
              editor.commands.replaceAll(rep);
              app.toast(`${n}개를 바꾸었습니다.`);
            }}
          >
            모두 바꾸기
          </button>
        </div>
      )}
      <div className="fp-row" style={{ marginBottom: 0, gap: 12 }}>
        <span style={{ width: 14 }} />
        <label className="check">
          <input type="checkbox" checked={opts.caseSensitive} onChange={(e) => setOpts({ ...opts, caseSensitive: e.target.checked })} />
          대/소문자 구별
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.wholeWord} onChange={(e) => setOpts({ ...opts, wholeWord: e.target.checked })} />
          온전한 낱말
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.regex} onChange={(e) => setOpts({ ...opts, regex: e.target.checked })} />
          정규식
        </label>
      </div>
    </div>
  );
}
