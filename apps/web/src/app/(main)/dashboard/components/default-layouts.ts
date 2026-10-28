export interface WidgetLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
}

export type Layouts = { [P: string]: WidgetLayout[] };

export interface DashboardConfig {
  version: number;
  layouts: Layouts;
  hiddenWidgets: string[];
  widgetSettings: Record<string, Record<string, unknown>>;
}

// ── DOCTOR ──
const DOCTOR_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // 2026-10-02 역할별 재검토 — 줄을 채우는 순서(전폭 → 3단위 줄) · '접속 정보'(머리와 같은 이름·역할)는 뺐다(카탈로그에 남음)
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'census', x: 0, y: 1, w: 12, h: 2 },
      { i: 'schedule', x: 0, y: 3, w: 4, h: 2 },
      { i: 'my-queue', x: 4, y: 3, w: 4, h: 2 },
      { i: 'draft-charts', x: 8, y: 3, w: 4, h: 2 },
      { i: 'consult-inbox', x: 0, y: 5, w: 4, h: 2 },
      { i: 'inpatients', x: 4, y: 5, w: 4, h: 2 },
      { i: 'surgery', x: 8, y: 5, w: 4, h: 2 },
      { i: 'lab-results', x: 0, y: 7, w: 12, h: 2 },
      { i: 'ews-high-risk', x: 0, y: 9, w: 4, h: 2 },
      { i: 'handoff', x: 4, y: 9, w: 4, h: 2 },
      { i: 'hospital-status', x: 8, y: 9, w: 4, h: 2 },
      { i: 'my-today', x: 0, y: 11, w: 4, h: 2 },
      { i: 'my-pay-snapshot', x: 4, y: 11, w: 4, h: 2 },
      { i: 'quick-actions', x: 8, y: 11, w: 4, h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {
    census:         { maxItems: 8, showVitals: true, showAlerts: true, sortBy: 'status' },
    'my-queue':     { showVisitType: true, autoCallNext: true },
    'draft-charts': { maxItems: 5, showReason: false },
    inpatients:     { maxItems: 5, showDiet: false, showAdmitDays: true },
    surgery:        { filterMine: true },
    'lab-results':  { maxItems: 8, departments: 'all' },
  },
};

