import { DOMSerializer } from '@tiptap/pm/model';
import type { HeaderFooter } from './types';
import { getDocSchema } from './editor/extensions';
import { sanitizeDoc } from './editor/sanitize';

const cache = new WeakMap<object, string>();

/**
 * 표·그림이 든 머리말/꼬리말(HeaderFooter.content)의 HTML. 없으면 null.
 * 문서 스키마로 그리므로 본문과 같은 모양이다. 쪽 번호 글자({{PAGE}})는 부르는 쪽에서 바꾼다.
 */
export function hfRichHtml(def: HeaderFooter): string | null {
  const c = def.content;
  if (!Array.isArray(c) || !c.length || typeof document === 'undefined') return null;
  let html = cache.get(c);
  if (html == null) {
    try {
      const schema = getDocSchema();
      const node = sanitizeDoc({ type: 'doc', content: c } as any, schema);
      const div = document.createElement('div');
      div.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content));
      html = div.innerHTML;
    } catch {
      html = '';
    }
    cache.set(c, html);
  }
  return html || null;
}
