'use client';

/**
 * 환자 목록 능력표·안내 띠(2026-10-20 환자 목록 P0 · `patients-list-refinement-2026-10.plan.md` A1·A2).
 *
 * 🔴 종전: 화면이 역할마다 문장을 지어냈다 — 의사 "본인 진료 환자 … 연락처/보험은 마스킹됩니다", 약사 "처방이 있는 환자의
 *    약물 정보만" — 그러나 서버는 역할별 범위를 걸지 않고(전체 환자) 의사에게 전화번호 원문을 보냈다.
 *    이제 문장은 **서버 능력표에서만** 만든다. 서버가 하는 일만 말한다.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

/** 서버 능력표 — 오는 중·실패면 `cap = undefined`(쓰기·관리 도구를 그리지 않는다 · 관리자 폴백 없음) */
export function useListCapabilities() {
  const q = useQuery({
    queryKey: ['patients-list-capabilities'],
    queryFn: () => apiClient.get<{ data: ListCapabilities }>('/api/v1/patients/list-capabilities'),
    staleTime: 300_000,
    retry: 1,
  });
  const raw = q.data as unknown as { data?: ListCapabilities | { data?: ListCapabilities } } | undefined;
  const inner = raw?.data as { data?: ListCapabilities } | ListCapabilities | undefined;
  const cap = (inner && 'scope' in inner ? inner : (inner as { data?: ListCapabilities } | undefined)?.data) as ListCapabilities | undefined;
  return { cap, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch };
}

export interface ListCapabilities {
  scope: 'ALL';
  contact: 'FULL' | 'MASKED';
  contactReason: 'RBAC' | 'SETTING' | null;
  identity: boolean;
  phoneSearch: boolean;
  canRegister: boolean;
  canImport: boolean;
  canMerge: boolean;
  canExport: boolean;
  canReviewDuplicates: boolean;
  canViewQuality: boolean;
  /** 목록 알레르기 확인 상태 칸(단건 조회와 같은 역할) · 2026-10-20 P3 */
  allergyStatus?: boolean;
  /** "내 환자" 필터(의사) */
  myScope?: boolean;
  /** 오래된 작성 중 기록 신호 — MINE 의사 본인 · ALL 관리자 · null 칸 없음(P4 B6) */
  staleDrafts?: 'MINE' | 'ALL' | null;
  staleDraftDays?: number;
  narrowing: { source: string; fields: Array<'showPhone' | 'canRegister'>; scope: 'LIST' } | null;
}

export function ListAccessBanner({ cap, isError }: { cap: ListCapabilities | undefined; isError: boolean }) {
  if (isError) {
    return (
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800" data-patients-access-error>
        <T k="목록 권한 정보를 불러오지 못해 등록·관리 도구를 숨겼습니다." />
      </div>
    );
  }
  if (!cap) return null; // 오는 중 — "확인 불가"라 말하지 않는다
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs text-blue-700" data-patients-access-banner>
      <span data-patients-scope><T k="등록된 전체 환자가 목록에 보입니다(역할별 범위 제한 없음)." /></span>
      {cap.contact === 'MASKED' && (
        <span data-patients-contact-masked={cap.contactReason ?? ''}>
          {cap.contactReason === 'SETTING'
            ? <T k="목록의 연락처는 가려서 받습니다 — 역할 데이터 접근 설정(목록에만 적용 · 환자 상세는 역할 권한대로)." />
            : <T k="연락처는 가려서 받습니다 — 역할 권한에 연락처 열람이 없습니다." />}
        </span>
      )}
      {!cap.phoneSearch && <span data-patients-no-phone-search><T k="전화번호로는 찾지 않습니다." /></span>}
    </div>
  );
}
