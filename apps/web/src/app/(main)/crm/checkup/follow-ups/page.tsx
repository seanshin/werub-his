'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { KDate, PatientName, EmptyState, Unit } from '@/components/ui/display';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 이상 소견 추적 — 안내 스텁을 실 워크리스트로 보완(2026-08-04).
 * 서버는 이미 있었다: GET /api/v1/checkup/follow-ups(+complete) — 화면만 배선.
 * 축은 **지연 여부**(dueDate 경과·미완) — 추적은 기한을 넘긴 순간부터 일이 된다.
 */

interface FollowUpRow {
  id: string;
  followUpType: string;
  description: string;
  dueDate: string;
  reminderSent: boolean;
  completedAt: string | null;
  createdAt: string;
  patient?: { id: string; mrn: string; familyName: string; givenName: string; phone?: string | null };
}

const TYPE_LABEL: Record<string, string> = { RECHECK: '재검', OUTPATIENT: '외래 연계', SCREENING: '정밀검사' };

export default function CheckupFollowUpsPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [view, setView] = useState<'open' | 'done'>('open');

  const { data, isLoading } = useQuery({
    queryKey: ['checkup-follow-ups', view],
    queryFn: () => apiClient.get<{ data: FollowUpRow[] }>('/api/v1/checkup/follow-ups', { completed: view === 'done' ? 'true' : 'false' }),
  });
  const raw = data?.data;
  const rows: FollowUpRow[] = Array.isArray(raw) ? raw : (raw as unknown as { data?: FollowUpRow[] })?.data ?? [];

  const now = Date.now();
  const overdue = rows.filter((r) => !r.completedAt && new Date(r.dueDate).getTime() < now);
  const upcoming = rows.filter((r) => !r.completedAt && new Date(r.dueDate).getTime() >= now);
  const ordered = view === 'open' ? [...overdue, ...upcoming] : rows;

  const complete = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/checkup/follow-ups/${id}/complete`),
    onSuccess: () => {
      toast.success('추적 완료 처리되었습니다.');
      qc.invalidateQueries({ queryKey: ['checkup-follow-ups'] });
    },
    onError: () => toast.error('완료 처리에 실패했습니다.'),
  });

  const dday = (due: string) => Math.floor((now - new Date(due).getTime()) / 86_400_000);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="이상 소견 추적" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="검진 이상 소견의 재검·외래 연계 추적 — 기한 경과가 먼저 보입니다" /></p>
        </div>
        <Link href="/crm/checkup/targets" className="text-sm text-blue-600 font-medium hover:underline"><T k="검진 대상자 관리" /> →</Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {([['open', '추적 중'], ['done', '완료됨']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium ${view === k ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>
              <T k={label} />
            </button>
          ))}
        </div>
        {view === 'open' && (
          <p className="text-xs text-gray-500">
            <T k="기한 경과" /> <b className="text-rose-600">{overdue.length}</b>건 · <T k="예정" /> <b className="text-gray-700">{upcoming.length}</b>건
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-xs text-gray-500">
              <th className="text-left py-3 px-4 font-medium"><T k="환자" /></th>
              <th className="text-left py-3 px-4 font-medium"><T k="유형" /></th>
              <th className="text-left py-3 px-4 font-medium"><T k="내용" /></th>
              <th className="text-left py-3 px-4 font-medium whitespace-nowrap"><T k="추적 기한" /></th>
              <th className="text-left py-3 px-4 font-medium"><T k="알림" /></th>
              <th className="text-right py-3 px-4 font-medium"><T k={view === 'open' ? '작업' : '완료일'} /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm"><T k="불러오는 중…" /></td></tr>
            ) : ordered.length === 0 ? (
              <tr><td colSpan={6}><EmptyState icon="📋" title={view === 'open' ? '추적 중인 이상 소견이 없습니다' : '완료된 추적이 없습니다'} hint="검진 방문의 이상 소견에서 추적을 등록하면 여기에 모입니다" /></td></tr>
            ) : ordered.map((r) => {
              const late = !r.completedAt && dday(r.dueDate) > 0;
              return (
                <tr key={r.id} className={`hover:bg-gray-50/60 ${late ? 'bg-rose-50/40' : ''}`}>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {r.patient ? (
                      <Link href={`/patients/${r.patient.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        <PatientName familyName={r.patient.familyName} givenName={r.patient.givenName} mrn={r.patient.mrn} />
                      </Link>
                    ) : '-'}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                      <T k={TYPE_LABEL[r.followUpType] ?? r.followUpType} />
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-700 max-w-md truncate" title={r.description}>{r.description}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <KDate value={r.dueDate} mode="date" className="text-gray-600" />
                    {late && <span className="ml-1.5 text-[10px] font-bold text-rose-600">+{dday(r.dueDate)}<Unit>일</Unit> <T k="경과" /></span>}
                  </td>
                  <td className="py-3 px-4 text-xs">{r.reminderSent ? <span className="text-emerald-600"><T k="발송됨" /></span> : <span className="text-gray-300">-</span>}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {view === 'open' ? (
                      <button onClick={() => complete.mutate(r.id)} disabled={complete.isPending}
                        className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        <T k="완료 처리" />
                      </button>
                    ) : (
                      <KDate value={r.completedAt} mode="date" className="text-xs text-gray-500" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
