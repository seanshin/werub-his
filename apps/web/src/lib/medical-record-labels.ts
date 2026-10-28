/**
 * 의무기록 라벨 정본(2026-10-02 · 환자 차트 '의무기록' 탭) — 미비 종류·발급 문서 종류·발급 상태·발급 요청 종류.
 * 🔴 미비 종류 라벨은 미비기록 화면(/admin/him `TYPE_META`)에도 있다 — 그 화면의 i18n 소유 가드가 원문을 화면 소스에서 세기 때문에
 *    거기서 지우지 않고 **두 곳이 같은 말인지 테스트로 기계 대조**한다(`patient-medical-record-tab.spec`).
 * 모르는 코드는 **코드 그대로** 보인다(라벨을 지어내지 않는다).
 */
export const HIM_DEFICIENCY_LABEL: Record<string, string> = {
  DISCHARGE_SUMMARY: '퇴원요약',
  UNSIGNED_ENCOUNTER: '진료기록',
  UNSIGNED_NURSING_NOTE: '간호기록',
  MISSING_DIAGNOSIS: '상병 미입력',
};

/** IssuedDocument.documentType — 서버 발급 경로에 실제로 나오는 값 */
export const ISSUED_DOC_TYPE_LABEL: Record<string, string> = {
  MEDICAL_CERTIFICATE: '진단서',
  CERTIFICATE: '증명서',
  ENCOUNTER: '진료기록',
  ENCOUNTER_RECORD: '진료기록',
  DISCHARGE_SUMMARY: '퇴원요약',
  PRESCRIPTION: '처방전',
  DISPENSING: '조제기록',
  CONSENT: '동의서',
  LAB_REPORT: '검사결과지',
  LAB_WORKSHEET: '검사워크시트',
  PATHOLOGY_REPORT: '병리보고서',
  CHECKUP_RESULT: '검진결과지',
  RECEIPT: '영수증',
};

/** IssuedDocument.status — 원본·사본·재발급·무효 */
export const ISSUED_DOC_STATUS_LABEL: Record<string, string> = {
  ORIGINAL: '원본',
  COPY: '사본',
  REISSUE: '재발급',
  VOID: '무효',
};

/** DocumentRequest.type — 서류 발급 요청 */
export const DOC_REQUEST_TYPE_LABEL: Record<string, string> = {
  MEDICAL_RECORD: '의무기록 사본',
  DIAGNOSIS_CERT: '진단서',
  OPINION: '소견서',
  RECEIPT: '영수증',
  TAX_INVOICE: '세금계산서',
  ADMISSION_CERT: '입퇴원확인서',
};

export const DELIVERY_METHOD_LABEL: Record<string, string> = { VISIT: '방문 수령', FAX: '팩스', MAIL: '우편' };

export const labelOf = (table: Record<string, string>, code: string | null | undefined): string => (code ? table[code] ?? code : '-');

/** 정정 이력 — 기록 종류(서버 recordType) */
export const AMENDMENT_RECORD_TYPE_LABEL: Record<string, string> = {
  ENCOUNTER: '진료기록',
  DISCHARGE_SUMMARY: '퇴원요약',
  NURSING_NOTE: '간호기록',
  LAB_RESULT: '검사 결과',
};

/** 정정 이력 — 출처(서버 AmendmentSource) · 원장마다 남는 것이 다르다 */
export const AMENDMENT_SOURCE_LABEL: Record<string, string> = {
  SIGNED_VERSION: '이전 서명본 보존',
  UNPRESERVED: '이전 내용 미보존',
  NURSING_ADDENDUM: '원본 유지·정정문 추가',
  LAB_RESULT_AMENDMENT: '수정 전 결과 보존',
};

/**
 * 정정된 항목 — 진료기록(서버 `ENCOUNTER_AMENDABLE_FIELDS`)·퇴원요약(서버 `buildUpdateData` 키) 과 기계 대조.
 * 모르는 키는 키 그대로(지어내지 않는다).
 */
export const AMENDED_FIELD_LABEL: Record<string, string> = {
  subjective: 'S(주관적)', objective: 'O(객관적)', assessment: 'A(평가)', plan: 'P(계획)', pregnancyStatus: '임신·수유', diagnoses: '상병',
  chiefComplaint: '주호소', historyPresentIllness: '현병력', pastMedicalHistory: '과거력', familyHistory: '가족력', socialHistory: '사회력',
  reviewOfSystems: '계통 문진', physicalExamination: '신체 진찰',
  admitDate: '입원일', dischargeDate: '퇴원일', admitDiagnosis: '입원 진단', dischargeDiagnosis: '퇴원 진단', diagnosisCodes: '진단 코드',
  hospitalCourse: '입원 경과', procedures: '시술·수술', significantFindings: '주요 소견', conditionAtDischarge: '퇴원 시 상태',
  dischargeMedications: '퇴원약', followUpPlan: '추적 계획', followUpDate: '추적 일자', dietaryInstructions: '식이 지도',
  activityRestrictions: '활동 제한', patientEducation: '환자 교육',
};
