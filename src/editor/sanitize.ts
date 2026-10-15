import { Fragment, Mark, Node as PMNode, type Schema } from '@tiptap/pm/model';
import type { JNode } from '../formats/common';

/**
 * 외부 형식에서 변환된 JSON을 스키마에 맞게 보정한다.
 * (TipTap은 잘못된 내용이 들어오면 빈 문서로 바꿔 버리므로 반드시 거쳐야 한다)
 */
export function sanitizeDoc(json: JNode, schema: Schema): PMNode {
  try {
    const n = PMNode.fromJSON(schema, json);
    n.check();
    return n;
  } catch {
    /* 아래에서 보정 */
  }
  const blocks = buildBlocks(json.content || [], schema);
  const doc = schema.topNodeType.createAndFill(null, blocks) || schema.topNodeType.createAndFill()!;
  return doc;
}

export function isSafeHref(href: unknown): boolean {
  return typeof href === 'string' && href.length < 4096 && /^(https?:|mailto:|tel:|#)/i.test(href.trim());
}

function marksOf(schema: Schema, marks?: { type: string; attrs?: any }[]): readonly Mark[] {
  const out: Mark[] = [];
  for (const m of marks || []) {
    const t = schema.marks[m.type];
    if (!t) continue;
    // 링크는 http(s)/mailto/tel/문서 안 위치만 (javascript:, file:, UNC 경로 등 제외)
    if (m.type === 'link' && !isSafeHref(m.attrs?.href)) continue;
    try {
      out.push(t.create(m.attrs));
    } catch {
      /* 무시 */
    }
  }
  return Mark.setFrom(out);
}

function buildInline(nodes: JNode[], schema: Schema): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      if (n.text) out.push(schema.text(n.text, marksOf(schema, n.marks)));
      continue;
    }
    const t = schema.nodes[n.type];
    if (t && t.isInline) {
      try {
        out.push(t.create(n.attrs, null, marksOf(schema, n.marks)));
      } catch {
        /* 무시 */
      }
      continue;
    }
    // 블록이 인라인 자리에 온 경우 텍스트만 살림
    if (n.content) out.push(...buildInline(flattenInline(n), schema));
  }
  return out;
}

function flattenInline(n: JNode): JNode[] {
  const out: JNode[] = [];
  for (const c of n.content || []) {
    if (c.type === 'text' || c.type === 'hardBreak' || c.type === 'image' || c.type === 'footnote') out.push(c);
    else {
      if (out.length) out.push({ type: 'text', text: ' ' });
      out.push(...flattenInline(c));
    }
  }
  return out;
}

function buildNode(n: JNode, schema: Schema): PMNode[] {
  const t = schema.nodes[n.type];
  if (!t) {
    // 알 수 없는 노드 → 하위 블록 또는 문단
    if (n.content) {
      const hasBlock = n.content.some((c) => schema.nodes[c.type]?.isBlock);
      return hasBlock ? buildBlocks(n.content, schema) : [schema.nodes.paragraph.create(null, buildInline(n.content, schema))];
    }
    return [];
  }
  if (t.isTextblock) {
    const inline = buildInline(n.content || [], schema);
    try {
      return [t.createChecked(n.attrs, inline, marksOf(schema, n.marks))];
    } catch {
      try {
        return [t.create(n.attrs, inline.filter((x) => t.contentMatch.matchType(x.type)))];
      } catch {
        return [schema.nodes.paragraph.create(null, inline)];
      }
    }
  }
  if (t.isLeaf) {
    try {
      return [t.create(n.attrs)];
    } catch {
      return [];
    }
  }
  if (t.isInline) return buildInline([n], schema);
  // 컨테이너
  let children: PMNode[] = [];
  if (n.type === 'table') children = (n.content || []).flatMap((r) => buildRow(r, schema));
  else if (n.type === 'bulletList' || n.type === 'orderedList') children = (n.content || []).flatMap((li) => buildListItem(li, schema, 'listItem'));
  else if (n.type === 'taskList') children = (n.content || []).flatMap((li) => buildListItem(li, schema, 'taskItem'));
  else children = buildBlocks(n.content || [], schema);
  try {
    return [t.createChecked(n.attrs, children)];
  } catch {
    const filled = t.createAndFill(n.attrs, Fragment.from(children));
    if (filled) return [filled];
    return children;
  }
}

function buildRow(r: JNode, schema: Schema): PMNode[] {
  const cells = (r.content || [])
    .map((c) => {
      const ct = schema.nodes[c.type === 'tableHeader' ? 'tableHeader' : 'tableCell'];
      const blocks = buildBlocks(c.content || [], schema);
      try {
        return ct.createChecked(c.attrs, blocks.length ? blocks : [schema.nodes.paragraph.create()]);
      } catch {
        return ct.createAndFill(c.attrs, blocks) || ct.createAndFill(c.attrs);
      }
    })
    .filter(Boolean) as PMNode[];
  if (!cells.length) return [];
  return [schema.nodes.tableRow.create(r.attrs, cells)];
}

function buildListItem(li: JNode, schema: Schema, type: string): PMNode[] {
  const t = schema.nodes[type];
  let blocks = buildBlocks(li.content || [], schema);
  if (!blocks.length || !blocks[0].isTextblock || blocks[0].type.name !== 'paragraph') blocks = [schema.nodes.paragraph.create(), ...blocks];
  try {
    return [t.createChecked(li.attrs, blocks)];
  } catch {
    return [t.createAndFill(li.attrs, blocks) || t.createAndFill()!];
  }
}

function buildBlocks(nodes: JNode[], schema: Schema): PMNode[] {
  const out: PMNode[] = [];
  let pendingInline: JNode[] = [];
  const flushInline = () => {
    if (!pendingInline.length) return;
    out.push(schema.nodes.paragraph.create(null, buildInline(pendingInline, schema)));
    pendingInline = [];
  };
  for (const n of nodes) {
    const t = schema.nodes[n.type];
    if (n.type === 'text' || (t && t.isInline)) {
      pendingInline.push(n);
      continue;
    }
    flushInline();
    out.push(...buildNode(n, schema));
  }
  flushInline();
  return out;
}
