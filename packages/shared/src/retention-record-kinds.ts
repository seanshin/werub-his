/**
 * 국가별 **법정 보존 기록 종류** 어휘 — 2026-09-13 (상용 릴리즈 기획 T10 · 결정 전 가능분 A1).
 *
 * 🔴 **이 파일에는 보존 기간(일·연)을 넣지 않는다.** 저장소 규칙: 법령 수치·조문은 레지스트리·시드에 박지 않는다 —
 *    검증이 어렵고 자주 바뀌며, 시드에 들어가면 그것이 곧 정책이 된다. 기간·기산점은 **기관 설정(RetentionPolicy) +
 *    법무 확정(`legalConfirmed`)** 이 정본이다. 여기에는 "무엇을 보존해야 하는가(종류 이름)"와 "그 근거가 어디인가(출처)",
 *    그리고 "이 시스템의 어느 모델이 그 종류인가(매핑)"만 둔다.
 *
 * 🔴 **매핑은 지어내지 않는다.** 실측으로 대응 모델이 분명한 것만 `MAPPED`, 비슷하지만 법적으로 같은지 확인되지 않은 것은
 *    `CANDIDATE`(법무 확인 필요), 대응 모델을 찾지 못한 것은 `UNMAPPED` 로 둔다.
 *
 * 🔴 **출처 대조 여부를 숨기지 않는다.** 원문(법제처 등)을 직접 대조하지 못하고 2차 자료(검색 요약·로펌 해설)로만
 *    확인한 것은 `sourceVerified: false`. 법무 확정 때 원문 대조가 필요하다.
 *
 * 기산점(보존기간을 언제부터 세는가)도 나라마다 다르다 — 한국은 기록 작성일, UAE 는 마지막 진료일로 읽힌다(2차 출처).
 * 이 역시 **결정 대기**라 여기서 정하지 않고, 집계는 두 기준을 모두 보여준다(`retention.service` legalKinds).
 */

export type RetentionCountry = 'KR' | 'AE';

export type RetentionMappingStatus = 'MAPPED' | 'CANDIDATE' | 'UNMAPPED';

/** 집계에 쓰는 시스템 기록 소스(모델) — 서버 `retention.service` 의 SQL 조각과 1:1 */
export type RetentionRecordSource =
  | 'PATIENT'
  | 'ENCOUNTER'
  | 'PRESCRIPTION'
  | 'SURGERY'
  | 'LAB_RESULT'
  | 'IMAGING_RESULT'
  | 'NURSING_NOTE'
  | 'UNIVERSAL_NURSING_NOTE'
  | 'DELIVERY_RECORD'
  | 'ISSUED_DOCUMENT'
  | 'CONSENT_FORM';

export interface RetentionSourceRef {
  label: string;
  url: string;
  /** 원문을 직접 대조했는가 — false 면 2차 자료로만 확인(법무 확정 때 원문 대조 필요) */
  sourceVerified: boolean;
}

export interface RetentionRecordKind {
  /** 국가 안에서 유일한 키 */
  key: string;
  country: RetentionCountry;
  /** 법령상 이름(원어) */
  legalName: string;
  mapping: RetentionMappingStatus;
  /** 대응 시스템 소스 — UNMAPPED 면 빈 배열 */
  sources: RetentionRecordSource[];
  /** 매핑 판단 근거·한계(사람이 읽는 문장) */
  note: string;
  source: RetentionSourceRef;
}

const KR_RULE_15: RetentionSourceRef = {
  label: '의료법 시행규칙 제15조(진료기록부 등의 보존)',
  url: 'https://www.law.go.kr/lumLsLinkPop.do?lspttninfSeq=61681',
  sourceVerified: false,
};

const AE_LAW_2_2019: RetentionSourceRef = {
  label: 'UAE Federal Law No. 2 of 2019 (Use of ICT in Health Fields) — Article 20',
  url: 'https://www.lw.com/en/insights/2019/06/new-uae-law-regulates-healthcare-data',
  sourceVerified: false,
};

