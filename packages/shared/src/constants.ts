export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MRN_PREFIX = 'HR';
export const JWT_ACCESS_EXPIRES_IN = '15m';
export const JWT_REFRESH_EXPIRES_IN = '7d';
export const BCRYPT_SALT_ROUNDS = 12;

// ── 한글 라벨 매핑 (UI 공용) ──
/**
 * 성별 라벨 정본.
 *
 * 🔴 2026-08-12: 화면 27곳이 `gender === 'MALE' ? '남' : '여'` 이진 삼항을 쓰고 있었다.
 *    이 형태는 **값이 없을 때 반대 값으로 단정**한다 — 대기열 API 가 `gender` 를 select 에서
 *    빼자 외래 간호 화면이 20행을 전부 여성으로 표시했다. 표기는 반드시 아래 함수를 거친다.
 */
export const GENDER_LABEL: Record<string, string> = {
  MALE: '남',
  FEMALE: '여',
  OTHER: '기타',
  UNKNOWN: '미상',
};

/**
 * 성별 코드 → 한글. **모르는 값을 반대 성별로 단정하지 않는다.**
 * `OTHER`·`UNKNOWN` 은 라벨표대로 '기타'·'미상' 으로 말한다.
 */
export function genderText(gender: string | null | undefined, fallback = '-'): string {
  if (!gender) return fallback;
  return GENDER_LABEL[gender] ?? GENDER_LABEL[gender.toUpperCase()] ?? fallback;
}

/**
 * QR·팔찌 등 **데이터 인코딩**용 축약 코드. 모르면 빈 문자열(거짓 코드를 심지 않는다).
 * 🔴 화면 표시에는 쓰지 않는다 — 한글 화면에 `M`/`F` 가 노출된다(2026-08-12 실측 2곳).
 */
export function genderCode(gender: string | null | undefined): string {
  if (gender === 'MALE') return 'M';
  if (gender === 'FEMALE') return 'F';
  return '';
}

export const INSURANCE_LABEL: Record<string, string> = {
  NHI: '건강보험',
  MEDICAID: '의료급여',
  INDUSTRIAL: '산재보험',
  AUTO: '자동차보험',
  SELF_PAY: '비급여(자비)',
};


export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '예약',
  CONFIRMED: '확정',
  CHECKED_IN: '접수',
  IN_PROGRESS: '진료중',
  COMPLETED: '완료',
  CANCELLED: '취소',
  NO_SHOW: '미내원',
};

export const USER_ROLE_LABEL: Record<string, string> = {
  ADMIN: '관리자',
  DOCTOR: '의사',
  NURSE: '간호사',
  RECEPTIONIST: '원무',        // 접수·인적정보·수납(임상 권한 없음)
  PHARMACIST: '약사',
  LAB_TECH: '검사기사',
  NUTRITION: '급양',           // 급식·식단·영양(임상 권한 없음)
  ADMIN_STAFF: '행정직',        // 총무·시설·자재(임상 권한 없음)
  MEDICAL_RECORDS: '의무기록사', // 기록 발급/검색(임상 작성 권한 없음)
  CHECKUP: '검진센터',          // 건강검진센터 원무·행정(본원 임상 권한 없음)
  CRM_MANAGER: '고객관리 책임자',
  CRM_STAFF: '고객상담',
  EXECUTIVE: '경영진',
  READ: '조회 전용',
};

export const ENCOUNTER_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성중',
  IN_PROGRESS: '진료중',
  COMPLETED: '완료',
  SIGNED: '서명',
  AMENDED: '수정',
};

export const BILLING_STATUS_LABEL: Record<string, string> = {
  PENDING: '미수납',
  PAID: '수납완료',
  PARTIAL: '부분수납',
  REFUNDED: '환불',
  CANCELLED: '취소',
  DEFERRED: '후납',
  INSTALLMENT: '분할납',
};

