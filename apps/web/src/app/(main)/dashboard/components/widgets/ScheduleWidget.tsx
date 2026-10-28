'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { pollMs } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

/**
 * 오늘 진료표 — `GET /clinic-schedule/today`(전 의사의 오늘 진료 시간표) 중 내 것.
 * 🔴 (2026-10-02 실측) 서버는 종일 진료를 `period: 'ALL'` 로, 진료실을 `roomName` 으로 준다. 종전 위젯은 AM/PM 만 보고
 *    `clinicRoom.name` 만 읽어 **종일 진료 의사에게 "오전 없음 · 오후 없음"**, 진료실 표시는 늘 빈칸이었다.
 *    또 시각이 없으면 `09:00`·`12:30` 같은 값을 지어 넣었다 → 서버 값만, 없으면 "시각 미기록".
 *    조회 실패를 "오늘 진료 없음"으로 그렸다 → 실패는 실패로.
 */
interface ClinicScheduleItem {
  doctorId?: string;
  period?: string;
  startTime?: string | null;
  endTime?: string | null;
  roomName?: string | null;
  departmentName?: string | null;
  waitingCount?: number;
}

const PERIOD_LABEL: Record<string, string> = { AM: '오전', PM: '오후', ALL: '종일' };
const PERIOD_ORDER: Record<string, number> = { ALL: 0, AM: 1, PM: 2 };

export default function ScheduleWidget() {
  const { user } = useAuthStore();
  const { data, isError, isLoading } = useQuery({
    queryKey: ['clinic-schedule-today-role'],
    queryFn: () => apiClient.get<{ data: ClinicScheduleItem[] }>('/api/v1/clinic-schedule/today'),
    refetchInterval: pollMs('slow'),
  });
  const raw = data?.data as unknown;
  const all: ClinicScheduleItem[] = Array.isArray(raw) ? raw : ((raw as { data?: ClinicScheduleItem[] })?.data ?? []);
  const mine = all.filter((s) => s.doctorId === user?.id).sort((a, b) => (PERIOD_ORDER[a.period ?? ''] ?? 9) - (PERIOD_ORDER[b.period ?? ''] ?? 9));

  if (isError) return <p className="py-2 text-center text-xs text-red-600"><T k="진료표 조회 실패 — 확인 필요" /></p>;
  if (isLoading) return <p className="py-2 text-center text-xs text-gray-400">…</p>;
  if (mine.length === 0) return <p className="py-2 text-center text-xs text-gray-400"><T k="오늘 진료 없음" /></p>;

  return (
    <div className="space-y-1.5" data-schedule-mine={mine.length}>
      {mine.map((s, i) => (
        <div key={`${s.period}-${i}`} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            <span className="font-medium text-gray-900"><T k={PERIOD_LABEL[s.period ?? ''] ?? s.period ?? '-'} /></span>
            <span className="text-gray-500">{s.startTime && s.endTime ? `${s.startTime} ~ ${s.endTime}` : <T k="시각 미기록" />}</span>
          </span>
          {s.roomName && <span className="truncate rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">{s.roomName}</span>}
        </div>
      ))}
    </div>
  );
}
