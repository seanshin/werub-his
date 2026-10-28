'use client';
import { T, Tf, Data } from '@/components/ui/i18n-text';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { Unit, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

/**
 * 오늘 회진 현황 — **담당의별 전체**.
 *
 * 🔴 2026-08-26 사람 신고: "의료진마다 회진 스케줄이 전체적으로 다 표시되어야 하지 않나?"
 *    종전 이 화면은 `GET /doctors/rounds/today`(= **내 것만**)뿐이라, 병동에서
 *    "오늘 회진이 어디까지 돌았나"를 볼 수 없었다.
 *
 * 🔴 **담당의 미지정 묶음을 맨 위에 둔다** — 아무도 회진 대상으로 보지 않는 환자가 가장 위험하다.
 * 🔴 **비율에는 분모를 함께** 낸다.
 */
type RoundPatient = {
  admissionId: string; patientId: string; name: string; mrn: string;
  ward: string | null; bed: string | null; roundedAt: string | null;
};
type DoctorGroup = {
  doctorId: string | null; doctorName: string | null; department: string | null;
  total: number; rounded: number; patients: RoundPatient[];
};
type AllRounds = { asOf: string; total: number; rounded: number; unassigned: number; doctors: DoctorGroup[] };

export function AllRoundsBoard() {
  // 🔴 `queryFn` 안에서 실패를 기본값으로 접지 않는다 — 접으면 "회진 대상 없음"이 된다
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rounds-today-all'],
    queryFn: () => apiClient.get<{ data: AllRounds }>('/api/v1/doctors/rounds/today/all'),
    staleTime: 30_000,
  });
  const res = (data?.data as AllRounds | undefined);

  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;
  if (isLoading) return <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />;
  if (!res) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-bold text-gray-900"><T k="전체 회진 현황" /></h2>
        <span className="text-[11px] text-gray-500">
          <Tf k="재원 {재원} 중 회진 {회진}" params={{ 재원: <>{res.total}<Unit>명</Unit></>, 회진: <>{res.rounded}<Unit>명</Unit></> }} />
        </span>
        {/* 🔴 담당의 미지정은 숨기지 않는다 */}
        {res.unassigned > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 border border-rose-200">
            <Tf k="담당의 미지정 {수}" params={{ 수: <>{res.unassigned}<Unit>명</Unit></> }} />
          </span>
        )}
      </div>

      {res.doctors.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-400"><T k="재원 환자가 없습니다." /></p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {res.doctors.map((g) => {
            const remaining = g.total - g.rounded;
            const pct = g.total > 0 ? Math.round((g.rounded / g.total) * 100) : null;
            const unassigned = !g.doctorId;
            return (
              <div
                key={g.doctorId ?? 'UNASSIGNED'}
                className={`rounded-2xl border p-4 ${unassigned ? 'border-rose-200 bg-rose-50/40' : 'border-gray-100 bg-white shadow-sm'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">
                      {/* 🔴 담당의 이름은 서버 데이터 */}
                      {unassigned ? <T k="담당의 미지정" /> : <Data>{g.doctorName}</Data>}
                    </p>
                    {g.department && <p className="text-[11px] text-gray-400">{g.department}</p>}
                  </div>
                  {/* 🔴 분모 병기 — 분모가 0이면 비율은 '산출 불가'다 */}
                  <span className="shrink-0 text-xs font-mono text-gray-600">
                    {g.rounded}/{g.total}
                    {pct != null && <span className="ml-1 text-gray-400">{pct}%</span>}
                  </span>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${remaining === 0 ? 'bg-green-500' : unassigned ? 'bg-rose-400' : 'bg-blue-500'}`}
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>

                <ul className="mt-2.5 space-y-1">
                  {g.patients.slice(0, 6).map((p) => (
                    <li key={p.admissionId}>
                      <Link
                        href={`/inpatient/${p.admissionId}`}
                        className="flex items-baseline gap-1.5 rounded-lg px-1.5 py-1 text-[12px] hover:bg-gray-50"
                      >
                        <span className={p.roundedAt ? 'text-gray-400' : 'font-medium text-gray-900'}>
                          {p.roundedAt ? '✓' : '·'} {p.name}
                        </span>
                        <span className="truncate text-[11px] text-gray-400">
                          {p.ward ?? ''} {p.bed ?? ''}
                        </span>
                        {p.roundedAt && (
                          <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                            <KDate value={p.roundedAt} mode="time" />
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
                {/* 🔴 자르면 잘랐다고 말한다 */}
                {g.patients.length > 6 && (
                  <p className="mt-1 px-1.5 text-[11px] text-gray-400">외 {g.patients.length - 6}명</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
