'use client';

import { useCallback, useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

interface Performance {
  campaigns: { id: string; name: string; type: string; channel: string; sentCount: number; deliveredCount: number; openedCount: number; clickedCount: number; conversionCount: number; abVariantName: string | null; completedAt: string }[];
  totals: { sent: number; delivered: number; opened: number; clicked: number; conversions: number };
  avgOpenRate: number;
  avgClickRate: number;
}

interface Cohort {
  month: string;
  total: number;
  retained: number;
  rate: number;
}

interface SendTimeRec {
  recommendedHour: number;
  reason: string;
  hourlyStats: { hour: number; openRate: number; count: number }[];
}

const TYPE_LABEL: Record<string, string> = {
  REMINDER: '리마인더', RECALL: '리콜', PROMOTION: '프로모션',
  FOLLOW_UP: '후속', REENGAGEMENT: '재활성화', SURVEY: '설문', ANNOUNCEMENT: '공지',
};

export default function CrmAnalyticsPage() {
  const [perf, setPerf] = useState<Performance | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [sendTime, setSendTime] = useState<SendTimeRec | null>(null);
  const [loading, setLoading] = useState(true);
  /** 조회에 실패한 패널 이름 — 비어 있어야 화면이 완전하다 */
  const [failed, setFailed] = useState<string[]>([]);

  // 🔴 종전에는 세 조회를 `Promise.all(...).catch(() => {})` 로 삼켰다. 성과 조회가 죽으면
  //    총계·캠페인 표가 **아무 말 없이 사라져** "최근 30일 캠페인이 없다"로 읽혔다.
  //    부분 성공은 그대로 그리되, 실패한 패널을 화면이 이름으로 말한다.
  const load = useCallback(() => {
    setLoading(true);
    setFailed([]);
    Promise.allSettled([
      apiClient.fetch<{ data: Performance }>('/api/v1/crm/dashboard/performance'),
      apiClient.fetch<{ data: Cohort[] }>('/api/v1/crm/dashboard/retention'),
      apiClient.fetch<{ data: SendTimeRec }>('/api/v1/crm/ai/recommend-time'),
    ]).then(([p, c, s]) => {
      const bad: string[] = [];
      if (p.status === 'fulfilled') setPerf(p.value.data); else { setPerf(null); bad.push('캠페인 성과'); }
      if (c.status === 'fulfilled') setCohorts(c.value.data ?? []); else { setCohorts([]); bad.push('코호트 리텐션'); }
      if (s.status === 'fulfilled') setSendTime(s.value.data); else { setSendTime(null); bad.push('최적 발송 시간'); }
      setFailed(bad);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="flex justify-center py-24"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  const maxHourCount = Math.max(...(sendTime?.hourlyStats?.map(h => h.count) ?? [1]), 1);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="CRM 분석" /></h1>
        <p className="text-sm text-gray-500 mt-1">캠페인 성과, 코호트 리텐션, {AI_ORIGIN_TEXT} 최적화</p>
      </div>

      {/* 🔴 실패한 패널은 사라지지 않고 이름을 말한다 — 빈 화면은 "실적 없음"으로 읽힌다 */}
      {failed.length > 0 && (
        <QueryErrorFallback
          size="compact"
          error={new Error(`${failed.join('·')} 조회에 실패했습니다 — 데이터가 없는 것이 아니라 아래 화면이 불완전합니다.`)}
          onRetry={load}
        />
      )}

      {/* 성과 총계 */}
      {perf && (
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: '총 발송', value: perf.totals.sent.toLocaleString(), bg: 'bg-blue-50', color: 'text-blue-700' },
            { label: '전달', value: perf.totals.delivered.toLocaleString(), bg: 'bg-indigo-50', color: 'text-indigo-700' },
            { label: '오픈', value: `${perf.totals.opened.toLocaleString()} (${perf.avgOpenRate}%)`, bg: 'bg-violet-50', color: 'text-violet-700' },
            { label: '클릭', value: `${perf.totals.clicked.toLocaleString()} (${perf.avgClickRate}%)`, bg: 'bg-amber-50', color: 'text-amber-700' },
            { label: '전환', value: perf.totals.conversions.toLocaleString(), bg: 'bg-emerald-50', color: 'text-emerald-700' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 p-4 text-center`}>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1"><T k={s.label} /></p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* 캠페인 성과 테이블 */}
        {perf && perf.campaigns.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 col-span-2">
            <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="최근 30일 캠페인 성과" /></h2>
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="pb-2 text-left"><T k="캠페인" /></th>
                  <th className="pb-2 text-center"><T k="유형" /></th>
                  <th className="pb-2 text-center"><T k="채널" /></th>
                  <th className="pb-2 text-right"><T k="발송@집계" /></th>
                  <th className="pb-2 text-right"><T k="오픈" /></th>
                  <th className="pb-2 text-right"><T k="클릭" /></th>
                  <th className="pb-2 text-right"><T k="전환" /></th>
                  <th className="pb-2 text-center">A/B</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {perf.campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{c.name}</td>
                    <td className="py-2 text-center text-xs text-gray-500"><T k={TYPE_LABEL[c.type] ?? c.type} /></td>
                    <td className="py-2 text-center text-xs text-gray-500">{c.channel}</td>
                    <td className="py-2 text-right">{c.sentCount.toLocaleString()}</td>
                    <td className="py-2 text-right">{c.openedCount.toLocaleString()}</td>
                    <td className="py-2 text-right">{c.clickedCount.toLocaleString()}</td>
                    <td className="py-2 text-right">{c.conversionCount.toLocaleString()}</td>
                    <td className="py-2 text-center">
                      {c.abVariantName && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-100 text-violet-700">{c.abVariantName}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 코호트 리텐션 */}
        {cohorts.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="월별 코호트 리텐션" /></h2>
            <div className="space-y-3">
              {cohorts.map(c => (
                <div key={c.month} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-16 font-mono">{c.month}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full flex items-center justify-end pr-2 transition-all"
                      style={{ width: `${Math.max(c.rate, 3)}%` }}>
                      {c.rate > 10 && <span className="text-[9px] font-bold text-white">{c.rate}<Unit>%</Unit></span>}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-20 text-right">{c.retained}/{c.total}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3"><T k="첫 방문 월 기준 → 이후 재방문 비율" /></p>
          </div>
        )}

        {/* WeRU.B 최적 발송 시간 */}
        {sendTime && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-2">{AI_ORIGIN_TEXT} 최적 발송 시간</h2>
            <div className="bg-blue-50 rounded-xl p-3 mb-4">
              <p className="text-sm text-blue-800 font-semibold">추천: {sendTime.recommendedHour}:00</p>
              <p className="text-xs text-blue-600 mt-0.5">{sendTime.reason}</p>
            </div>
            <div className="space-y-1.5">
              {sendTime.hourlyStats.filter(h => h.count > 0).map(h => (
                <div key={h.hour} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-8 text-right font-mono">{h.hour}시</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3.5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${h.hour === sendTime.recommendedHour ? 'bg-blue-500' : 'bg-gray-300'}`}
                      style={{ width: `${Math.max((h.count / maxHourCount) * 100, 3)}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-16 text-right">{h.openRate}<Unit>%</Unit> ({h.count})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
