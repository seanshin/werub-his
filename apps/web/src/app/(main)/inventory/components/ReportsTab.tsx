'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Th, Td, EmptyRow, Input, Select, Label, Card } from './shared-ui';
import { money, kdate } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

type ReportSummary = { totalItems: number; totalValue: number; lowStockItems: number; overStockItems: number };
type AbcGrade = { grade: string; itemCount: number; valuePercent: number; totalValue: number };
type AbcItem = { id: string; grade: string; code: string; name: string; currentStock: number; unitPrice: number; value: number; cumulativePct: number };
type AbcData = { summary: AbcGrade[]; items: AbcItem[] };
type ExpiryLot = { id: string; lotNumber: string; item?: { name: string; category: string }; quantity: number; expiryDate: string; daysRemaining: number; storage?: { name: string } };
type ExpiryData = { summary: { expired: number; within30: number; within60: number; within90: number }; lots: ExpiryLot[] };
type TurnoverItem = { id: string; code: string; name: string; category: string; inQty: number; outQty: number; currentStock: number; turnover: number };
type TurnoverData = { period: { from?: string; to?: string }; items: TurnoverItem[] };

export function ReportsTab() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [category, setCategory] = useState('');

  const { data: summaryData } = useQuery({ queryKey: ['inv-report-summary', category], queryFn: () => apiClient.get<{ data: ReportSummary }>(`/api/v1/inventory/reports/summary${category ? `?category=${category}` : ''}`) });
  const { data: abcData } = useQuery({ queryKey: ['inv-report-abc', category], queryFn: () => apiClient.get<{ data: AbcData }>(`/api/v1/inventory/reports/abc-analysis${category ? `?category=${category}` : ''}`) });
  const { data: expiryData } = useQuery({ queryKey: ['inv-report-expiry', category], queryFn: () => apiClient.get<{ data: ExpiryData }>(`/api/v1/inventory/reports/expiry${category ? `?category=${category}` : ''}`) });
  const { data: turnoverData } = useQuery({ queryKey: ['inv-report-turnover', dateFrom, dateTo, category], queryFn: () => { const params = new URLSearchParams(); if (dateFrom) params.set('dateFrom', dateFrom); if (dateTo) params.set('dateTo', dateTo); if (category) params.set('category', category); return apiClient.get<{ data: TurnoverData }>(`/api/v1/inventory/reports/turnover?${params}`); } });

  const summary: ReportSummary = summaryData?.data ?? { totalItems: 0, totalValue: 0, lowStockItems: 0, overStockItems: 0 };
  const abc: AbcData = abcData?.data ?? { summary: [], items: [] };
  const expiry: ExpiryData = expiryData?.data ?? { summary: { expired: 0, within30: 0, within60: 0, within90: 0 }, lots: [] };
  const turnover: TurnoverData = turnoverData?.data ?? { period: {}, items: [] };

  const gradeColor: Record<string, string> = { A: 'bg-rose-50 text-rose-700 font-bold', B: 'bg-amber-50 text-amber-700 font-semibold', C: 'bg-gray-100 text-gray-600' };

  return (
    <div className="space-y-6">
      {/* 기간 필터 */}
      <Card className="p-4">
        <div className="flex gap-4 items-end flex-wrap">
          <div><Label><T k="시작일" /></Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div><Label><T k="종료일" /></Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
          <div><Label><T k="카테고리" /></Label>
            <Select value={category} onChange={e => setCategory(e.target.value)}>
              <option value=""><T k="전체" /></option>
              <option value="소모품"><T k="소모품" /></option><option value="수술소모품"><T k="수술소모품" /></option><option value="검사소모품"><T k="검사소모품" /></option><option value="의약품"><T k="의약품" /></option><option value="의료기기"><T k="의료기기" /></option>
            </Select>
          </div>
        </div>
      </Card>

      {/* 요약 카드 4개 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5 text-center">
          <p className="text-xs text-gray-500 mb-1"><T k="총 품목수" /></p>
          <p className="text-2xl font-bold text-gray-900">{summary.totalItems.toLocaleString()}</p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-xs text-gray-500 mb-1"><T k="총 재고금액" /></p>
          <p className="text-2xl font-bold text-blue-600"><Money value={Math.round(summary.totalValue)} /></p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-xs text-gray-500 mb-1"><T k="부족 품목" /></p>
          <p className="text-2xl font-bold text-rose-600">{summary.lowStockItems}</p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-xs text-gray-500 mb-1"><T k="과잉 품목" /></p>
          <p className="text-2xl font-bold text-amber-600">{summary.overStockItems}</p>
        </Card>
      </div>

      {/* ABC 분석 */}
      <Card>
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900"><T k="ABC 분석 (금액 기준)" /></h3>
          <p className="text-xs text-gray-500 mt-0.5"><T k="A: 상위 80% 금액, B: 80~95%, C: 나머지" /></p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          {abc.summary.map((s: AbcGrade) => (
            <div key={s.grade} className="p-4 text-center">
              <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold mb-2 ${gradeColor[s.grade] ?? ''}`}>{s.grade}등급</span>
              <p className="text-lg font-bold text-gray-900">{s.itemCount}<Unit><T k="개" /></Unit></p>
              <p className="text-xs text-gray-500">{s.valuePercent}<Unit>%</Unit> (<Money value={Math.round(s.totalValue)} />)</p>
            </div>
          ))}
        </div>
        {abc.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="border-b border-t border-gray-100 bg-gray-50/50">
              <tr><Th><T k="등급" /></Th><Th><T k="코드" /></Th><Th><T k="품목명" /></Th><Th right><T k="현재고" /></Th><Th right><T k="단가" /></Th><Th right><T k="금액" /></Th><Th right><T k="누적%" /></Th></tr>
            </thead>
            <tbody>
              {abc.items.slice(0, 20).map((i: AbcItem) => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-[11px] ${gradeColor[i.grade]}`}>{i.grade}</span></td>
                  <Td mono>{i.code}</Td>
                  <Td>{i.name}</Td>
                  <Td right>{i.currentStock?.toLocaleString()}</Td>
                  <Td right><Money value={(i.unitPrice ?? 0)} /></Td>
                  <Td right><Money value={Math.round(i.value)} /></Td>
                  <Td right>{i.cumulativePct}<Unit>%</Unit></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 유효기간 임박 */}
      <Card>
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900"><T k="유효기간 임박 리포트" /></h3>
        </div>
        <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
          <div className="p-3 text-center"><p className="text-xs text-gray-500"><T k="만료" /></p><p className="text-lg font-bold text-rose-600">{expiry.summary.expired}</p></div>
          <div className="p-3 text-center"><p className="text-xs text-gray-500"><T k="30일내" /></p><p className="text-lg font-bold text-rose-500">{expiry.summary.within30}</p></div>
          <div className="p-3 text-center"><p className="text-xs text-gray-500"><T k="60일내" /></p><p className="text-lg font-bold text-amber-600">{expiry.summary.within60}</p></div>
          <div className="p-3 text-center"><p className="text-xs text-gray-500"><T k="90일내" /></p><p className="text-lg font-bold text-amber-500">{expiry.summary.within90}</p></div>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr><Th>LOT</Th><Th><T k="품목" /></Th><Th><T k="분류" /></Th><Th right><T k="수량" /></Th><Th><T k="유효기간" /></Th><Th right><T k="잔여일" /></Th><Th><T k="보관장소" /></Th></tr>
          </thead>
          <tbody>
            {!expiry.lots.length ? <EmptyRow cols={7} msg="유효기간 임박 품목이 없습니다." /> : expiry.lots.slice(0, 30).map((l: ExpiryLot) => {
              const days = l.daysRemaining ?? 0;
              const color = days < 0 ? 'text-rose-700 font-bold' : days <= 30 ? 'text-rose-600 font-semibold' : days <= 60 ? 'text-amber-600' : 'text-gray-700';
              const bg = days < 0 ? 'bg-rose-50/40' : days <= 30 ? 'bg-rose-50/20' : '';
              return (
                <tr key={l.id} className={`border-b border-gray-50 ${bg}`}>
                  <Td mono>{l.lotNumber}</Td>
                  <Td>{l.item?.name}</Td>
                  <Td>{l.item?.category}</Td>
                  <Td right>{l.quantity?.toLocaleString()}</Td>
                  <Td>{l.expiryDate ? kdate(l.expiryDate) : '-'}</Td>
                  <td className={`px-4 py-3 text-sm text-right ${color}`}>{days < 0 ? `${Math.abs(days)}일 경과` : `${days}일`}</td>
                  <Td>{l.storage?.name ?? '-'}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* 재고 회전율 상위 */}
      {turnover.items.length > 0 && (
        <Card>
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900"><T k="재고 회전율 (상위 20개)" /></h3>
            <p className="text-xs text-gray-500 mt-0.5">기간: {turnover.period?.from ?? '-'} ~ {turnover.period?.to ?? '-'}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr><Th><T k="코드" /></Th><Th><T k="품목명" /></Th><Th><T k="분류" /></Th><Th right><T k="입고량" /></Th><Th right><T k="출고량" /></Th><Th right><T k="현재고" /></Th><Th right><T k="회전율" /></Th></tr>
            </thead>
            <tbody>
              {turnover.items.slice(0, 20).map((i: TurnoverItem) => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                  <Td mono>{i.code}</Td><Td>{i.name}</Td><Td>{i.category}</Td>
                  <td className="px-4 py-3 text-sm text-right text-blue-600 font-medium">{i.inQty.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right text-rose-600 font-medium">{i.outQty.toLocaleString()}</td>
                  <Td right>{i.currentStock?.toLocaleString()}</Td>
                  <td className="px-4 py-3 text-sm text-right font-bold text-gray-900">{i.turnover}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
