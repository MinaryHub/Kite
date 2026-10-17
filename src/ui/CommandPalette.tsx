import { useEffect, useMemo, useRef, useState } from 'react';
import { commands, runCommand } from '../app/commands';
import { useApp } from '../app/hooks';
import { Icon } from './Icon';

/**
 * 명령 팔레트 (Ctrl+Shift+P): 모든 명령을 이름으로 찾아 실행한다.
 * 이름 일부, 한글 초성(ㅍㅈ → 표 지우기), 띄어 쓴 여러 낱말로 찾을 수 있다. 빈 칸이면 최근에 쓴 명령부터.
 */

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한글 음절을 초성으로 (그 밖의 글자는 그대로) */
export function chosung(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}

const norm = (s: string) => s.replace(/\.\.\.$/, '').replace(/\s+/g, '').toLowerCase();
const isChosungOnly = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);

/** 검색어에 맞는 정도 (클수록 앞에, 0 이면 안 맞음) */
export function matchScore(label: string, query: string): number {
  const q = norm(query);
  if (!q) return 1;
  const l = norm(label);
  if (l.startsWith(q)) return 100 - l.length * 0.1;
  if (l.includes(q)) return 80 - l.indexOf(q);
  if (isChosungOnly(q)) {
    const c = chosung(l);
    if (c.startsWith(q)) return 60;
    if (c.includes(q)) return 50 - c.indexOf(q);
  }
  // 띄어 쓴 낱말이 모두 들어 있으면
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => l.includes(w) || (isChosungOnly(w) && chosung(l).includes(w)))) return 40;
  return 0;
}

export function CommandPalette() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (app.paletteOpen) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [app.paletteOpen]);

  const items = useMemo(() => {
    const all = Object.entries(commands).filter(([id]) => id !== 'tools.palette');
    if (!q.trim()) {
      const recent = (app.prefs.recentCommands || []).filter((id) => commands[id] && id !== 'tools.palette');
      const rest = all.filter(([id]) => !recent.includes(id)).sort((a, b) => a[1].label.localeCompare(b[1].label, 'ko'));
      return [...recent.map((id) => [id, commands[id]] as const), ...rest].map(([id, c]) => ({ id, c, recent: recent.includes(id) }));
    }
    return all
      .map(([id, c]) => ({ id, c, score: matchScore(c.label, q), recent: false }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [q, app.paletteOpen]);

  useEffect(() => {
    listRef.current?.querySelector('.cp-item.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel, items]);

  if (!app.paletteOpen) return null;
  const close = () => app.set({ paletteOpen: false });
  const run = (id: string) => {
    close();
    // 팔레트가 닫히고 편집기에 초점이 돌아간 뒤 실행
    setTimeout(() => runCommand(id), 0);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[sel];
      if (it && (!it.c.enabled || it.c.enabled())) run(it.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="cp-back" onMouseDown={close}>
      <div className="cp" role="dialog" aria-label="명령 찾기" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cp-input">
          <Icon name="Search" size={16} />
          <input
            ref={inputRef}
            value={q}
            placeholder="명령 이름 또는 초성으로 찾기 (예: 표, ㅉㅂㄱ)"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKey}
          />
        </div>
        <div className="cp-list" ref={listRef}>
          {items.length === 0 && <div className="cp-empty">맞는 명령이 없습니다.</div>}
          {items.map((it, i) => {
            const disabled = !!it.c.enabled && !it.c.enabled();
            const active = it.c.active?.();
            return (
              <div
                key={it.id}
                className={'cp-item' + (i === sel ? ' sel' : '') + (disabled ? ' disabled' : '')}
                onMouseEnter={() => setSel(i)}
                onClick={() => !disabled && run(it.id)}
              >
                <span className="cp-icon">{active ? <Icon name="Check" size={15} /> : <Icon name={it.c.icon} size={15} />}</span>
                <span className="cp-label">{it.c.label.replace(/\.\.\.$/, '')}</span>
                {it.recent && !q && <span className="cp-tag">최근</span>}
                {it.c.shortcut && <span className="cp-key">{it.c.shortcut}</span>}
              </div>
            );
          })}
        </div>
        <div className="cp-foot">↑↓ 고르기 · Enter 실행 · Esc 닫기</div>
      </div>
    </div>
  );
}
