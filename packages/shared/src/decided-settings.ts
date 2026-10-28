/**
 * 사람 결정에 묶인 운영 설정의 허용 값(2026-10-10 · 결정 등록부 배치 10-F).
 *
 * 🔴 기능이 알아듣지 못하는 값이 저장되면 화면은 "정해짐"으로 보이는데 동작은 미설정과 같다.
 *    범용 설정 저장(`PUT /config/:key`)과 결정 집행 엔진이 **같은 규칙**으로 거른다(QI 흐름 규칙 `QI_FLOW_SETTING_ALLOWED` 과 함께).
 * `null` 은 언제나 허용 — 미설정(현행 동작)으로 되돌리는 값이다.
 */
import { qiFlowSettingInvalidReason } from './qi-flow';
import { NHI_OUTPATIENT_BY_GRADE_KEY, gradeRatesInvalidReason } from './copay-by-grade';
import { nursingRuleSettingInvalidReason } from './nursing-rules';

export type DecidedSettingRule = readonly (string | boolean)[] | { int: readonly [number, number] };

export const DECIDED_SETTING_ALLOWED: Record<string, DecidedSettingRule> = {
  'qi.docIssuance.slaHours': { int: [1, 720] },
  'doctor.inbox.dueHours': { int: [1, 168] },
  'nursing.io.noOutputAlertHours': { int: [1, 48] },
  'documents.fee.billingLink': ['BILLING_ITEM'],
  'location.wifi.autoUnbindOnEnd': [true, false],
  'location.wifi.keyRotationGraceMinutes': { int: [1, 1440] },
  'nursing.reassessment.autoScheduleOnAdmission': [true, false],
  'nursing.initialAssessment.bradenInput': ['TOTAL', 'SUBSCORES'],
  'pediatrics.growth.reference': ['WHO_2006', 'KDCA_2017'],
  // 결정 엔진(2026-10-11) — 결정에 묶인 설정 보호 게이트
  'governance.decisionConfigGuard': ['OFF', 'WARN', 'BLOCK'],
  // 요양기관 종별(2026-10-20) — 결정 billing.institutionType 이 집행하는 값 · 표 밖 값(오타)이 저장되면 진찰료 코드를 못 고른다
  'billing.institution.grade': ['CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY'],
};

/** 규칙이 있는 키면 값 검사 결과(null = 통과), 규칙 밖 키면 undefined(판정하지 않음) */
export function decidedSettingInvalidReason(key: string, value: unknown): string | null | undefined {
  const rule = DECIDED_SETTING_ALLOWED[key];
  if (!rule) return undefined;
  if (value === null) return null;
  if (Array.isArray(rule)) return rule.includes(value as string | boolean) ? null : `허용 값: ${rule.map(String).join(' · ')}`;
  const [min, max] = (rule as { int: readonly [number, number] }).int;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? null : `${min}~${max} 정수여야 합니다`;
}

/** 결정에 묶인 설정 전체(QI 흐름 + 배치 10-F) — 저장·집행이 부르는 하나의 입구 */
export function settingValueInvalidReason(key: string, value: unknown, today: Date = new Date()): string | null | undefined {
  const qi = qiFlowSettingInvalidReason(key, value, today);
  if (qi !== undefined) return qi;
  if (key === NHI_OUTPATIENT_BY_GRADE_KEY) return gradeRatesInvalidReason(value); // 건보 외래 율 종별 차등(객체 값)
  const nursing = nursingRuleSettingInvalidReason(key, value); // 간호 원내 규정(2026-10-26 · 통증 재평가 규정 객체·인계 인수 방식)
  if (nursing !== undefined) return nursing;
  return decidedSettingInvalidReason(key, value);
}
