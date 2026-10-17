import { DOMParser as PMDOMParser, DOMSerializer, Node as PMNode } from '@tiptap/pm/model';
import { latexToHwp } from '../math/hwpEq';
import { getDocSchema } from '../editor/extensions';
import type { DocSettings, KDocument, LoadedDoc } from '../types';
import { defaultSettings, docNode, xmlEscape, type JNode } from './common';

/** HTML 문자열 → 문서 JSON */
export function htmlToJson(html: string): JNode {
  const schema = getDocSchema();
  const dom = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const doc = PMDOMParser.fromSchema(schema).parse(dom.body);
  return doc.toJSON();
}

/** 문서 JSON → HTML 조각 */
export function jsonToHtml(content: JNode): string {
  const schema = getDocSchema();
  const node = PMNode.fromJSON(schema, content);
  const frag = DOMSerializer.fromSchema(schema).serializeFragment(node.content);
  const div = document.createElement('div');
  div.appendChild(frag);
  return div.innerHTML;
}

export function readHtml(text: string): LoadedDoc {
  const parsed = new window.DOMParser().parseFromString(text, 'text/html');
  const title = parsed.title || undefined;
  const json = htmlToJson(parsed.body ? parsed.body.innerHTML : text);
  return { content: json, settings: defaultSettings(), meta: { title }, warnings: [] };
}

export function documentCss(settings: DocSettings): string {
  const p = settings.page;
  const w = p.landscape ? Math.max(p.width, p.height) : p.width;
  const h = p.landscape ? Math.min(p.width, p.height) : p.height;
  return `@page { size: ${w}mm ${h}mm; margin: ${p.marginTop + p.marginHeader}mm ${p.marginRight}mm ${p.marginBottom + p.marginFooter}mm ${p.marginLeft}mm; }
body { font-family: '함초롬바탕', 'HCR Batang', '바탕', Batang, serif; font-size: 10pt; line-height: 1.6; color: #000; max-width: ${w - p.marginLeft - p.marginRight}mm; margin: 2em auto; }
p, h1, h2, h3, h4, h5, h6 { margin: 0; }
p { text-align: justify; }
table { border-collapse: collapse; }
td, th { border: 1px solid #000; padding: 1mm 1.8mm; vertical-align: middle; }
td p, th p { text-align: inherit; }
img { max-width: 100%; }
.page-break { page-break-after: always; break-after: page; }
sup.footnote-ref { font-size: 0.7em; }
.footnotes { margin-top: 2em; border-top: 1px solid #000; font-size: 9pt; }`;
}

export function writeHtml(doc: KDocument): string {
  let body = jsonToHtml(doc.content as JNode);
  // 각주 번호 및 목록
  const notes: string[] = [];
  body = body.replace(/<sup([^>]*?)data-footnote="([^"]*)"([^>]*)>\*<\/sup>/g, (_m, a, text, b) => {
    notes.push(text);
    const n = notes.length;
    return `<sup${a}data-footnote="${text}"${b}><a href="#fn${n}" id="fnref${n}">${n}</a></sup>`;
  });
  const fnHtml = notes.length
    ? `<div class="footnotes">${notes.map((t, i) => `<p id="fn${i + 1}">${i + 1}) ${t}</p>`).join('')}</div>`
    : '';
  const s = doc.settings;
  const hdr = s.header.text ? `<header style="text-align:${s.header.align}">${xmlEscape(s.header.text.replace(/\{\{PAGE\}\}|\{\{PAGES\}\}/g, ''))}</header>` : '';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${xmlEscape(doc.meta.title || '')}</title>
<style>
${documentCss(s)}
</style>
</head>
<body>
${hdr}
${body}
${fnHtml}
</body>
</html>`;
}

// ---------------- 텍스트 ----------------
export function readText(text: string): LoadedDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: JNode[] = lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' }));
  return { content: docNode(blocks), settings: defaultSettings(), meta: {}, warnings: [] };
}

export function writeText(doc: KDocument): string {
  const out: string[] = [];
  const walk = (n: JNode, depth: number, prefix = '') => {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
        out.push(prefix + inlineText(n));
        return;
      case 'pageBreak':
        out.push('\f');
        return;
      case 'horizontalRule':
        out.push('―'.repeat(20));
        return;
      case 'bulletList':
      case 'taskList':
        (n.content || []).forEach((li) => (li.content || []).forEach((c, i) => walk(c, depth + 1, i === 0 ? '  '.repeat(depth) + '• ' : '  '.repeat(depth + 1))));
        return;
      case 'orderedList': {
        let k = n.attrs?.start || 1;
        (n.content || []).forEach((li) => {
          (li.content || []).forEach((c, i) => walk(c, depth + 1, i === 0 ? '  '.repeat(depth) + `${k}. ` : '  '.repeat(depth + 1)));
          k++;
        });
        return;
      }
      case 'table':
        (n.content || []).forEach((row) => {
          out.push((row.content || []).map((cell) => (cell.content || []).map(inlineText).join(' ')).join('\t'));
        });
        return;
      default:
        (n.content || []).forEach((c) => walk(c, depth, prefix));
    }
  };
  (doc.content as JNode).content?.forEach((c) => walk(c, 0));
  return out.join('\r\n');
}

function inlineText(n: JNode): string {
  return (n.content || [])
    .map((c) => (c.type === 'text' ? c.text : c.type === 'hardBreak' ? '\n' : c.type === 'math' ? c.attrs?.hwp || latexToHwp(c.attrs?.latex || '') : ''))
    .join('');
}
