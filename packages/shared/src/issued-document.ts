/**
 * 발급 원장(`IssuedDocument`) 문서 종류 정본 — 2026-10-12 기획 `decision-print-remaining` P0-3·G13·G15.
 *
 * 🔴 종전:
 *  · 진위확인 화면 라벨이 6종뿐이라 사망진단서 등은 `DEATH_CERT` 코드가 그대로 보였다(G15 — 렌더러는 14종)
 *  · 범용 발급 EP 의 종류가 `@IsString()` 하나라, 서버가 원장에서 만들어야 하는 문서(결정 대장)를
 *    클라이언트가 임의 본문으로 보내 진본 번호를 받을 수 있었다(G2·G13)
 */

/**
 * 서버가 원장에서 스냅샷을 **직접 만드는** 종류 — 범용 `POST documents/issue` 는 거부한다(400 DOCUMENT_TYPE_SERVER_BUILT).
 * 진위확인 QR 에 확인 코드(`v=`)가 붙는다(G14 — 번호 열거 방지).
 */
export const SERVER_BUILT_DOCUMENT_TYPES = ['DECISION_REGISTER', 'DECISION_RECORD', 'GOLIVE_BRIEFING', 'DUTY_ROSTER', 'QI_REPORT'] as const;
export type ServerBuiltDocumentType = (typeof SERVER_BUILT_DOCUMENT_TYPES)[number];
export const isServerBuiltDocumentType = (t: string | null | undefined): t is ServerBuiltDocumentType =>
  !!t && (SERVER_BUILT_DOCUMENT_TYPES as readonly string[]).includes(t);

/**
 * 종류 라벨 — 렌더러 종류(`/print/[issueNo]`)·서버 발급 종류·운영 원장에 있는 종류를 모두 덮는다(가드가 대조).
 * 운영 2026-10-12 실측: ERP_MEDICAL_CONTRACT 2 · CONTRACT 1 · CONSENT 1 · MEDICAL_RECORD_COPY 1 · CHECKUP_RESULT 2 · CERTIFICATE 1 · RECEIPT 3
 */
export const ISSUED_DOCUMENT_TYPE_LABEL: Readonly<Record<string, string>> = {
  LAB_REPORT: '검사 성적서',
  ENCOUNTER_RECORD: '진료기록지',
  PRESCRIPTION: '처방전',
  CERTIFICATE: '진단서',
  OPINION: '소견서',
  ADMISSION_CERT: '입퇴원확인서',
  DEATH_CERT: '사망진단서(시체검안서)',
  BIRTH_CERT: '출생증명서',
  MEDICAL_RECORD_COPY: '의무기록 사본',
  ERP_MEDICAL_CONTRACT: '의료계약서',
  ERP_OUTSOURCING_CONTRACT: '외주용역계약서',
  DETAILED_BILL: '진료비 세부산정내역서',
  ATTENDANCE_CERT: '통원확인서',
  RECEIPT: '진료비 영수증',
  CHECKUP_RESULT: '건강검진 결과서',
  CONSENT: '동의서',
  CONTRACT: '계약서',
  DECISION_REGISTER: '결정 대장',
  DECISION_RECORD: '의사결정서',
  GOLIVE_BRIEFING: '실서비스 개시 브리핑',
  DUTY_ROSTER: '당직표',
  QI_REPORT: 'QI 보고서',
};

/**
 * 의사만 발급하는 문서(2026-10-13 결함 발굴 A4 · 의료법 §17 — 진단서·검안서·증명서는 직접 진찰한 의사가 교부).
 * 🔴 종전엔 범용 발급 EP(간호사·원무 포함)로 진단서가 의사 서명 없이 나갔다.
 * 출생증명서는 넣지 않는다 — 조산사도 교부할 수 있는데(§17②) 시스템이 조산사를 구분하지 못한다(막으면 거짓 거부).
 */
export const PHYSICIAN_ISSUED_DOCUMENT_TYPES: readonly string[] = ['CERTIFICATE', 'OPINION', 'DEATH_CERT'];
export const isPhysicianIssuedDocumentType = (t: string | null | undefined): boolean => !!t && PHYSICIAN_ISSUED_DOCUMENT_TYPES.includes(t);

/** 라벨 — 모르는 종류는 null(코드를 사람 글자인 척하지 않는다 · 화면은 코드를 그대로 보이고 "등록되지 않은 종류"라 말한다) */
export const issuedDocumentTypeLabel = (t: string | null | undefined): string | null => (t ? ISSUED_DOCUMENT_TYPE_LABEL[t] ?? null : null);

/** 발급번호 `WRB-{TYPE}-{YYYYMMDD}-{seq}` 에서 종류 — 형식이 아니면 null */
export function documentTypeOfIssueNo(issueNo: string): string | null {
  const m = /^WRB-([A-Z][A-Z0-9_]*)-(\d{8})-(\d{1,6})$/.exec(issueNo);
  return m ? m[1] : null;
}

/**
 * 발급 원장에 올리지 않는 인쇄본 — 2026-10-12 기획 P1.
 *  · `NOT_ISSUED` — 발급 대상이 아니다(단축키 안내 등) · QR 을 싣지 않는다(대조할 곳이 없는 QR 은 인증인 척이다 · G4)
 *  · `PENDING_D2` — 환자 정보가 든 인쇄본 · 발급 원장 보존기간·열람 역할(사람 결정 D2) 전에는 원장에 올리지 않는다
 */
export type UnissuedPrintReason = 'NOT_ISSUED' | 'PENDING_D2';
export const UNISSUED_PRINT_TEXT: Record<UnissuedPrintReason, string> = {
  NOT_ISSUED: '발급 대상 아님 — 진위확인 없음',
  PENDING_D2: '원장 미등재 — 진위확인 불가(환자 정보 인쇄본 · 보존·열람 결정 전)',
};

/**
 * 서버 PDF(`/print/[issueNo]` 렌더러)가 양식을 가진 종류 — 2026-10-12.
 * 🔴 양식이 없는 종류는 렌더러가 "로딩 중…"을 찍은 채 PDF 가 만들어졌다 — 전자서명 요청은 그 PDF 의 해시를 서명 대상으로 보냈다.
 *    양식이 없으면 서버 PDF 를 만들지 않는다(409) · 가드가 렌더러 페이지의 분기와 이 목록을 기계 대조한다.
 */
export const PRINT_RENDERER_TYPES = [
  'LAB_REPORT', 'ENCOUNTER_RECORD', 'PRESCRIPTION', 'CERTIFICATE', 'OPINION', 'ADMISSION_CERT', 'DEATH_CERT', 'BIRTH_CERT',
  'MEDICAL_RECORD_COPY', 'ERP_MEDICAL_CONTRACT', 'ERP_OUTSOURCING_CONTRACT', 'DETAILED_BILL', 'ATTENDANCE_CERT', 'RECEIPT',
] as const;
/** 발급 때 본문 HTML 을 스냅샷에 동결하는 종류 — 서버 PDF 는 그 HTML 로 그린다(동의서: 동의서 모듈 정본 HTML) */
export const HTML_SNAPSHOT_TYPES = ['CONSENT'] as const;
export const hasServerPrintForm = (t: string | null | undefined) =>
  !!t && ((PRINT_RENDERER_TYPES as readonly string[]).includes(t) || (HTML_SNAPSHOT_TYPES as readonly string[]).includes(t));
