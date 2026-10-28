'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { Ratio, Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface QuestionnaireDepartmentStat {
  formName: string;
  completed: number;
  sent: number;
  rate: number;
}

interface QuestionnaireStats {
  total: { sent?: number; completed?: number; pending?: number; expired?: number };
  completionRate?: number;
  byDepartment?: QuestionnaireDepartmentStat[];
}

interface PendingQuestionnaire {
  id: string;
  status: string;
  expiresAt: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  formSchema?: { name?: string };
}

export default function QuestionnaireDashboardPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();

  const { data: statsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['q-dashboard-stats'],
    queryFn: () => apiClient.get<{ data: QuestionnaireStats | { data: QuestionnaireStats } }>('/api/v1/admin/questionnaire/stats'),
    refetchInterval: pollMs('normal'),
  });
  const { data: pendingData } = useQuery({
    queryKey: ['q-dashboard-pending'],
    queryFn: () => apiClient.get<{ data: PendingQuestionnaire[] | { data: PendingQuestionnaire[] } }>('/api/v1/admin/questionnaire/pending'),
    refetchInterval: pollMs('normal'),
  });

  const stats: QuestionnaireStats | null = statsData?.data
    ? ((statsData.data as { data: QuestionnaireStats })?.data ?? statsData.data) as QuestionnaireStats
    : null;
  const pendingRaw = pendingData?.data;
  const pending: PendingQuestionnaire[] = Array.isArray(pendingRaw) ? pendingRaw : (pendingRaw as { data: PendingQuestionnaire[] })?.data ?? [];
  const total = stats?.total ?? {};

  // 🔴 '재발송'은 종전에 아무 데도 보내지 않고 상태만 'SENT' 로 바꿨다(2026-08-14 W8·P16).
  //    지금은 서버가 실제 발송을 시도하고 결과를 돌려준다 — 화면은 그 결과를 그대로 말한다.
  const resendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: { delivery?: string; message?: string } }>(`/api/v1/admin/questionnaire/resend/${id}`),
    onSuccess: (res) => {
      const d = res.data;
      if (d?.delivery === 'SENT') toast.success(d.message ?? tAttr('재발송했습니다.'));
      else toast.error(d?.message ?? tAttr('재발송되지 않았습니다.'));
      qc.invalidateQueries({ queryKey: ['q-dashboard-pending'] });
      qc.invalidateQueries({ queryKey: ['q-dashboard-stats'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tAttr('재발송 처리에 실패했습니다.')),
  });

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      SENT: { label: '발송됨', cls: 'bg-blue-100 text-blue-700' },
      OPENED: { label: '열람', cls: 'bg-indigo-100 text-indigo-700' },
      IN_PROGRESS: { label: '작성중', cls: 'bg-yellow-100 text-yellow-700' },
      COMPLETED: { label: '완료', cls: 'bg-green-100 text-green-700' },
      EXPIRED: { label: '만료', cls: 'bg-red-100 text-red-700' },
    };
    const m = map[s] ?? { label: s, cls: 'bg-gray-100 text-gray-600' };
    return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}><T k={m.label} /></span>;
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400"><T k="로딩 중..." /></div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-6xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-900"><T k="문진표 대시보드" /></h2>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: '총 발송', value: total.sent ?? 0, icon: '📨', color: 'border-blue-200' },
          { label: '작성 완료', value: total.completed ?? 0, icon: '✅', color: 'border-green-200' },
          { label: '미작성', value: total.pending ?? 0, icon: '⏳', color: 'border-yellow-200' },
          { label: '만료', value: total.expired ?? 0, icon: '❌', color: 'border-red-200' },
          // 🔴 발송 0건이면 작성률은 0%(=아무도 안 썼다)가 아니라 산출 불가다 — 분모와 함께 낸다(§3.3)
          { label: '작성률', value: <Ratio numerator={total.completed} denominator={total.sent} unavailableHint="발송 0건" />, icon: '📊', color: 'border-purple-200' },
        ].map((c: { label: string; value: React.ReactNode; icon: string; color: string }) => (
          <div key={c.label} className={`flex flex-col justify-center bg-white rounded-xl border-2 ${c.color} p-4`}>
            <div className="flex items-center gap-2 mb-1">
              <span>{c.icon}</span>
              <span className="text-xs text-gray-500"><T k={c.label} /></span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{c.value}</p>
          </div>
        ))}
      </div>

      {/* 양식별 작성률 */}
      {stats?.byDepartment && stats.byDepartment.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="양식별 작성률" /></h3>
          <div className="space-y-2">
            {stats.byDepartment.map((d: QuestionnaireDepartmentStat, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 w-40 truncate">{d.formName}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${d.rate}%` }} />
                </div>
                {/* 🔴 손으로 쓴 `n/N (p%)` 는 분모 0 을 못 잡는다 — 정본 `<Ratio>` 가 같은 모양을 내면서 판정도 한다 */}
                <Ratio numerator={d.completed} denominator={d.sent} className="text-xs text-gray-500 w-24 text-right" unavailableHint="발송 0건" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 미작성 목록 */}
      <div className="bg-white rounded-xl border">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900"><T k="미작성 문진표" /> ({pending.length}<Unit>건</Unit>)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left"><T k="환자" /></th>
                <th className="px-4 py-2 text-left">MRN</th>
                <th className="px-4 py-2 text-left"><T k="양식" /></th>
                <th className="px-4 py-2 text-left"><T k="상태" /></th>
                <th className="px-4 py-2 text-left"><T k="만료" /></th>
                <th className="px-4 py-2 text-left"><T k="관리" /></th>
              </tr>
            </thead>
            <tbody>
              {!pending.length ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="미작성 문진표가 없습니다." /></td></tr>
              ) : pending.map((p: PendingQuestionnaire) => {
                const expiry = new Date(p.expiresAt);
                const hoursLeft = Math.max(0, Math.round((expiry.getTime() - Date.now()) / 3600000));
                return (
                  <tr key={p.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{p.patient?.familyName}{p.patient?.givenName}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{p.patient?.mrn}</td>
                    <td className="px-4 py-2">{p.formSchema?.name}</td>
                    <td className="px-4 py-2">{statusBadge(p.status)}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {hoursLeft > 0 ? `${hoursLeft}시간 남음` : <span className="text-red-500"><T k="만료" /></span>}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => resendMutation.mutate(p.id)}
                        disabled={resendMutation.isPending}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                        <T k="재발송" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
