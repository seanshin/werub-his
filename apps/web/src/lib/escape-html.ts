/**
 * HTML 문자열 조립(document.write 인쇄 팝업 등) 시 변수 이스케이프 — XSS 방지.
 * React JSX 밖에서 환자명·알레르기 등 사용자 유래 값을 HTML에 넣을 때 반드시 사용.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
