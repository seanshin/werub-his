/**
 * 감사(AuditLog) 라우트 규약 — 2026-07 감사 커버리지 전수검토 결과 정본.
 *
 * 설계 원칙(구 설계에서 전환):
 *   구) 정규식 allowlist 28종에 매칭되는 경로만 감사 → **미등록 도메인은 기본 미감사**(누락이 기본값).
 *       실측: 간호기록 190·경과기록 56·수술 11·활력 492건이 AuditLog 0건.
 *   신) **변이(POST/PUT/PATCH/DELETE)는 기본 감사 ON**, 면제만 명시(AUDIT_EXEMPT·@NoAudit).
 *       신규 도메인이 추가돼도 자동으로 감사 대상 — 여정 이벤트 단일 구독점과 같은 구조 보장.
 *
 * 판정 근거·면제 사유: docs/03-analysis/audit-coverage-audit-2026-07.md
 */

/** 완전한 UUID 세그먼트 (부분 hex 매칭 금지 — 구 `[0-9a-f-]+` 오탐의 원인) */
export const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_G = new RegExp(UUID_RE, 'gi');
const UUID_FULL = new RegExp(`^${UUID_RE}$`, 'i');

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * 경로 → 감사 리소스명 매핑. 미매칭 시 경로 세그먼트에서 자동 파생(deriveResourceType).
 * 프리픽스 경계 `(?=/|$)` 필수 — 구 설계는 경계가 없어 `/billing` 이 `/billings` 를 함께 삼켰음.
 */
export const RESOURCE_TYPE_MAP: Array<{ pattern: RegExp; resourceType: string }> = [
  // 환자·진료
  { pattern: /^\/api\/v1\/patients(?=\/|$)/, resourceType: 'Patient' },
  { pattern: /^\/fhir\/R4\/Patient(?=\/|$)/, resourceType: 'Patient' },
  { pattern: /^\/api\/v1\/encounters(?=\/|$)/, resourceType: 'Encounter' },
  { pattern: /^\/api\/v1\/prescriptions(?=\/|$)/, resourceType: 'Prescription' },
  { pattern: /^\/api\/v1\/orders(?=\/|$)/, resourceType: 'Order' },
  { pattern: /^\/api\/v1\/workstation/, resourceType: 'Order' },
  { pattern: /^\/api\/v1\/pre-orders(?=\/|$)/, resourceType: 'PreOrder' },
  { pattern: /^\/api\/v1\/therapy-orders(?=\/|$)/, resourceType: 'TherapyOrder' },
  // 검사·영상·병리
  { pattern: /^\/api\/v1\/lab(?=\/|$)/, resourceType: 'LabResult' },
  { pattern: /^\/api\/v1\/imaging(?=\/|$)/, resourceType: 'ImagingResult' },
  { pattern: /^\/api\/v1\/pathology(?=\/|$)/, resourceType: 'Pathology' },
  { pattern: /^\/api\/v1\/pacs(?=\/|$)/, resourceType: 'PacsReport' }, // 파생하면 단수화가 'Pac' 을 만든다
  // 의무기록·동의
  { pattern: /^\/api\/v1\/medical-records(?=\/|$)/, resourceType: 'MedicalRecord' },
  { pattern: /^\/api\/v1\/consent/, resourceType: 'ConsentForm' },
  { pattern: /^\/api\/v1\/discharge/, resourceType: 'DischargeSummary' },
  // 수납·보험 (실 라우트가 복수형 `/billings/:id` 라 단·복수 모두 Billing 으로 귀속)
  { pattern: /^\/api\/v1\/billings?(?=\/|$)/, resourceType: 'Billing' },
  { pattern: /^\/api\/v1\/claims(?=\/|$)/, resourceType: 'Claim' },
  // 약제
  { pattern: /^\/api\/v1\/pharmacy/, resourceType: 'Dispensing' },
  { pattern: /^\/api\/v1\/medication-administrations(?=\/|$)/, resourceType: 'MedicationAdministration' },
  { pattern: /^\/api\/v1\/controlled-substance/, resourceType: 'ControlledSubstance' },
  // 입원·민감 임상
  { pattern: /^\/api\/v1\/admissions(?=\/|$)/, resourceType: 'Admission' },
  { pattern: /^\/api\/v1\/inpatient/, resourceType: 'Admission' },
  { pattern: /^\/api\/v1\/psychiatry/, resourceType: 'Psychiatry' },
  { pattern: /^\/api\/v1\/blood-bank/, resourceType: 'BloodBank' },
  { pattern: /^\/api\/v1\/transplant/, resourceType: 'Transplant' },
  { pattern: /^\/api\/v1\/hospice/, resourceType: 'Hospice' },
  { pattern: /^\/api\/v1\/research/, resourceType: 'Research' },
  { pattern: /^\/api\/v1\/crm/, resourceType: 'Crm' },
  // 사용자·시스템
  { pattern: /^\/api\/v1\/users(?=\/|$)/, resourceType: 'User' },
  { pattern: /^\/api\/v1\/appointments(?=\/|$)/, resourceType: 'Appointment' },
  { pattern: /^\/api\/v1\/admin/, resourceType: 'AdminConfig' },
  // 보안 통제 (2026-07 신규 — 권한 변경 이력이 전무했음)
  { pattern: /^\/api\/v1\/access-control/, resourceType: 'AccessControl' },
  { pattern: /^\/api\/v1\/break-the-glass/, resourceType: 'BreakTheGlass' },
  { pattern: /^\/api\/v1\/vip-patients/, resourceType: 'VipPatient' },
  // 환자안전사고 보고 — 보고자 신원이 걸린 법정기록(환자안전법 §16·§17).
  // /api/v1/safety 아래의 낙상평가·EWS·보호대 등은 종전대로 'Safety' 로 파생된다(여기 걸지 않는다).
  { pattern: /^\/api\/v1\/safety\/(incidents|rca)(?=\/|$)/, resourceType: 'SafetyIncident' },
];

