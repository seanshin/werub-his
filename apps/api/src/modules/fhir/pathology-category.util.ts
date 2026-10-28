/**
 * 병리 오더 판정 — EDI 수가코드 프리픽스 기반 (LIS PAT category 라우팅, 2026-07-15 계약).
 * 수가마스터에 병리 플래그가 없어 프리픽스 세트로 판정한다. 기본 세트는 병리검사료 챕터
 * 추정치(조직·세포병리 C55~C60·침생검 C85)이며, **병리과·원무 확정 시 config
 * `fhir.pathologyEdiPrefixes`(JSON 배열)로 재배포 없이 조정**한다.
 */
export const DEFAULT_PATHOLOGY_EDI_PREFIXES = ['C55', 'C56', 'C57', 'C58', 'C59', 'C60', 'C85'];

export function isPathologyEdiCode(code: string | null | undefined, prefixes?: string[] | null): boolean {
  if (!code) return false;
  const list = prefixes?.length ? prefixes : DEFAULT_PATHOLOGY_EDI_PREFIXES;
  const upper = String(code).toUpperCase();
  return list.some((p) => upper.startsWith(String(p).toUpperCase()));
}

/** LIS 계약 정본 — 병기 category 코딩 값 (laboratory 코딩은 유지·추가만) */
export const PATHOLOGY_CATEGORY_CODING = {
  system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
  code: 'PAT',
  display: 'Pathology',
} as const;
