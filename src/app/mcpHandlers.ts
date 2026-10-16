import type { Node as PMNode } from '@tiptap/pm/model';
import { app } from './controller';
import { platform } from '../platform';
import type { DocTab } from '../doc/docTab';
import { htmlToJson } from '../formats/html';
import { writeMarkdown } from '../formats/markdown';
import type { JNode } from '../formats/common';
import { renderMarkdown } from '../ui/aiMarkdown';
import { MCP_TOOLS, type McpCall } from '../mcp/tools';

/**
 * AI 앱 연결(MCP) 도구 처리기. 주 프로세스가 넘겨준 도구 호출을 열린 문서에 적용한다.
 * - 문서 하나에 대한 수정은 트랜잭션 하나 = 되돌리기 한 번
 * - 호출은 순서대로 하나씩 처리 (확인 창이 겹치지 않게)
 */

class ToolError extends Error {}

const DEFAULT_MAX_CHARS = 40000;
const MAX_MARKDOWN = 1_000_000;

function tabOf(args: Record<string, any>): DocTab {
  const id = args.document_id;
  if (id != null) {
    if (typeof id !== 'string') throw new ToolError('document_id 는 문자열이어야 합니다.');
    const t = app.docs.find((d) => d.id === id);
    if (!t) throw new ToolError(`문서 '${id}' 를 찾을 수 없습니다. list_documents 로 id 를 확인하세요.`);
    return t;
  }
  if (!app.active) throw new ToolError('열려 있는 문서가 없습니다.');
  return app.active;
}

function int(v: unknown, name: string, def?: number): number {
  if (v == null) {
    if (def != null) return def;
    throw new ToolError(`${name} 값이 필요합니다.`);
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new ToolError(`${name} 은(는) 0 이상의 정수여야 합니다.`);
  return v;
}

function str(v: unknown, name: string, allowEmpty = true): string {
  if (typeof v !== 'string') throw new ToolError(`${name} 은(는) 문자열이어야 합니다.`);
  if (!allowEmpty && !v) throw new ToolError(`${name} 이(가) 비어 있습니다.`);
  if (v.length > MAX_MARKDOWN) throw new ToolError(`${name} 이(가) 너무 깁니다.`);
  return v;
}

/** 최상위 블록 i 의 시작 위치 */
function blockStart(doc: PMNode, i: number): number {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
  return pos;
}

function checkBlock(doc: PMNode, i: number, name: string) {
  if (i >= doc.childCount) throw new ToolError(`${name}=${i} 이(가) 범위를 벗어났습니다 (블록 0–${doc.childCount - 1}).`);
}

/** 그림 자료(data URL)는 AI 에 보내지 않는다 */
function stripImages(md: string): string {
  return md.replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, (_m, alt) => (alt ? `[그림: ${alt}]` : '[그림]'));
}

function nodesToMarkdown(tab: DocTab, nodes: JNode[]): string {
  return stripImages(writeMarkdown({ content: { type: 'doc', content: nodes }, settings: tab.settings, meta: tab.meta } as any)).trim();
}

/** Markdown → 문서 노드 (AI 패널과 같은 정리: 외부 그림 제거 등) */
function markdownToNodes(md: string): JNode[] {
  if (!md.trim()) return [];
  return htmlToJson(renderMarkdown(md)).content || [];
}

