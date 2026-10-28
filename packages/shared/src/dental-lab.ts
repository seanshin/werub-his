/**
 * 치과 기공의뢰 상태 흐름 정본(2026-10-07) — 화면과 서버가 같은 순서를 쓴다.
 *  · 종전 서버는 문자열이면 무엇이든 받아 의뢰→장착완료로 건너뛰거나 되돌릴 수 있었다(발송·수령 시각 없이 "장착완료")
 *  · 한 단계씩 앞으로만 간다. 되돌림·건너뜀은 거부한다
 */
export const DENTAL_LAB_STATUS_FLOW = ['ORDERED', 'IMPRESSION_TAKEN', 'SENT', 'IN_FABRICATION', 'RECEIVED', 'FITTED', 'CEMENTED'] as const;
export type DentalLabStatus = (typeof DENTAL_LAB_STATUS_FLOW)[number];

export const DENTAL_LAB_STATUS_LABEL: Record<DentalLabStatus, string> = {
  ORDERED: '의뢰', IMPRESSION_TAKEN: '인상채득', SENT: '발송', IN_FABRICATION: '제작중',
  RECEIVED: '수령', FITTED: '시적', CEMENTED: '장착완료',
};

export function isDentalLabStatus(v: unknown): v is DentalLabStatus {
  return typeof v === 'string' && (DENTAL_LAB_STATUS_FLOW as readonly string[]).includes(v);
}

/** 다음 단계 — 마지막이거나 어휘 밖이면 null. */
export function nextDentalLabStatus(current: string): DentalLabStatus | null {
  const i = (DENTAL_LAB_STATUS_FLOW as readonly string[]).indexOf(current);
  return i >= 0 && i < DENTAL_LAB_STATUS_FLOW.length - 1 ? DENTAL_LAB_STATUS_FLOW[i + 1] : null;
}
