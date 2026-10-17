import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useEditorTick } from '../app/hooks';
import { app } from '../app/controller';
import { Icon } from './Icon';
import { runRules, textRuns, issueKey, type CheckIssue } from '../check/checker';
import { CATEGORY_LABEL, type CheckCategory } from '../check/rules';
import { checkMarksKey, currentCheckRanges } from '../editor/extensions/checkMarks';
import { aiComplete, aiAvailable, extractJson } from '../ai/client';
import type { Editor } from '@tiptap/react';

/**
 * 문서 검사 창 (F8): 맞춤법·띄어쓰기·공문서 표기·순화어·문장 부호 규칙 검사 + AI 교정.
 * 찾은 곳은 문서에 물결 밑줄로 보이고, 하나씩 또는 한꺼번에 고칠 수 있다.
 */

const ALL: CheckCategory[] = ['spelling', 'spacing', 'official', 'plain', 'punct', 'ai'];
const LS_CATS = 'kite:check:cats';

function loadCats(): Set<CheckCategory> {
  try {
    const v = JSON.parse(localStorage.getItem(LS_CATS) || 'null');
    if (Array.isArray(v)) return new Set(v);
  } catch {
    /* 무시 */
  }
  return new Set(['spelling', 'spacing', 'official', 'plain', 'punct']);
}

