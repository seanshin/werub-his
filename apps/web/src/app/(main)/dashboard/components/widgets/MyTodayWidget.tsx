'use client';
import { useQuery } from '@tanstack/react-query';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';

export default function MyTodayWidget() {
  const { user } = useAuthStore();
  // 🔴 종전 `.catch(() => [])` — 근태 조회 실패가 "미출근", 예약 조회 실패가 "0건"으로 둔갑했다(P17)
  const att = useQuery({ queryKey: ['ess-attendance'], queryFn: () => apiClient.get<{ data: Array<{ type: string; at: string }> }>('/api/v1/ess/attendance').then((r) => r.data) });
  /**
   * 🔴 **`doctorId=<나>` 는 진료를 보는 직군의 개념이다.**
   *    종전엔 전 직군이 이 줄을 봤고, 급양·의무기록·검사기사에게는 서버가 403 을 냈다 —
   *    화면은 정직하게 "조회 실패"(빨강)를 그렸지만, **애초에 그들에게 의미가 없는 줄**이었다.
   *    거짓 경보는 진짜 경보를 죽인다(매일 빨간 줄을 보면 아무도 안 본다).
   * 🔴 **EP 를 여는 것이 답이 아니다** — 남의 예약을 보여줄 이유가 없다.
   *    **묻지 않는 것**이 답이라, 진료 직군일 때만 부른다(§규약 5: 성격을 구분한다).
   */
  // 🔴 (2026-10-02) 관리자·간호사도 뺐다 — 예약은 의사(doctorId)에게 걸린다. 간호사·관리자는 `doctorId=<나>` 가 늘 "0건"이었다(없는 개념을 0 으로)
  const seesOwnAppointments = user?.role === 'DOCTOR';
  const appts = useQuery({
    queryKey: ['wt-appts', user?.id],
    // 🔴 date=today 는 DateQueryPipe 가 400 으로 거른다(서버 특례 도달 불가) — 실날짜(KST)
    queryFn: () => apiClient.get<{ data: unknown }>(`/api/v1/appointments?date=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}&doctorId=${user?.id}&limit=50`).then((r) => { const d = r.data as { data?: unknown[] }; return Array.isArray(d) ? d : (d?.data ?? []); }),
    enabled: !!user?.id && seesOwnAppointments,
  });
  const today = (att.data ?? []).find((a) => a.type === 'CLOCK_IN' && new Date(a.at).toDateString() === new Date().toDateString());
  const apptCount = (appts.data ?? []).length;
  return (
    <div className="flex flex-col h-full">
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-gray-500"><T k="근무" /></span><span className={att.isError ? 'text-red-600' : today ? 'text-emerald-600' : 'text-gray-400'}>{att.isError ? <T k="조회 실패" /> : today ? <><T k="출근" /> {kdate(today.at, 'time')}</> : <T k="미출근" />}</span></div>
        {/* 🔴 진료 직군이 아니면 이 줄을 아예 그리지 않는다 — 없는 개념을 "0건"으로도 "조회 실패"로도 말하지 않는다 */}
        {seesOwnAppointments && (
          <div className="flex justify-between"><span className="text-gray-500"><T k="오늘 내 예약" /></span><span className={`font-semibold ${appts.isError ? 'text-red-600' : 'text-gray-800'}`}>{appts.isError ? <T k="조회 실패" /> : <>{apptCount}<Unit><T k="건" /></Unit></>}</span></div>
        )}
      </div>
      <div className="mt-auto pt-2 flex gap-3 text-[11px]">
        <Link href="/staff/dashboard" className="text-blue-600 hover:underline"><T k="오늘 진료" /></Link>
        <Link href="/staff/ess" className="text-blue-600 hover:underline"><T k="내 행정" /></Link>
      </div>
    </div>
  );
}
