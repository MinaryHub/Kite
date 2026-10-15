import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * AI 가 만든 Markdown 을 안전한 HTML 로 (AI 패널 표시, 문서에 넣기, MCP 도구가 함께 쓴다)
 */

// 응답 속 외부 그림은 표시만으로 주소(=문서 내용)가 전송될 수 있으므로 제거한다.
// (문서에 숨겨진 지시로 조작된 응답이 데이터를 빼내는 경로 차단)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element;
  if (el.tagName === 'IMG') {
    const src = el.getAttribute('src') || '';
    if (!/^data:image\//i.test(src)) el.remove();
  }
});

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { gfm: true, breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'link', 'meta', 'svg', 'math'],
    // 인라인 CSS·대체 그림 주소 등으로 바깥에 요청이 나가지 않도록
    FORBID_ATTR: ['style', 'srcset', 'poster', 'ping', 'formaction', 'background', 'target'],
  });
}

