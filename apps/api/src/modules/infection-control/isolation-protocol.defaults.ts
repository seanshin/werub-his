/**
 * 격리 프로토콜 기본값(P0-a④) — 정본은 IsolationProtocol 테이블.
 * 이 상수는 ①최초 시드 소스 ②미등재 타입/로드 실패 폴백(fail-safe)으로만 쓰인다.
 * 🔴 개정은 여기가 아니라 PUT /infection-control/protocols/:type → 테이블(감염관리위 심의 대상).
 */
export interface IsolationProtocolDef {
  isolationType: string;
  standardDurationDays: number;
  requiredPPE: string[];
  environmentalMeasures: string[];
  visitationPolicy: string;
  staffEducationRequired: boolean;
}

export const ISOLATION_PROTOCOL_DEFAULTS: IsolationProtocolDef[] = [
  { isolationType: 'STANDARD', standardDurationDays: 0, requiredPPE: ['Hand hygiene'], environmentalMeasures: ['Standard cleaning'], visitationPolicy: 'Unrestricted', staffEducationRequired: false },
  { isolationType: 'DROPLET', standardDurationDays: 5, requiredPPE: ['Surgical mask', 'Eye protection'], environmentalMeasures: ['Door closed', 'Standard cleaning'], visitationPolicy: 'Limited', staffEducationRequired: true },
  { isolationType: 'AIRBORNE', standardDurationDays: 10, requiredPPE: ['N95/KN95 respirator', 'Gown', 'Eye protection'], environmentalMeasures: ['Negative pressure room', 'HEPA filtration'], visitationPolicy: 'Restricted', staffEducationRequired: true },
  { isolationType: 'CONTACT', standardDurationDays: 5, requiredPPE: ['Gown', 'Gloves'], environmentalMeasures: ['Dedicated equipment', 'Disinfection'], visitationPolicy: 'Limited', staffEducationRequired: true },
  { isolationType: 'STRICT', standardDurationDays: 14, requiredPPE: ['Full PPE', 'N95 respirator', 'Double gown'], environmentalMeasures: ['Negative pressure room', 'Triple containment'], visitationPolicy: 'Prohibited', staffEducationRequired: true },
  { isolationType: 'PROTECTIVE', standardDurationDays: 0, requiredPPE: ['Gown', 'Gloves', 'Surgical mask (staff)'], environmentalMeasures: ['Positive pressure room', 'HEPA filtration', 'No fresh flowers/plants'], visitationPolicy: 'Restricted (healthy visitors only)', staffEducationRequired: true },
];
