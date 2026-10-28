'use client';

import { ReactNode } from 'react';
import { ageOf } from '@hospital-run/shared';
import { Unit, Duration, genderText } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import Link from 'next/link';
import { pollMs } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

interface StationLayoutProps {
  stationId: string;
  children: ReactNode;
}

export function StationLayout({ stationId, children }: StationLayoutProps) {
  const { data: queueRes, isLoading } = useQuery({
    queryKey: ['ck-ws-queue', stationId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/ws/stations/${stationId}/queue`),
    refetchInterval: 8000,
  });
  const queueData = queueRes?.data;
  const station = queueData?.station;
  const queue = queueData?.queue ?? [];

  const { data: statsRes } = useQuery({
    queryKey: ['ck-ws-stats', stationId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/ws/stations/${stationId}/stats`),
    refetchInterval: pollMs('normal'),
  });
  const stats = statsRes?.data;

  const age = (dob: string) => dob ? (ageOf(dob) ?? 0) : null;

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/his-checkup/ws" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition">←</Link>
          <span className="text-2xl">{station?.icon ?? '🏥'}</span>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{station?.name ?? stationId}</h1>
            <p className="text-[10px] text-gray-400">{station?.location && `${station.location} · `}<T k="대기" /> {queue.length}<Unit>명</Unit> · 8초 갱신</p>
          </div>
        </div>
        <Link href="/his-checkup/flow-board" className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-[10px] hover:bg-gray-200 transition"><T k="동선판" /></Link>
      </div>

      {/* 메인 */}
      <div className="grid grid-cols-12 gap-3">
        {/* 좌 — 대기 큐 */}
        <div className="col-span-4">
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700"><T k="대기" /> ({queue.length})</span>
              {stats && <span className="text-[9px] text-gray-400"><T k="오늘" /> {stats.totalProcessed}<Unit>건</Unit></span>}
            </div>
            {isLoading ? (
              <div className="py-8 text-center text-gray-400 text-xs animate-pulse"><T k="로딩..." /></div>
            ) : queue.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                <div className="text-xl mb-1">{station?.icon ?? '🏥'}</div>
                <p className="text-[10px]"><T k="대기 없음" /></p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[calc(100vh-260px)] overflow-y-auto">
                {queue.map((q: any, idx: number) => (
                  <div key={q.visitId}
                    className={`px-3 py-2.5 cursor-pointer hover:bg-blue-50/50 transition ${idx === 0 ? 'bg-blue-50/30 border-l-2 border-blue-500' : ''}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-blue-100 text-blue-700 text-[9px] font-bold flex items-center justify-center">{idx + 1}</span>
                        <span className="text-xs font-semibold text-gray-900">{q.patient?.familyName}{q.patient?.givenName}</span>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        q.stationStatus === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' : q.stationStatus === 'ARRIVED' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                      }`}><T k={q.stationStatus === 'IN_PROGRESS' ? '검사중' : q.stationStatus === 'ARRIVED' ? '도착' : '대기'} /></span>
                    </div>
                    <div className="text-[9px] text-gray-400">{genderText(q.patient?.gender)}/{age(q.patient?.dateOfBirth)} · {q.patient?.mrn} · {q.program?.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 우 — 입력 폼 */}
        <div className="col-span-8">{children}</div>
      </div>

      {/* 하단 통계 */}
      {stats && (
        <div className="bg-white border rounded-xl px-4 py-2.5 flex items-center gap-5 text-xs text-gray-500">
          <span><T k="오늘" /> <strong className="text-gray-900">{stats.totalProcessed}<Unit>건</Unit></strong></span>
          <span><T k="평균" /> <strong className="text-gray-900"><Duration minutes={stats.avgMinutes} /></strong></span>
          {stats.abnormalCount > 0 && <span><T k="이상" /> <strong className="text-amber-600">{stats.abnormalCount}<Unit>건</Unit></strong></span>}
          {stats.criticalCount > 0 && <span><T k="위급" /> <strong className="text-red-600">{stats.criticalCount}<Unit>건</Unit></strong></span>}
        </div>
      )}
    </div>
  );
}
