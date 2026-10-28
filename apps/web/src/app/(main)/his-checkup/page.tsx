'use client';

import { useState } from 'react';
import { ageOf } from '@hospital-run/shared';
import { Unit, genderText } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import Link from 'next/link';
import { pollMs, kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';
import { T } from '@/components/ui/i18n-text';

const STATUS_LABELS: Record<string, string> = {
  RESERVED: '예약', CHECKED_IN: '접수', IN_PROGRESS: '진행중',
  EXAM_COMPLETE: '검사완료', PARTIAL_COMPLETE: '부분완료', REVIEW: '소견대기',
  COMPLETED: '완료', DELIVERED: '전달', CANCELLED: '취소', NO_SHOW: '미방문',
};
const STATUS_COLORS: Record<string, string> = {
  RESERVED: 'bg-slate-100 text-slate-600', CHECKED_IN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700', EXAM_COMPLETE: 'bg-orange-100 text-orange-700',
  PARTIAL_COMPLETE: 'bg-yellow-100 text-yellow-700',
  REVIEW: 'bg-violet-100 text-violet-700', COMPLETED: 'bg-emerald-100 text-emerald-700',
  DELIVERED: 'bg-emerald-200 text-emerald-800',
  CANCELLED: 'bg-red-50 text-red-500', NO_SHOW: 'bg-gray-200 text-gray-500',
};


/**
 * 표시용 카탈로그 키 — 🔴 위 STATUS_LABELS(원문 정본)는 그대로 두고, **동음이의만** 문맥 키로 가른다.
 * 무문맥 '접수'는 nav 의 부서명(Reception)이고 '취소'는 버튼(Cancel)이라, 상태 배지에 그대로 쓰면
 * 뜻이 달라진다(교차 충돌 가드가 이미 A 오역으로 확정한 자리). 정본 문맥 키는 shared 에 있다.
 */
const STATUS_I18N: Record<string, string> = {
  RESERVED: '예약@상태', CHECKED_IN: '접수@상태', CANCELLED: '취소@상태',
};
/** 🔴 라벨 원문은 그대로 쓴다(카드 '검사중' ≠ 배지 '진행중' — 화면 문구를 바꾸지 않는다) */
const statusKey = (status: string, label: string) => STATUS_I18N[status] ?? label;

export default function CheckupDashboardPage() {
  const today = kstToday();
  const [statusFilter, setStatusFilter] = useState('');

  const { data: statsRes, isLoading: statsLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup', 'today-stats'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/visits/today-stats'),
    refetchInterval: pollMs('fast'),
  });
  const stats = statsRes?.data;

  const { data: visitsRes, isLoading: visitsLoading } = useQuery({
    queryKey: ['checkup', 'visits', today, statusFilter],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/visits', { date: today, ...(statusFilter && { status: statusFilter }), limit: '50' }),
  });
  const visits = visitsRes?.data ?? [];

  const { data: flowRes } = useQuery({
    queryKey: ['ck-flow-mini'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/ws/flow-board'),
    refetchInterval: pollMs('fast'),
  });
  const flowStations = flowRes?.data?.stations ?? [];

  const statCards = [
    { label: '예약', value: stats?.reserved ?? 0, status: 'RESERVED', icon: '📋', gradient: 'from-slate-500 to-slate-600' },
    { label: '접수', value: stats?.checkedIn ?? 0, status: 'CHECKED_IN', icon: '🏥', gradient: 'from-blue-500 to-blue-600' },
    { label: '검사중', value: stats?.inProgress ?? 0, status: 'IN_PROGRESS', icon: '🔬', gradient: 'from-amber-500 to-orange-500' },
    { label: '검사완료', value: stats?.examComplete ?? 0, status: 'EXAM_COMPLETE', icon: '✅', gradient: 'from-orange-500 to-red-400' },
    { label: '소견대기', value: stats?.review ?? 0, status: 'REVIEW', icon: '📝', gradient: 'from-violet-500 to-purple-600' },
    { label: '완료', value: stats?.completed ?? 0, status: 'COMPLETED', icon: '🎉', gradient: 'from-emerald-500 to-teal-600' },
  ];

  const age = (dob: string) => dob ? (ageOf(dob) ?? 0) : '-';
  const time = (iso: string) => iso ?kdate(iso, 'time') : '--:--';

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-lg shadow-blue-200">H</div>
          <div>
            <h1 className="text-xl font-bold text-gray-900"><T k="건강검진센터" /></h1>
            <p className="text-xs text-gray-400">{today} · <T k="오늘" /> {stats?.total ?? 0}<Unit>명</Unit> · <T k="15초 자동갱신" /></p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/his-checkup/reception" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-semibold shadow-sm shadow-blue-200 transition">
            <T k="검진 접수" />
          </Link>
          <Link href="/his-checkup/ws" className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-xs font-medium transition">
            <T k="검사실 허브" />
          </Link>
          <Link href="/his-checkup/flow-board" className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-xs font-medium transition">
            <T k="동선 현황판" />
          </Link>
        </div>
      </div>

      {/* ── 통계 카드 (클릭 필터) ── */}
      <div className="grid grid-cols-6 gap-2">
        {statCards.map((card) => {
          const active = statusFilter === card.status;
          return (
            <button key={card.status} onClick={() => setStatusFilter(active ? '' : card.status)}
              className={`relative overflow-hidden rounded-xl p-3 text-left transition-all ${
                active ? 'ring-2 ring-gray-900 shadow-lg scale-[1.02]' : 'hover:shadow-md hover:scale-[1.01]'
              }`}>
              <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-${active ? '100' : '90'}`} />
              <div className="relative text-white">
                <div className="flex items-center justify-between">
                  <span className="text-lg">{card.icon}</span>
                  <span className="text-2xl font-black tabular-nums">{statsLoading ? '-' : card.value}</span>
                </div>
                <div className="text-[10px] font-medium opacity-80 mt-1"><T k={statusKey(card.status, card.label)} /></div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 검사실 미니 현황 ── */}
      {flowStations.length > 0 && (
        <div className="bg-white rounded-xl border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700"><T k="검사실 현황" /></span>
            <Link href="/his-checkup/ws" className="text-[10px] text-blue-600 hover:underline"><T k="상세" /> →</Link>
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {flowStations.filter((s: any) => s.stationId !== 'ck-reception').map((s: any) => {
              const total = s.waiting + s.inProgress + s.completed;
              const hasQueue = s.waiting > 0 || s.inProgress > 0;
              return (
                <Link key={s.stationId} href={`/his-checkup/ws/${s.stationId.replace('ck-', '')}`}
                  className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] border transition ${
                    hasQueue ? 'bg-amber-50 border-amber-200 text-amber-800' : total > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-100 text-gray-400'
                  }`}>
                  <span className="mr-1">{s.icon}</span>
                  <span className="font-semibold">{s.waiting > 0 ? `${s.waiting}대기` : s.inProgress > 0 ? `${s.inProgress}진행` : total > 0 ? `${s.completed}완료` : '-'}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 퀵 액션 ── */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { href: '/his-checkup/schedule', icon: '📅', label: '예약 관리', badge: null },
          { href: '/his-checkup/review', icon: '📝', label: '소견 작성', badge: stats?.review ?? 0 },
          { href: '/his-checkup/follow-ups', icon: '🔔', label: '추적 관리', badge: null },
          { href: '/his-checkup/contracts', icon: '🏢', label: '단체 검진', badge: null },
          { href: '/his-checkup/stats', icon: '📊', label: '검진 통계', badge: null },
        ].map((a) => (
          <Link key={a.href} href={a.href}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-100 rounded-lg text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-200 transition">
            <span className="text-sm">{a.icon}</span>
            <span className="font-medium"><T k={a.label} /></span>
            {a.badge != null && a.badge > 0 && (
              <span className="ml-auto px-1.5 py-0.5 bg-violet-500 text-white text-[9px] rounded-full font-bold">{a.badge}</span>
            )}
          </Link>
        ))}
      </div>

      {/* ── 오늘 일정 테이블 ── */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-800"><T k="오늘 검진" /></h2>
            {statusFilter && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium"><T k={statusKey(statusFilter, STATUS_LABELS[statusFilter] ?? statusFilter)} /></span>
            )}
            <span className="text-[10px] text-gray-400">{visits.length}<Unit>건</Unit></span>
          </div>
          {statusFilter && (
            <button onClick={() => setStatusFilter('')} className="text-[10px] text-gray-400 hover:text-gray-600"><T k="전체 보기" /></button>
          )}
        </div>

        {visitsLoading ? (
          <div className="py-10 text-center text-gray-400 text-sm animate-pulse"><T k="로딩 중..." /></div>
        ) : visits.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            <p className="text-sm">{statusFilter ? `${STATUS_LABELS[statusFilter]} 상태의 예약이 없습니다` : <T k="오늘 예약이 없습니다" />}</p>
            <Link href="/his-checkup/schedule" className="inline-block mt-2 text-blue-600 text-xs hover:underline"><T k="예약 생성하기" /></Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visits.map((v: any) => {
              const programItems = Array.isArray(v.program?.items) ? v.program.items : [];
              const resultCount = v._count?.items ?? 0;
              const totalItems = programItems.length;
              const pct = totalItems > 0 ? Math.round((resultCount / totalItems) * 100) : 0;
              return (
                <Link key={v.id} href={`/his-checkup/visit/${v.id}`}
                  className="flex items-center px-4 py-2.5 hover:bg-blue-50/40 transition-colors gap-3 group">
                  {/* 시간 */}
                  <div className="w-12 text-center">
                    <span className="text-[11px] font-mono text-gray-400">{time(v.checkedInAt)}</span>
                  </div>
                  {/* 아바타 + 이름 */}
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
                    {v.patient?.familyName}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-gray-900 truncate">{v.patient?.familyName}{v.patient?.givenName}</span>
                      <span className="text-[10px] text-gray-400">{genderText(v.patient?.gender)}/{age(v.patient?.dateOfBirth)}</span>
                    </div>
                    <div className="text-[10px] text-gray-400">{v.program?.name} · {v.patient?.mrn}</div>
                  </div>
                  {/* 진행률 */}
                  <div className="w-20">
                    {totalItems > 0 && v.status !== 'RESERVED' ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[9px] text-gray-400 tabular-nums w-6 text-right">{pct}<Unit>%</Unit></span>
                      </div>
                    ) : <span className="text-[10px] text-gray-300">-</span>}
                  </div>
                  {/* 상태 */}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${STATUS_COLORS[v.status] ?? 'bg-gray-100'}`}>
                    <T k={statusKey(v.status, STATUS_LABELS[v.status] ?? v.status)} />
                  </span>
                  {/* 화살표 */}
                  <span className="text-gray-300 group-hover:text-blue-400 transition-colors text-xs">→</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