function preview(md: string, n = 300): string {
  const t = md.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// ---------------- 도구 ----------------
type Handler = (args: Record<string, any>, ctx: { client: string; confirmEdits: boolean }) => Promise<string>;

/** 수정 전 확인(설정 시) + 화면 전환 + 알림 */
async function beforeEdit(tab: DocTab, ctx: { client: string; confirmEdits: boolean }, what: string) {
  if (app.activeId !== tab.id) app.activate(tab.id);
  if (!ctx.confirmEdits) return;
  const r = await app.confirm('AI 수정 확인', `'${ctx.client}' 이(가) '${tab.title}' 을(를) 고치려고 합니다.\n\n${what}`, [
    { id: 'ok', label: '허용', primary: true },
    { id: 'no', label: '거부', danger: true },
  ]);
  if (r !== 'ok') throw new ToolError('사용자가 이 수정을 거부했습니다.');
}
function afterEdit(tab: DocTab, ctx: { client: string }, what: string) {
  app.toast(`${ctx.client}: ${what} — 되돌리려면 Ctrl+Z`, 'info', 4000);
  void tab;
}

const handlers: Record<string, Handler> = {
  async list_documents() {
    const list = app.docs.map((d) => ({
      id: d.id,
      title: d.title,
      active: d.id === app.activeId,
      unsaved_changes: d.dirty,
      pages: d.layout.pageCount,
      blocks: d.editor.state.doc.childCount,
    }));
    return JSON.stringify(list, null, 2);
  },

  async read_document(args) {
    const tab = tabOf(args);
    const doc = tab.editor.state.doc;
    const n = doc.childCount;
    const from = Math.min(int(args.from_block, 'from_block', 0), Math.max(0, n - 1));
    const to = Math.min(int(args.to_block, 'to_block', n - 1), n - 1);
    if (to < from) throw new ToolError('to_block 이 from_block 보다 작습니다.');
    const max = Math.min(Math.max(int(args.max_chars, 'max_chars', DEFAULT_MAX_CHARS), 1000), 200000);
    const parts: string[] = [];
    let used = 0;
    let last = from - 1;
    for (let i = from; i <= to; i++) {
      const md = nodesToMarkdown(tab, [doc.child(i).toJSON()]);
      const piece = `<!-- block ${i} -->\n${md || '(빈 문단)'}\n`;
      if (used + piece.length > max && parts.length) break;
      parts.push(piece);
      used += piece.length;
      last = i;
    }
    const head = `# 문서: ${tab.title}\n블록 ${from}–${last} / 전체 ${n}개 (0부터), ${tab.layout.pageCount}쪽\n`;
    const tail = last < to ? `\n(글자 수 제한으로 여기까지. 이어서 읽으려면 from_block=${last + 1})` : '';
    return head + '\n' + parts.join('\n') + tail;
  },

  async get_selection(args) {
    const tab = tabOf(args);
    const { state } = tab.editor;
    const { from, to, empty } = state.selection;
    const bFrom = state.doc.resolve(from).index(0);
    const bTo = state.doc.resolve(Math.max(from, to - 1)).index(0);
    if (empty) return JSON.stringify({ empty: true, cursor_block: bFrom });
    const slice = state.doc.cut(from, to);
    const md = nodesToMarkdown(tab, (slice.toJSON().content || []) as JNode[]);
    return JSON.stringify({ empty: false, from_block: bFrom, to_block: bTo, markdown: md || state.doc.textBetween(from, to, '\n') }, null, 2);
  },

  async insert_content(args, ctx) {
    const tab = tabOf(args);
    const md = str(args.markdown, 'markdown', false);
    const position = args.position ?? 'cursor';
    const doc = tab.editor.state.doc;
    let pos: number;
    let where: string;
    switch (position) {
      case 'cursor':
        pos = tab.editor.state.selection.to;
        where = '커서 위치';
        break;
      case 'start':
        pos = 0;
        where = '문서 처음';
        break;
      case 'end':
        pos = doc.content.size;
        where = '문서 끝';
        break;
      case 'after_block':
      case 'before_block': {
        const b = int(args.block, 'block');
        checkBlock(doc, b, 'block');
        pos = position === 'after_block' ? blockStart(doc, b + 1) : blockStart(doc, b);
        where = `블록 ${b} ${position === 'after_block' ? '뒤' : '앞'}`;
        break;
      }
      default:
        throw new ToolError(`position 값이 올바르지 않습니다: ${position}`);
    }
    let nodes = markdownToNodes(md);
    if (!nodes.length) throw new ToolError('넣을 내용이 없습니다.');
    // 커서 위치에 한 문단이면 글자만 넣어 현재 문단 서식을 유지
    if (position === 'cursor' && nodes.length === 1 && nodes[0].type === 'paragraph') nodes = nodes[0].content || [];
    await beforeEdit(tab, ctx, `${where}에 넣기:\n${preview(md)}`);
    const ok = tab.editor.chain().insertContentAt(pos, nodes).run();
    if (!ok) throw new ToolError('내용을 넣지 못했습니다.');
    afterEdit(tab, ctx, `${where}에 내용을 넣었습니다`);
    return `${where}에 넣었습니다. 이제 문서는 블록 ${tab.editor.state.doc.childCount}개입니다.`;
  },

  async replace_selection(args, ctx) {
    const tab = tabOf(args);
    const md = str(args.markdown, 'markdown');
    const { from, to, empty } = tab.editor.state.selection;
    if (empty) throw new ToolError('선택된 부분이 없습니다. 사용자가 Kite 에서 바꿀 부분을 먼저 선택해야 합니다.');
    let nodes = markdownToNodes(md);
    if (nodes.length === 1 && nodes[0].type === 'paragraph') nodes = nodes[0].content || [];
    await beforeEdit(tab, ctx, `선택 영역 바꾸기:\n${preview(md)}`);
    const ok = nodes.length ? tab.editor.chain().insertContentAt({ from, to }, nodes).run() : tab.editor.chain().deleteRange({ from, to }).run();
    if (!ok) throw new ToolError('선택 영역을 바꾸지 못했습니다.');
    afterEdit(tab, ctx, '선택 영역을 바꾸었습니다');
    return '선택 영역을 바꾸었습니다.';
  },

  async replace_blocks(args, ctx) {
    const tab = tabOf(args);
    const doc = tab.editor.state.doc;
    const a = int(args.from_block, 'from_block');
    const b = int(args.to_block, 'to_block');
    if (b < a) throw new ToolError('to_block 이 from_block 보다 작습니다.');
    checkBlock(doc, a, 'from_block');
    checkBlock(doc, b, 'to_block');
    const md = str(args.markdown, 'markdown');
    const from = blockStart(doc, a);
    const to = blockStart(doc, b + 1);
    let nodes = markdownToNodes(md);
    // 문서 전체를 지우면 빈 문단 하나는 남긴다
    if (!nodes.length && a === 0 && b === doc.childCount - 1) nodes = [{ type: 'paragraph' }];
    await beforeEdit(tab, ctx, `블록 ${a}–${b} ${nodes.length ? '바꾸기' : '지우기'}${nodes.length ? ':\n' + preview(md) : ''}`);
    const ok = nodes.length ? tab.editor.chain().insertContentAt({ from, to }, nodes).run() : tab.editor.chain().deleteRange({ from, to }).run();
    if (!ok) throw new ToolError('블록을 바꾸지 못했습니다.');
    afterEdit(tab, ctx, nodes.length ? `블록 ${a}–${b} 을(를) 바꾸었습니다` : `블록 ${a}–${b} 을(를) 지웠습니다`);
    return `블록 ${a}–${b} 을(를) ${nodes.length ? '바꾸었습니다' : '지웠습니다'}. 이제 문서는 블록 ${tab.editor.state.doc.childCount}개입니다 (뒤쪽 블록 번호가 달라졌을 수 있습니다).`;
  },

  async find_replace(args, ctx) {
    const tab = tabOf(args);
    const find = str(args.find, 'find', false);
    const replace = str(args.replace, 'replace');
    const max = Math.min(int(args.max, 'max', 1000), 1000);
    const flags = 'g' + (args.match_case === false ? 'i' : '');
    let re: RegExp;
    try {
      re = args.regex ? new RegExp(find, flags) : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e: any) {
      throw new ToolError('정규식이 올바르지 않습니다: ' + (e?.message || e));
    }
    const { state } = tab.editor;
    // 문단(텍스트 블록) 단위로 찾는다
    const hits: { from: number; to: number; text: string }[] = [];
    state.doc.descendants((node, pos) => {
      if (hits.length >= max) return false;
      if (!node.isTextblock) return true;
      // 글자 위치 ↔ 문서 위치 대응 (인라인 노드는 건너뜀)
      let text = '';
      const map: number[] = [];
      node.forEach((child, off) => {
        if (child.isText) {
          for (let k = 0; k < child.text!.length; k++) {
            map.push(pos + 1 + off + k);
            text += child.text![k];
          }
        } else {
          map.push(-1);
          text += '￼';
        }
      });
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) && hits.length < max) {
        if (!m[0]) {
          re.lastIndex++;
          continue;
        }
        const s = map[m.index];
        const e = map[m.index + m[0].length - 1];
        if (s < 0 || e < 0 || m[0].includes('￼')) continue;
        const out = args.regex ? m[0].replace(new RegExp(re.source, re.flags.replace('g', '')), replace) : replace;
        hits.push({ from: s, to: e + 1, text: out });
      }
      return false;
    });
    if (!hits.length) return '찾는 글자가 없습니다. 바꾼 것이 없습니다.';
    await beforeEdit(tab, ctx, `'${preview(find, 60)}' → '${preview(replace, 60)}' ${hits.length}곳 바꾸기`);
    const tr = tab.editor.state.tr;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      const marks = tr.doc.resolve(h.from + 1 > h.to ? h.from : h.from + 1).marks();
      if (h.text) tr.replaceWith(h.from, h.to, tab.editor.schema.text(h.text, marks));
      else tr.delete(h.from, h.to);
    }
    tab.editor.view.dispatch(tr);
    afterEdit(tab, ctx, `${hits.length}곳을 바꾸었습니다`);
    return `${hits.length}곳을 바꾸었습니다.`;
  },
};

