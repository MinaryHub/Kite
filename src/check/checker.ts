import type { Node as PMNode } from '@tiptap/pm/model';
import { ACTIVE_RULES, type CheckCategory } from './rules';

/** 검사에서 찾은 것 하나 */
export interface CheckIssue {
  id: string;
  cat: CheckCategory;
  from: number;
  to: number;
  /** 문서의 원래 글자 */
  text: string;
  /** 고칠 말 (null 이면 알림만) */
  fix: string | null;
  reason: string;
  /** 앞뒤 문맥 (목록에 보여 줄) */
  context: string;
}

/** 문단 하나의 글자와, 글자 위치 → 문서 위치 */
export interface TextRun {
  text: string;
  pos: number[];
}

/** 문서의 글자 문단들 (그림·줄 나눔은 자리 표시 글자로) */
export function textRuns(doc: PMNode): TextRun[] {
  const runs: TextRun[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const t = child.text || '';
        for (let i = 0; i < t.length; i++) {
          text += t[i];
          map.push(start + i);
        }
      } else {
        text += child.type.name === 'hardBreak' ? '\n' : '￼';
        map.push(start);
      }
    });
    map.push(pos + 1 + node.content.size);
    if (text.trim()) runs.push({ text, pos: map });
    return false;
  });
  return runs;
}

const contextOf = (text: string, a: number, b: number) => {
  const s = Math.max(0, a - 14);
  const e = Math.min(text.length, b + 14);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\n/g, ' ') + (e < text.length ? '…' : '');
};

/** 규칙 검사 */
export function runRules(doc: PMNode, cats: Set<CheckCategory>, ignored: Set<string> = new Set()): CheckIssue[] {
  const out: CheckIssue[] = [];
  const rules = ACTIVE_RULES.filter((r) => cats.has(r.cat));
  for (const run of textRuns(doc)) {
    const taken: [number, number][] = [];
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(run.text))) {
        if (m[0].length === 0) {
          rule.re.lastIndex++;
          continue;
        }
        const a = m.index;
        const b = a + m[0].length;
        // 다른 규칙이 이미 짚은 곳과 겹치면 하나만
        if (taken.some(([x, y]) => a < y && b > x)) continue;
        let fix: string | null;
        if (typeof rule.fix === 'function') fix = rule.fix(m);
        else fix = rule.fix.replace(/\$(\d)/g, (_, n) => m![+n] ?? '');
        if (fix === null || fix === m[0]) continue;
        const key = `${rule.cat}|${m[0]}|${fix}`;
        if (ignored.has(key)) continue;
        taken.push([a, b]);
        out.push({ id: `${run.pos[a]}:${key}`, cat: rule.cat, from: run.pos[a], to: run.pos[b - 1] + 1, text: m[0], fix, reason: rule.reason, context: contextOf(run.text, a, b) });
      }
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

/** 무시 목록에 넣을 열쇠 */
export const issueKey = (i: CheckIssue) => `${i.cat}|${i.text}|${i.fix}`;
