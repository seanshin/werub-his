// HTML 이스케이프 공용 유틸 (XSS 방지 · perf-security-remediation-2026h2 §3-B)
//
// 서버가 생성해 브라우저로 직접 렌더되는 문서 HTML(text/html 응답·FE dangerouslySetInnerHTML·
// 인쇄 document.write) 안에 사용자/DB/AI 유래 값을 보간하기 전 반드시 적용한다.
// 반환 HTML을 FE가 별도 sanitize 없이 렌더하는 경로에서는 서버 이스케이프가 유일 방어선이다.
//
// 주의: 리치 HTML을 "의도적으로" 렌더하는 경로(CMS 저작 콘텐츠·마케팅 이메일 본문)에는
// 사용하지 말 것 — 그 경우는 저작 시점 sanitize(DOMPurify)가 올바른 통제다.

/**
 * HTML 텍스트/속성 컨텍스트에서 안전하도록 메타문자를 엔티티로 치환한다.
 * `&`를 가장 먼저 치환해 이중 이스케이프를 방지한다. null/undefined는 빈 문자열.
 */
export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
