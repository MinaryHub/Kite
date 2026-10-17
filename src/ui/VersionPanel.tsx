import { useEffect, useState } from 'react';
import { useApp } from '../app/hooks';
import { app } from '../app/controller';
import { Icon } from './Icon';
import * as versions from '../app/versions';
import { diffDocs, type DiffRow } from '../app/versionDiff';

/** 버전 기록 창: 남겨 둔 사본을 보고, 지금과 비교하고, 되돌리거나 새 탭으로 연다 */

const KIND: Record<versions.VersionMeta['kind'], string> = { save: '저장', auto: '자동', named: '이름', restore: '되돌리기 전' };

const dayOf = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return '오늘';
  if (d.toDateString() === y.toDateString()) return '어제';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
};
const hm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

export function VersionPanel() {
  const appState = useApp();
  const tab = appState.active;
  const [list, setList] = useState<versions.VersionMeta[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffRow[] | null>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const [showSame, setShowSame] = useState(false);

  const refresh = async () => {
    if (!tab) return setList([]);
    setList(await versions.list(tab));
  };
  useEffect(() => {
    if (appState.versionsOpen) void refresh();
    setSel(null);
    setDiff(null);
  }, [appState.versionsOpen, tab?.id, tab?.path]);

  useEffect(() => {
    if (sel == null || !tab) return setDiff(null);
    let alive = true;
    versions.load(sel).then((v) => {
      if (alive && v) setDiff(diffDocs(v.content, tab.editor.getJSON()));
    });
    return () => {
      alive = false;
    };
  }, [sel]);

  if (!appState.versionsOpen || !tab) return null;

  const saveNamed = async () => {
    const v = await versions.snapshot(tab, 'named', name.trim() || '이름 없는 버전');
    if (v) app.toast('지금 내용을 버전으로 남겼습니다.');
    setName('');
    void refresh();
  };
  const restore = async (id: number) => {
    const v = await versions.load(id);
    if (!v) return;
    const meta = list.find((x) => x.id === id);
    const r = await app.confirm('이 버전으로 되돌리기', `${meta ? `${dayOf(meta.time)} ${hm(meta.time)}` : '이'} 버전의 내용으로 바꿉니다.\n지금 내용은 '되돌리기 전' 버전으로 남겨 두며, Ctrl+Z 로도 되돌릴 수 있습니다.`, [
      { id: 'ok', label: '되돌리기', primary: true },
      { id: 'no', label: '취소' },
    ]);
    if (r !== 'ok') return;
    await versions.snapshot(tab, 'restore', '되돌리기 전');
    tab.setContent(v.content);
    if (v.settings) tab.settings = { ...tab.settings, ...v.settings };
    tab.markDirty();
    tab.editor.storage.pagination?.schedule?.();
    app.emit();
    app.toast('선택한 버전으로 되돌렸습니다.');
    setSel(null);
    void refresh();
  };
  const openCopy = async (id: number) => {
    const v = await versions.load(id);
    const meta = list.find((x) => x.id === id);
    if (v && meta) app.openCopy(`${tab.title.replace(/\.[^.]+$/, '')} (${dayOf(meta.time)} ${hm(meta.time)})`, v);
  };

  const changed = diff ? diff.filter((r) => r.type !== 'same').length : 0;
  let lastDay = '';

  return (
    <aside className="side-panel version-panel">
      <div className="ai-head">
        <b>버전 기록</b>
        <span style={{ flex: 1 }} />
        <button className="tb-btn" title="닫기" onClick={() => app.set({ versionsOpen: false })}>
          <Icon name="X" size={14} />
        </button>
      </div>
      <div className="vh-new">
        <input value={name} placeholder="버전 이름 (예: 1차 검토본)" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && saveNamed()} />
        <button className="btn small primary" onClick={saveNamed}>
          지금 버전 남기기
        </button>
      </div>
      <div className="unit vh-note">저장할 때와 편집 중 5분마다 이 컴퓨터에 자동으로 남깁니다.</div>
      <div className="rv-list">
        {list.length === 0 && <div className="chk-empty">아직 남긴 버전이 없습니다.</div>}
        {list.map((v) => {
          const day = dayOf(v.time);
          const head = day !== lastDay ? <div className="vh-day">{day}</div> : null;
          lastDay = day;
          const on = sel === v.id;
          return (
            <div key={v.id}>
              {head}
              <div className={'rv-card vh-item' + (on ? ' sel' : '')} onClick={() => setSel(on ? null : v.id)}>
                <div className="rv-meta">
                  <b>{hm(v.time)}</b> · <span className={'vh-kind k-' + v.kind}>{KIND[v.kind]}</span> · {v.chars.toLocaleString()}자
                </div>
                {renaming === v.id ? (
                  <input
                    autoFocus
                    className="vh-rename"
                    value={renameText}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter') {
                        await versions.rename(v.id, renameText);
                        setRenaming(null);
                        void refresh();
                      } else if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  v.label && <div className="rv-text">{v.label}</div>
                )}
                {on && (
                  <>
                    <div className="rv-btns" onClick={(e) => e.stopPropagation()}>
                      <button className="btn small primary" onClick={() => restore(v.id)}>
                        <Icon name="History" size={12} /> 되돌리기
                      </button>
                      <button className="btn small" onClick={() => openCopy(v.id)}>
                        새 탭으로
                      </button>
                      <button className="btn small" onClick={() => (setRenaming(v.id), setRenameText(v.label))}>
                        이름
                      </button>
                      <button
                        className="btn small"
                        title="이 버전 지우기"
                        onClick={async () => {
                          await versions.remove(v.id);
                          setSel(null);
                          void refresh();
                        }}
                      >
                        <Icon name="Trash2" size={12} />
                      </button>
                    </div>
                    <div className="vh-diff" onClick={(e) => e.stopPropagation()}>
                      {!diff ? (
                        <div className="unit">비교하는 중…</div>
                      ) : changed === 0 ? (
                        <div className="unit">지금 내용과 글이 같습니다.</div>
                      ) : (
                        <>
                          <div className="vh-diff-head">
                            <span className="unit">이 버전 → 지금: 바뀐 문단 {changed}개</span>
                            <label className="check">
                              <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> 같은 문단도
                            </label>
                          </div>
                          {diff.map((r, i) =>
                            r.type === 'same' && !showSame ? null : (
                              <div key={i} className={'vh-row r-' + r.type}>
                                {r.parts.map((p, j) =>
                                  p.type === 'del' ? <del key={j}>{p.text}</del> : p.type === 'ins' ? <ins key={j}>{p.text}</ins> : <span key={j}>{p.text}</span>,
                                )}
                              </div>
                            ),
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
