'use client';

import { useState } from 'react';
import { Ratio, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kstToday } from '@/lib/kst-today';

const CATEGORY_LABELS: Record<string, string> = {
  BASIC: '기본@검진등급', PLUS: '플러스', PRECISION: '정밀', PREMIUM: '프리미엄',
  PET_PRECISION: 'PET', SPECIAL: '특화',
};

export default function CheckupStatsPage() {
  const tAttr = useTAttr();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [from, setFrom] = useState(`${thisMonth}-01`);
  const [to, setTo] = useState(kstToday());
  const [tab, setTab] = useState<'program' | 'revenue' | 'demographics' | 'findings'>('program');

  const { data: statsRes, isError, error, refetch } = useQuery({
    queryKey: ['checkup-stats', from, to],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/stats', { from, to }),
  });
  const stats = statsRes?.data ?? [];

  const { data: abnormalRes } = useQuery({
    queryKey: ['checkup-abnormal', from, to],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/stats/abnormal', { from, to }),
  });
  const abnormals = abnormalRes?.data ?? [];

  const { data: revenueRes } = useQuery({
    queryKey: ['checkup-revenue', from, to],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/stats/revenue', { from, to }),
    enabled: tab === 'revenue',
  });
  const revenue = revenueRes?.data;

  const { data: demoRes } = useQuery({
    queryKey: ['checkup-demographics', from, to],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/stats/demographics', { from, to }),
    enabled: tab === 'demographics',
  });
  const demographics = demoRes?.data;

  const { data: findingRes } = useQuery({
    queryKey: ['checkup-finding-rate', from, to],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/stats/finding-rate', { from, to }),
    enabled: tab === 'findings',
  });
  const findingRate = findingRes?.data;

  const totalVisits = stats.reduce((sum: number, s: any) => sum + s.total, 0);
  const totalCompleted = stats.reduce(
    (sum: number, s: any) => sum + (s.byStatus?.COMPLETED ?? 0) + (s.byStatus?.DELIVERED ?? 0),
    0,
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const formatPrice = (n: number) => new Intl.NumberFormat('ko-KR').format(n);
  const TABS = [
    { key: 'program' as const, label: '프로그램별' },
    { key: 'revenue' as const, label: '매출' },
    { key: 'demographics' as const, label: '수검자 분포' },
    { key: 'findings' as const, label: '유소견율' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold"><T k="검진 통계" /></h1>
        <div className="flex items-center gap-2">
          <input type="date" className="border rounded-lg px-3 py-1.5 text-sm" value={from}
            onChange={(e) => setFrom(e.target.value)} />
          <span className="text-gray-400">~</span>
          <input type="date" className="border rounded-lg px-3 py-1.5 text-sm" value={to}
            onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* 탭 선택 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}><T k={t.label} /></button>
        ))}
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500"><T k="총 예약" /></div>
          <div className="text-2xl font-bold">{totalVisits}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500"><T k="완료" /></div>
          <div className="text-2xl font-bold text-green-600">{totalCompleted}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500"><T k="완료율" /></div>
          {/* 🔴 비율은 분모와 함께(§3.3) — 예약 0건이면 정본 `<Ratio>` 가 '산출 불가'를 그린다 */}
          <div className="text-2xl font-bold">
            <Ratio numerator={totalCompleted} denominator={totalVisits} unavailableHint="기간 내 예약 없음" />
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-sm text-gray-500"><T k="이상소견" /></div>
          <div className="text-2xl font-bold text-red-600">
            {abnormals.reduce((s: number, a: any) => s + a.total, 0)}건
          </div>
        </div>
      </div>

      {/* 프로그램별 통계 */}
      {tab === 'program' && <><div className="bg-white border rounded-lg">
        <div className="p-4 border-b">
          <h2 className="font-semibold"><T k="프로그램별 현황" /></h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left"><T k="프로그램" /></th>
              <th className="px-4 py-2 text-center"><T k="카테고리" /></th>
              <th className="px-4 py-2 text-center"><T k="총 예약" /></th>
              <th className="px-4 py-2 text-center"><T k="예약" /></th>
              <th className="px-4 py-2 text-center"><T k="접수@상태" /></th>
              <th className="px-4 py-2 text-center"><T k="진행" /></th>
              <th className="px-4 py-2 text-center"><T k="완료" /></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {stats.map((s: any) => (
              <tr key={s.program.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium">{s.program.name}</div>
                  <div className="text-xs text-gray-400">{s.program.code}</div>
                </td>
                <td className="px-4 py-3 text-center text-xs text-gray-500">
                  <T k={CATEGORY_LABELS[s.program.category] ?? s.program.category} />
                </td>
                <td className="px-4 py-3 text-center font-semibold">{s.total}</td>
                <td className="px-4 py-3 text-center">{s.byStatus?.RESERVED ?? 0}</td>
                <td className="px-4 py-3 text-center">{s.byStatus?.CHECKED_IN ?? 0}</td>
                <td className="px-4 py-3 text-center">{s.byStatus?.IN_PROGRESS ?? 0}</td>
                <td className="px-4 py-3 text-center text-green-600">
                  {(s.byStatus?.COMPLETED ?? 0) + (s.byStatus?.DELIVERED ?? 0)}
                </td>
              </tr>
            ))}
            {stats.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400"><T k="데이터 없음" /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 이상소견 TOP */}
      <div className="bg-white border rounded-lg">
        <div className="p-4 border-b">
          <h2 className="font-semibold"><T k="이상소견 TOP (빈도순)" /></h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left"><T k="검사명" /></th>
              <th className="px-4 py-2 text-center"><T k="이상" /></th>
              <th className="px-4 py-2 text-center"><T k="위험" /></th>
              <th className="px-4 py-2 text-center"><T k="합계" /></th>
              <th className="px-4 py-2 text-left"><T k="분포" /></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {abnormals.slice(0, 15).map((a: any) => (
              <tr key={a.testName} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium">{a.testName}</td>
                <td className="px-4 py-2.5 text-center text-yellow-600">{a.abnormal}</td>
                <td className="px-4 py-2.5 text-center text-red-600">{a.critical}</td>
                <td className="px-4 py-2.5 text-center font-semibold">{a.total}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <div className="h-2 bg-yellow-400 rounded" style={{ width: `${a.abnormal * 4}px` }} />
                    <div className="h-2 bg-red-500 rounded" style={{ width: `${a.critical * 4}px` }} />
                  </div>
                </td>
              </tr>
            ))}
            {abnormals.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400"><T k="이상소견 데이터 없음" /></td></tr>
            )}
          </tbody>
        </table>
      </div></>}

      {/* 매출 통계 */}
      {tab === 'revenue' && revenue && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="총 매출" /></div>
              <div className="text-xl font-bold text-blue-600">{formatPrice(revenue.totalRevenue)}<Unit>원</Unit></div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="개인 검진" /></div>
              <div className="text-xl font-bold">{formatPrice(revenue.individualRevenue)}<Unit>원</Unit></div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="단체 검진" /></div>
              <div className="text-xl font-bold">{formatPrice(revenue.corporateRevenue)}<Unit>원</Unit></div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="건당 평균" /></div>
              {/* 표본 0이면 '건당 0원'이 아니라 산출 불가다 */}
              <div className="text-xl font-bold">{revenue.avgRevenuePerVisit == null ? <T k="산출 불가" /> : <>{formatPrice(revenue.avgRevenuePerVisit)}<Unit>원</Unit></>}</div>
            </div>
          </div>
          <div className="bg-white border rounded-lg">
            <div className="p-4 border-b"><h2 className="font-semibold"><T k="프로그램별 매출" /></h2></div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left"><T k="프로그램" /></th>
                  <th className="px-4 py-2 text-center"><T k="건수" /></th>
                  <th className="px-4 py-2 text-right"><T k="매출" /></th>
                  <th className="px-4 py-2 text-left"><T k="비율" /></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(revenue.byProgram ?? []).map((p: any) => (
                  <tr key={p.name} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5 text-center">{p.count}</td>
                    <td className="px-4 py-2.5 text-right">{formatPrice(p.revenue)}<Unit>원</Unit></td>
                    <td className="px-4 py-2.5">
                      <div className="h-2 bg-blue-400 rounded" style={{ width: `${revenue.totalRevenue > 0 ? (p.revenue / revenue.totalRevenue) * 100 : 0}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(revenue.byMonth ?? []).length > 0 && (
            <div className="bg-white border rounded-lg p-4">
              <h2 className="font-semibold mb-3"><T k="월별 추이" /></h2>
              <div className="flex items-end gap-2 h-32">
                {(revenue.byMonth as any[]).map((m: any) => {
                  const max = Math.max(...(revenue.byMonth as any[]).map((mm: any) => mm.revenue));
                  const h = max > 0 ? (m.revenue / max) * 100 : 0;
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-blue-400 rounded-t" style={{ height: `${h}%` }} />
                      <span className="text-[10px] text-gray-400">{m.month.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 수검자 분포 */}
      {tab === 'demographics' && demographics && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border rounded-lg p-4 text-center">
              <div className="text-sm text-gray-500"><T k="전체" /></div>
              <div className="text-2xl font-bold">{demographics.total}<Unit>명</Unit></div>
            </div>
            <div className="bg-white border rounded-lg p-4 text-center">
              <div className="text-sm text-gray-500"><T k="남성" /></div>
              <div className="text-2xl font-bold text-blue-600">{demographics.maleCount}<Unit>명</Unit>{demographics.maleRatio != null && <> ({demographics.maleRatio}<Unit>%</Unit>)</>}</div>
            </div>
            <div className="bg-white border rounded-lg p-4 text-center">
              <div className="text-sm text-gray-500"><T k="여성" /></div>
              {/* 🔴 `100 - maleRatio` 는 표본 0에서 "여성 100%"를 만들고 OTHER/미상을 여성에 몰아넣는다.
                  서버가 femaleCount 를 주므로 그것으로 계산한다. */}
              <div className="text-2xl font-bold text-pink-600">{demographics.femaleCount}<Unit>명</Unit>{demographics.total > 0 && <> ({Math.round((demographics.femaleCount / demographics.total) * 100)}<Unit>%</Unit>)</>}</div>
            </div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold mb-3"><T k="연령대별 분포" /></h2>
            <div className="space-y-2">
              {Object.entries(demographics.ageGroups as Record<string, { male: number; female: number }>).map(([group, counts]) => {
                const total = counts.male + counts.female;
                const maxTotal = Math.max(...Object.values(demographics.ageGroups as Record<string, { male: number; female: number }>).map((c) => c.male + c.female));
                return (
                  <div key={group} className="flex items-center gap-3">
                    <span className="w-12 text-sm text-gray-600 text-right">{group}</span>
                    <div className="flex-1 flex gap-0.5">
                      <div className="h-5 bg-blue-400 rounded-l" style={{ width: `${maxTotal > 0 ? (counts.male / maxTotal) * 100 : 0}%` }} />
                      <div className="h-5 bg-pink-400 rounded-r" style={{ width: `${maxTotal > 0 ? (counts.female / maxTotal) * 100 : 0}%` }} />
                    </div>
                    <span className="w-8 text-sm text-gray-500 text-right">{total}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 justify-center mt-3 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 rounded" /><T k="남성" /></span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-pink-400 rounded" /><T k="여성" /></span>
            </div>
          </div>
        </div>
      )}

      {/* 유소견율 */}
      {tab === 'findings' && findingRate && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="전체 검사" /></div>
              <div className="text-2xl font-bold">{findingRate.totalItems}<Unit>건</Unit></div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="이상" /></div>
              <div className="text-2xl font-bold text-amber-600">{findingRate.abnormalItems}<Unit>건</Unit></div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="위급값" /></div>
              <div className="text-2xl font-bold text-red-600">{findingRate.criticalItems}<Unit>건</Unit></div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500"><T k="전체 유소견율" /></div>
              {/* 🔴 검사 0건이면 유소견율은 0%(=전원 정상)가 아니라 산출 불가다 — 분모와 함께 낸다(§3.3) */}
              <div className="text-2xl font-bold"><Ratio numerator={findingRate.abnormalItems} denominator={findingRate.totalItems} unavailableHint="기간 내 검사 0건" /></div>
            </div>
          </div>
          <div className="bg-white border rounded-lg">
            <div className="p-4 border-b"><h2 className="font-semibold"><T k="항목별 유소견율 TOP 20" /></h2></div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left"><T k="검사명" /></th>
                  <th className="px-4 py-2 text-center"><T k="전체" /></th>
                  <th className="px-4 py-2 text-center"><T k="이상" /></th>
                  <th className="px-4 py-2 text-center"><T k="유소견율" /></th>
                  <th className="px-4 py-2 text-left"><T k="분포" /></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(findingRate.byTest ?? []).map((t: any) => (
                  <tr key={t.testName} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{t.testName}</td>
                    <td className="px-4 py-2.5 text-center text-gray-500">{t.totalCount}</td>
                    <td className="px-4 py-2.5 text-center text-amber-600">{t.abnormalCount}</td>
                    <td className="px-4 py-2.5 text-center font-semibold"><Ratio numerator={t.abnormalCount} denominator={t.totalCount} pctOnly unavailableHint="검사 0건" /></td>
                    <td className="px-4 py-2.5">
                      <div className="h-2 bg-amber-400 rounded" style={{ width: `${t.rate}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
