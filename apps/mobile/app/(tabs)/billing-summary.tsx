import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { InfoCard } from '../../src/components/common/InfoCard';
import { formatAmount } from '../../src/lib/format';

export default function BillingSummaryScreen() {
  const annual = useQuery({ queryKey: ['billing-annual'], queryFn: () => apiClient.get('/api/v1/portal/billing/annual-summary') });
  const expenses = useQuery({ queryKey: ['medical-expenses'], queryFn: () => apiClient.get('/api/v1/portal/medical-expenses') });
  const unpaid = useQuery({ queryKey: ['billings-unpaid'], queryFn: () => apiClient.get('/api/v1/portal/billings/unpaid') });

  /**
   * 서버 실측(2026-08-14):
   *   /billing/annual-summary → { year, totalVisits, totalAmount, totalInsurance, totalCopay,
   *                               monthly: [{ month, count, amount }, ...12] }
   *   /medical-expenses       → { year, summary: {totalAmount, insuranceCovered, copay, paid},
   *                               visitCount, monthly: [{month, count, paid}] }
   * 🔴 둘 다 **객체**인데 종전 화면은 배열로 가정했다. 그래서
   *    · 연간 요약: `Array.isArray` 가 false → `JSON.stringify(...).slice(0,300)` 로 원시 JSON 이
   *      문장 중간에서 잘린 채 환자 화면에 찍혔다(월별 막대 코드는 전부 죽은 코드였다).
   *    · 연말정산 의료비: 객체에 `.length` 가 없어 `expenseData.length > 0` 이 영원히 false →
   *      카드가 한 번도 뜨지 않았다.
   */
  const annualData: any = (annual.data as any)?.data ?? null;
  const annualMonthly: any[] = Array.isArray(annualData?.monthly) ? annualData.monthly : [];
  const expenseData: any = (expenses.data as any)?.data ?? null;
  const expenseMonthly: any[] = Array.isArray(expenseData?.monthly) ? expenseData.monthly : [];
  const unpaidList: any[] = (unpaid.data as any)?.data ?? [];

  // 막대 그래프의 기준은 하드코딩 상한이 아니라 실제 최대 월이다(0 이면 그리지 않는다).
  const maxMonthlyAmount = annualMonthly.reduce((m: number, x: any) => Math.max(m, Number(x?.amount ?? 0)), 0);

  const isLoading = annual.isLoading;
  const onRefresh = () => { annual.refetch(); expenses.refetch(); unpaid.refetch(); };

  if (isLoading) return <LoadingState />;

  // 🔴 조회 실패를 "내역 없음"으로 보이게 하지 않는다
  const failed = [
    annual.isError && '연간 요약',
    expenses.isError && '연말정산 의료비',
    unpaid.isError && '미수납',
  ].filter(Boolean) as string[];

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '수납 요약', headerShown: true }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={annual.isRefetching} onRefresh={onRefresh} />}>

        {failed.length > 0 && (
          <View style={s.failBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
            <Text style={s.failText}>
              {failed.join(' · ')} 정보를 불러오지 못했습니다. 비어 있어도 “내역 없음”이 아닙니다.
            </Text>
          </View>
        )}

        {/* 미수납 */}
        {unpaidList.length > 0 && (
          <InfoCard title={`미수납 (${unpaidList.length}건)`} accentColor="#EF4444">
            {unpaidList.map((b: any, i: number) => (
              <View key={i} style={s.unpaidRow}>
                {/* 🔴 (2026-10-14 P4-1) 종전 `총진료비 − 납부` 는 공단 부담까지 미수로 그렸다 — 서버 정본 outstanding(본인부담 − 감면 − 납부) */}
                <Text style={s.unpaidAmount}>{formatAmount(typeof b.outstanding === 'number' ? b.outstanding : Math.max(0, (b.patientCopay ?? 0) - (b.discountAmount ?? 0) - (b.paidAmount ?? 0)))}</Text>
                <Text style={s.unpaidDate}>{b.createdAt ? new Date(b.createdAt).toLocaleDateString('ko-KR') : ''}</Text>
              </View>
            ))}
          </InfoCard>
        )}

        {/* 연간 요약 */}
        {annualData && (
          <InfoCard title={`${annualData.year ?? ''}년 수납 요약`} accentColor="#4F46E5">
            <View style={s.totalsRow}>
              <Totals label="총 진료" value={`${annualData.totalVisits ?? 0}회`} />
              <Totals label="총 진료비" value={formatAmount(annualData.totalAmount ?? 0)} />
              <Totals label="본인부담" value={formatAmount(annualData.totalCopay ?? 0)} />
            </View>
            {annualMonthly.filter((m: any) => Number(m?.amount ?? 0) > 0).map((m: any, i: number) => (
              <View key={i} style={s.monthRow}>
                <Text style={s.monthLabel}>{m.month}월</Text>
                <View style={s.barContainer}>
                  <View
                    style={[
                      s.bar,
                      { width: maxMonthlyAmount > 0 ? `${(Number(m.amount) / maxMonthlyAmount) * 100}%` : '0%' },
                    ]}
                  />
                </View>
                <Text style={s.monthAmount}>{formatAmount(Number(m.amount))}</Text>
              </View>
            ))}
            {maxMonthlyAmount === 0 && (
              <Text style={s.summaryText}>올해 수납 내역이 없습니다.</Text>
            )}
          </InfoCard>
        )}

        {/* 연말정산 의료비 */}
        {expenseData && (
          <InfoCard title={`연말정산 의료비 (${expenseData.year ?? ''})`} accentColor="#10B981">
            <View style={s.totalsRow}>
              <Totals label="진료 횟수" value={`${expenseData.visitCount ?? 0}회`} />
              <Totals label="총 진료비" value={formatAmount(expenseData.summary?.totalAmount ?? 0)} />
              <Totals label="실납부" value={formatAmount(expenseData.summary?.paid ?? 0)} />
            </View>
            {expenseMonthly.map((m: any, i: number) => (
              <View key={i} style={s.expenseRow}>
                <Text style={s.expenseDate}>{m.month}월</Text>
                <Text style={s.expenseDesc} numberOfLines={1}>{m.count}건</Text>
                <Text style={s.expenseAmount}>{formatAmount(Number(m.paid ?? 0))}</Text>
              </View>
            ))}
            {expenseMonthly.length === 0 && (
              <Text style={s.summaryText}>해당 연도 납부 내역이 없습니다.</Text>
            )}
          </InfoCard>
        )}

        {!annualData && unpaidList.length === 0 && !expenseData && failed.length === 0 && (
          <View style={s.emptyView}>
            <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
            <Text style={s.emptyText}>수납 내역이 없습니다</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.totalsItem}>
      <Text style={s.totalsLabel}>{label}</Text>
      <Text style={s.totalsValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  unpaidRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  unpaidAmount: { fontSize: 15, fontWeight: '700', color: '#DC2626' },
  unpaidDate: { fontSize: 12, color: '#9CA3AF' },
  monthRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  monthLabel: { fontSize: 12, color: '#6B7280', width: 30 },
  barContainer: { flex: 1, height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', backgroundColor: '#4F46E5', borderRadius: 4 },
  monthAmount: { fontSize: 11, color: '#374151', width: 70, textAlign: 'right', fontVariant: ['tabular-nums'] },
  summaryText: { fontSize: 13, color: '#374151' },
  expenseRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  expenseDate: { fontSize: 11, color: '#9CA3AF', width: 70 },
  expenseDesc: { fontSize: 12, color: '#374151', flex: 1 },
  expenseAmount: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  emptyView: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: '#9CA3AF', marginTop: 12 },
  failBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 12 },
  failText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  totalsItem: { alignItems: 'center', flex: 1 },
  totalsLabel: { fontSize: 11, color: '#9CA3AF' },
  totalsValue: { fontSize: 13, fontWeight: '700', color: '#1F2937', marginTop: 2 },
});
