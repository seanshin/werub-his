/**
 * 환자 포털 공개 범위 — 정본(2026-10-20 포털 세련화 P3 · 결정 등록부 배치 10-J).
 *
 * 🔴 무엇을 환자에게 언제 보여 주는가는 사람 결정이다(등록부 키가 정본 — 기획서 표는 정본이 아니다).
 *    2026-10-20 사용자 지시로 정한 선택을 개발 시드로 기록하고 그대로 구현했다(판정표 "시드대로 구현됨").
 *    실결정이 다르게 나오면 결정 엔진이 "되돌림 필요"를 남긴다.
 *
 *  · `portal.visitSummaryScope`     = GENERAL — 진료 후 요약은 진단명(일반 수준)·처방·다음 예약·일반 안내까지. 의사 소견 원문은 싣지 않는다.
 *  · `portal.patientReportedVitals` = REFERENCE_ONLY — 환자가 집에서 잰 값은 의료진 화면에 "환자 입력·참고용"으로만. 경보·조절 판정에 쓰지 않는다.
 *  · `portal.costEstimate`          = SHOW_AS_ESTIMATE — 예상 진료비는 "예측 자료이며 실제와 다를 수 있다"를 붙여서만 보인다.
 *  · `portal.labResultRelease`      = VALUES_NOW_JUDGMENT_AFTER_REVIEW — 검사 수치는 바로, 판정(높음·낮음·결론)은 의료진 확인 뒤.
 */
export const PORTAL_DISCLOSURE_DECISIONS = {
  visitSummaryScope: { key: 'portal.visitSummaryScope', seed: 'GENERAL' },
  patientReportedVitals: { key: 'portal.patientReportedVitals', seed: 'REFERENCE_ONLY' },
  costEstimate: { key: 'portal.costEstimate', seed: 'SHOW_AS_ESTIMATE' },
  labResultRelease: { key: 'portal.labResultRelease', seed: 'VALUES_NOW_JUDGMENT_AFTER_REVIEW' },
} as const;

// ── B4 가정 측정 ──────────────────────────────────────────────

/** 환자가 직접 잰 값의 출처(ChronicObservation.source). 의료진 측정·기기 연동·검사와 구분한다. */
export const PATIENT_REPORTED_SOURCES = ['SMBG'] as const;
export function isPatientReportedSource(source: string | null | undefined): boolean {
  return source != null && (PATIENT_REPORTED_SOURCES as readonly string[]).includes(source);
}

// ── B2 진료 후 요약 ───────────────────────────────────────────

/**
 * 진료 후 요약에 싣는 진단 — 일반 수준(GENERAL).
 *  · 감별 진단(DIFFERENTIAL)·배제 진단(RULE_OUT)은 싣지 않는다 — 의사가 "아닌지 보는 중"인 병명을 환자가 확정으로 읽는다
 *  · 추정(PROVISIONAL)은 싣되 "추정"을 붙인다(certainty 가 비어 있으면 붙일 말이 없다 — 지어내지 않는다)
 */
export function visitSummaryIncludesDiagnosis(d: { type?: string | null; certainty?: string | null }): boolean {
  return d.type !== 'DIFFERENTIAL' && d.certainty !== 'RULE_OUT';
}

// ── B8 검사 결과 공개 ─────────────────────────────────────────

/**
 * 검사 결과 한 건의 공개 상태.
 *  · REVIEWED         — 의료진이 확인했다(확인 시각 있음) → 수치 + 판정
 *  · AWAITING_REVIEW  — 의료진 확인 전 → 수치만(판정은 비운다)
 */
export const LAB_RELEASE_STATES = ['REVIEWED', 'AWAITING_REVIEW'] as const;
export type LabReleaseState = (typeof LAB_RELEASE_STATES)[number];
export function labReleaseState(reviewedAt: Date | string | null | undefined): LabReleaseState {
  return reviewedAt ? 'REVIEWED' : 'AWAITING_REVIEW';
}

// ── B6 진료비 사전 안내 ───────────────────────────────────────

/** 예상 진료비 표본 — 최근 같은 진료과 방문의 본인부담 범위를 볼 때 몇 건까지 보는가 */
export const COST_ESTIMATE_RECENT_SAMPLE = 6;
