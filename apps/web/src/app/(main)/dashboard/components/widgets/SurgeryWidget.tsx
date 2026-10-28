'use client';

import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState } from '@/components/ui/display';
import { kstToday, kstTodayPlus, kstDateOf } from '@/lib/kst-today';

/**
 * 🔴 (2026-10-02) 서버 정본은 `scheduledAt`(시각)·`surgeonId`·`orRoom.name` 이다. 종전 위젯은 `scheduledDate`·`date`·
 *    `scheduledTime`·`startTime` 을 읽었는데 **그런 키는 응답에 없어** 날짜가 늘 빈 값 → **개통 이래 "오늘 수술 일정이 없습니다"**였다.
 *    날짜는 KST 로 가른다(`slice(0,10)` 은 UTC 날짜라 오전 9시 전 수술이 전날로 떨어진다).
 */
interface SurgeryItem {
  id: string;
  scheduledAt?: string;
  surgeonId?: string;
  patient?: { familyName: string; givenName: string; mrn?: string };
  procedureName?: string;
  orRoom?: { name?: string } | null;
  status?: string;
}

export default function SurgeryWidget({ settings }: { settings?: Record<string, unknown> }) {
  const { user } = useAuthStore();
  const filterMine = (settings?.filterMine as boolean) ?? true;

  // 🔴 종전 `.catch(() => ({ data: [] }))` — 조회 실패가 "오늘 수술 일정이 없습니다"로 둔갑했다(P17)
  const { data, isError } = useQuery({
    queryKey: ['doctor-surgery-schedule'],
    // 전날~다음날(서버 날짜 경계는 UTC 라 하루씩 넓혀 받고, 오늘 여부는 화면이 KST 로 가른다)
    queryFn: () => apiClient.get<{ data: SurgeryItem[] }>(`/api/v1/surgery/schedule?dateFrom=${kstTodayPlus(-1)}&dateTo=${kstTodayPlus(1)}`),
    refetchInterval: pollMs('normal'),
  });

  const allSurgeries: SurgeryItem[] = Array.isArray(data?.data) ? data.data : [];
  const today = kstToday();
  const todaySurgeries = allSurgeries.filter((s) => {
    if (kstDateOf(s.scheduledAt) !== today) return false;
    if (!filterMine) return true;
    return s.surgeonId === user?.id;
  });

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
        </div>
        <Link href="/surgery" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="수술 관리" /> →</Link>
      </div>
      {isError ? (
        <p className="text-xs text-red-600 py-2 text-center"><T k="수술 일정 조회 실패 — ‘없음’이 아니라" /> <b><T k="확인 불가" /></b></p>
      ) : todaySurgeries.length === 0 ? (
        <EmptyState compact icon="📅" title={filterMine ? '오늘 집도할 수술이 없습니다' : '오늘 수술 일정이 없습니다'} />
      ) : (
        <div className="divide-y divide-gray-50">
          {todaySurgeries.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-1.5 px-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-rose-700">{s.scheduledAt ? kdate(s.scheduledAt, 'time') : '-'}</span>
                <span className="text-xs font-medium text-gray-900">{s.patient?.familyName}{s.patient?.givenName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500">{s.procedureName ?? ''}{s.orRoom?.name ? ` · ${s.orRoom.name}` : ''}</span>
                <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${
                  s.status === 'IN_PROGRESS' ? 'bg-red-100 text-red-700' :
                  s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  <T k={s.status === 'IN_PROGRESS' ? '진행중' : s.status === 'COMPLETED' ? '완료' : '예정'} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
