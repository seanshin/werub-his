'use client';

/**
 * 환자 목록 빈 상태(2026-10-20 환자 목록 P1 · R10).
 * 🔴 종전: 원내 보기·검색·필터를 걸어도 늘 "등록된 환자가 없습니다" — 조건에 맞는 환자가 없는 것과 등록 0 은 다른 사실이다.
 * 조회 실패는 이 부품에 오지 않는다(화면이 QueryErrorFallback 으로 따로 그린다).
 */
import { T, Tf } from '@/components/ui/i18n-text';

export interface ListConditions {
  search: string;
  onsiteOnly: boolean;
  filterCount: number;
}

export function hasListConditions(c: ListConditions): boolean {
  return !!c.search.trim() || c.onsiteOnly || c.filterCount > 0;
}

export function ListEmptyState({ conditions, onShowAll, onResetFilters }: {
  conditions: ListConditions;
  onShowAll: () => void;
  onResetFilters: () => void;
}) {
  if (!hasListConditions(conditions)) {
    return <p className="text-sm text-gray-400" data-patients-empty="none-registered"><T k="등록된 환자가 없습니다." /></p>;
  }
  return (
    <div className="space-y-2" data-patients-empty="no-match">
      <p className="text-sm text-gray-500"><T k="조건에 맞는 환자가 없습니다." /></p>
      <ul className="inline-flex flex-wrap justify-center gap-1.5 text-[11px] text-gray-500">
        {conditions.onsiteOnly && <li className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700" data-empty-cond="onsite"><T k="원내 환자만" /></li>}
        {!!conditions.search.trim() && <li className="rounded-full bg-gray-100 px-2 py-0.5" data-empty-cond="search"><Tf k="검색어 “{검색어}”" params={{ 검색어: conditions.search.trim() }} /></li>}
        {conditions.filterCount > 0 && <li className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700" data-empty-cond="filters"><Tf k="필터 {수}개" params={{ 수: conditions.filterCount }} /></li>}
      </ul>
      <div className="flex justify-center gap-2">
        {conditions.onsiteOnly && (
          <button type="button" onClick={onShowAll} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50" data-empty-show-all>
            <T k="등록 환자 전체 보기" />
          </button>
        )}
        {conditions.filterCount > 0 && (
          <button type="button" onClick={onResetFilters} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50" data-empty-reset>
            <T k="필터 초기화" />
          </button>
        )}
      </div>
    </div>
  );
}