// ── NURSE — 기존 NurseDashboard 통합 패널 + 공통 위젯 ──
const NURSE_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // 2026-10-02 — 🔴 'med-alert' 는 레지스트리에 없는 id 였다(조용히 사라지던 칸) · 접속 정보 대신 미확인 알림
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'nurse-panel', x: 0, y: 1, w: 12, h: 2 },
      { i: 'handoff', x: 0, y: 3, w: 4, h: 2 },
      { i: 'ews-high-risk', x: 4, y: 3, w: 4, h: 2 },
      { i: 'isolation-list', x: 8, y: 3, w: 4, h: 2 },
      { i: 'hospital-status', x: 0, y: 5, w: 4, h: 2 },
      { i: 'safety-alerts', x: 4, y: 5, w: 4, h: 2 },
      { i: 'quick-actions', x: 8, y: 5, w: 4, h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── NURSE (비병동: 원무·외래·검진) — 병동 패널 대신 접수/대기/예약 중심 ──
const NURSE_NONWARD_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // 2026-10-02 — 🔴 '내 대기 환자'(/queue/my = 의사 본인 대기열)는 간호사에게 늘 빈 목록 → 원무·외래가 보는 접수 대기 현황
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'reception-queue', x: 0, y: 1, w: 4, h: 2 },
      { i: 'appointments', x: 4, y: 1, w: 4, h: 2 },
      { i: 'hospital-status', x: 8, y: 1, w: 4, h: 2 },
      { i: 'safety-alerts', x: 0, y: 3, w: 4, h: 2 },
      { i: 'my-today', x: 4, y: 3, w: 4, h: 2 },
      { i: 'quick-actions', x: 8, y: 3, w: 4, h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── ADMIN — 관리자·원무 업무(2026-10-02 실화면 재정돈) ──
/**
 * 🔴 (2026-10-02) 실화면 — 카드 폭이 1/4·1/3·1/2 로 섞여 줄마다 오른쪽이 비었고(widget-size 참조),
 *    관리자에게 의미 없는 카드가 자리를 차지했다:
 *    - '내 대기 환자'(/queue/my = 의사 본인 대기열) — 관리자는 담당 환자가 없어 늘 빈 목록인데 위 띠는 "대기 환자 260"
 *    - '오늘의 나'의 "오늘 내 예약 0" · '내 급여 요약' · '접속 정보'(머리와 같은 이름·역할) — 개인 행정은 내 행정 화면 몫
 *    → 관리자의 일만 3단위씩 세 줄로 놓는다(개인 위젯은 카탈로그에서 다시 추가할 수 있다 · 저장된 배치는 덮지 않는다).
 *    줄 순서 = 병원 상태·알림·시스템 / 창구(수납·접수) / 청구 검토·직원 노출·바로가기.
 */
const ADMIN_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    lg: [
      { i: 'stat-bar',        x: 0, y: 0,  w: 12, h: 1, static: true },
      // 병원 전체 현황은 통합 상황판이 정본 — 대시보드에는 같은 응답으로 만든 요약 한 칸만
      { i: 'hospital-status', x: 0, y: 1,  w: 4,  h: 2 },
      { i: 'safety-alerts',   x: 4, y: 1,  w: 4,  h: 2 },
      { i: 'system-health',   x: 8, y: 1,  w: 4,  h: 2 },
      { i: 'cashier-queue',   x: 0, y: 3,  w: 8,  h: 3 },
      { i: 'reception-queue', x: 8, y: 3,  w: 4,  h: 3 },
      { i: 'billing-review-queue', x: 0, y: 6, w: 4, h: 2 },
      // 🔴 직원 혈액·체액 노출 사고 — 서버가 staffSafety 를 내려주는데 읽는 위젯이 없었다(2026-08-18) · 상황판에 없는 일이라 남긴다
      { i: 'staff-exposure',  x: 4, y: 6,  w: 4,  h: 2 },
      { i: 'quick-actions',   x: 8, y: 6,  w: 4,  h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── PHARMACIST — 기존 PharmacistDashboard 통합 패널 ──
const PHARMACIST_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // 2026-10-02 — 조제 단계 요약(2단위)+바로가기 / 대기열(환자·약품)+재고 부족 / 유효기간·이상반응·병원 상황
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'pharma-panel', x: 0, y: 1, w: 8, h: 2 },
      { i: 'quick-actions', x: 8, y: 1, w: 4, h: 2 },
      { i: 'pharmacy-queue', x: 0, y: 3, w: 8, h: 2 },
      { i: 'low-stock', x: 8, y: 3, w: 4, h: 2 },
      { i: 'expiring-drugs', x: 0, y: 5, w: 4, h: 2 },
      { i: 'adr-stats', x: 4, y: 5, w: 4, h: 2 },
      { i: 'hospital-status', x: 8, y: 5, w: 4, h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── LAB_TECH — 기존 LabTechDashboard 통합 패널 ──
const LAB_TECH_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // 2026-10-02 — 🔴 '검사실 통계'(오늘 집계)는 단계 요약과 같은 사실을 다른 기준으로 말했다 → 단계 요약 하나 · 대기열은 환자·검사명
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'lab-panel', x: 0, y: 1, w: 8, h: 2 },
      { i: 'quick-actions', x: 8, y: 1, w: 4, h: 2 },
      { i: 'lab-queue', x: 0, y: 3, w: 4, h: 2 },
      { i: 'imaging-queue', x: 4, y: 3, w: 4, h: 2 },
      { i: 'blood-bank', x: 8, y: 3, w: 4, h: 2 },
      { i: 'hospital-status', x: 0, y: 5, w: 4, h: 2 },
      { i: 'safety-alerts', x: 4, y: 5, w: 4, h: 2 },
      { i: 'my-today', x: 8, y: 5, w: 4, h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── EXECUTIVE — 경영 KPI 종합(공백 없이 12칸 밀집) ──
const EXECUTIVE_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // EXECUTIVE 권한=dashboard·patient·billing·encounter(audit 없음) → billing/현황/차트 위젯만 사용
    // 2026-10-02 — 🔴 '오늘 수익'·'청구 현황'·'일일 정산'·'병원 현황'은 경영진에게 서버 403 이었다(12칸 중 4칸) → 경영 정본(/executive/*) 위젯
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'executive-summary', x: 0, y: 1, w: 4, h: 2 },
      { i: 'executive-claims', x: 4, y: 1, w: 4, h: 2 },
      { i: 'finance-benchmark', x: 8, y: 1, w: 4, h: 2 },
      { i: 'patient-flow', x: 0, y: 3, w: 4, h: 2 },
      { i: 'admission-trend', x: 4, y: 3, w: 4, h: 2 },
      { i: 'bed-status', x: 8, y: 3, w: 4, h: 2 },
      { i: 'bed-by-ward', x: 0, y: 5, w: 4, h: 2 },
      { i: 'chart-beds', x: 4, y: 5, w: 4, h: 2 },
      { i: 'chart-weekly', x: 8, y: 5, w: 4, h: 2 },
      { i: 'chart-dept', x: 0, y: 7, w: 4, h: 2 },
      { i: 'safety-alerts', x: 4, y: 7, w: 4, h: 2 },
      { i: 'quick-actions', x: 8, y: 7, w: 4, h: 2 },
    ],
    md: [], sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── CRM — 예약·만족도·알림 중심 ──
const CRM_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // CRM 권한=patient·billing·dashboard(+manager audit) → 예약·현황·차트 위젯(양 CRM 역할 공통 접근)
    // 2026-10-02 — 🔴 '예약 현황'(환자 목록)·'병원 현황'(예약 통계)은 CRM 에게 서버 403 · '알림'과 '미확인 알림'이 같은 목록을 두 번 → 하나
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'safety-alerts', x: 0, y: 1, w: 4, h: 2 },
      { i: 'patient-flow', x: 4, y: 1, w: 4, h: 2 },
      { i: 'chart-weekly', x: 8, y: 1, w: 4, h: 2 },
      { i: 'quick-actions', x: 0, y: 3, w: 4, h: 2 },
      { i: 'my-today', x: 4, y: 3, w: 4, h: 2 },
      { i: 'my-pay-snapshot', x: 8, y: 3, w: 4, h: 2 },
    ],
    md: [], sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── READ(열람 전용) — 병원 현황 요약 ──
