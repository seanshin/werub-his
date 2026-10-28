/**
 * 경보 등록부(Alert Registry) — **정본**. 기획서 `docs/01-plan/features/alert-registry.plan.md`.
 *
 * 🔴 왜 있는가(2026-08-19 실측): 직원 대상 임상·운영 경보가 **직접 발화 55곳·리스너 31핸들러·prisma 직접쓰기 9곳**에
 *    산재해 있었고, tier·대상 역할·억제·내장 액션이 코드마다 달랐다. 몇 개인지·누구에게 가는지·무엇을 하면 꺼지는지를
 *    아무도 한 곳에서 볼 수 없었다(읽음률 8.6% · CRITICAL 93건 중 읽음 2건).
 *
 * P0(인구조사) 원칙:
 *   · **어휘를 바꾸지 않는다** — `code` = 현행 `Notification.type` 그대로. 이름을 바꾸면 소비처(FE 링크·필터)가 갈라진다.
 *   · **현행 그대로 적는다** — tier·대상은 오늘 코드가 하는 대로. 전부 `approvedBy: 'UNAPPROVED'`(사람 게이트 §5).
 *   · **미등재는 막지 않는다** — `lookupAlert()` 가 null 이면 발화는 그대로 나가고 `unregistered` 로 수집된다.
 *     (거짓 경보를 죽이는 쪽으로 오작동하는 등록부는 등록부가 아니다.)
 *   · 이 파일은 순수 데이터 — Nest 의존 없음(어느 모듈에서 import 해도 순환이 없다).
 *
 * 등재 3조건(구조 가드 `test/notification/alert-registry-guard.spec.ts`): tier · targetKind · actionHref.
 */
import type { UserRole } from '@prisma/client';

/** 1 즉시·확인 필수(read-back) · 2 당일 조치 · 3 근무 내 · 4 정보 */
export type AlertTier = 1 | 2 | 3 | 4;
export type AlertDomain =
  | 'LAB' | 'IMAGING' | 'MED' | 'NURSING' | 'ER' | 'OR' | 'OB' | 'PSY' | 'PEDS' | 'PALLIATIVE'
  | 'SAFETY' | 'INFECTION' | 'CONSENT' | 'CONSULT' | 'ADMIN' | 'BILLING' | 'HR' | 'CRM' | 'SECURITY' | 'GOVERNANCE' | 'OPS';
/**
 * 발화 대상을 고르는 방식 — ATTENDING=환자 주치의 · ROLE=역할 전원/당직 · ASSIGNEE=특정 담당자(배정·요청자) ·
 * BROADCAST · **PATIENT=환자 본인(대외 발신 · PatientNotification+FCM)**
 */
export type AlertTargetKind = 'ATTENDING' | 'ROLE' | 'ASSIGNEE' | 'BROADCAST' | 'PATIENT';
/** 발신 채널 — 기본 STAFF(원내 Notification). PATIENT = 환자 앱 푸시(대외 발신) */
export type AlertChannel = 'STAFF' | 'PATIENT';
export type AlertBudgetClass = 'SAFETY' | 'WORKFLOW' | 'INFO';

export interface AlertDef {
  code: string;
  label: string;
  domain: AlertDomain;
  tier: AlertTier;
  targetKind: AlertTargetKind;
  /** ROLE 이면 발화 대상 역할, 그 외는 통상 수신 역할(정보) */
  targetRoles: UserRole[];
  /** 주치의 폴백 등 — 대상 역할에 온콜/담당이 없을 때 */
  fallbackKind?: AlertTargetKind;
  /** 같은 대상·유형·refId 재발송 억제 창(시간). null = 억제 없음(이유는 note) */
  dedupHours: number | null;
  /** 내장 액션(현재는 화면 이동 — 정본은 이 값. FE `hrefForRef` 는 refType 기준이라 P1 에서 이 값으로 수렴) */
  actionHref: string;
  /** 승인 주체 — 'UNAPPROVED' 면 관제가 표시한다 */
  approvedBy: string;
  /** ISO date — 지나면 관제 배지 */
  reviewDue: string;
  budgetClass: AlertBudgetClass;
  /** 발화 지점(파일:라인 — 2026-08-19 실측 · 이동하면 가드가 아니라 사람이 갱신) */
  emitters: string[];
  /** 기본 STAFF. PATIENT 는 대외 발신(환자 앱) — 어휘·억제·킬 스위치가 별도다(patient-push.contract.ts) */
  channel?: AlertChannel;
  /**
   * channel='PATIENT' 일 때 실제 `PatientNotification.type`.
   * 🔴 `code` 와 분리한 이유: 직원 코드 `LAB_RESULT` 와 이름이 겹친다(테이블이 다른데 등록부 키는 하나다).
   *    가드가 이 값 ↔ `PATIENT_PUSH_TYPES` 를 기계 대조한다(배선한 것만 등재·등재한 것만 배선).
   */
  patientNotificationType?: string;
  note?: string;
}