export const RETENTION_RECORD_KINDS: readonly RetentionRecordKind[] = [
  // ── KR: 의료법 시행규칙 제15조 제1항 9종 ──────────────────────────────────────
  { key: 'PATIENT_REGISTER', country: 'KR', legalName: '환자 명부', mapping: 'MAPPED', sources: ['PATIENT'],
    note: '환자 등록 원장(patients)', source: KR_RULE_15 },
  { key: 'CLINICAL_RECORD', country: 'KR', legalName: '진료기록부', mapping: 'MAPPED', sources: ['ENCOUNTER'],
    note: '진료(encounters) — 입원 경과기록(progress_notes)·퇴원요약은 포함하지 않았다(입원 기록의 법정 분류는 법무 확인 필요)', source: KR_RULE_15 },
  { key: 'PRESCRIPTION', country: 'KR', legalName: '처방전', mapping: 'MAPPED', sources: ['PRESCRIPTION'],
    note: '처방(prescriptions) — 원외 처방전 발행본과 원내 오더가 한 테이블이다', source: KR_RULE_15 },
  { key: 'SURGERY_RECORD', country: 'KR', legalName: '수술기록', mapping: 'MAPPED', sources: ['SURGERY'],
    note: '수술(surgeries) — 수술기록지(surgery_op_notes)는 수술 1건에 1행이라 수술 단위로 센다', source: KR_RULE_15 },
  { key: 'LAB_RECORD', country: 'KR', legalName: '검사내용 및 검사소견기록', mapping: 'MAPPED', sources: ['LAB_RESULT'],
    note: '검사 결과(lab_results)', source: KR_RULE_15 },
  { key: 'RADIOLOGY_RECORD', country: 'KR', legalName: '방사선 사진 및 그 소견서', mapping: 'CANDIDATE', sources: ['IMAGING_RESULT'],
    note: '소견(imaging_results)만 HIS 에 있다 — 방사선 사진(영상 원본)은 OpenPACS 소관이라 HIS 보존 정책이 닿지 않는다', source: KR_RULE_15 },
  { key: 'NURSING_RECORD', country: 'KR', legalName: '간호기록부', mapping: 'MAPPED', sources: ['NURSING_NOTE', 'UNIVERSAL_NURSING_NOTE'],
    note: '입원 간호기록(nursing_notes)과 범용 간호기록(universal_nursing_notes)의 합', source: KR_RULE_15 },
  { key: 'MIDWIFERY_RECORD', country: 'KR', legalName: '조산기록부', mapping: 'CANDIDATE', sources: ['DELIVERY_RECORD'],
    note: '분만기록(delivery_records)이 가장 가깝지만 조산사가 작성하는 조산기록부와 같은 기록인지 확인되지 않았다', source: KR_RULE_15 },
  { key: 'CERTIFICATE_COPY', country: 'KR', legalName: '진단서 등의 부본', mapping: 'CANDIDATE', sources: ['ISSUED_DOCUMENT'],
    note: '발급 원장(issued_documents)은 발급 사실·원천 참조를 담는다 — 부본(발급본 사본) 자체를 보관하는지는 확인되지 않았다', source: KR_RULE_15 },

  // ── AE: 연방법 2019년 제2호 — 보건 데이터(단일 분류) ─────────────────────────────
  { key: 'HEALTH_DATA', country: 'AE', legalName: 'Health data (health information and records)', mapping: 'UNMAPPED', sources: [],
    note: '법이 기록 종류를 나누지 않고 보건 데이터 전반을 대상으로 한다(2차 출처) — 특정 모델 하나로 매핑하지 않는다', source: AE_LAW_2_2019 },
];

export function retentionRecordKindsOf(country: RetentionCountry): RetentionRecordKind[] {
  return RETENTION_RECORD_KINDS.filter((k) => k.country === country);
}