/**
 * 감사 면제 — **면제는 근거를 남긴다**(신규 면제 추가 시 정본 문서에도 등재).
 * 원칙: ①PHI/임상/보안 무관 ②고빈도 UX 상태 토글 ③미인증 공개 경로(어차피 actor 없음).
 */
export const AUDIT_EXEMPT: Array<{ pattern: RegExp; reason: string }> = [
  // 🔴 2026-08-18: 이 면제 사유는 **사실이 아니었다** — auth 모듈에 감사 호출이 0건이라
  //    직원 로그인·로그아웃이 개통 이래 한 건도 기록되지 않았다(의료법 §23④).
  //    이제 `auth/auth-audit.ts` 정본이 AuthSession(CREATE=로그인·DELETE=로그아웃)·AuthLoginFailure 를 남긴다.
  //    인터셉터가 아니라 auth 모듈이 남기는 이유: 실패한 로그인은 인터셉터에 actor 가 없다.
  { pattern: /^\/api\/v1\/auth\/(login|refresh|logout)/, reason: '세션 감사는 auth 모듈이 직접 기록(auth-audit.ts) — 인터셉터 이중기록 방지' },
  { pattern: /^\/api\/v1\/notifications\/(.*\/)?read(-all)?$/, reason: '알림 읽음 토글 — 고빈도 UX 상태·PHI 아님' },
  { pattern: /^\/api\/v1\/dashboard\/(config|templates)/, reason: '개인 대시보드 레이아웃 설정 — 비PHI 개인 환경설정' },
  { pattern: /^\/api\/v1\/dev\//, reason: '개발 전용(운영 config OFF) — 데모 데이터 도구' },
  { pattern: /^\/api\/v1\/public\//, reason: '공개 엔드포인트(미인증) — actor 특정 불가' },
  { pattern: /^\/api\/v1\/queue\/public/, reason: '대기현황 공개 디스플레이 — 비PHI 표시 전용' },
  { pattern: /^\/(health|metrics)/, reason: '헬스체크·메트릭' },
];

/**
 * PHI 열람(GET) 감사 — 특정 환자를 지목한 조회만 기록.
 * ①경로에 UUID 세그먼트가 있는 상세 조회 ②query.patientId 가 있는 모든 조회(도메인 무관·신규 자동 포함)
 * 구 설계의 `[0-9a-f-]+` 부분매칭은 `/billing/daily-summary` 같은 집계 조회까지 READ 로 기록했고
 * (실측 Billing READ 245건 전량 resourceId=zero) 정작 `/billings/:uuid` 실 열람은 놓쳤음.
 */
export const PHI_READ_PATTERNS: RegExp[] = [
  new RegExp(`^/api/v1/patients/${UUID_RE}`, 'i'),
  new RegExp(`^/fhir/R4/Patient/${UUID_RE}`, 'i'),
  new RegExp(`^/api/v1/encounters/${UUID_RE}`, 'i'),
  new RegExp(`^/api/v1/lab/results/${UUID_RE}`, 'i'),
  new RegExp(`^/api/v1/billings?/${UUID_RE}`, 'i'),
  /**
   * 청구·EDI 문서 열람(2026-09-01) — `GET /claims/:id`·`/:id/xml`·`/:id/edi`·`GET /hira-edi/:id` 는
   * 환자 성명·MRN·**보험증번호**(복호 후 평문)가 든 청구 문서를 통째로 내보내는 자리인데,
   * 같은 급인 `billings/:id` 만 등재돼 있고 여기가 빠져 **개통 이래 열람 감사 0** 이었다
   * (운영 실측: XML 다운로드 후 audit_logs Claim 행 없음 — 변이만 있었다).
   * 목록(`/claims`·`/hira-edi`)은 billings 목록과 동급으로 제외(환자 지목이 아니다).
   */
  new RegExp(`^/api/v1/claims/${UUID_RE}`, 'i'),
  new RegExp(`^/api/v1/hira-edi/${UUID_RE}`, 'i'),
  /**
   * 판독문·검진 결과서 반출(2026-09-01) — lab/results/:id 는 등재돼 있는데 같은 급의
   * 영상 판독(pacs 프록시·imaging 결과)과 검진 결과서 PDF 가 빠져 열람 감사 0 이었다.
   * pacs 리포트 id 는 OpenPACS 쪽 비UUID 라 UUID 패턴으로 못 건다 — 세그먼트 존재로 잡고,
   * 귀속은 extractResourceId 규약(비UUID→ZERO_UUID·"귀속 실패를 원장이 말한다")을 따른다.
   * 목록(/pacs/reports)은 제외, 환자 지목 목록(/pacs/patients/:pid/reports)은 전건 반출이라 포함.
   */
  /^\/api\/v1\/pacs\/reports\/[^/?]+/,
  /^\/api\/v1\/pacs\/patients\/[^/?]+\/reports(?=\/|$|\?)/,
  new RegExp(`^/api/v1/imaging/results/${UUID_RE}`, 'i'),
  new RegExp(`^/api/v1/checkup/visits/${UUID_RE}/result-pdf`, 'i'),
  new RegExp(`^/api/v1/medical-records/${UUID_RE}`, 'i'),
  /** 환자↔담당의 메시지 스레드(2026-09-14 신설) — 환자 지목 열람. 받은편지함(`/inbox`)은 본문 없는 묶음이라 제외 */
  new RegExp(`^/api/v1/patient-messages/patients/${UUID_RE}`, 'i'),
  /**
   * 환자 여정 타임라인·기간 보고서(`/journey/:patientId/timeline|report`)·처방 설명 가이드(`/nurse-station/rx-guide/:encounterId`)
   * — 2026-09-14 S4: 보고서·가이드를 만들며 확인하니 타임라인도 환자 지목 조회인데 열람 감사 대상에서 빠져 있었다.
   */
  new RegExp(`^/api/v1/journey/${UUID_RE}/(timeline|report|clinical-lens|episodes)`, 'i'), // episodes(방문 묶음) 2026-10-01
  new RegExp(`^/api/v1/nurse-station/rx-guide/${UUID_RE}`, 'i'),
  /^\/api\/v1\/medical-records\/search/,
  /^\/api\/v1\/controlled-substance/, // 마약류는 목록 열람까지 법정 기록
  /**
   * 환자안전사고 — **목록 열람까지** 법정 기록(2026-08-18).
   *
   * 🔴 마약류는 목록 열람까지 감사하는데, **보고자 신원이 든 사고보고는 통째로 빠져 있었다.**
   *    운영 실측: `audit_logs` 에 safety 계열 열람 기록 **0건**(resource_type ILIKE '%safety%').
   *    환자안전법 §17 은 보고자 정보 누설을 3년 이하 징역으로 처벌한다 — 누가 언제 무엇을
   *    열어봤는지 남지 않으면 누설을 **탐지할 수도, 부인할 수도** 없다.
   *
   * `/incidents/stats`·`/ipsg-summary` 같은 집계는 제외한다(환자·보고자를 지목하지 않는다).
   * 목록(`/incidents`)은 포함 — 보고 내용 전건이 한 번에 나가는 지점이라 집계가 아니다.
   */
  /^\/api\/v1\/safety\/incidents\/?(\?|$)/, // 사고 목록(전건 열람)
  new RegExp(`^/api/v1/safety/incidents/${UUID_RE}`, 'i'), // 사고 상세 · 사건별 RCA
  /^\/api\/v1\/safety\/rca(?=\/|$|\?)/, // RCA 목록 — 사건 경위·근본원인이 함께 나간다
];

const HTTP_METHOD_ACTION: Record<string, 'CREATE' | 'UPDATE' | 'DELETE'> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

export function actionForMethod(method: string) {
  return HTTP_METHOD_ACTION[method?.toUpperCase?.() ?? ''];
}

export function isExempt(path: string): boolean {
  return AUDIT_EXEMPT.some((e) => e.pattern.test(path));
}

/** kebab-case 경로 세그먼트 → PascalCase 단수형 (nursing-notes → NursingNote, ess → Ess) */
export function toResourceName(segment: string): string {
  const pascal = segment
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  // 단순 복수형만 단수화 — 'ss'로 끝나면(Ess, Access) 유지
  if (pascal.length > 3 && pascal.endsWith('s') && !pascal.endsWith('ss')) return pascal.slice(0, -1);
  return pascal;
}

/** 레지스트리 우선, 미등록이면 경로에서 자동 파생 — 신규 도메인이 'Unknown'으로 새지 않도록 */
export function deriveResourceType(path: string): string {
  const hit = RESOURCE_TYPE_MAP.find((m) => m.pattern.test(path));
  if (hit) return hit.resourceType;

  const parts = path.split('/').filter(Boolean);
  let i = 0;
  if (parts[0] === 'fhir') i = 2; // /fhir/R4/<Resource>
  else {
    if (parts[i] === 'api') i += 1;
    if (parts[i] === 'v1') i += 1;
  }
  const seg = parts[i];
  if (!seg) return 'Unknown';
  // 세그먼트가 UUID면 상위(=컨트롤러 루트)가 없는 경우이므로 그 앞을 사용
  if (UUID_FULL.test(seg)) return toResourceName(parts[i - 1] ?? 'Unknown');
  return toResourceName(seg);
}

/**
 * 대상 리소스 ID — **마지막** UUID 우선.
 * 구 설계는 첫 UUID를 채택해 `/patients/:pid/allergies/:aid` 가 부모(pid)로 귀속됐음.
 * 응답 id 도 UUID 검증 후에만 사용(비UUID면 DB uuid 컬럼 저장 실패 → 재시도 소진 → 버퍼 적재 →
 * 플러셔가 같은 항목에서 계속 실패하는 poison-message 로 감사 버퍼 전체가 멈춤).
 */
export function extractResourceId(path: string, responseId?: unknown): string {
  const found = path.match(UUID_G);
  if (found?.length) return found[found.length - 1];
  if (typeof responseId === 'string' && UUID_FULL.test(responseId)) return responseId;
  return ZERO_UUID;
}

/** 조회 대상 환자 — query.patientId 가 UUID일 때만(문자열 MRN 등은 대상 아님) */
export function patientIdFromQuery(query: Record<string, unknown> | undefined): string | null {
  const v = query?.patientId;
  return typeof v === 'string' && UUID_FULL.test(v) ? v : null;
}