const UNAPPROVED = 'UNAPPROVED';
const REVIEW = '2026-09-18'; // baseline 30일 후(기획서 §4 P0)

/**
 * 🔴 실측 그대로. tier 는 현행 severity 매핑(CRITICAL→1 · WARNING→2 · INFO→3/4)이며 **승인된 값이 아니다**.
 */
export const ALERT_REGISTRY: readonly AlertDef[] = [
  // ── LAB / IMAGING ──────────────────────────────────────────────────────────────
  { code: 'CRITICAL_VALUE', label: '위급 검사값(read-back)', domain: 'LAB', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/orders', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:260', 'notification/notification.listener.ts:278', 'notification/notification.listener.ts:293'], note: '확인 원장은 CriticalValueAlert(IPSG.2). 억제 없음이 맞다(위급값은 매번).' },
  { code: 'DIAGNOSTIC_CRITICAL', label: '진단검사 위험소견', domain: 'LAB', tier: 1, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], fallbackKind: 'ATTENDING', dedupHours: 3, actionHref: '/diagnostics', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:672'], note: '처방의 → 주치의 순. 3시간 억제(실측 유일한 억제 리스너 3곳 중 하나).' },
  { code: 'LAB_RESULT', label: '검사 결과 도착', domain: 'LAB', tier: 4, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/orders', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['notification/notification.listener.ts:179', 'notification/notification.listener.ts:200'] },
  { code: 'IMAGING_REPORT', label: '판독 완료', domain: 'IMAGING', tier: 4, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/orders', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['notification/notification.listener.ts:75'] },

  // ── NURSING / 활력·위험 ────────────────────────────────────────────────────────
  { code: 'VITAL_ALERT', label: '활력징후 임계 초과', domain: 'NURSING', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/patients', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['vitals/vitals.service.ts:277'], note: '🔴 RRT/전담간호사 라우팅 없음 — 주치의 직행(§3.5 P1 대상). 게이트 clinical.vitals.criticalAlert(명시 false 만 억제·R9-①). PACU 는 별도 발화점(pacu.service PACU_VITAL_ALERT — 게이트 밖).' },
  { code: 'EWS_ALERT', label: 'EWS(조기경고점수) 상승', domain: 'NURSING', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:318'], note: '실측: EWS 통보 대상 부재를 아무도 몰랐다(§5.4) — 대상 없음은 그 자체가 경보다.' },
  { code: 'FALL_RISK_ALERT', label: '낙상 고위험', domain: 'NURSING', tier: 2, targetKind: 'ATTENDING', targetRoles: ['NURSE', 'DOCTOR'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:374'] },
  { code: 'REASSESSMENT_OVERDUE', label: '위험 재평가 기한 초과', domain: 'NURSING', tier: 2, targetKind: 'ATTENDING', targetRoles: ['NURSE'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['notification/notification.listener.ts:491'] },
  { code: 'RESTRAINT_ALERT', label: '격리·강박 재평가 초과', domain: 'NURSING', tier: 2, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:473'] },
  { code: 'MED_OVERDUE', label: '투약 지연', domain: 'MED', tier: 2, targetKind: 'ATTENDING', targetRoles: ['NURSE'], dedupHours: null, actionHref: '/patients', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['nursing/medication-overdue-cron.service.ts:57'], note: '크론 반복 — 억제 없음(중복 발화 가능·baseline 에서 확인).' },
  { code: 'CLINICAL_HANDOFF', label: '인수인계 도착', domain: 'NURSING', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['NURSE', 'DOCTOR'], dedupHours: null, actionHref: '/handoffs', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['inpatient/inpatient.service.ts:530'] },
  { code: 'CLINICAL_HANDOFF_REMINDER', label: '인수인계 미확인 리마인더', domain: 'NURSING', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['NURSE'], dedupHours: null, actionHref: '/handoffs', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['inpatient/handoff-reminder.cron.ts:57'] },
  { code: 'NUTRITION_ALERT', label: '영양 위험', domain: 'NURSING', tier: 2, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NUTRITION'], dedupHours: null, actionHref: '/patients', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['nutrition/nutrition-advanced.service.ts:290'] },
  { code: 'CHRONIC_ALERT', label: '만성질환 이상 추이', domain: 'NURSING', tier: 2, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/patients', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['chronic/chronic.service.ts:118'] },
  { code: 'CHRONIC_RECALL', label: '만성질환 리콜', domain: 'NURSING', tier: 4, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/patients', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['chronic/chronic-recall-cron.service.ts:45'] },
  { code: 'PROTOCOL_NEXT', label: '프로토콜 다음 단계', domain: 'NURSING', tier: 3, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/patients', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['protocol/protocol.service.ts:583'] },
  { code: 'DRAFT_CHART_REMINDER', label: '미서명 차트 회수', domain: 'NURSING', tier: 3, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/doctor-inbox', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['encounter/draft-chart-reminder.cron.ts:78'] },

  // ── ER / OR / OB / PSY / PEDS / PALLIATIVE ────────────────────────────────────
  { code: 'GOLDEN_PATHWAY_ALERT', label: '골든패스웨이 활성', domain: 'ER', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/emergency-board', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:352'] },
  { code: 'ER_REASSESS_OVERDUE', label: '응급 재평가 기한 초과', domain: 'ER', tier: 2, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/emergency-board', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['emergency/emergency.service.ts:1240'] },
  { code: 'STAFF_CALL', label: '직원 호출(코드 방송 포함)', domain: 'ER', tier: 1, targetKind: 'ROLE', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['staff-call/staff-call.service.ts:120'], note: 'call.type 이 코드명(CODE BLUE 등)으로도 들어온다 — refId 비UUID 유실 이력(notification_refid_contract).' },
  { code: 'BROADCAST', label: '전체 방송', domain: 'OPS', tier: 3, targetKind: 'BROADCAST', targetRoles: [], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['staff-call/staff-call.service.ts:145'] },
  { code: 'PACU_VITAL_ALERT', label: 'PACU 활력 이상', domain: 'OR', tier: 2, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['pacu/pacu.service.ts:510'] },
  { code: 'PACU_COMPLICATION', label: 'PACU 합병증', domain: 'OR', tier: 1, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['pacu/pacu.service.ts:566'] },
  { code: 'SURGERY_SAFETY_DIGEST', label: '수술안전 일일 다이제스트', domain: 'OR', tier: 3, targetKind: 'ROLE', targetRoles: ['ADMIN', 'DOCTOR'], dedupHours: null, actionHref: '/admin/qi', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['qi/surgery-safety.cron.ts:78'] },
  { code: 'PREECLAMPSIA_ALERT', label: '자간전증 의심', domain: 'OB', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:611'] },
  { code: 'FETAL_DISTRESS_ALERT', label: '태아곤란', domain: 'OB', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:627'] },
  { code: 'NEWBORN_CRITICAL_ALERT', label: '신생아 위급', domain: 'PEDS', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:422'] },
  { code: 'SUICIDE_RISK_ALERT', label: '자살위험 고위험', domain: 'PSY', tier: 1, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:400'] },
  { code: 'HOSPICE_SEVERE_PAIN', label: '호스피스 중증 통증', domain: 'PALLIATIVE', tier: 2, targetKind: 'ATTENDING', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/nursing-station', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:672'] },
  { code: 'TRANSPLANT_TDM_OUT_OF_RANGE', label: '이식 면역억제제 농도 목표범위 이탈', domain: 'MED', tier: 2, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/transplant', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:649', 'notification/notification.listener.ts:656'] },

  // ── SAFETY / 마약류 / 감사 ────────────────────────────────────────────────────
  { code: 'SAFETY_INCIDENT_CRITICAL', label: '환자안전 사고(위급)', domain: 'SAFETY', tier: 1, targetKind: 'ROLE', targetRoles: ['ADMIN'], fallbackKind: 'ATTENDING', dedupHours: null, actionHref: '/safety', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:512', 'notification/notification.listener.ts:520'] },
  { code: 'RCA_OVERDUE', label: 'RCA 기한 초과', domain: 'SAFETY', tier: 2, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/safety', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['notification/notification.listener.ts:577', 'notification/notification.listener.ts:594'] },
  { code: 'QI_TARGET_MISSED', label: '질 지표 목표 미달', domain: 'SAFETY', tier: 2, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: 24, actionHref: '/quality', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['notification/notification.listener.ts:560'], note: '2026-10-08 QI 흐름 — 월 마감(quality-flow)이 그 달 정본 행이 목표 미달인 지표마다 발행. 대상=지표 담당+QPS 위원+정책 역할. 판정 불가는 발행하지 않는다.' },
  { code: 'QI_MEASUREMENT_MISSING', label: '질 지표 측정 미입력', domain: 'SAFETY', tier: 3, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: 24, actionHref: '/quality', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['notification/notification.listener.ts:568'], note: '2026-10-08 QI 흐름 — 공급원 없는 수기 지표가 마감한 달에 측정이 없을 때. 채우지 않는다(사람이 입력하거나 측정하지 않는 사유를 남긴다).' },
  { code: 'QI_DEFINITION_CHANGED', label: '질 지표 정의·목표 직접 변경', domain: 'GOVERNANCE', tier: 3, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/quality', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['notification/notification.listener.ts:577'], note: '2026-10-08 QI 흐름 — 결정 qi.indicator.directEdit=ALLOW_WITH_REASON 일 때 화면 직접 수정(사유 포함)을 QPS 위원·관리자에게 통지. 위원회 의결 집행은 발행하지 않는다.' },
  { code: 'PHARMACIST_INTERVENTION', label: '약사 중재 — 처방의 회신 요청', domain: 'MED', tier: 2, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/pharmacist-replies', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['pharmacist-activity/pharmacist-activity.service.ts:449'], note: '2026-09-30 신설 — 대상=연결 처방의 책임 처방의(prescriberId ?? createdBy). 처방 연결 없는 중재는 받을 사람을 몰라 발화하지 않는다(응답 prescriberNotice.reason=NO_PRESCRIPTION). 억제 없음 — 중재마다 refId 가 다르다. 잔여 작업의 정본은 알림이 아니라 /pharmacist-replies 목록이다.' },
  { code: 'SUBSTITUTION_REQUEST', label: '대체조제 승인 요청', domain: 'MED', tier: 2, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/pharmacist-replies', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['pharmacy/pharmacy.service.ts:880'], note: '2026-09-30 신설 — 대상=원 처방의 책임 처방의. 🔴 요청 EP(POST pharmacy/substitution)를 부르는 화면이 아직 없다(발화 경로는 API 호출뿐).' },
  { code: 'SUBSTITUTION_DECIDED', label: '대체조제 판정 결과(약사)', domain: 'MED', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['PHARMACIST'], dedupHours: null, actionHref: '/pharmacy/admin', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['pharmacy/pharmacy.service.ts:954'], note: '2026-09-30 신설 — 대상=대체조제를 요청한 약사. 승인·거부와 사유(거부는 필수)를 싣는다. 같은 판정 재전송은 발화하지 않는다. 결과의 정본은 약제 관리 「최근 판정」 목록.' },
  { code: 'BED_TRANSFER_DECIDED', label: '전동 요청 결과(요청자)', domain: 'NURSING', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['NURSE', 'DOCTOR'], dedupHours: null, actionHref: '/bed-transfers', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['bed-transfer/bed-transfer.service.ts:166'], note: '2026-09-30 신설 — 대상=전동을 요청한 사람. 수락(받은 병동)·거절(사유). 입원 종료로 저절로 닫힌 요청은 알리지 않는다. 잔여 작업의 정본은 /bed-transfers 목록.' },
  { code: 'CONTROLLED_DISCREPANCY', label: '마약류 재고 불일치', domain: 'MED', tier: 1, targetKind: 'ROLE', targetRoles: ['PHARMACIST', 'ADMIN'], dedupHours: null, actionHref: '/admin/controlled-substance', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['notification/notification.listener.ts:445'] },
  { code: 'AUDIT_ANOMALY', label: '감사 이상 징후', domain: 'SECURITY', tier: 2, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/admin/audit', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['audit-enhanced/anomaly-detection.service.ts:281'] },
  { code: 'GUARDIAN_BTG', label: '보호자 응급열람(Break-the-glass)', domain: 'SECURITY', tier: 1, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/admin/audit', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['portal/portal.service.ts:550'] },
  { code: 'SECURITY', label: '기기 등록·보안 이벤트', domain: 'SECURITY', tier: 2, targetKind: 'ASSIGNEE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['auth/break-glass/break-glass.service.ts:124', 'auth/device-enroll/device-enroll.service.ts:330', 'auth/lifecycle/lifecycle.service.ts:85', 'auth/recovery/recovery.service.ts:109'] },
  { code: 'CERT_SETUP_NOTICE', label: '전자서명 인증서 설정 안내', domain: 'SECURITY', tier: 4, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR', 'NURSE', 'PHARMACIST'], dedupHours: 24, actionHref: '/settings/my-certificate', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['blockchain-cert/blockchain-cert.service.ts:43'], note: "관리 화면 '안내 발송' 버튼이 toast 만 띄우던 P16 봉합(2026-09-03) — 관리자가 미발급자에게 수동 발송. 24h 억제는 재클릭 스팸 방지." },
  { code: 'CREDENTIAL', label: '자격·기기 수명주기', domain: 'HR', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['credential-admin/bulk.service.ts:49', 'credential-admin/credential-cron.service.ts:90', 'credential-admin/device-policy.service.ts:82'] },
  { code: 'VOUCHER_CHAIN_BROKEN', label: '검진권 체인 위반', domain: 'ADMIN', tier: 1, targetKind: 'ROLE', targetRoles: ['ADMIN', 'CHECKUP'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'SAFETY', emitters: ['voucher/voucher-cron.service.ts:156'], note: '운영 0건 이력 — refId 비UUID 유실(고침). 발화 자체가 살아 있는지 baseline 에서 본다.' },

  // ── CONSENT / CONSULT / REFERRAL ─────────────────────────────────────────────
  { code: 'CONSENT', label: '동의서 생성(서명 요청)', domain: 'CONSENT', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR', 'NURSE'], dedupHours: null, actionHref: '/workstation/consent', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['consent/consent.service.ts:686', 'notification/notification.listener.ts:777', 'registration-consent/registration-consent.service.ts:304'] },
  { code: 'CONSENT_SIGNED', label: '동의서 환자 서명 완료', domain: 'CONSENT', tier: 4, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/workstation/consent', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['notification/notification.listener.ts:812', 'portal/portal.service.ts:1175'] },
  { code: 'CONSULT_REQUEST', label: '협진 요청', domain: 'CONSULT', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/consultations', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['consultation/consultation.service.ts:89'] },
  { code: 'CONSULT_REPLY', label: '협진 회신', domain: 'CONSULT', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/consultations', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['consultation/consultation.service.ts:285'] },
  { code: 'PATIENT_MESSAGE', label: '환자 메시지 도착', domain: 'CONSULT', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/patient-messages', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['patient-message/patient-message.listener.ts:40'], note: '포털·앱에서 환자가 담당의 지정 메시지를 보냈을 때 그 의사에게만. 담당 미지정은 알릴 사람이 없어 발화하지 않는다(받은편지함 미지정 묶음으로만 보인다).' },
  { code: 'REFERRAL', label: '의뢰서 서명·전송·회신', domain: 'CONSULT', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/consultations', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['referral-letter/referral-letter.service.ts:411', 'referral-letter/referral-letter.service.ts:447', 'referral-letter/referral-letter.service.ts:485'] },
  { code: 'CLAIM_REVIEW', label: '청구 검토 요청', domain: 'BILLING', tier: 3, targetKind: 'ATTENDING', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/claims', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['claim/claim.service.ts:81'] },
  { code: 'BILLING_UNPAID_ALERT', label: '미수금 경보', domain: 'BILLING', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['RECEPTIONIST', 'ADMIN'], dedupHours: null, actionHref: '/billing', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['billing/billing.service.ts:2929'] },
  { code: 'PRE_AUTH', label: '사전승인 요청', domain: 'BILLING', tier: 3, targetKind: 'ROLE', targetRoles: ['ADMIN', 'DOCTOR'], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['pre-auth/pre-auth-gate.service.ts:219', 'pre-auth/pre-auth.service.ts:235', 'pre-auth/pre-auth.service.ts:81'] },
  { code: 'HIM_DEFICIENCY', label: '의무기록 미비', domain: 'ADMIN', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR', 'MEDICAL_RECORDS'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['him/him.service.ts:221'] },
  { code: 'EDU', label: '교육 이수 알림', domain: 'HR', tier: 4, targetKind: 'ASSIGNEE', targetRoles: [], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['staff-qualification/staff-qualification-integration.controller.ts:107'] },

  // ── CRM / VoC / 상담 ─────────────────────────────────────────────────────────
  { code: 'CONSULT_NEW', label: '상담 세션 신규', domain: 'CRM', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['CRM_STAFF', 'CRM_MANAGER'], dedupHours: null, actionHref: '/consult', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['consult/consult.service.ts:140'] },
  { code: 'CONSULT_ESCALATION', label: '상담 에스컬레이션', domain: 'CRM', tier: 2, targetKind: 'ROLE', targetRoles: ['CRM_MANAGER'], dedupHours: null, actionHref: '/consult', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['consult/consult.service.ts:531'] },
  { code: 'CONSULT_SLA', label: '상담 SLA 초과', domain: 'CRM', tier: 2, targetKind: 'ASSIGNEE', targetRoles: ['CRM_STAFF'], dedupHours: null, actionHref: '/consult', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['voc/voc-sla-cron.service.ts:94'] },
  { code: 'VOC_ASSIGNED', label: 'VoC 배정', domain: 'CRM', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['CRM_STAFF'], dedupHours: null, actionHref: '/admin/voc', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['voc/voc-admin.service.ts:146'] },
  { code: 'VOC_SLA_OVERDUE', label: 'VoC SLA 초과', domain: 'CRM', tier: 2, targetKind: 'ASSIGNEE', targetRoles: ['CRM_STAFF'], dedupHours: null, actionHref: '/admin/voc', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['voc/voc-sla-cron.service.ts:54'] },
  { code: 'VOC_PATIENT_REPLY', label: 'VoC 고객 답글', domain: 'CRM', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['CRM_STAFF'], dedupHours: null, actionHref: '/admin/voc', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['voc/voc.service.ts:225'] },
  { code: 'VOC_REOPENED', label: 'VoC 재오픈', domain: 'CRM', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['CRM_STAFF'], dedupHours: null, actionHref: '/admin/voc', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['voc/voc.service.ts:225'] },

  // ── HR / GOVERNANCE / OPS ────────────────────────────────────────────────────
  { code: 'HR_APPROVAL', label: 'HR 결재 요청', domain: 'HR', tier: 3, targetKind: 'ASSIGNEE', targetRoles: [], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['ess/ess.service.ts:508'], note: '래퍼 notifyUser 경유(스캔 누락분 — 운영 DB 미등재 관찰로 발견).' },
  { code: 'HR_APPROVAL_RESULT', label: 'HR 결재 결과', domain: 'HR', tier: 3, targetKind: 'ASSIGNEE', targetRoles: [], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['ess/ess.service.ts:1054'] },
  { code: 'HR_DELEGATION', label: '결재 대결(위임) 지정', domain: 'HR', tier: 3, targetKind: 'ASSIGNEE', targetRoles: [], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['ess/ess.service.ts:761'] },
  { code: 'CLINICAL_APPROVAL', label: '기록지 전자결재 요청', domain: 'ADMIN', tier: 3, targetKind: 'ASSIGNEE', targetRoles: ['DOCTOR'], dedupHours: null, actionHref: '/workstation/documents', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['ess/ess.service.ts:1156', 'ess/ess.service.ts:1227'], note: 'prisma 직접쓰기(서비스 우회).' },
  { code: 'HR_DUTY_CLASH', label: '근무·휴가 충돌', domain: 'HR', tier: 3, targetKind: 'ASSIGNEE', targetRoles: [], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['ess/ess.service.ts:1540'], note: '래퍼 notifyUser 경유(가드 스캔 확장으로 발견).' },
  { code: 'HR_DUTY_SWAP', label: '근무 교대 요청', domain: 'HR', tier: 3, targetKind: 'ROLE', targetRoles: ['NURSE', 'ADMIN'], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['duty-schedule/duty-schedule.service.ts:377'] },
  { code: 'HR_APPROVAL_REMIND', label: 'HR 결재 리마인더', domain: 'HR', tier: 3, targetKind: 'ASSIGNEE', targetRoles: [], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['ess/ess-approval-reminder.cron.ts:40'], note: 'prisma 직접쓰기(서비스 우회) — 등록부 lookup 을 타지 않는다(P1 수렴 대상).' },
  { code: 'HR_APPROVAL_ESCALATION', label: 'HR 결재 에스컬레이션', domain: 'HR', tier: 2, targetKind: 'ASSIGNEE', targetRoles: [], dedupHours: null, actionHref: '/ess', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['ess/ess-approval-reminder.cron.ts:45'], note: 'prisma 직접쓰기(서비스 우회).' },
  { code: 'GOVERNANCE_REVIEW_DUE', label: '거버넌스 재검토 도래', domain: 'GOVERNANCE', tier: 4, targetKind: 'ASSIGNEE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['gld/governance.service.ts:734'] },
  { code: 'GOVERNANCE_ENACT_FAILED', label: '거버넌스 집행 실패', domain: 'GOVERNANCE', tier: 2, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['gld/governance-enactment.service.ts:459'] },
  { code: 'GOLIVE_OVERDUE', label: '운영 전환 목표일 지연', domain: 'OPS', tier: 3, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/admin/go-live', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', emitters: ['go-live/go-live-cron.service.ts:73'] },
  { code: 'GOLIVE_READY', label: '운영 전환 준비 완료', domain: 'OPS', tier: 4, targetKind: 'ROLE', targetRoles: ['ADMIN'], dedupHours: null, actionHref: '/admin/go-live', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', emitters: ['go-live/go-live-cron.service.ts:61'] },

  // ── 환자 앱 푸시(대외 발신 · channel='PATIENT') ──────────────────────────────
  // 🔴 2026-08-20 신규 배선. 종전에는 리스너만 있고 **발행 지점이 없어 개통 이래 한 번도 발화하지 않았다.**
  //    P0 규약대로 **켜기 전에** 등재한다 — 다만 `approvedBy: 'UNAPPROVED'` 이고
  //    킬 스위치(`notification.patientPush.*`)가 **전부 기본 OFF** 라 사람이 켜기 전에는 나가지 않는다.
  //    tier·라우팅·야간 창은 사람 승인 대기(§5 게이트: 진료부·원무과·정보보호).
  //    `actionHref` 는 환자앱(expo-router) 실재 라우트다 — `data.route` 로 딥링크된다.
  //    🔴 배선하지 않은 것은 등재하지 않았다: 회진 예정(`admission.round_scheduled` — 예정 시각 스키마 부재) ·
  //       예약 리마인더(`appointment.reminder` — 크론 부재 · 통보 어댑터 미구현).
  { code: 'PATIENT_PUSH_CALLED', label: '[환자앱] 진료 호출', domain: 'OPS', tier: 2, targetKind: 'PATIENT', targetRoles: [], dedupHours: 0.05, actionHref: '/(tabs)/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', channel: 'PATIENT', patientNotificationType: 'CALLED', emitters: ['waiting-queue/waiting-queue.service.ts:427'], note: '대기열 호출(WAITING/CALLED→CALLED) 확정 후. 직원 옵트인(notifyPatient) 필수 · 야간 억제 예외(지금 부르는 것) · 3분 중복 억제.' },
  { code: 'PATIENT_PUSH_PHARMACY', label: '[환자앱] 약 조제 완료(수령 안내)', domain: 'MED', tier: 3, targetKind: 'PATIENT', targetRoles: [], dedupHours: 0.5, actionHref: '/(tabs)/medication', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', channel: 'PATIENT', patientNotificationType: 'PHARMACY', emitters: ['pharmacy/pharmacy.service.ts:500'], note: '조제 검수 완료(DISPENSED→VERIFIED)=불출 가능 시점. 외래만(입원은 병동 인계) · 직원 옵트인 필수 · 야간 억제 예외.' },
  { code: 'PATIENT_PUSH_BILLING', label: '[환자앱] 수납 대기', domain: 'BILLING', tier: 3, targetKind: 'PATIENT', targetRoles: [], dedupHours: 1, actionHref: '/(tabs)/billing', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', channel: 'PATIENT', patientNotificationType: 'BILLING', emitters: ['billing/billing.service.ts:778'], note: '청구(PENDING) 생성 직후. 🔴 encounter.signed 자동 경로는 누를 사람이 없어 항상 NOT_REQUESTED — 자동 발송 여부는 사람 결정.' },
  { code: 'PATIENT_PUSH_LAB_RESULT', label: '[환자앱] 검사 결과 확정', domain: 'LAB', tier: 4, targetKind: 'PATIENT', targetRoles: [], dedupHours: 1, actionHref: '/(tabs)/labs', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', channel: 'PATIENT', patientNotificationType: 'LAB_RESULT', emitters: ['lab/lab.service.ts:704'], note: '🔴 VERIFIED(독립 검증 완료) 이후에만 — COMPLETED 는 예비 결과다. 위급값 포함 결과는 미발송(IPSG.2 read-back 이 정본) · 야간 억제 적용 · 옵트인 없음(설정만으로 판정).' },
  { code: 'PATIENT_PUSH_MESSAGE', label: '[환자앱] 담당의 메시지 답변', domain: 'CONSULT', tier: 4, targetKind: 'PATIENT', targetRoles: [], dedupHours: 10 / 60, actionHref: '/(tabs)/messages', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', channel: 'PATIENT', patientNotificationType: 'MESSAGE', emitters: ['patient-message/patient-message.service.ts:188'], note: '의사 답변 저장 후. 내용은 싣지 않음(잠금 화면에 진료 조언 금지) · 의사 옵트인 필수 · 야간 억제 적용 · 10분 중복 억제.' },
  { code: 'PATIENT_PUSH_DOCUMENT_READY', label: '[환자앱] 서류 발급 완료', domain: 'ADMIN', tier: 4, targetKind: 'PATIENT', targetRoles: [], dedupHours: 10 / 60, actionHref: '/(tabs)/documents', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', channel: 'PATIENT', patientNotificationType: 'DOCUMENT_READY', emitters: ['medical-record-issuance/issuance.service.ts:788', 'medical-record-issuance/issuance.service.ts:823'], note: '개별 서류 발급 완료(2026-10-10 — 종전엔 실손 번들만 알림). 번들 소속은 번들 알림 몫 · 수령 방법별 문구 · 옵트인 없음(시스템) · 야간 억제 · 10분 중복 억제.' },
  { code: 'PATIENT_PUSH_DOCUMENT_REJECTED', label: '[환자앱] 서류 발급 반려', domain: 'ADMIN', tier: 4, targetKind: 'PATIENT', targetRoles: [], dedupHours: 10 / 60, actionHref: '/(tabs)/documents', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'INFO', channel: 'PATIENT', patientNotificationType: 'DOCUMENT_REJECTED', emitters: ['medical-record-issuance/issuance.service.ts:841'], note: '반려(2026-10-10). 🔴 사유는 싣지 않는다(잠금 화면) — 앱 신청 내역에서 확인 · 옵트인 없음 · 야간 억제.' },
  { code: 'PATIENT_PUSH_QUEUE_NEAR', label: '[환자앱] 진료 차례 임박', domain: 'OPS', tier: 3, targetKind: 'PATIENT', targetRoles: [], dedupHours: 0.05, actionHref: '/(tabs)/notifications', approvedBy: UNAPPROVED, reviewDue: REVIEW, budgetClass: 'WORKFLOW', channel: 'PATIENT', patientNotificationType: 'QUEUE_NEAR', emitters: ['waiting-queue/waiting-queue.service.ts:812'], note: '포털 B3(2026-10-26). 같은 진료과 오늘 대기에서 앞 인원이 기준(notification.patientPush.queueNearAhead · 🔴 미설정이면 만들지 않음) 이하가 된 첫 순간 · 같은 대기표 한 번(원장 data.queueId) · 시스템 알림(옵트인 없음) · 야간 억제 예외(원내 대기 중) · 문구에 이름·진료실 없음.' },
];

/**
 * 운영 DB 에는 있으나 **발화 코드가 없는** 유형(시드 데이터 전용 · 2026-08-19 실측 `registry` 보고).
 * 등재하지 않는다(등록부는 살아 있는 발화의 목록이다) — 관제가 "시드 전용"으로 표시해 미등재와 구분한다.
 */
export const SEED_ONLY_CODES: readonly string[] = ['BILLING_OVERDUE', 'DISPENSING_PENDING', 'ICU_ALERT', 'LAB_CRITICAL', 'ORDER_COMPLETE', 'SYSTEM', 'FALL_RISK'];

const INDEX = new Map(ALERT_REGISTRY.map((d) => [d.code, d]));

/** 등재 조회 — 없으면 null(발화를 막지 않는다 · 호출자가 unregistered 로 수집한다) */
export function lookupAlert(code: string | null | undefined): AlertDef | null {
  if (!code) return null;
  return INDEX.get(code) ?? null;
}

/** tier → 표준 severity(호출자가 severity 를 안 줬을 때의 기본값) */
export function tierToSeverity(tier: AlertTier): 'INFO' | 'WARNING' | 'CRITICAL' {
  return tier === 1 ? 'CRITICAL' : tier === 2 ? 'WARNING' : 'INFO';
}
