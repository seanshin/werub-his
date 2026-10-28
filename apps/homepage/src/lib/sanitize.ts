/* eslint-disable */
// 🔴 이 파일은 `apps/web/src/lib/sanitize.ts` 의 **기계 대조 사본**이다.
//    `apps/homepage` 는 격리 빌드(자체 npm install)라 web 을 참조할 수 없어 사본을 둔다.
//    XSS 방어 로직이라 정본(web)에서 고친 것이 여기 안 오면 **공개 사이트만 취약**해진다.
//    정본은 apps/web 이며, 갈라지면 `apps/web/test/architecture/homepage-lib-copy-parity.spec.ts` 가 실패한다.
//    **여기를 직접 고치지 말 것** — 정본을 고치고 이 파일에 그대로 복사한다.
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