const READ_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // READ 권한=patient·dashboard → 현황·차트 위젯만(census는 DOCTOR 전용이라 제외)
    // 2026-10-02 — 🔴 '병원 현황'(예약 통계)은 열람 전용에게 서버 403 · '알림'은 미확인 알림(같은 제목 묶음)으로
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'safety-alerts', x: 0, y: 1, w: 4, h: 2 },
      { i: 'patient-flow', x: 4, y: 1, w: 4, h: 2 },
      { i: 'bed-status', x: 8, y: 1, w: 4, h: 2 },
      { i: 'admission-trend', x: 0, y: 3, w: 4, h: 2 },
      { i: 'chart-dept', x: 4, y: 3, w: 4, h: 2 },
      { i: 'quick-actions', x: 8, y: 3, w: 4, h: 2 },
    ],
    md: [], sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── ADMIN_STAFF(행정) — READ 와 같되 '병상 가동률' 없음(2026-10-03) ──
// 🔴 READ 기본을 그대로 썼는데 병상 위젯은 `patient:view` 가 필요하고 행정에겐 없다(ROLE_PERMISSIONS) —
//    운영 실탐침에서 행정 대시보드만 그 칸이 403 이었다. 권한을 넓히지 않고 기본 배치에서 뺀다(가드가 둘을 대조한다).
const ADMIN_STAFF_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    lg: [
      { i: 'stat-bar', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'safety-alerts', x: 0, y: 1, w: 4, h: 2 },
      { i: 'patient-flow', x: 4, y: 1, w: 4, h: 2 },
      { i: 'admission-trend', x: 8, y: 1, w: 4, h: 2 },
      { i: 'chart-dept', x: 0, y: 3, w: 8, h: 2 },
      { i: 'quick-actions', x: 8, y: 3, w: 4, h: 2 },
    ],
    md: [], sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── RECEPTIONIST(원무) — 2026-07-31 신설 역할. 접수·대기·수납이 업무의 전부다 ──
