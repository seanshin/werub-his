/**
 * FHIR R4 Encounter 상태·분류·상태 이력 — 정본 하나(여정 P3-3 · 2026-10-01).
 *
 * 🔴 종전엔 같은 진료 기록을 두 매퍼가 다르게 반출했다(P12):
 *    · `fhir.controller` — 정정된 진료(AMENDED)를 `status: 'amended'` 로. **R4 Encounter.status 값 목록에 없는 값**이다
 *      (planned·arrived·triaged·in-progress·onleave·finished·cancelled·entered-in-error·unknown).
 *    · `fhir-full.service` — 같은 진료를 `in-progress`(진행 중)로. 서명까지 끝난 진료다.
 *    정정은 **진료 기록**의 사실이지 방문 상태가 아니다 — 방문은 끝났다(finished).
 * 🔴 분류(class)는 늘 `AMB`(외래)였다 — 입원 진료(admissionId·visitType INPATIENT)도 외래로 나갔다.
 * 🔴 `partOf` 는 싣지 않는다 — 입원(Admission)은 FHIR Encounter 로 제공하지 않아 `Encounter/<입원 id>` 는 **가리킬 곳이 없는 참조**다
 *    (모델·서버에 있는 것만 반출한다 — 유령 필드 규약).
 */

export type FhirR4EncounterStatus =
  | 'planned' | 'arrived' | 'triaged' | 'in-progress' | 'onleave' | 'finished' | 'cancelled' | 'entered-in-error' | 'unknown';

/** 진료 기록 상태 → 방문 상태 */
export function fhirEncounterStatus(status: string | null | undefined): FhirR4EncounterStatus {
  switch (status) {
    case 'DRAFT': return 'in-progress';
    case 'SIGNED':
    case 'AMENDED': return 'finished';
    default: return 'unknown';
  }
}

const V3 = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';

/**
 * 방문 분류 — 기록된 `visitType`·입원 연결이 근거. 둘 다 없으면 종전 기본(외래 AMB)을 쓴다
 * (진료 기록 생성 기본 경로가 외래 대기열이라서다 — 근거 없는 추정을 새로 만들지 않는다).
 */
export function fhirEncounterClass(enc: { visitType?: string | null; admissionId?: string | null }) {
  const vt = enc.visitType ?? null;
  if (vt === 'ER_CONSULT') return { system: V3, code: 'EMER', display: 'emergency' };
  if (vt === 'INPATIENT' || vt === 'INPATIENT_CONSULT' || (!vt && enc.admissionId)) return { system: V3, code: 'IMP', display: 'inpatient encounter' };
  return { system: V3, code: 'AMB', display: 'ambulatory' };
}

/**
 * 상태 이력(R4 `statusHistory`) — 원장 시각(생성·서명)에서 결정적으로 파생한다. 모르는 구간은 만들지 않는다.
 *  · 진행 중: 생성 → 서명(서명 전이면 끝 없음)
 *  · 종료: 서명 시각부터
 */
export function fhirEncounterStatusHistory(enc: { status?: string | null; createdAt: Date; signedAt?: Date | null }) {
  const out: { status: FhirR4EncounterStatus; period: { start: string; end?: string } }[] = [];
  const signed = enc.signedAt instanceof Date && !Number.isNaN(enc.signedAt.getTime()) ? enc.signedAt : null;
  out.push({ status: 'in-progress', period: signed ? { start: enc.createdAt.toISOString(), end: signed.toISOString() } : { start: enc.createdAt.toISOString() } });
  if (signed && fhirEncounterStatus(enc.status) === 'finished') out.push({ status: 'finished', period: { start: signed.toISOString() } });
  return out;
}
