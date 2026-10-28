import { Prisma } from '@prisma/client';

/**
 * CRM 세그먼트 규칙 → Prisma where 정본 (2026-08-13 · 화면 점검 W6)
 *
 * 🔴 같은 규칙을 **세 곳이 각자 해석**하고 있었다:
 *    - 발송 대상(`getSegmentPatients`)·수동 갱신(`countSegmentPatients`) = churnRisk·gender·nationality·tags
 *    - 야간 크론(`crm-cron`) = 위 4키 **+ rfmSegment**
 *    그래서 `{"rfmSegment":"CHAMPION"}` 세그먼트가 크론 뒤엔 1명, 화면 '갱신' 버튼을 누르면 874명(전체)로
 *    바뀌었고, **그 상태로 발송하면 조건이 통째로 무시되어 전체 환자에게 나간다.**
 *
 * 🔴 그리고 **모르는 키를 조용히 무시하지 않는다.** `{"ageMin":50}` 처럼 지원하지 않는 조건을 넣으면
 *    종전엔 필터가 하나도 안 걸린 채 "환자 수 874"만 표시돼, 사용자는 조건이 무시된 걸 알 방법이 없었다
 *    (P4-서버판: 미등록 키가 조용히 기본값으로 흐름). 이제 미지원 키를 함께 반환해 화면이 말하게 한다.
 */
export const SEGMENT_RULE_KEYS = ['churnRisk', 'gender', 'nationality', 'rfmSegment', 'tags'] as const;
export type SegmentRuleKey = (typeof SEGMENT_RULE_KEYS)[number];

export interface SegmentWhereResult {
  where: Prisma.PatientWhereInput;
  /** 규칙에 있었지만 이 시스템이 해석하지 못한 키 — 화면이 "조건이 적용되지 않았다"고 말해야 한다 */
  unsupportedKeys: string[];
}

/** 세그먼트 규칙을 환자 조회 조건으로. 사망·통합 환자는 항상 제외한다. */
export function buildSegmentWhere(rules: unknown): SegmentWhereResult {
  const r = (rules ?? {}) as Record<string, unknown>;
  const where: Prisma.PatientWhereInput = { isDeceased: false, mergedIntoId: null };

  if (r.churnRisk) where.churnRisk = r.churnRisk as string;
  if (r.gender) where.gender = r.gender as 'MALE' | 'FEMALE';
  if (r.nationality) where.nationality = r.nationality as string;
  if (r.rfmSegment) where.rfmSegment = r.rfmSegment as string;
  if (r.tags) where.tags = { hasSome: r.tags as string[] };

  const unsupportedKeys = Object.keys(r).filter(
    (k) => !(SEGMENT_RULE_KEYS as readonly string[]).includes(k) && r[k] != null,
  );
  return { where, unsupportedKeys };
}
