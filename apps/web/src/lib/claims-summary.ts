/**
 * 청구 요약 정본 파서 (2026-08-13 · 화면 점검 W3 · P11)
 *
 * 🔴 서버 `/api/v1/claims/summary` 는 Prisma groupBy **배열**
 *    `[{ status, _count, _sum: { claimedAmount, ... } }]` 을 반환한다.
 *    대시보드/위젯이 `{pending, reviewing, ...}` 평면 객체를 기대해 실제 청구 4건이
 *    있어도 전 칸 `0` 으로 단정됐다. 이 파서 하나로 두 소비처를 수렴한다(P12 예방).
 *
 * 버킷 매핑은 ClaimStatus enum 전량을 덮는다 — 늘어나면 합계 검증에서 드러난다.
 */
export interface ClaimSummaryRow {
  status: string;
  _count?: number;
  _sum?: { claimedAmount?: unknown; approvedAmount?: unknown; paidAmount?: unknown };
}

export interface ClaimCounts {
  pending: number;    // DRAFT — 미청구(작성중)
  reviewing: number;  // SUBMITTED·UNDER_REVIEW — 제출됨(🔴 P4-4: 심평원 전송 채널이 없어 SUBMITTED 는 '심사 중'이 아니다 · 화면 라벨 '제출됨')
  approved: number;   // APPROVED·PARTIALLY_APPROVED — 인정
  rejected: number;   // REJECTED — 반려
  paid: number;       // PAID — 지급완료
  total: number;
  totalClaimed: number; // 청구액 합계
  totalApproved: number; // 인정액 합계(P4-3 — 청구 목록 카드가 최근 20건으로 세던 것을 전체로)
}

const BUCKET: Record<string, keyof Omit<ClaimCounts, 'total' | 'totalClaimed' | 'totalApproved'>> = {
  DRAFT: 'pending',
  SUBMITTED: 'reviewing',
  UNDER_REVIEW: 'reviewing',
  APPROVED: 'approved',
  PARTIALLY_APPROVED: 'approved',
  REJECTED: 'rejected',
  PAID: 'paid',
};

export function claimCounts(raw: unknown): ClaimCounts {
  const rows: ClaimSummaryRow[] = Array.isArray(raw) ? raw as ClaimSummaryRow[] : [];
  const out: ClaimCounts = { pending: 0, reviewing: 0, approved: 0, rejected: 0, paid: 0, total: 0, totalClaimed: 0, totalApproved: 0 };
  for (const r of rows) {
    const n = typeof r._count === 'number' ? r._count : 0;
    const bucket = BUCKET[r.status];
    if (bucket) out[bucket] += n;
    out.total += n;
    out.totalClaimed += Number(r._sum?.claimedAmount ?? 0);
    out.totalApproved += Number(r._sum?.approvedAmount ?? 0);
  }
  return out;
}
