/**
 * 환자 응답 필드 마스킹 — 순수 로직.
 *
 * 🔴 라우트를 막는 것만으로는 부족하다: 목록·상세 응답 자체가 연락처·보험번호를 담고 있어
 *    `PATIENT_VIEW` 만 가진 역할(약사·검사기사·마케팅·경영진)도 전화번호와 보호자 연락처를 받았다.
 *    **응답 경계에서** 열람 권한에 따라 지운다(화면이 가리는 것에 기대지 않는다).
 *
 * 원칙:
 *  - 연락처는 **지우지 않고 부분 마스킹**한다(등록 여부는 업무상 필요·값은 감춘다).
 *  - 주소·이메일·보호자·보험번호·주민번호는 **아예 뺀다**(부분 노출이 의미 없거나 재식별 위험).
 *  - 보험 '유형'(건보/자보 등)은 수납·안내에 필요하므로 남긴다 — 번호만 감춘다.
 */

export interface ViewerPerms {
  /** PATIENT_VIEW_CONTACT — 연락처·주소·보호자 */
  contact: boolean;
  /** PATIENT_VIEW_IDENTITY — 주민번호·보험번호 등 신원식별 */
  identity: boolean;
}

/** `010-1234-5678` → `010-****-5678` (자리수·존재는 남기고 값은 감춤) */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 7) return '***';
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-****-${tail}`;
}

const CONTACT_ONLY_FIELDS = ['email', 'address', 'contacts', 'emergencyContact'] as const;
const IDENTITY_FIELDS = ['nationalId', 'nationalIdHash', 'insuranceNumber', 'passportNumber'] as const;

/** 목록 항목 — 전화번호만 담고 있어 마스킹으로 충분 */
export function maskListItem<T extends Record<string, unknown>>(item: T, v: ViewerPerms): T {
  if (v.contact && v.identity) return item;
  const out: Record<string, unknown> = { ...item };
  if (!v.contact && 'phone' in out) out.phone = maskPhone(out.phone as string | null);
  if (!v.identity) for (const f of IDENTITY_FIELDS) delete out[f];
  return out as T;
}

/** 상세 — 보호자·주소까지 담기므로 제거가 필요하다 */
export function maskDetail<T extends Record<string, unknown>>(patient: T, v: ViewerPerms): T {
  if (v.contact && v.identity) return patient;
  const out: Record<string, unknown> = { ...patient };
  if (!v.contact) {
    out.phone = maskPhone(out.phone as string | null);
    for (const f of CONTACT_ONLY_FIELDS) delete out[f];
  }
  if (!v.identity) for (const f of IDENTITY_FIELDS) delete out[f];
  // 무엇이 가려졌는지 화면이 알 수 있게(빈 값과 '권한 없음'을 구분)
  out.maskedFields = [
    ...(!v.contact ? ['phone', ...CONTACT_ONLY_FIELDS] : []),
    ...(!v.identity ? [...IDENTITY_FIELDS] : []),
  ];
  return out as T;
}
