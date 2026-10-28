'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-yellow-100 text-yellow-700',
  C1: 'bg-orange-100 text-orange-700',
  C2: 'bg-red-100 text-red-700',
  D1: 'bg-red-200 text-red-800',
  D2: 'bg-blue-100 text-blue-700',
};

const GRADE_LABELS: Record<string, string> = {
  A: '정상',
  B: '경미한 이상',
  C1: '요관찰',
  C2: '요치료',
  D1: '정밀검사',
  D2: '치료중',
};

export function CheckupHistoryTab({ patientId }: { patientId: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: historyRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup-history', patientId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/patient/${patientId}/history`),
  });
  const visits = historyRes?.data ?? [];

  if (isLoading) {
    return <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>;
  }

  // 🔴 조회 실패를 "건강검진 이력이 없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02)
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;

  if (visits.length === 0) {
    return (
      <div className="py-12 text-center text-gray-400">
        <p><T k="건강검진 이력이 없습니다" /></p>
        <Link
          href="/his-checkup/schedule"
          className="mt-3 inline-block text-blue-600 hover:underline text-sm"
        >
          <T k="검진 예약하기" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold"><T k="검진 이력" /></h3>

      {/* 이력 테이블 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left"><T k="검진일" /></th>
              <th className="px-4 py-2 text-left"><T k="프로그램" /></th>
              <th className="px-4 py-2 text-center"><T k="등급" /></th>
              <th className="px-4 py-2 text-center"><T k="항목" /></th>
              <th className="px-4 py-2 text-center"><T k="관리" /></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visits.map((v: any) => (
              <>
                <tr
                  key={v.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                >
                  <td className="px-4 py-3 font-mono">
                    {v.scheduledDate?.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{v.program?.name}</div>
                    <div className="text-xs text-gray-400">{v.program?.code}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {v.summary?.overallGrade ? (
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold whitespace-nowrap ${
                          GRADE_COLORS[v.summary.overallGrade] ?? 'bg-gray-100'
                        }`}
                      >
                        {v.summary.overallGrade}
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">
                    {v._count?.items ?? 0}건
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Link
                      href={`/checkup/visit/${v.id}`}
                      className="text-blue-600 hover:underline text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <T k="상세" />
                    </Link>
                  </td>
                </tr>

                {/* 확장: 영역별 판정 */}
                {expandedId === v.id && v.summary && (
                  <tr key={`${v.id}-detail`}>
                    <td colSpan={5} className="px-4 py-3 bg-gray-50">
                      <div className="space-y-3">
                        {/* 영역별 판정 */}
                        <div className="grid grid-cols-4 gap-2">
                          {(v.summary.sections as any[])?.map(
                            (sec: any, idx: number) => (
                              <div
                                key={idx}
                                className={`p-2 rounded text-xs ${
                                  GRADE_COLORS[sec.grade] ?? 'bg-gray-50'
                                }`}
                              >
                                <div className="font-medium">{sec.area}</div>
                                <div className="flex justify-between mt-0.5">
                                  <span className="font-bold">{sec.grade}</span>
                                  <span className="truncate ml-1 opacity-70">
                                    {sec.findings}
                                  </span>
                                </div>
                              </div>
                            ),
                          )}
                        </div>

                        {/* 의사 소견 요약 */}
                        {v.summary.doctorOpinion && (
                          <div className="text-sm text-gray-600 bg-white p-3 rounded border">
                            <span className="font-medium text-gray-700"><T k="소견:" /> </span>
                            {v.summary.doctorOpinion}
                          </div>
                        )}

                        {/* 추적/의뢰 */}
                        <div className="flex gap-4 text-xs text-gray-400">
                          {v._count?.referrals > 0 && (
                            <span>의뢰 {v._count.referrals}<Unit>건</Unit></span>
                          )}
                          {v._count?.followUps > 0 && (
                            <span>추적 {v._count.followUps}<Unit>건</Unit></span>
                          )}
                          {v.summary.signedAt && (
                            <span>
                              서명:{' '}
                              {new Date(v.summary.signedAt).toLocaleDateString(
                                'ko-KR',
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
