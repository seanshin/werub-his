/**
 * 임상 카탈로그(약속처방·치료일정 템플릿) 생애주기 정본 — 2026-10-21 임상 규칙·템플릿 P2(`clinical-rules-templates-review-2026-10.plan.md` A3).
 *
 * 🔴 종전: 초안 → 사용 중 직행이 승인자를 남기지 않았고(운영 약속처방 26/26 승인 기록 없음), 사용 중 세트를 의사가 제자리에서 고쳤다
 *    (판 올림·재승인·미해석 항목 검사 없음). 두 서비스가 같은 전이 표를 각자 들고 있었다.
 *  · 사용 중으로 바꾸는 사람이 승인 기록이 없으면 그 사람이 승인자로 남는다(누가 사용 중으로 했는지가 원장에 남는다)
 *  · 같은 계보(원본 + 판)에서 사용 중은 하나 — 새 판을 사용 중으로 하면 이전 판은 폐기로
 *  · 사용 중 내용 수정 = 새 판 초안(사용 중 판은 그대로 쓰인다) · 승인 대기·승인됨 내용 수정 = 초안으로 되돌림(승인은 다른 내용에 대한 것)
 */
export const CATALOG_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'DEPRECATED'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const CATALOG_STATUS_TRANSITIONS: Readonly<Record<CatalogStatus, readonly CatalogStatus[]>> = {
  DRAFT: ['PENDING_APPROVAL', 'ACTIVE'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT'],
  APPROVED: ['ACTIVE', 'DRAFT'],
  ACTIVE: ['DEPRECATED', 'DRAFT'],
  DEPRECATED: ['DRAFT'],
};

export function catalogTransitionAllowed(from: string, to: string): boolean {
  return ((CATALOG_STATUS_TRANSITIONS as Record<string, readonly string[]>)[from] ?? []).includes(to);
}

/** 내용 수정이 무엇을 일으키는가 */
export type CatalogEditMode = 'IN_PLACE' | 'RESET_APPROVAL' | 'NEW_VERSION';
export function catalogEditMode(status: string): CatalogEditMode {
  if (status === 'ACTIVE') return 'NEW_VERSION';
  if (status === 'PENDING_APPROVAL' || status === 'APPROVED') return 'RESET_APPROVAL';
  return 'IN_PLACE';
}

/** 계보 뿌리 — 원본은 자기 자신, 판은 parentId */
export const catalogRootId = (row: { id: string; parentId?: string | null }) => row.parentId ?? row.id;
