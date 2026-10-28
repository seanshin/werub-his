'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import Link from 'next/link';
import { kstToday, kstTodayPlus } from '@/lib/kst-today';
import { T } from '@/components/ui/i18n-text';
import { useCanManageCheckupVisit } from '../checkup-access';

export default function CheckupFollowUpsPage() {
  // 🔴 추적관리 완료는 검진 데스크 권한(정본 `checkup-access`)
  const canManage = useCanManageCheckupVisit();
  const queryClient = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);

  const today = kstToday();
  const nextMonth = kstTodayPlus(30);

  const { data: followUpsRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup-follow-ups', showCompleted],
    queryFn: () =>
      apiClient.get<any>('/api/v1/checkup/follow-ups', {
        completed: showCompleted ? 'true' : 'false',
        dueTo: showCompleted ? undefined : nextMonth,
      }),
  });
  const followUps = followUpsRes?.data ?? [];

  const complete = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/api/v1/checkup/follow-ups/${id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-follow-ups'] });
      toast.success('추적 완료 처리');
    },
  });

  const overdue = followUps.filter((f: any) => !f.completedAt && f.dueDate < today);
  const upcoming = followUps.filter((f: any) => !f.completedAt && f.dueDate >= today);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold"><T k="추적 관리" /></h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCompleted(false)}
            className={`px-3 py-1.5 rounded-lg text-sm ${!showCompleted ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}
          >
            <T k="미완료" />
          </button>
          <button
            onClick={() => setShowCompleted(true)}
            className={`px-3 py-1.5 rounded-lg text-sm ${showCompleted ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}
          >
            <T k="완료" />
          </button>
        </div>
      </div>

      {/* 기한 초과 */}
      {!showCompleted && overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-700 mb-2"><T k="기한 초과" /> ({overdue.length}<Unit>건</Unit>)</h3>
          <div className="space-y-2">
            {overdue.map((f: any) => (
              <FollowUpRow key={f.id} item={f} onComplete={() => complete.mutate(f.id)} isOverdue />
            ))}
          </div>
        </div>
      )}

      {/* 목록 */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : (
        <div className="bg-white border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left"><T k="환자" /></th>
                <th className="px-4 py-2 text-left"><T k="내용" /></th>
                <th className="px-4 py-2 text-center"><T k="유형" /></th>
                <th className="px-4 py-2 text-center"><T k="예정일" /></th>
                <th className="px-4 py-2 text-left"><T k="검진" /></th>
                <th className="px-4 py-2 text-center"><T k="관리" /></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(showCompleted ? followUps : upcoming).map((f: any) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.patient?.familyName}{f.patient?.givenName}</div>
                    <div className="text-xs text-gray-400">{f.patient?.mrn}</div>
                  </td>
                  <td className="px-4 py-3">{f.description}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 whitespace-nowrap">
                      <T k={f.followUpType === 'RECHECK' ? '재검' : f.followUpType === 'OUTPATIENT' ? '외래' : '검진'} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono">{f.dueDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {f.visit?.program?.name} ({f.visit?.scheduledDate?.slice(0, 10)})
                  </td>
                  <td className="px-4 py-3 text-center">
                    {f.completedAt ? (
                      <span className="text-green-600 text-xs"><T k="완료" /></span>
                    ) : !canManage ? (
                      <span className="text-gray-400 text-xs"><T k="미완료" /></span>
                    ) : (
                      <button
                        onClick={() => complete.mutate(f.id)}
                        className="px-2 py-1 bg-green-50 text-green-600 rounded text-xs hover:bg-green-100"
                      >
                        <T k="완료@버튼" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {followUps.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    <T k={showCompleted ? '완료된 항목 없음' : '추적 대상 없음'} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FollowUpRow({ item, onComplete, isOverdue }: { item: any; onComplete: () => void; isOverdue?: boolean }) {
  return (
    <div className="flex items-center justify-between bg-white rounded p-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="font-medium">{item.patient?.familyName}{item.patient?.givenName}</span>
        <span className="text-gray-500">{item.description}</span>
        <span className="text-xs text-gray-400 font-mono">{item.dueDate?.slice(0, 10)}</span>
        {item.patient?.phone && <span className="text-xs text-gray-400">{item.patient.phone}</span>}
      </div>
      <button onClick={onComplete} className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">
        <T k="완료@버튼" />
      </button>
    </div>
  );
}
