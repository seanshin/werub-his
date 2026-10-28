'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

const TRIGGER_LABEL: Record<string, string> = {
  SCHEDULE: '스케줄', EVENT: '이벤트', MANUAL: '수동', WEBHOOK: '웹훅',
};

interface BotItem {
  id: string;
  name: string;
  triggerType: string;
  runCount?: number;
  lastRunAt?: string;
  status: string;
}

export default function BotsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['bots'],
    queryFn: () => apiClient.get<{ data: BotItem[]; meta?: { actionEngine?: { wired?: boolean; note?: string } } }>('/api/v1/bots'),
  });
  const toggle = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/bots/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
  const actionEngine = data?.meta?.actionEngine;
  const _botsRaw = data?.data;
  const botsList: BotItem[] = Array.isArray(_botsRaw) ? _botsRaw : (_botsRaw as unknown as Record<string, unknown>)?.data as BotItem[] ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="Bots (자동화)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="업무 자동화 봇 관리 및 트리거 이력" /></p>
      </div>

      {/* 🔴 액션 엔진이 없다는 사실을 목록 위에 먼저 말한다 — 없으면 '실행 횟수'가 수행 횟수로 읽힌다 */}
      {actionEngine?.wired === false && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-900">
          <b>{actionEngine.note ?? <T k="액션 엔진이 배선되어 있지 않습니다." />}</b> <T k="아래 '트리거 횟수'는 봇이 실제로 무엇을 수행한 횟수가 아닙니다." />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="봇 이름" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="트리거" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="트리거 횟수" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="마지막 트리거" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !botsList.length ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
                  </svg>
                  <p className="text-sm text-gray-400"><T k="등록된 봇이 없습니다" /></p>
                </td>
              </tr>
            ) : (
              botsList.map((b: BotItem) => (
                <tr key={b.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="px-5 py-4 font-medium text-gray-900">{b.name}</td>
                  <td className="px-5 py-4 text-gray-600 text-xs"><T k={TRIGGER_LABEL[b.triggerType] ?? b.triggerType} /></td>
                  <td className="px-5 py-4 text-gray-500">{b.runCount ?? 0}<Unit>회</Unit></td>
                  <td className="px-5 py-4 text-gray-500 text-xs">{b.lastRunAt ? kdate(new Date(b.lastRunAt), 'datetime') : '-'}</td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => toggle.mutate(b.id)}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                        b.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <T k={b.status === 'ACTIVE' ? '활성' : '비활성'} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