/** 문서 밑줄을 검사 결과와 맞춘다 */
function syncMarks(editor: Editor, issues: CheckIssue[], current: string | null) {
  const tr = editor.state.tr.setMeta(checkMarksKey, { marks: issues.map((i) => ({ id: i.id, from: i.from, to: i.to, cat: i.cat })), current });
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

const AI_SYSTEM = `당신은 한국어 교정 전문가입니다. 번호가 붙은 문단들의 맞춤법, 띄어쓰기, 문법, 어색한 표현 오류만 찾습니다.
- 내용·문체·용어를 바꾸지 말고 확실한 오류만 고칩니다. 공문서의 개조식 문체(~함, ~임)는 오류가 아닙니다.
- 답은 JSON 배열 하나만: [{"p": 문단 번호, "wrong": "문단에 있는 그대로의 틀린 부분(짧게)", "right": "고친 말", "reason": "짧은 이유"}]
- 오류가 없으면 [] 만 답합니다.`;

export function CheckPanel() {
  const appState = useApp();
  const tab = appState.active;
  const editor = tab?.editor || null;
  useEditorTick(editor);
  const [issues, setIssues] = useState<CheckIssue[]>([]);
  const [cats, setCats] = useState<Set<CheckCategory>>(loadCats);
  const [filter, setFilter] = useState<CheckCategory | 'all'>('all');
  const [current, setCurrent] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const ignored = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);

  const run = (keepAi = true) => {
    if (!editor) return;
    const rule = runRules(editor.state.doc, new Set([...cats].filter((c) => c !== 'ai')), ignored.current);
    // AI 가 찾은 것은 밑줄이 남아 있으면 그대로 둔다
    const ranges = currentCheckRanges(editor.state);
    const ai = keepAi ? issues.filter((i) => i.cat === 'ai' && ranges.has(i.id)).map((i) => ({ ...i, ...ranges.get(i.id)! })) : [];
    const merged = [...rule, ...ai.filter((a) => !rule.some((r) => a.from < r.to && a.to > r.from))].sort((a, b) => a.from - b.from);
    setIssues(merged);
    syncMarks(editor, merged, null);
    setCurrent(null);
  };

  // 창을 열 때와 문서를 바꿀 때 검사
  useEffect(() => {
    if (!appState.checkOpen || !editor) return;
    run(false);
    return () => {
      aiAbort.current?.abort();
    };
  }, [appState.checkOpen, editor]);
  // 창을 닫으면 밑줄도 지운다
  useEffect(() => {
    if (!appState.checkOpen) for (const d of app.docs) syncMarks(d.editor, [], null);
  }, [appState.checkOpen]);

  // 밑줄이 따라 옮겨진 위치로 갱신 (고친 곳은 빠진다)
  const live = useMemo(() => {
    if (!editor) return [];
    const ranges = currentCheckRanges(editor.state);
    return issues.filter((i) => ranges.has(i.id)).map((i) => ({ ...i, ...ranges.get(i.id)! }));
  }, [issues, editor?.state]);

  if (!appState.checkOpen) return null;

  const shown = live.filter((i) => filter === 'all' || i.cat === filter);
  const counts = new Map<string, number>();
  for (const i of live) counts.set(i.cat, (counts.get(i.cat) || 0) + 1);

  const goto = (i: CheckIssue) => {
    if (!editor) return;
    setCurrent(i.id);
    editor.chain().setTextSelection({ from: i.from, to: i.to }).scrollIntoView().run();
    editor.view.dispatch(editor.state.tr.setMeta(checkMarksKey, { current: i.id }).setMeta('addToHistory', false));
  };

  /** 하나 고치기 (문서의 글자가 그대로일 때만) */
  const apply = (i: CheckIssue, tr = editor!.state.tr): boolean => {
    if (i.fix === null) return false;
    const now = tr.doc.textBetween(i.from, i.to, '\n', '￼');
    if (now !== i.text) return false;
    const marks = tr.doc.resolve(i.from + 1 > i.to ? i.from : i.from + 1).marks();
    if (i.fix === '') tr.delete(i.from, i.to);
    else tr.replaceWith(i.from, i.to, editor!.schema.text(i.fix, marks));
    return true;
  };
  const fixOne = (i: CheckIssue) => {
    if (!editor) return;
    const tr = editor.state.tr;
    if (!apply(i, tr)) {
      app.toast('글자가 바뀌어 고칠 수 없습니다. 다시 검사하세요.', 'warn');
      return;
    }
    editor.view.dispatch(tr);
  };
  const fixAll = () => {
    if (!editor) return;
    const tr = editor.state.tr;
    let n = 0;
    // 뒤에서부터 고쳐야 앞의 위치가 그대로다
    for (const i of [...shown].filter((x) => x.fix !== null).sort((a, b) => b.from - a.from)) if (apply(i, tr)) n++;
    if (n) editor.view.dispatch(tr);
    app.toast(n ? `${n}곳을 고쳤습니다. (되돌리기: Ctrl+Z)` : '고칠 곳이 없습니다.');
  };
  const ignore = (i: CheckIssue, all: boolean) => {
    if (all) ignored.current.add(issueKey(i));
    const rest = issues.filter((x) => x.id !== i.id && !(all && issueKey(x) === issueKey(i)));
    setIssues(rest);
    if (editor) syncMarks(editor, live.filter((x) => rest.some((r) => r.id === x.id)), null);
  };
  const toggleCat = (c: CheckCategory) => {
    const next = new Set(cats);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCats(next);
    try {
      localStorage.setItem(LS_CATS, JSON.stringify([...next]));
    } catch {
      /* 무시 */
    }
  };

  /** AI 교정: 문단을 묶어 보내고 답을 문서 위치로 바꾼다 */
  const runAi = async () => {
    if (!editor) return;
    if (aiBusy) {
      aiAbort.current?.abort();
      return;
    }
    const sel = editor.state.selection;
    const runs = textRuns(editor.state.doc).filter((r) => sel.empty || (r.pos[r.pos.length - 1] > sel.from && r.pos[0] < sel.to));
    if (!runs.length) return;
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    const found: CheckIssue[] = [];
    const batches: number[][] = [];
    let cur: number[] = [];
    let size = 0;
    runs.forEach((r, k) => {
      if (size + r.text.length > 5000 && cur.length) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(k);
      size += r.text.length;
    });
    if (cur.length) batches.push(cur);
    try {
      for (let b = 0; b < batches.length; b++) {
        if (ctrl.signal.aborted) break;
        setAiBusy(`AI 교정 중… (${b + 1}/${batches.length})`);
        const ids = batches[b];
        const user = ids.map((k, n) => `[${n + 1}] ${runs[k].text.replace(/\n/g, ' ')}`).join('\n');
        const answer = await aiComplete(AI_SYSTEM, user, { signal: ctrl.signal });
        const list = extractJson<{ p: number; wrong: string; right: string; reason?: string }[]>(answer) || [];
        for (const it of Array.isArray(list) ? list : []) {
          const run = runs[ids[(it?.p | 0) - 1]];
          if (!run || typeof it.wrong !== 'string' || typeof it.right !== 'string' || !it.wrong || it.wrong === it.right) continue;
          const at = run.text.indexOf(it.wrong);
          if (at < 0) continue;
          const from = run.pos[at];
          const to = run.pos[at + it.wrong.length - 1] + 1;
          found.push({ id: `ai:${from}:${it.wrong}:${it.right}`, cat: 'ai', from, to, text: it.wrong, fix: it.right, reason: it.reason || 'AI 교정', context: run.text.slice(Math.max(0, at - 14), at + it.wrong.length + 14) });
        }
      }
    } catch (e: any) {
      if (!ctrl.signal.aborted) app.toast(String(e?.message || e), 'error', 6000);
    } finally {
      setAiBusy(null);
      aiAbort.current = null;
    }
    if (!found.length) {
      if (!ctrl.signal.aborted) app.toast('AI가 더 고칠 곳을 찾지 못했습니다.');
      return;
    }
    const ranges = currentCheckRanges(editor.state);
    const base = issues.filter((i) => ranges.has(i.id)).map((i) => ({ ...i, ...ranges.get(i.id)! }));
    const merged = [...base, ...found.filter((a) => !base.some((r) => a.from < r.to && a.to > r.from))].sort((a, b) => a.from - b.from);
    setIssues(merged);
    syncMarks(editor, merged, null);
    if (!cats.has('ai')) toggleCat('ai');
    app.toast(`AI가 ${found.length}곳을 찾았습니다.`);
  };

  return (
    <aside className="side-panel check-panel">
      <div className="ai-head">
        <b>문서 검사</b>
        <span style={{ flex: 1 }} />
        <button className="tb-btn" title="다시 검사" onClick={() => run()}>
          <Icon name="RotateCcw" size={14} />
        </button>
        <button className="tb-btn" title="닫기" onClick={() => app.set({ checkOpen: false })}>
          <Icon name="X" size={14} />
        </button>
      </div>
      <div className="chk-cats">
        {ALL.map((c) => (
          <label key={c} className={'chk-cat chk-c-' + c}>
            <input type="checkbox" checked={cats.has(c)} onChange={() => toggleCat(c)} disabled={c === 'ai'} />
            {CATEGORY_LABEL[c]}
          </label>
        ))}
      </div>
      <div className="chk-actions">
        <button className="btn" onClick={runAi} disabled={!aiAvailable()} title={aiAvailable() ? '선택 영역(없으면 문서 전체)을 AI로 교정' : '데스크톱 앱에서 쓸 수 있습니다'}>
          <Icon name={aiBusy ? 'X' : 'Sparkles'} size={14} /> {aiBusy ? '멈추기' : 'AI 교정'}
        </button>
        <button className="btn primary" onClick={fixAll} disabled={!shown.some((i) => i.fix !== null)}>
          보이는 것 모두 고치기
        </button>
      </div>
      {aiBusy && <div className="chk-busy">{aiBusy}</div>}
      <div className="chk-filter">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          전체 {live.length}
        </button>
        {ALL.filter((c) => counts.get(c)).map((c) => (
          <button key={c} className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>
            {CATEGORY_LABEL[c]} {counts.get(c)}
          </button>
        ))}
      </div>
      <div className="chk-list" ref={listRef}>
        {shown.length === 0 && <div className="chk-empty">{live.length ? '이 분류에는 찾은 곳이 없습니다.' : '고칠 곳을 찾지 못했습니다.'}</div>}
        {shown.map((i) => (
          <div key={i.id} className={'chk-item' + (i.id === current ? ' sel' : '')} onClick={() => goto(i)}>
            <div className="chk-line">
              <span className={'chk-badge chk-c-' + i.cat}>{CATEGORY_LABEL[i.cat]}</span>
              <span className="chk-wrong">{i.text.replace(/ /g, '␣')}</span>
              {i.fix !== null && (
                <>
                  <Icon name="ArrowRight" size={12} />
                  <span className="chk-right">{i.fix === '' ? '(지움)' : i.fix.replace(/ /g, '␣')}</span>
                </>
              )}
            </div>
            <div className="chk-reason">{i.reason}</div>
            <div className="chk-ctx">{i.context}</div>
            <div className="chk-btns" onClick={(e) => e.stopPropagation()}>
              {i.fix !== null && (
                <button className="btn small primary" onClick={() => fixOne(i)}>
                  고치기
                </button>
              )}
              <button className="btn small" onClick={() => ignore(i, false)}>
                건너뛰기
              </button>
              <button className="btn small" onClick={() => ignore(i, true)} title="이 문서에서 같은 지적을 모두 무시">
                모두 무시
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
