/**
 * 로그인 후 이동할 수 있는 경로인지 판정 — **내부 절대경로 하나만** 통과시킨다.
 *
 * 거부: 스킴 포함(`https:`·`javascript:`), 프로토콜 상대(`//evil`), 역슬래시(`/\evil` — 일부 브라우저가
 * `//` 로 해석), 제어문자·공백, 디코딩 후 위 조건에 걸리는 인코딩 우회.
 * 🔴 allowlist 를 화이트리스트 문자열 목록으로 두지 않는다 — 화면이 계속 늘어나 반드시 갈라진다.
 *    "내부 경로인가"라는 성질로 판정한다.
 */
export function toInternalPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw;
  for (let i = 0; i < 2; i++) {
    try { const d = decodeURIComponent(v); if (d === v) break; v = d; } catch { return null; }
  }
  if (!v.startsWith('/')) return null;          // 절대 내부 경로만
  if (v.startsWith('//') || v.startsWith('/\\')) return null; // 프로토콜 상대 우회
  if (/[\u0000-\u001f\u007f\s]/.test(v)) return null;   // 제어문자·공백
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;   // 스킴
  return v;
}
