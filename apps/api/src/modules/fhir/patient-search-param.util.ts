/**
 * FHIR 환자 검색 파라미터 정본 — `patient` 와 `subject` 는 **같은 환자**를 가리킨다.
 *
 * 🔴 핸들러가 한쪽 이름만 읽으면, **다른 이름으로 필터한 요청이 전 환자를 돌려받는다.**
 *    (2026-09-15 외부 실측: 트윈은 Observation 을 `subject=` 로, cerno 는 MedicationRequest·
 *    Procedure·DiagnosticReport·DocumentReference 를 `patient=` 로 검색하는데 HIS 는 각각
 *    반대 이름만 읽어, 필터가 통째로 사라진 채 다른 환자 기록이 섞여 나갔다.)
 *
 * 🔴 SMART 환자 스코프에서도 뚫린다 — 가드는 `patient ?? subject` 로 토큰 환자와 대조해
 *    통과시키지만(일치하므로 주입도 하지 않는다), 핸들러가 그 이름을 안 읽으면 필터가 없다.
 *    가드의 정규화(`smart-auth.guard.ts` — 두 키를 함께 채운다)와 이 함수는 **둘 다** 필요하다.
 *
 * FHIR R4 에서 `patient` 는 `subject` 중 Patient 로 한정한 검색 파라미터라 두 이름 모두 정당하다.
 */
export function patientSearchRef(...values: (string | null | undefined)[]): string | undefined {
  for (const raw of values) {
    if (raw === null || raw === undefined) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    return trimmed.replace(/^Patient\//, '');
  }
  return undefined;
}
