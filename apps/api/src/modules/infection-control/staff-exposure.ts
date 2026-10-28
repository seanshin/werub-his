/**
 * 🔴 직원 혈액·체액 노출 사고(니들스틱 등) 어휘 정본 — 영속화 배선(2026-08-18).
 *
 * 무엇이 잘못이었나:
 *  - `InfectionControlService.recordStaffExposure()` 는 사고를 **프로세스 메모리 배열**에 담았다.
 *    pm2 재기동(=매 배포)마다 전량 소실됐고, 산업안전보건법·감염관리 법정기록이 남지 않았다.
 *  - 화면·대시보드의 '직원 노출 0건'은 **사고가 없었다는 뜻이 아니라** 표본이 지워졌다는 뜻이었다.
 *
 * 무엇을 고쳤나:
 *  - 전용 모델 `StaffExposureIncident` 로 영속화한다.
 *  - 🔴 `SafetyIncident`(환자안전 사고 정본)를 재사용하지 않는다 — 재사용하면 patient-safety
 *    통계·QI 보드·경영 대시보드가 직원 사고를 환자안전 사고로 세어 지표가 오염된다.
 *
 * 🔴 원환자 감염상태는 **모르면 null** 이다. null 을 '음성'으로 접으면 PEP(노출 후 예방요법)
 *    판단이 뒤집힌다 — 이 파일의 `serologyOf()` 하나만 쓰고, boolean 을 직접 읽지 않는다.
 */

/** 노출 유형 — 스키마는 VarChar(30)(enum 아님)이라 여기가 정본이다. */
export const STAFF_EXPOSURE_TYPES = [
  'NEEDLESTICK', // 주사침 자상
  'SHARPS', // 기타 예리물(수술칼·유리 등)
  'SPLASH_MUCOSA', // 점막(눈·구강·비강) 튐
  'SKIN_CONTACT', // 손상 피부 접촉
  'OTHER',
] as const;
export type StaffExposureType = (typeof STAFF_EXPOSURE_TYPES)[number];

export const STAFF_EXPOSURE_TYPE_LABELS: Record<StaffExposureType, string> = {
  NEEDLESTICK: '주사침 자상',
  SHARPS: '예리물 손상',
  SPLASH_MUCOSA: '점막 노출',
  SKIN_CONTACT: '손상피부 접촉',
  OTHER: '기타',
};

/** 추적관찰 상태 — 스키마 VarChar(20). */
export const STAFF_EXPOSURE_FOLLOW_UP_STATUSES = ['OPEN', 'IN_FOLLOW_UP', 'CLOSED'] as const;
export type StaffExposureFollowUpStatus = (typeof STAFF_EXPOSURE_FOLLOW_UP_STATUSES)[number];

export const STAFF_EXPOSURE_FOLLOW_UP_LABELS: Record<StaffExposureFollowUpStatus, string> = {
  OPEN: '접수(추적 미개시)',
  IN_FOLLOW_UP: '추적관찰 중',
  CLOSED: '종결',
};

/**
 * 원환자 혈청학적 상태의 3상 — **UNKNOWN 은 NEGATIVE 가 아니다**.
 * (`Boolean?` 컬럼의 null 을 false 로 접으면 '음성'으로 단정하는 것과 같다.)
 */
export type SourceSerology = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';

export function serologyOf(v: boolean | null | undefined): SourceSerology {
  if (v === true) return 'POSITIVE';
  if (v === false) return 'NEGATIVE';
  return 'UNKNOWN'; // null / undefined = 검사하지 않았거나 결과를 모른다
}

export const SEROLOGY_LABELS: Record<SourceSerology, string> = {
  POSITIVE: '양성',
  NEGATIVE: '음성',
  UNKNOWN: '미상(검사 전·결과 없음)',
};

export interface SourceStatusView {
  hbv: SourceSerology;
  hcv: SourceSerology;
  hiv: SourceSerology;
  /** 하나라도 UNKNOWN 이면 true — 화면은 '음성'이 아니라 '확인 필요'로 말해야 한다 */
  anyUnknown: boolean;
  /** 하나라도 POSITIVE 이면 true */
  anyPositive: boolean;
  /** 원환자 자체가 지정되지 않음(무명 노출) — 검사 자체가 불가능하다 */
  sourceIdentified: boolean;
}

export function sourceStatusOf(r: {
  sourcePatientId?: string | null;
  sourceHbv?: boolean | null;
  sourceHcv?: boolean | null;
  sourceHiv?: boolean | null;
}): SourceStatusView {
  const hbv = serologyOf(r.sourceHbv);
  const hcv = serologyOf(r.sourceHcv);
  const hiv = serologyOf(r.sourceHiv);
  const all = [hbv, hcv, hiv];
  return {
    hbv,
    hcv,
    hiv,
    anyUnknown: all.includes('UNKNOWN'),
    anyPositive: all.includes('POSITIVE'),
    sourceIdentified: !!r.sourcePatientId,
  };
}

/**
 * 미상 항목이 남아 있으면 사람이 읽고 바로 조치할 수 있는 한 줄.
 * 🔴 확실하지 않으면 침묵한다 — 전부 판명된 경우에는 아무 문구도 만들지 않는다(거짓 경보 방지).
 */
export function sourceStatusNote(s: SourceStatusView): string | null {
  if (!s.sourceIdentified) {
    return '원환자가 지정되지 않아 감염상태를 확인할 수 없습니다 — 음성으로 간주하지 마십시오.';
  }
  if (!s.anyUnknown) return null;
  const unknown = (['hbv', 'hcv', 'hiv'] as const).filter((k) => s[k] === 'UNKNOWN');
  return `원환자 ${unknown.map((k) => k.toUpperCase()).join('·')} 결과 미상 — 음성이 아니라 미확인입니다. 원환자 동의 후 즉시 검사하십시오.`;
}
