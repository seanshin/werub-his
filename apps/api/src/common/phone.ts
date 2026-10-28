/**
 * 🔴 전화번호 정규화 정본 (2026-08-31 · 환자관리 A1).
 *
 * 종전엔 `data-quality.service.ts` 안에 **`private normalizePhone`** 으로 갇혀 있어(소비처가 될 수
 * 없는 형태), 환자 등록·중복검사 경로는 **저장 원문을 그대로** 비교했다 — `010-1234-5678` 과
 * `01012345678` 이 **같은 사람인데 중복 탐지를 빠져나갔다**. common 으로 승격해 등록/수정/중복검사가
 * 같은 규칙을 쓴다(정본이 둘이면 갈라진다).
 *
 * 🔴 **결정적 규칙만**(AI 미사용·오적용 위험). 해석 불가는 `null` — 지어내지 않는다.
 * 표시용 원문(`phone`)은 그대로 두고, 이 값은 **정확 매칭용 파생 컬럼**(`phoneNormalized`)에만 쓴다.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/[^0-9+]/g, '');
  if (/^\+82/.test(d)) return d.length >= 11 ? d : null; // 이미 E.164(+82) — 자릿수 확인
  if (/^0\d{8,10}$/.test(d)) return `+82${d.slice(1)}`;   // 국내 0 접두 → +82
  return null; // 해석 불가 — 정규화하지 않는다(제안/저장 안 함)
}
