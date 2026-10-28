/**
 * 영상 modality 어휘 정본 — 전리방사선(피폭) 대상 판정.
 *
 * 🔴 정본을 만든 것과 **모든 소비처가 그것을 쓰는 것**은 다른 일이다. 이 집합은
 *    ① 시행 전 안전게이트(임신·누적선량 — `ImagingSafetyService`)
 *    ② 데이터 품질 지표(선량 미기록 촬영 — `quality-registry`)
 *    두 곳이 함께 읽는다. 한쪽에만 적으면 게이트가 세는 모집단과 지표가 세는 모집단이 갈라진다.
 *
 * 어휘의 출처: 시술코드 마스터 `procedure_codes.modality` 실측 7종
 * (CT 4,472 · MR 3,338 · US 1,781 · CR 1,680 · RF 245 · NM 78 · MG 21 — 2026-08-24).
 * `CTA`·`DX`·`XA`·`PT` 는 마스터에 아직 없지만 DICOM 표준 값이라 함께 둔다.
 * `XR`·`X-ray` 는 **표준 밖 잔재**다(운영 `imaging_results` 에 2건). 새로 만들지는 않되
 * (생산 경로 폴백은 `CR`), 이미 저장된 것을 안전 판정·선량 추적에서 빠뜨리지 않는다.
 */
export const IONIZING_MODALITIES = new Set([
  'CT', 'CTA', 'CR', 'DX', 'RF', 'XA', 'MG', 'NM', 'PT',
  'XR', 'X-RAY', // 표준 밖 잔재 — 승격이 아니라 누락 방지
]);

/** 비전리(피폭 없음) — 초음파·자기공명 */
export const NON_IONIZING_MODALITIES = new Set(['US', 'MR', 'MRI']);

export function isIonizingModality(modality?: string | null): boolean {
  return !!modality && IONIZING_MODALITIES.has(modality.trim().toUpperCase());
}

/**
 * Prisma `in` 필터용 — DB 에 실제로 저장될 수 있는 표기(대문자 정본 + 잔재 원문 `X-ray`).
 * 🔴 대소문자를 섞어 저장한 잔재가 있어 `X-ray` 를 따로 넣는다. 지표의 분모가 되므로
 *    여기서 빠지면 "선량 미기록"이 조용히 과소 집계된다(어휘 오염이 안전장치를 끄는 경로).
 */
export const IONIZING_MODALITY_VALUES = [...IONIZING_MODALITIES, 'X-ray'];
