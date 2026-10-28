import DOMPurify from 'dompurify';

/**
 * HTML 문자열을 DOMPurify로 산정화합니다.
 * dangerouslySetInnerHTML 사용 전 반드시 호출해야 합니다.
 *
 * 허용 태그: 기본 HTML + 의료 문서용 태그
 * 차단: script, iframe, object, embed, form, input
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof window === 'undefined') {
    // SSR에서는 기본 이스케이프만 적용
    return dirty
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  }
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'strong', 'em', 'b', 'i', 'u', 's', 'mark', 'sub', 'sup',
      'a', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'blockquote', 'pre', 'code', 'span', 'div', 'section',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel',
      'width', 'height', 'style', 'colspan', 'rowspan', 'scope',
    ],
    ALLOW_DATA_ATTR: false,
  });
}