/**
 * 🔴 (2026-10-19 포털 세련화 A2) 같은 수납 상태를 **환자가 읽는 말**로 — 직원 정본(`BILLING_STATUS_LABEL`)은 병원 입장('수납')이고
 *    환자는 자기가 내는 쪽('납부')이다. 상태 집합은 직원 정본과 **같아야** 한다(shared 시험이 키 집합을 대조).
 *    포털은 종전에 자기 표를 따로 들고 후납·분할납·환불을 몰라 영문 코드를 그대로 보였다.
 */
export const BILLING_STATUS_PATIENT_LABEL: Record<string, string> = {
  PENDING: '미납',
  PAID: '납부완료',
  PARTIAL: '일부납부',
  REFUNDED: '환불',
  CANCELLED: '취소',
  DEFERRED: '후불 납부',
  INSTALLMENT: '분할 납부',
};

// ── 도메인 상태 라벨 정본(UX 일관성 검토 2026-07) ────────────────────────────
// 동일 enum이 페이지마다 다른 라벨(예: ORDERED=대기/접수/접수대기)로 표기되던 것을 정본화.
// 신규 화면은 로컬 Record 재정의 대신 이 정본 + web StatusBadge(domain)를 사용할 것.

/** 오더(Order.status) — CPOE·약국·검사·영상 공통 */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  ORDERED: '의뢰',
  RECEIVED: '접수',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  CANCELLED: '취소',
  ISSUED: '불출',
  ON_HOLD: '보류',
};

/** 처방(Prescription.status) */
export const PRESCRIPTION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '활성',
  // 중단 — 그 시각 이후 멈춤(이미 조제·투약된 사실은 유효) · 취소(무효)와 다르다(2026-09-30)
  DISCONTINUED: '중단',
  COMPLETED: '완료',
  CANCELLED: '취소',
  ON_HOLD: '보류',
};

/** 검사결과(LabResult.status) */
export const LAB_RESULT_STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  COLLECTED: '채취',
  IN_PROGRESS: '진행중',
  COMPLETED: '입력완료',
  VERIFIED: '확정',
};

/** 수혈 오더(TransfusionOrder.status) */
export const TRANSFUSION_ORDER_STATUS_LABEL: Record<string, string> = {
  ORDERED: '의뢰',
  CROSSMATCHING: '교차중',
  READY: '준비',
  ISSUED: '출고',
  IN_PROGRESS: '수혈중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

/** 입원(Admission.status) */
export const ADMISSION_STATUS_LABEL: Record<string, string> = {
  ADMITTED: '재원',
  DISCHARGED: '퇴원',
  TRANSFERRED: '전원',
};

/** 클레임(Claim.status) — 실 enum(ClaimStatus) 기준 */
export const CLAIM_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성중',
  SUBMITTED: '제출',
  UNDER_REVIEW: '심사중',
  APPROVED: '인정',
  PARTIALLY_APPROVED: '부분인정',
  REJECTED: '반려',
  PAID: '지급완료',
};

/** 오더 수행부서(약국/검사/영상 큐) 관점 — 의뢰자 관점(ORDER_STATUS_LABEL)과 시점 언어가 다름(ORDERED=아직 접수 전) */
export const ORDER_DEPT_STATUS_LABEL: Record<string, string> = {
  ORDERED: '접수대기',
  RECEIVED: '접수',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  CANCELLED: '취소',
  ON_HOLD: '보류',
};

/** 약국 조제 워크플로(Order.status 확장 + DispensingStatus)
 *  🔴 PENDING = DispensingStatus 의 '조제 시작~완료 전'(오더 IN_PROGRESS 대응).
 *  이 키가 빠져 있으면 StatusBadge 가 DEFAULT_CONFIG.PENDING('미납' — 수납 용어)으로 폴백한다. */
