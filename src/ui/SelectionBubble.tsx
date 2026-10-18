import { useEffect, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { useApp, useEditorTick } from '../app/hooks';
import { app } from '../app/controller';
import { Icon } from './Icon';
import { aiAvailable, aiComplete, currentAi } from '../ai/client';
import { reportAiResponse } from '../ai/report';
import { listChanges, newChangeId, resolveChanges, TRACK_SKIP } from '../editor/extensions/trackChanges';

/**
 * 선택 영역 위에 뜨는 작은 도구 막대: AI 로 고치기(다듬기·줄이기·공문서체·번역 …)와 메모 달기.
 * AI 결과는 바로 덮어쓰지 않고 'AI' 의 변경 제안(지움+넣음)으로 넣어, 그 자리에서 받아들이거나 되돌린다.
 */

const ACTIONS: { id: string; label: string; prompt: string }[] = [
  { id: 'polish', label: '매끄럽게 다듬기', prompt: '뜻은 그대로 두고 더 읽기 쉽고 매끄럽게 다듬어 주세요.' },
  { id: 'short', label: '더 짧게', prompt: '핵심은 남기고 더 짧고 간결하게 줄여 주세요.' },
  { id: 'long', label: '더 자세히', prompt: '뜻을 살려 조금 더 구체적이고 자세하게 늘려 주세요.' },
  { id: 'official', label: '공문서체로', prompt: '공문서·보고서에 맞는 개조식 문체(~함, ~임)로 바꿔 주세요.' },
  { id: 'easy', label: '쉬운 말로', prompt: '어려운 한자어·전문 용어를 쉬운 우리말로 바꿔 누구나 이해하게 써 주세요.' },
  { id: 'spell', label: '맞춤법만 고치기', prompt: '맞춤법·띄어쓰기·문법 오류만 바로잡고 나머지는 그대로 두세요.' },
  { id: 'en', label: '영어로 번역', prompt: '자연스러운 영어로 번역해 주세요.' },
  { id: 'ko', label: '한국어로 번역', prompt: '자연스러운 한국어로 번역해 주세요.' },
];

const SYSTEM = `당신은 한국어 문서 편집기 Kite 의 글쓰기 도우미입니다. 사용자가 고른 글을 지시대로 고쳐 씁니다.
- 고친 결과 글만 답합니다. 설명, 따옴표, 머리말, Markdown 기호를 붙이지 마세요.
- 문단 구분은 빈 줄 하나로 나타냅니다.
- 고유 명사·숫자·날짜는 바꾸지 마세요.`;

type Phase = { kind: 'idle' } | { kind: 'menu' } | { kind: 'ask' } | { kind: 'busy'; text: string } | { kind: 'done'; changeId: string; text: string };

export function SelectionBubble() {
  const appState = useApp();
  const tab = appState.active;
  const editor = tab?.editor || null;
  useEditorTick(editor);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [mouseDown, setMouseDown] = useState(false);
  const [ask, setAsk] = useState('');
  const ctrl = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lastSel = useRef<string>('');

  // 끌어서 고르는 동안은 숨긴다
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setMouseDown(true);
    };
    const up = () => setMouseDown(false);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('mouseup', up, true);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('mouseup', up, true);
    };
  }, []);

  if (!editor || appState.multiPage || appState.paletteOpen || appState.dialog) return null;
  const sel = editor.state.selection;
  const selKey = `${sel.from}-${sel.to}`;
  // 선택이 바뀌면 처음 상태로 (끝난 제안을 보여 주는 중이면 그 범위 안에서는 유지)
  if (selKey !== lastSel.current) {
    lastSel.current = selKey;
    if (phase.kind === 'menu' || phase.kind === 'ask' || (phase.kind === 'done' && sel.empty)) setTimeout(() => setPhase({ kind: 'idle' }), 0);
  }
  const showSel = !sel.empty && sel instanceof TextSelection && editor.isFocused;
  if (!(showSel || phase.kind === 'busy' || phase.kind === 'done' || ((phase.kind === 'menu' || phase.kind === 'ask') && !sel.empty)) || mouseDown) return null;

  let top = 0;
  let left = 0;
  try {
    const a = editor.view.coordsAtPos(sel.from);
    const b = editor.view.coordsAtPos(sel.to);
    top = Math.min(a.top, b.top) - 44;
    left = Math.max(8, Math.min(a.left, window.innerWidth - 360));
    if (top < 90) top = Math.max(a.bottom, b.bottom) + 8;
  } catch {
    return null;
  }

  const run = async (instruction: string) => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, '\n\n', ' ');
    if (!text.trim()) return;
    const c = new AbortController();
    ctrl.current = c;
    setPhase({ kind: 'busy', text: 'AI가 쓰는 중…' });
    try {
      const out = (await aiComplete(SYSTEM, `${instruction}\n\n<글>\n${text}\n</글>`, { signal: c.signal })).trim().replace(/^<글>\s*|\s*<\/글>$/g, '');
      if (c.signal.aborted || !out) {
        setPhase({ kind: 'idle' });
        return;
      }
      const id = applySuggestion(from, to, out);
      setPhase(id ? { kind: 'done', changeId: id, text: out } : { kind: 'idle' });
    } catch (e: any) {
      if (!c.signal.aborted) app.toast(String(e?.message || e), 'error', 6000);
      setPhase({ kind: 'idle' });
    } finally {
      ctrl.current = null;
    }
  };

  /** from..to 를 'AI' 의 변경 제안으로 바꾼다 */
  const applySuggestion = (from: number, to: number, out: string): string | null => {
    const { state } = editor;
    // 그 사이 글이 바뀌었으면 넣지 않는다
    if (to > state.doc.content.size) return null;
    const schema = state.schema;
    const id = newChangeId();
    const author = `AI (${currentAi().model})`;
    const time = Date.now();
    const insMark = schema.marks.insertion.create({ id, author, time });
    const delMark = schema.marks.deletion.create({ id, author, time });
    const baseMarks = state.doc.resolve(from + 1 <= to ? from + 1 : from).marks().filter((m) => m.type.name !== 'insertion' && m.type.name !== 'deletion');
    const tr = state.tr;
    tr.addMark(from, to, delMark);
    const paras = out.split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
    let slice: Slice;
    if (paras.length <= 1) slice = new Slice(Fragment.from(schema.text(paras[0] || out, [...baseMarks, insMark])), 0, 0);
    else {
      const parent = state.doc.resolve(from).parent;
      const ptype = parent.type.name === 'paragraph' || parent.type.name === 'heading' ? parent.type : schema.nodes.paragraph;
      const nodes = paras.map((p) => ptype.create(parent.type === ptype ? parent.attrs : null, schema.text(p, [...baseMarks, insMark])));
      slice = new Slice(Fragment.from(nodes), 1, 1);
    }
    tr.replace(to, to, slice);
    tr.setMeta(TRACK_SKIP, true);
    editor.view.dispatch(tr.scrollIntoView());
    return id;
  };

  const resolveDone = (accept: boolean) => {
    if (phase.kind !== 'done') return;
    const { state } = editor;
    const mine = listChanges(state.doc).filter((c) => c.ids.includes(phase.changeId));
    const tr = resolveChanges(state, accept, (c) => c.ids.includes(phase.changeId));
    if (tr && mine.length) {
      // 여러 문단 답을 넣으며 나뉜 문단을 다시 잇는다:
      // 받아들이면 지운 글 자리(빈 문단)~넣은 글 앞, 거부하면 지운 글 끝~넣은 글 끝 사이에 남은 문단 경계를 없앤다
      const dels = mine.filter((c) => c.type === 'deletion');
      const ins = mine.filter((c) => c.type === 'insertion');
      if (dels.length && ins.length) {
        const a = accept ? Math.min(...dels.map((c) => c.from)) : Math.max(...dels.map((c) => c.to));
        const b = accept ? Math.min(...ins.map((c) => c.from)) : Math.max(...ins.map((c) => c.to));
        const ma = tr.mapping.map(a, -1);
        const mb = tr.mapping.map(b, 1);
        if (mb > ma && !tr.doc.textBetween(ma, mb, '', '').trim()) tr.delete(ma, mb);
      }
      tr.setMeta(TRACK_SKIP, true);
      editor.view.dispatch(tr);
    }
    setPhase({ kind: 'idle' });
    editor.commands.focus();
  };

  const style: React.CSSProperties = { top, left };
  return (
    <div className="sel-bubble" ref={boxRef} style={style} onMouseDown={(e) => e.preventDefault()}>
      {phase.kind === 'busy' ? (
        <>
          <span className="sb-spin" />
          <span className="sb-note">{phase.text}</span>
          <button className="sb-btn" onClick={() => ctrl.current?.abort()}>
            멈추기
          </button>
        </>
      ) : phase.kind === 'done' ? (
        <>
          <Icon name="Sparkles" size={14} />
          <span className="sb-note" title="AI가 만든 내용은 틀리거나 부적절할 수 있습니다">AI 제안 · 확인 후 받아들이세요</span>
          <button className="sb-btn primary" onClick={() => resolveDone(true)} title="받아들이기">
            <Icon name="Check" size={14} /> 받아들이기
          </button>
          <button className="sb-btn" onClick={() => resolveDone(false)} title="되돌리기">
            <Icon name="Undo" size={14} /> 되돌리기
          </button>
          <span className="sb-sep" />
          <button className="sb-btn" title="부적절하거나 사실과 다른 응답 신고" onClick={() => phase.kind === 'done' && reportAiResponse({ provider: currentAi().provider, model: currentAi().model, text: phase.text })}>
            신고
          </button>
        </>
      ) : phase.kind === 'ask' ? (
        <>
          <input
            className="sb-ask"
            autoFocus
            value={ask}
            placeholder="어떻게 고칠까요? (예: 존댓말로, 3줄로 요약)"
            onChange={(e) => setAsk(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && ask.trim()) {
                e.preventDefault();
                run(ask.trim() + ' 결과만 보여 주세요.');
              } else if (e.key === 'Escape') setPhase({ kind: 'idle' });
            }}
          />
          <button className="sb-btn primary" disabled={!ask.trim()} onClick={() => run(ask.trim())}>
            실행
          </button>
        </>
      ) : (
        <>
          <button className={'sb-btn' + (phase.kind === 'menu' ? ' on' : '')} disabled={!aiAvailable()} title={aiAvailable() ? 'AI로 고치기' : '데스크톱 앱에서 쓸 수 있습니다'} onClick={() => setPhase(phase.kind === 'menu' ? { kind: 'idle' } : { kind: 'menu' })}>
            <Icon name="Sparkles" size={14} /> AI로 고치기 <Icon name="ChevronDown" size={12} />
          </button>
          <span className="sb-sep" />
          <button className="sb-btn" title="메모 달기" onClick={() => app.set({ reviewOpen: true, reviewTab: 'comments', commentDraft: true })}>
            <Icon name="MessageSquarePlus" size={14} /> 메모
          </button>
          {phase.kind === 'menu' && (
            <div className="sb-menu">
              {ACTIONS.map((a) => (
                <button key={a.id} onClick={() => run(a.prompt)}>
                  {a.label}
                </button>
              ))}
              <div className="sb-menu-sep" />
              <button onClick={() => (setAsk(''), setPhase({ kind: 'ask' }))}>직접 지시…</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
