'use client';

import { useQuery } from '@tanstack/react-query';
import { ageOf } from '@hospital-run/shared';
import { Unit, genderText } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import Link from 'next/link';
import { pollMs } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

export default function CheckupReviewPage() {
  const { data: reviewRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup-review'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/visits', { status: 'REVIEW', limit: '50' }),
    refetchInterval: pollMs('fast'),
  });
  const reviews = reviewRes?.data ?? [];

  const { data: examRes } = useQuery({
    queryKey: ['checkup-exam-complete'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/visits', { status: 'EXAM_COMPLETE', limit: '50' }),
  });
  const examComplete = examRes?.data ?? [];

  const { data: partialRes } = useQuery({
    queryKey: ['checkup-partial'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/visits', { status: 'PARTIAL_COMPLETE', limit: '50' }),
  });
  const partial = partialRes?.data ?? [];

  const age = (dob: string) => dob ? (ageOf(dob) ?? 0) : '-';
  const allPending = [...reviews, ...examComplete, ...partial];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="소견 작성 대기" /></h1>
          <p className="text-xs text-gray-400"><T k="검사 완료 → 의사 소견 작성 필요" /> · 총 {allPending.length}<Unit>건</Unit></p>
        </div>
      </div>

      {/* 상태별 카운트 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <span className="text-lg">📝</span>
            <span className="text-3xl font-black">{reviews.length}</span>
          </div>
          <div className="text-[10px] font-medium opacity-80 mt-1"><T k="소견대기 (REVIEW)" /></div>
        </div>
        <div className="p-4 rounded-xl bg-gradient-to-br from-orange-500 to-red-400 text-white">
          <div className="flex items-center justify-between">
            <span className="text-lg">✅</span>
            <span className="text-3xl font-black">{examComplete.length}</span>
          </div>
          <div className="text-[10px] font-medium opacity-80 mt-1"><T k="검사완료 (소견 전)" /></div>
        </div>
        <div className="p-4 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 text-white">
          <div className="flex items-center justify-between">
            <span className="text-lg">⚠️</span>
            <span className="text-3xl font-black">{partial.length}</span>
          </div>
          <div className="text-[10px] font-medium opacity-80 mt-1"><T k="부분완료" /></div>
        </div>
      </div>

      {/* 대기 목록 */}
      {isLoading ? (
        <div className="py-10 text-center text-gray-400 text-sm animate-pulse"><T k="로딩 중..." /></div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : allPending.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-sm font-medium"><T k="소견 대기 중인 검진이 없습니다" /></p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50">
            {allPending.map((v: any) => {
              const items = (v.program?.items as any[]) ?? [];
              const resultCount = v._count?.items ?? 0;
              const isPartial = v.status === 'PARTIAL_COMPLETE';
              return (
                <Link key={v.id} href={`/his-checkup/visit/${v.id}`}
                  className="flex items-center px-4 py-3 hover:bg-violet-50/30 transition-colors gap-3 group">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center text-xs font-bold text-violet-700 flex-shrink-0">
                    {v.patient?.familyName}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{v.patient?.familyName}{v.patient?.givenName}</span>
                      <span className="text-[10px] text-gray-400">{genderText(v.patient?.gender)}/{age(v.patient?.dateOfBirth)} · {v.patient?.mrn}</span>
                      {isPartial && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[9px] font-bold whitespace-nowrap"><T k="부분완료" /></span>}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{v.program?.name} · {v.scheduledDate?.slice(0, 10)} · 결과 {resultCount}/{items.length}<Unit>건</Unit></div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${
                    v.status === 'REVIEW' ? 'bg-violet-100 text-violet-700' : v.status === 'PARTIAL_COMPLETE' ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    <T k={v.status === 'REVIEW' ? '소견 작성' : v.status === 'PARTIAL_COMPLETE' ? '부분 소견' : '검사완료'} />
                  </span>
                  <span className="text-gray-300 group-hover:text-violet-400 transition-colors">→</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