export const PHARMACY_ORDER_STATUS_LABEL: Record<string, string> = {
  ORDERED: '접수대기',
  RECEIVED: '수령',
  PENDING: '조제중',
  IN_PROGRESS: '조제중',
  DISPENSED: '조제완료',
  VERIFIED: '불출대기',
  ISSUED: '불출완료',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

/** 응급 방문(EmergencyVisit.status — 모델 코멘트 실측 8상태) */
export const EMERGENCY_VISIT_STATUS_LABEL: Record<string, string> = {
  PENDING_TRIAGE: '분류대기',
  TRIAGED: '분류완료',
  PENDING_DOCTOR: '진료대기',
  IN_TREATMENT: '치료중',
  PENDING_RESULT: '결과대기',
  UNDER_OBSERVATION: '관찰중',
  PENDING_DISPOSITION: '처치결정대기',
  COMPLETED: '진료종료',
};

/** KTAS 라벨 정본(ER 베드 보드 D7·2026-08-05) — 색(tone)은 웹 `lib/ktas.ts` 단일 모듈(Tailwind 스캔 범위) */
export const KTAS_LEVEL_LABEL: Record<string, string> = {
  LEVEL_1: '1 소생',
  LEVEL_2: '2 긴급',
  LEVEL_3: '3 응급',
  LEVEL_4: '4 준응급',
  LEVEL_5: '5 비응급',
};

/** 일정/계획 공통(전문과 오늘 일정·치료계획 등 — PLANNED 4상태 표시 규약) */
export const PLAN_STATUS_LABEL: Record<string, string> = {
  PLANNED: '예정',
  IN_PROGRESS: '진행',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

/** 문서/증명서 발급(DocumentRequest.status — 의무기록·진단서 워크스테이션 공통) */
/**
 * 🔴 **전 직군** 역할 목록 — "모든 직원이 쓰는 EP"의 `@Roles` 에 이것을 쓴다.
 *
 * 2026-08-21 실측: 전역 컴포넌트(위급검사값 배너·알림)가 전 직군 화면에 렌더되는데 EP 는 임상 역할만
 * 열려 있어 **14역할 중 9역할이 상시 403** 을 봤다. 컨트롤러마다 역할을 손으로 나열하면
 * 신설 직군이 생길 때 그 목록만 안 따라가 같은 일이 반복된다 — **정본을 하나로 둔다.**
 *
 * 🔴 이 목록은 `USER_ROLE_LABEL` 의 키와 **집합이 같아야 한다**(가드가 대조한다).
 */
export const EVERY_STAFF_ROLE = [
  'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH', 'ADMIN',
  'NUTRITION', 'RECEPTIONIST', 'ADMIN_STAFF', 'MEDICAL_RECORDS',
  'CHECKUP', 'CRM_MANAGER', 'CRM_STAFF', 'EXECUTIVE', 'READ',
] as const;

export const DOC_ISSUANCE_STATUS_LABEL: Record<string, string> = {
  REQUESTED: '신청',
  IN_REVIEW: '작성중',
  PROCESSING: '처리중',
  READY: '발급완료',
  DELIVERED: '교부완료',
  REJECTED: '반려',
};

/** 직원 온보딩(StaffOnboarding.status — 초대→활성화 8단계) */
export const ONBOARDING_STATUS_LABEL: Record<string, string> = {
  INVITED: '초대됨',
  VERIFIED: '본인확인',
  DOC_SUBMITTED: '서류제출',
  CONTRACT_SIGNED: '계약서명',
  APPROVED: '승인',
  BOOTED: '활성화',
  EXPIRED: '만료',
  REVOKED: '폐기',
};

/**
 * 인사 신청(휴가·초과근무 LeaveRequest/OvertimeRequest.status) — 🔴 (2026-09-14) 결재함·ESS 가 각자 로컬 표로 그리던 어휘.
 *    결재함은 `<StatusBadge domain="hrRequest">` 로 이 정본을 쓴다.
 */
export const HR_REQUEST_STATUS_LABEL: Record<string, string> = {
  REQUESTED: '결재중',
  APPROVED: '승인',
  REJECTED: '반려',
  WITHDRAWN: '철회',
};

/** CRM 캠페인(Campaign.status) */
export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: '초안',
  SCHEDULED: '예약',
  SENDING: '발송중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

/** 국제환자 케이스(InternationalCase.status — 문의→종결 8단계) */
export const INTL_CASE_STATUS_LABEL: Record<string, string> = {
  INQUIRY: '문의',
  QUOTED: '견적',
  CONFIRMED: '확정',
  ARRIVED: '입국',
  IN_TREATMENT: '진료중',
  DISCHARGED: '퇴원',
  FOLLOW_UP: '사후관리',
  CLOSED: '종료',
};

/** 진료 대기열(WaitingQueue.status — 접수→진료→수납/약국 흐름) */
export const WAITING_QUEUE_STATUS_LABEL: Record<string, string> = {
  WAITING: '대기',
  CALLED: '호출',
  IN_CONSULTATION: '진료중',
  CASHIER_WAITING: '수납대기',
  PHARMACY_WAITING: '약국대기',
  COMPLETED: '완료',
  CANCELLED: '취소',
  NO_SHOW: '미방문',
};

/**
 * 마약류 취급 원장(ControlledSubstanceLog.status) — 화면 실사용 점검 W8(2026-08-14).
 * 🔴 마약류관리법상 법정 원장의 상태 어휘다. 화면별 로컬 Record 로 재정의하면
 *    "폐기"가 다른 화면에서 "반납"으로 읽히는 일이 생긴다 — 정본은 여기 하나.
 */
export const CONTROLLED_SUBSTANCE_STATUS_LABEL: Record<string, string> = {
  PRESCRIBED: '처방',
  VERIFIED: '2차확인',
  DISPENSED: '불출',
  ADMINISTERED: '투약',
  WASTED: '폐기',
  RETURNED: '반납',
};

/**
 * 투약 기록(MAR) 상태 — Prisma `MedAdminStatus` 그대로(2026-09-30 정본화).
 * 🔴 간호 스테이션이 로컬 표로 그리며 **거부(REFUSED)를 '예정'으로** 말했다(기본값 폴백) — 간호사가 이미
 *    판단을 남긴 투약을 아직 할 일처럼 보였다. 라벨표는 여기 하나(`<StatusBadge domain="medAdmin">`).
 */
export const MED_ADMIN_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '예정',
  ADMINISTERED: '완료',
  HELD: '보류',
  REFUSED: '거부',
  MISSED: '미투약',
};

/**
 * NIMS(식약처 마약류통합관리시스템) 보고 전송 상태 — W8.
 * 🔴 **전송하지 않은 것을 '제출 완료'라 말하지 않기 위한** 어휘다.
 *    종전에는 파일 생성만으로 `SUBMITTED` 를 확정했고, 화면은 "식약처 제출"이라 말했다.
 *    실제 도달의 근거는 담당자가 NIMS 웹에 올리고 받은 접수번호(`MANUAL_ACK`)뿐이다.
 */
export const NIMS_TRANSMISSION_STATUS_LABEL: Record<string, string> = {
  QUEUED: '제출대기',
  LOCAL_ONLY: '원내 기록(미전송)',
  SEND_FAILED: '전송 실패',
  UNVERIFIED: '전송 근거 없음',
  MANUAL_ACK: '수기 접수(NIMS 웹)',
  TRANSMITTED: '전송 완료',
};

/** 동의서(ConsentStatus enum — 세부 서명단계는 화면별 config 오버라이드) */
export const CONSENT_STATUS_LABEL: Record<string, string> = {
  PENDING: '서명대기',
  SIGNED: '서명완료',
  EXPIRED: '만료',
  REVOKED: '철회',
};

/**
 * 의료장비 상태(EquipmentStatus enum) — 🔴 2026-08-14(W6) 정정.
 *
 * DB enum 은 `ACTIVE · UNDER_MAINTENANCE · BROKEN · RETIRED` 인데 화면 라벨표는
 * `ACTIVE · MAINTENANCE · INACTIVE · RETIRED` 라는 **다른 어휘**를 쓰고 있었다.
 * 겹치는 건 ACTIVE/RETIRED 뿐이라, 정비중이거나 **고장난 장비는 'UNDER_MAINTENANCE'
 * 'BROKEN' 이라는 영문 원문**으로, 색도 없이 회색 배지로 떴다. 고장난 제세동기가
 * 화면에서 눈에 띄지 않는다.
 */
export const EQUIPMENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '가동중',
  UNDER_MAINTENANCE: '정비중',
  BROKEN: '고장',
  RETIRED: '폐기',
};