// 🔴 역할만 만들고 대시보드 기본값이 없으면 의사 화면(census·처방 등)으로 폴백돼
//    권한 없는 위젯이 빈 카드로 뜬다 → 업무 위젯으로 구성한다.
const RECEPTIONIST_DEFAULT: DashboardConfig = {
  version: 3,
  layouts: {
    // 🔴 (2026-10-02) '내 대기 환자'(/queue/my)는 원무에게 서버가 403 이었다 → 병원 접수 대기(reception-queue)로.
    //    '환자 흐름'(기간 추이)은 경영 화면 몫 · '접속 정보'는 머리와 같은 내용 → 뺐다. 3단위씩 세 줄.
    lg: [
      { i: 'stat-bar',         x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'reception-queue',  x: 0, y: 1, w: 4,  h: 3 },   // 접수 대기
      { i: 'cashier-queue',    x: 4, y: 1, w: 8,  h: 3 },   // 수납 대기(오늘 창구 · 이전 미수)
      { i: 'appointments',     x: 0, y: 4, w: 4,  h: 3 },   // 오늘 예약
      { i: 'revenue-today',    x: 4, y: 4, w: 4,  h: 2 },
      { i: 'daily-settlement', x: 8, y: 4, w: 4,  h: 2 },
      { i: 'notifications',    x: 0, y: 7, w: 4,  h: 2 },
      { i: 'my-today',         x: 4, y: 7, w: 4,  h: 2 },
      { i: 'quick-actions',    x: 8, y: 7, w: 4,  h: 2 },
    ],
    md: [],
    sm: [],
  },
  hiddenWidgets: [],
  widgetSettings: {},
};

// ── 기본값 로더 ──
const DEFAULT_CONFIGS: Record<string, DashboardConfig> = {
  DOCTOR:      DOCTOR_DEFAULT,
  NURSE:       NURSE_DEFAULT,
  RECEPTIONIST: RECEPTIONIST_DEFAULT,
  ADMIN:       ADMIN_DEFAULT,
  PHARMACIST:  PHARMACIST_DEFAULT,
  LAB_TECH:    LAB_TECH_DEFAULT,
  EXECUTIVE:   EXECUTIVE_DEFAULT,
  CRM_MANAGER: CRM_DEFAULT,
  CRM_STAFF:   CRM_DEFAULT,
  READ:        READ_DEFAULT,
  // 🔴 v3.96 신설 지원부서 4역할 — 빠져 있으면 아래 폴백으로 **의사 대시보드**가 뜬다
  //    (임상 위젯 나열·전부 403/공백). 임상 권한 없는 역할은 READ 기반이 정직하다.
  NUTRITION:       READ_DEFAULT,
  ADMIN_STAFF:     ADMIN_STAFF_DEFAULT,
  MEDICAL_RECORDS: READ_DEFAULT,
  CHECKUP:         READ_DEFAULT,
};

// 비병동(원무·접수·외래·검진·행정) 간호 부서 — 병동 대시보드 대신 접수/대기 중심
const NURSE_NONWARD_DEPT = /원무|접수|행정|외래|콜센터|고객|검진|보험|청구|코디|데스크/;

export const DASHBOARD_CONFIG_VERSION = 3;

export function getDefaultConfig(role?: string, department?: string): DashboardConfig {
  if (role === 'NURSE' && department && NURSE_NONWARD_DEPT.test(department)) {
    return structuredClone(NURSE_NONWARD_DEFAULT);
  }
  // 미등재 역할 폴백은 READ — 의사 화면으로 흘리면 신설 역할마다 같은 사고가 반복된다(P4·P9)
  return structuredClone(DEFAULT_CONFIGS[role ?? 'DOCTOR'] ?? READ_DEFAULT);
}
