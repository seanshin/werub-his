import { lazy } from 'react';
import { canAccessWidget } from '@/lib/permissions';

export type WidgetCategory = 'patient' | 'clinical' | 'orders' | 'admin' | 'chart' | 'system' | 'emergency' | 'bed' | 'quality';

export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  patient: '진료 현황',
  clinical: '임상',
  emergency: '수술/응급',
  orders: '검사/약국',
  admin: '경영/수납',
  bed: '병동/병상',
  quality: '품질/안전',
  chart: '통계 차트',
  system: '시스템',
};

export interface WidgetDef {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  category: WidgetCategory;
  roles: string[]; // 빈 배열 = ALL
  requiredPermissions: string[]; // API가 요구하는 Permission
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  defaultW: number;
  defaultH: number;
  /**
   * 무엇의 범위인가(2026-10-02 · 상황판↔대시보드 역할 분리) — 생략 = MINE(나·내 담당·내 과의 일).
   *  - HOSPITAL = 병원 전체 현황 → 정본은 통합 상황판(대시보드 기본 배치에 넣지 않는다 · 저장된 배치에 남은 것은 표식+링크)
   *  - ANALYTICS = 기간 추이·경영 → 정본은 경영 화면(/executive)
   */
  scope?: WidgetScope;
}

export type WidgetScope = 'MINE' | 'HOSPITAL' | 'ANALYTICS';

/** 병원 전체 현황 위젯 — 통합 상황판이 같은 사실을 그린다 */
const HOSPITAL_SCOPE = new Set([
  'hospital-pulse', 'admin-panel', 'er-status', 'icu-dashboard', 'icu-alerts', 'bed-status', 'bed-by-ward',
  'infection-dashboard', 'safety-incidents', 'qi-dashboard', 'ipsg-summary', 'satisfaction',
]);
/** 기간 추이·경영 위젯 */
const ANALYTICS_SCOPE = new Set([
  'charts', 'chart-hourly', 'chart-weekly', 'chart-dept', 'chart-beds', 'chart-top-dx', 'chart-infection',
  'admission-trend', 'patient-flow', 'finance-benchmark',
]);