// ── 알림 severity 정본(2026-07-24) — 발신처 난립(ERROR/WARN/URGENT/MILD 등 9종) 정규화 ──
// 표준 3단계로 수렴. FE 색상·정렬·필터 일관성 + ERROR가 info로 오표시되던 버그 봉합.
export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  INFO: '정보', WARNING: '주의', CRITICAL: '위급',
};

/** 비표준 severity → 표준 3단계. 미상은 INFO(안전 기본). */
export function normalizeNotificationSeverity(raw?: string | null): NotificationSeverity {
  switch ((raw ?? '').toUpperCase()) {
    case 'CRITICAL': case 'ERROR': case 'CONTRAINDICATED': case 'FATAL':
      return 'CRITICAL';
    case 'WARNING': case 'WARN': case 'URGENT': case 'HIGH': case 'MODERATE': case 'OVERRIDE':
      return 'WARNING';
    case 'INFO': case 'LOW': case 'MILD': case 'NORMAL':
    default:
      return 'INFO';
  }
}

// ── 알림 type→카테고리 정본(2026-07-24) — 종전 store/페이지 2곳 중복·VoC/consult 미분류 → 단일 소스 ──
export const NOTIFICATION_CATEGORIES = [
  'clinical', 'approval', 'lab', 'billing', 'pharmacy', 'appointment', 'order', 'consult', 'system',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * 알림 type 문자열 → 표시 카테고리(정본). 우선순위: 임상위급 > 결재 > 상담/VoC > 도메인.
 * 미상은 system. FE 아이콘·필터의 단일 소스(store.mapNotifType·notifications 페이지 공통).
 */
export function notificationCategory(type?: string | null): NotificationCategory {
  const u = (type ?? '').toUpperCase();
  if (/CRITICAL_VALUE|SUICIDE|FALL_RISK|EWS|GOLDEN|FETAL|PREECLAMPSIA|NEWBORN|RESTRAINT|DIAGNOSTIC_CRITICAL|VITAL|REASSESSMENT|SEVERE_PAIN|SAFETY_INCIDENT|SEPSIS|CODE_/.test(u)) return 'clinical';
  if (/APPROVAL|PRE_AUTH|CONSENT|REFERRAL|STEPUP|CLAIM|SIGN/.test(u)) return 'approval';
  if (/VOC|CONSULT/.test(u)) return 'consult';
  if (u.includes('LAB') || u.includes('CRITICAL')) return 'lab';
  if (u.includes('BILLING') || u.includes('PAYMENT') || u.includes('UNPAID')) return 'billing';
  if (u.includes('PHARM') || u.includes('DISPENS')) return 'pharmacy';
  if (u.includes('APPOINT')) return 'appointment';
  if (u.includes('ORDER') || u.includes('IMAGING')) return 'order';
  return 'system';
}

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  clinical: '임상 위급', approval: '결재/승인', lab: '검사', billing: '수납', pharmacy: '약국',
  appointment: '예약', order: '오더', consult: '상담/VoC', system: '시스템',
};

/**
 * 화면에 표시하는 HIS 버전 — **표시 정본**.
 * 🔴 종전엔 로그인 화면(v3.45.0)·사이드바(v3.10.0)에 각각 하드코딩돼 있어 릴리즈를 거듭해도
 *    아무도 갱신하지 않았다(2026-08-11 실측: 실제 v3.97.0). 표시처가 늘면 여기만 바꾼다.
 *    릴리즈 시 이 값을 올리는 것이 규약(가드 테스트가 하드코딩 재발을 막는다).
 */
/**
 * 🔴 화면·API 가 함께 쓰는 **버전 정본**. 로그인 화면·사이드바·대시보드·`GET /health` 가 이것을 읽는다.
 *
 * 2026-08-26 — v3.98.0 에 **9 릴리즈 동안 멈춰 있었다.** 화면이 배포본과 다른 버전을 말했고
 *    `/health` 도 같은 값을 내보내 외부에서 버전을 오판할 수 있었다.
 *    가드(`his-version-freshness.spec.ts`)가 최신 릴리즈 문서와 대조한다 — 릴리즈를 내면 여기도 올린다.
 */
export const HIS_VERSION = 'v4.130.0';