// 정의와 처리기가 어긋나지 않았는지
for (const t of MCP_TOOLS) if (!handlers[t.name]) console.warn('[mcp] 처리기가 없는 도구:', t.name);

let queue: Promise<unknown> = Promise.resolve();

export function installMcpHandlers() {
  if (!platform.mcp.available()) return;
  platform.mcp.onCall((call: McpCall) => {
    queue = queue.then(async () => {
      const h = handlers[call.name];
      let ok = false;
      let text = '';
      try {
        if (!h) throw new ToolError(`알 수 없는 도구: ${call.name}`);
        text = await h(call.args || {}, { client: call.client || 'AI 앱', confirmEdits: !!call.confirmEdits });
        ok = true;
      } catch (e: any) {
        text = e instanceof ToolError ? e.message : `오류: ${e?.message || e}`;
        if (!(e instanceof ToolError)) console.error('[mcp]', e);
      }
      platform.mcp.result({ callId: call.callId, ok, text });
      // 패널에 보여 줄 작업 기록
      const def = MCP_TOOLS.find((t) => t.name === call.name);
      app.mcpLog = [
        { time: Date.now(), client: call.client || 'AI 앱', tool: call.name, title: def?.title || call.name, ok, edits: !!def?.edits, detail: text.split('\n')[0].slice(0, 120) },
        ...app.mcpLog,
      ].slice(0, 30);
      app.emit();
    });
  });
}