// 기존 컴포넌트를 위젯으로 래핑 (lazy import)
const WIDGETS: WidgetDef[] = [
  // ── 공통 (dashboard:view) ──
  { id: 'stat-bar',      name: '요약 통계',         category: 'system',   roles: [],   requiredPermissions: ['dashboard:view'], component: lazy(() => import('./widgets/StatBarWidget')),        defaultW: 12, defaultH: 1 },
  // 2026-10-02 — 병원 전체는 상황판이 정본. 대시보드에는 같은 응답으로 만든 요약 한 칸만 둔다(역할은 상황판 API @Roles 와 같다)
  { id: 'hospital-status', name: '병원 상황 요약',   description: '통합 상황판과 같은 기준의 위험·주의 요약', icon: '📡', category: 'system', roles: ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH'], requiredPermissions: [], component: lazy(() => import('./widgets/HospitalStatusWidget')), defaultW: 6, defaultH: 2 },
  { id: 'quick-actions', name: '바로가기',           category: 'system',   roles: [],   requiredPermissions: [],                 component: lazy(() => import('./QuickActions')),                defaultW: 8, defaultH: 1 },
  { id: 'session-info',  name: '접속 정보',          category: 'system',   roles: [],   requiredPermissions: [],                 component: lazy(() => import('./SessionInfo')),                 defaultW: 4, defaultH: 2 },
  { id: 'charts',        name: '통계 차트',          category: 'chart',    roles: [],   requiredPermissions: ['dashboard:view'], component: lazy(() => import('./DashboardCharts')),             defaultW: 12, defaultH: 4 },
  { id: 'my-today',      name: '오늘의 나',          category: 'system',   roles: [],   requiredPermissions: [],                 component: lazy(() => import('./widgets/MyTodayWidget')),        defaultW: 4, defaultH: 2 },
  { id: 'my-pay-snapshot', name: '내 급여 요약',      category: 'system',   roles: [],   requiredPermissions: [],                 component: lazy(() => import('./widgets/MyPaySnapshotWidget')),  defaultW: 4, defaultH: 2 },
  // 2026-10-02 — 서버 /appointments/stats 는 ADMIN·DOCTOR·NURSE·RECEPTIONIST 만(열람 전용·CRM·경영진 기본 배치에서 403 이었다)
  { id: 'hospital-pulse', name: '병원 현황',         category: 'patient',  roles: ['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'],   requiredPermissions: ['dashboard:view'], component: lazy(() => import('./widgets/HospitalPulseWidget')),  defaultW: 6, defaultH: 2 },
  { id: 'safety-alerts', name: '미확인 알림',          category: 'quality',  roles: [],   requiredPermissions: [],                 component: lazy(() => import('./widgets/SafetyAlertsWidget')),   defaultW: 6, defaultH: 2 },

  // ── 의사 ──
  { id: 'census',        name: '담당 환자 센서스',    category: 'patient',  roles: ['DOCTOR'],                       requiredPermissions: ['patient:view'],    component: lazy(() => import('./MyCensusPanel')),          defaultW: 12, defaultH: 3 },
  { id: 'schedule',      name: '오늘 진료표',        category: 'clinical', roles: ['DOCTOR'],                       requiredPermissions: [],                  component: lazy(() => import('./widgets/ScheduleWidget')),     defaultW: 4, defaultH: 2 },
  { id: 'draft-charts',  name: '미완료 차트',        category: 'clinical', roles: ['DOCTOR'],                       requiredPermissions: ['encounter:view'],  component: lazy(() => import('./widgets/DraftChartsWidget')),  defaultW: 4, defaultH: 2 },
  { id: 'lab-results',   name: '검사결과 도착',       category: 'orders',   roles: ['DOCTOR', 'LAB_TECH'],           requiredPermissions: ['order:view'],      component: lazy(() => import('./widgets/LabResultsWidget')), defaultW: 12, defaultH: 2 },
  { id: 'consult-inbox', name: '받은 협진요청',       description: '내게/내 과에 온 미처리 협진', icon: '🤝', category: 'clinical', roles: ['DOCTOR', 'ADMIN'],              requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/ConsultInboxWidget')), defaultW: 6, defaultH: 2 },

  // ── 원무·관리자 ──
  // 2026-10-02 — 원무·관리자 기본 배치의 '내 대기 환자'(/queue/my = 의사 본인 대기열)는 원무에게 403, 관리자에게 늘 빈 목록이었다.
  //   창구가 보는 것은 병원 접수 대기다(서버 /queue/stats — 원무 역할 허용).
  { id: 'reception-queue', name: '접수 대기 현황',   description: '지금 대기·과별 대기·대기시간 산출 근거', icon: '🧾', category: 'patient', roles: ['ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR'], requiredPermissions: [], component: lazy(() => import('./widgets/ReceptionQueueWidget')), defaultW: 4, defaultH: 2 },

  // ── 공유 (다중 역할) ──
  { id: 'my-queue',      name: '내 대기 환자',       category: 'patient',  roles: ['DOCTOR', 'ADMIN', 'NURSE'],     requiredPermissions: ['patient:view'],    component: lazy(() => import('./MyWaitingQueueWidget')), defaultW: 4, defaultH: 2 },
  { id: 'inpatients',    name: '담당 입원환자',       category: 'patient',  roles: ['DOCTOR', 'NURSE', 'ADMIN'],     requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/InpatientsWidget')), defaultW: 6, defaultH: 2 },
  // 🔴 (2026-10-03 실탐침) 간호사는 편집 목록에서 넣으면 늘 403 — 서버가 병원 전체 수술 일정을 간호사에게 막는다(환자 지정 조회만)
  { id: 'surgery',       name: '오늘 수술 일정',      category: 'clinical', roles: ['DOCTOR', 'ADMIN'],     requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/SurgeryWidget')), defaultW: 6, defaultH: 2 },
  { id: 'handoff',       name: '인수인계',           category: 'clinical', roles: ['DOCTOR', 'NURSE'],              requiredPermissions: ['patient:view'],    component: lazy(() => import('./PendingHandoffBanner')), defaultW: 6, defaultH: 2 },

  // ── 역할별 통합 대시보드 (기존 컴포넌트 그대로 활용) ──
  { id: 'nurse-panel',   name: '간호사 대시보드',     category: 'clinical', roles: ['NURSE'],                        requiredPermissions: ['patient:view'],    component: lazy(() => import('./NurseDashboard')),            defaultW: 12, defaultH: 6 },
  { id: 'admin-panel',   name: '관리자 대시보드',     category: 'admin',    roles: ['ADMIN'],                        requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./AdminDashboard')),            defaultW: 12, defaultH: 6 },
  { id: 'pharma-panel',  name: '조제 단계 요약',       category: 'orders',   roles: ['PHARMACIST'],                   requiredPermissions: ['order:view'],      component: lazy(() => import('./PharmacistDashboard')),   defaultW: 12, defaultH: 4 },
  { id: 'lab-panel',     name: '검사·영상 단계 요약',     category: 'orders',   roles: ['LAB_TECH'],                     requiredPermissions: ['order:view'],      component: lazy(() => import('./LabTechDashboard')),        defaultW: 12, defaultH: 4 },

  // ════════════════════════════════════════════════════════
  // 확장 위젯 (v2.7.0) — 범용 API 위젯 42종
  // ════════════════════════════════════════════════════════

  // ── 진료 현황 (추가) ──
  // 2026-10-02 — CRM 역할은 서버(/appointments 목록)가 403 이었다(환자 목록이라 열지 않는다) · 원무는 서버가 허용
  { id: 'appointments',     name: '예약 현황',        description: '오늘 예약 목록',            icon: '📅', category: 'patient',    roles: ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST'], requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/AppointmentsWidget')),   defaultW: 6, defaultH: 2 },

  // ── 수술/응급 ──
  { id: 'er-status',        name: '응급실 현황',       description: 'KTAS별 환자 수 + 대기열',    icon: '🚨', category: 'emergency',  roles: ['DOCTOR', 'NURSE', 'ADMIN'],   requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/ErStatusWidget')),       defaultW: 4, defaultH: 2 },
  { id: 'er-queue',         name: '응급 대기열',       description: '응급실 대기 환자 목록',       icon: '🚨', category: 'emergency',  roles: ['DOCTOR', 'NURSE', 'ADMIN'],   requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/ErQueueWidget')),        defaultW: 6, defaultH: 2 },
  { id: 'icu-dashboard',    name: 'ICU 현황',         description: '점유율/인공호흡기/중증도',    icon: '🏥', category: 'emergency',  roles: ['DOCTOR', 'NURSE', 'ADMIN'],   requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/IcuDashboardWidget')),   defaultW: 4, defaultH: 2 },
  { id: 'icu-alerts',       name: 'ICU NEWS2 경고',   description: '고위험 조기경보 환자',        icon: '⚠️', category: 'emergency',  roles: ['DOCTOR', 'NURSE', 'ADMIN'],   requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/IcuAlertsWidget')),      defaultW: 6, defaultH: 1 },

  // ── 검사/영상 ──
  { id: 'lab-queue',        name: '검사 대기열',       description: '검사 접수 대기 목록',         icon: '🔬', category: 'orders',     roles: ['DOCTOR', 'NURSE', 'ADMIN', 'LAB_TECH'], requiredPermissions: ['order:view'], component: lazy(() => import('./widgets/ext/LabQueueWidget')),    defaultW: 6, defaultH: 2 },
  // 🔴 (2026-10-03 실탐침) 간호사 늘 403 — 영상 대기열 서버 @Roles 는 관리자·검사실·의사(간호 영상 조회는 환자 차트 경로)
  { id: 'imaging-queue',    name: '영상 대기열',       description: '영상 촬영 대기 목록',         icon: '📷', category: 'orders',     roles: ['DOCTOR', 'ADMIN', 'LAB_TECH'], requiredPermissions: ['order:view'], component: lazy(() => import('./widgets/ext/ImagingQueueWidget')), defaultW: 6, defaultH: 2 },
  { id: 'lab-stats',        name: '검사실 통계',       description: '검사 상태별 건수',            icon: '📊', category: 'orders',     roles: [],                                        requiredPermissions: ['dashboard:view'], component: lazy(() => import('./widgets/ext/LabStatsWidget')),    defaultW: 4, defaultH: 2 },

  // ── 약국/재고 ──
  { id: 'pharmacy-queue',   name: '조제 대기열',       description: '처방 조제 대기 목록',         icon: '💊', category: 'orders',     roles: ['PHARMACIST', 'ADMIN'],                   requiredPermissions: ['order:view'],      component: lazy(() => import('./widgets/ext/PharmacyQueueWidget')), defaultW: 8, defaultH: 2 },
  { id: 'low-stock',        name: '재고 부족',         description: '안전재고 미달 약품',          icon: '📦', category: 'orders',     roles: ['PHARMACIST', 'ADMIN'],                   requiredPermissions: ['order:view'],      component: lazy(() => import('./widgets/ext/LowStockWidget')),      defaultW: 4, defaultH: 2 },
  { id: 'expiring-drugs',   name: '만료 임박 약품',    description: '유효기간 임박 약품',          icon: '⏰', category: 'orders',     roles: ['PHARMACIST', 'ADMIN'],                   requiredPermissions: ['order:view'],      component: lazy(() => import('./widgets/ext/ExpiringDrugsWidget')), defaultW: 4, defaultH: 2 },
  { id: 'blood-bank',       name: '혈액은행 현황',     description: '혈액형별 재고 매트릭스',      icon: '🩸', category: 'orders',     roles: ['DOCTOR', 'NURSE', 'ADMIN', 'LAB_TECH'],  requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/BloodBankWidget')),     defaultW: 6, defaultH: 2 },
  { id: 'adr-stats',        name: '약물 이상반응',     description: 'ADR 보고 통계',               icon: '⚠️', category: 'orders',     roles: ['PHARMACIST', 'ADMIN'],                   requiredPermissions: ['order:view'],      component: lazy(() => import('./widgets/ext/AdrStatsWidget')),      defaultW: 4, defaultH: 2 },

  // ── 경영/수납 ──
  // 2026-10-02 — 서버 cashier-stats 는 NURSE·ADMIN·RECEPTIONIST 만(경영진·CRM 은 403 이었다 → 경영진은 '경영 요약')
  { id: 'revenue-today',    name: '오늘 수익',        description: '금일 수납/청구 요약',        icon: '💰', category: 'admin',      roles: ['NURSE', 'ADMIN', 'RECEPTIONIST'], requiredPermissions: ['billing:view'],    component: lazy(() => import('./widgets/ext/RevenueTodayWidget')),   defaultW: 4, defaultH: 2 },
  // 2026-10-02 — 서버 /claims 는 ADMIN 전용(경영진·CRM 은 403 이었다 → 경영진은 '이번 달 청구')
  { id: 'claims',           name: '청구 현황',        description: '보험 청구 상태별 건수',      icon: '🧾', category: 'admin',      roles: ['ADMIN'],         requiredPermissions: ['billing:view'],    component: lazy(() => import('./widgets/ext/ClaimsWidget')),         defaultW: 4, defaultH: 2 },
  { id: 'cashier-queue',    name: '수납 대기열',       description: '수납 대기 환자 — 오늘 창구·이전 미수(환자·진료과·본인부담·경과)', icon: '🏧', category: 'admin',      roles: ['NURSE', 'ADMIN', 'RECEPTIONIST'],                        requiredPermissions: ['billing:view'],    component: lazy(() => import('./widgets/ext/CashierQueueWidget')),   defaultW: 6, defaultH: 2 },
  { id: 'billing-review-queue', name: '청구 검토 대기', description: '응급청구 실패·정정 검토(최근 7일)', icon: '🧾', category: 'admin',  roles: ['ADMIN'],                                 requiredPermissions: ['billing:view'],    component: lazy(() => import('./widgets/ext/BillingReviewQueueWidget')), defaultW: 6, defaultH: 2 },
  { id: 'finance-benchmark', name: '경영성과 벤치마크', description: '공시 손익 동급 비교(중앙값) — 의료이익률·비용 편차', icon: '📊', category: 'admin', roles: ['ADMIN', 'EXECUTIVE'], requiredPermissions: ['billing:view'], component: lazy(() => import('./widgets/ext/FinanceBenchmarkWidget')), defaultW: 4, defaultH: 2 },
  { id: 'daily-settlement', name: '일일 정산',        description: '금일 정산 요약',            icon: '🏦', category: 'admin',      roles: ['NURSE', 'ADMIN', 'RECEPTIONIST'], requiredPermissions: ['billing:view'],    component: lazy(() => import('./widgets/ext/DailySettlementWidget')),defaultW: 4, defaultH: 1 },

  // 2026-10-02 — 경영진은 수납·청구 EP 권한 밖이다. 경영 정본(/executive/*)과 같은 응답을 읽는다
  { id: 'executive-summary', name: '경영 요약',     description: '오늘 청구·수납·미수납·외래·병상 가동률(경영 화면과 같은 응답)', icon: '📊', category: 'admin', roles: ['EXECUTIVE', 'ADMIN'], requiredPermissions: [], component: lazy(() => import('./widgets/ext/ExecutiveSummaryWidget')), defaultW: 4, defaultH: 2 },
  { id: 'executive-claims',  name: '이번 달 청구',  description: '청구 단계별 건수·청구 금액·삭감률(경영 화면과 같은 응답)', icon: '🧾', category: 'admin', roles: ['EXECUTIVE', 'ADMIN'], requiredPermissions: [], component: lazy(() => import('./widgets/ext/ExecutiveClaimsWidget')), defaultW: 4, defaultH: 2 },

  // ── 병동/병상 ──
  { id: 'bed-status',       name: '병상 가동률',       description: '총/사용/가용 + 가동률',       icon: '🛏️', category: 'bed',        roles: [],                                        requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/BedStatusWidget')),      defaultW: 4, defaultH: 2 },
  { id: 'bed-by-ward',      name: '병동별 현황',       description: '병동별 점유율 비교',          icon: '🏢', category: 'bed',        roles: [],                                        requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/BedByWardWidget')),      defaultW: 6, defaultH: 2 },
  { id: 'admission-trend',  name: '입퇴원 추이',       description: '일별 입원/퇴원 추이',         icon: '📈', category: 'bed',        roles: [],                                        requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./widgets/ext/AdmissionTrendWidget')), defaultW: 6, defaultH: 2 },
  { id: 'patient-flow',     name: '환자 흐름',         description: '입원 vs 퇴원 비교',           icon: '🔄', category: 'bed',        roles: [],                                        requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./widgets/ext/PatientFlowWidget')),    defaultW: 4, defaultH: 2 },

  // ── 품질/안전 ──
  { id: 'infection-dashboard', name: '감염감시 현황',  description: '감염 감시 종합 현황판',       icon: '🦠', category: 'quality',    roles: [],                                        requiredPermissions: ['audit:view'],      component: lazy(() => import('./widgets/ext/InfectionWidget')),      defaultW: 6, defaultH: 2 },
  { id: 'staff-exposure',   name: '직원 노출 사고',    description: '혈액·체액 노출 접수·추적관찰 현황',  icon: '🩹', category: 'quality',    roles: [],                                        requiredPermissions: ['audit:view'],      component: lazy(() => import('./widgets/ext/StaffExposureWidget')),  defaultW: 4, defaultH: 2 },
  { id: 'isolation-list',   name: '격리 환자',         description: '현재 격리 환자 목록',         icon: '🔒', category: 'quality',    roles: [],                                        requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/IsolationWidget')),      defaultW: 4, defaultH: 2 },
  { id: 'safety-incidents', name: '안전 사건',         description: '안전사건 유형별 통계',        icon: '🛡️', category: 'quality',    roles: ['DOCTOR', 'NURSE', 'ADMIN'],              requiredPermissions: ['audit:view'],      component: lazy(() => import('./widgets/ext/SafetyIncidentsWidget')),defaultW: 4, defaultH: 2 },
  { id: 'ews-high-risk',    name: '고위험 환자',       description: 'NEWS2 고위험 환자 목록',      icon: '🔴', category: 'quality',    roles: ['DOCTOR', 'NURSE', 'ADMIN'],              requiredPermissions: ['patient:view'],    component: lazy(() => import('./widgets/ext/EwsHighRiskWidget')),    defaultW: 6, defaultH: 1 },
  { id: 'qi-dashboard',     name: 'QI 지표',          description: '품질 지표 최신 값 + 추이',    icon: '✅', category: 'quality',    roles: ['DOCTOR', 'NURSE', 'ADMIN'],              requiredPermissions: ['audit:view'],      component: lazy(() => import('./widgets/ext/QiDashboardWidget')),    defaultW: 6, defaultH: 2 },
  { id: 'ipsg-summary',     name: 'IPSG 환자안전 요약', description: '위기값·감염·손위생·낙상 통합', icon: '🛡️', category: 'quality',    roles: ['DOCTOR', 'NURSE', 'ADMIN'],              requiredPermissions: ['audit:view'],      component: lazy(() => import('./widgets/ext/IpsgSummaryWidget')),    defaultW: 6, defaultH: 2 },
  { id: 'satisfaction',     name: '환자 만족도',       description: '부서별 NPS + 트렌드',         icon: '😊', category: 'quality',    roles: ['DOCTOR', 'NURSE', 'ADMIN'],              requiredPermissions: ['audit:view'],      component: lazy(() => import('./widgets/ext/SatisfactionWidget')),   defaultW: 6, defaultH: 2 },

  // ── 통계 차트 (추가) ──
  { id: 'chart-hourly',     name: '시간대별 접수',     description: '시간대별 접수 환자 바 차트',   icon: '📊', category: 'chart',      roles: [],                                        requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./widgets/ext/ChartHourlyWidget')),    defaultW: 6, defaultH: 2 },
  { id: 'chart-weekly',     name: '7일 진료 추이',     description: '일별 진료 건수 라인 차트',     icon: '📈', category: 'chart',      roles: [],                                        requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./widgets/ext/ChartWeeklyWidget')),    defaultW: 6, defaultH: 2 },
  { id: 'chart-dept',       name: '부서별 환자 분포',  description: '부서별 환자 비율',             icon: '🍩', category: 'chart',      roles: [],                                        requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./widgets/ext/ChartDeptWidget')),      defaultW: 6, defaultH: 2 },
  { id: 'chart-beds',       name: '병상 가동률 추이',  description: '7일 가동률 라인 차트',         icon: '📉', category: 'chart',      roles: [],                                        requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./widgets/ext/ChartBedsWidget')),      defaultW: 6, defaultH: 2 },
  { id: 'chart-top-dx',     name: '상위 진단',         description: '빈도 Top 10 진단 코드',       icon: '🏆', category: 'chart',      roles: ['ADMIN'],                                 requiredPermissions: ['dashboard:view'],  component: lazy(() => import('./widgets/ext/ChartTopDxWidget')),     defaultW: 6, defaultH: 2 },
  { id: 'chart-infection',  name: '감염 추이',         description: '감염 발생 추이 차트',          icon: '🦠', category: 'chart',      roles: [],                                        requiredPermissions: ['audit:view'],      component: lazy(() => import('./widgets/ext/ChartInfectionWidget')), defaultW: 6, defaultH: 2 },

  // ── 시스템 (추가) ──
  { id: 'notifications',    name: '알림',             description: '최근 알림 목록',               icon: '🔔', category: 'system',     roles: [],                                        requiredPermissions: [],                  component: lazy(() => import('./widgets/ext/NotificationsWidget')),  defaultW: 4, defaultH: 2 },
  { id: 'system-health',    name: '시스템 상태',       description: 'API/DB/Redis 상태',            icon: '💚', category: 'system',     roles: ['ADMIN'],                                 requiredPermissions: ['system:manage'],   component: lazy(() => import('./widgets/ext/SystemHealthWidget')),   defaultW: 4, defaultH: 1 },
];

export const WIDGET_REGISTRY: Record<string, WidgetDef> = {};
WIDGETS.forEach((w) => {
  w.scope = HOSPITAL_SCOPE.has(w.id) ? 'HOSPITAL' : ANALYTICS_SCOPE.has(w.id) ? 'ANALYTICS' : 'MINE';
  WIDGET_REGISTRY[w.id] = w;
});

export const WIDGET_LIST = WIDGETS;

/** 역할 + 권한 이중 검증으로 사용 가능한 위젯 필터링 */
export function getAvailableWidgets(role: string, permissions: string[] = []): WidgetDef[] {
  return WIDGETS.filter((w) => canAccessWidget(w.roles, w.requiredPermissions, role, permissions));
}
