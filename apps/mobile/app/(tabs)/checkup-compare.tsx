import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { InfoCard } from '../../src/components/common/InfoCard';

/**
 * 검진 비교·셀프 예약 — 서버 `portal/checkup-comparison`(최근 5회 추이) ·
 * `checkup-programs`/`checkup-capacity`/`checkup-reserve` 배선.
 * 🔴 조회 실패 ≠ 기록 없음(P17) · 판정(finding)은 서버 값 그대로 — 화면이 재판정하지 않는다.
 */

interface TrendRow { testName: string; unit?: string; dataPoints: { date: string; value: string; finding: string }[] }
interface GradeRow { date: string; program: string; overallGrade: string | null }
interface ProgramRow { id: string; name: string; category: string; price: number; discountRate: number; duration?: string | null; description?: string | null }
interface CapacityRow { date: string; capacity: number; reserved: number; available: number; isWeekend: boolean }

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

export default function CheckupCompareScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const [selProgram, setSelProgram] = useState<ProgramRow | null>(null);
  const [selDate, setSelDate] = useState<string | null>(null);

  const comparison = useQuery({
    queryKey: ['checkup-comparison'],
    queryFn: () => apiClient.get('/api/v1/portal/checkup-comparison'),
  });
  const programs = useQuery({
    queryKey: ['checkup-programs'],
    queryFn: () => apiClient.get('/api/v1/portal/checkup-programs'),
  });
  const from = new Date(); from.setDate(from.getDate() + 1);
  const to = new Date(); to.setDate(to.getDate() + 21);
  const capacity = useQuery({
    queryKey: ['checkup-capacity'],
    queryFn: () => apiClient.get(`/api/v1/portal/checkup-capacity?from=${dateStr(from)}&to=${dateStr(to)}`),
    enabled: !!selProgram,
  });

  const reserve = useMutation({
    mutationFn: (body: { programId: string; scheduledDate: string }) => apiClient.post('/api/v1/portal/checkup-reserve', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checkup-visits'] });
      setSelProgram(null); setSelDate(null);
      Alert.alert('예약 완료', '검진 예약이 접수되었습니다. 건강 관리 화면에서 확인할 수 있습니다.', [
        { text: '확인', onPress: () => router.push('/health' as never) },
      ]);
    },
    onError: (e: unknown) => Alert.alert('예약 실패', (e as { message?: string })?.message ?? '검진 예약에 실패했습니다.'),
  });

  if (comparison.isLoading) return <LoadingState />;

  const cmp = (comparison.data as { data?: { trends?: TrendRow[]; gradeTimeline?: GradeRow[] } } | undefined)?.data;
  const trends = cmp?.trends ?? [];
  const gradeTimeline = cmp?.gradeTimeline ?? [];
  const programList: ProgramRow[] = ((programs.data as { data?: ProgramRow[] } | undefined)?.data ?? []) as ProgramRow[];
  const capList: CapacityRow[] = (((capacity.data as { data?: CapacityRow[] } | undefined)?.data ?? []) as CapacityRow[]).filter((c) => !c.isWeekend && c.available > 0);
  const discounted = (p: ProgramRow) => (p.discountRate > 0 ? Math.round(p.price * (1 - p.discountRate / 100)) : p.price);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '검진 비교·예약', headerShown: true }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={comparison.isRefetching} onRefresh={() => { comparison.refetch(); programs.refetch(); }} />}>

        {/* 연도 비교 — 종합 등급 타임라인 */}
        {comparison.isError ? (
          <InfoCard title="검진 결과 비교" accentColor="#EF4444">
            <ErrorState message="비교 데이터를 불러오지 못했습니다 — 기록이 없는 것이 아닙니다." onRetry={() => comparison.refetch()} />
          </InfoCard>
        ) : gradeTimeline.length === 0 && trends.length === 0 ? (
          <InfoCard title="검진 결과 비교" accentColor="#3B82F6">
            <EmptyState icon="analytics-outline" message="완료된 검진이 2회 이상이면 회차별 비교가 표시됩니다." />
          </InfoCard>
        ) : (
          <>
            {gradeTimeline.length > 0 && (
              <InfoCard title="종합 등급 추이" subtitle="완료된 검진의 회차별 종합 판정" accentColor="#4F46E5">
                {gradeTimeline.map((g, i) => (
                  <View key={i} style={s.gradeRow}>
                    <Text style={s.gradeDate}>{g.date}</Text>
                    <Text style={s.gradeProgram} numberOfLines={1}>{g.program}</Text>
                    {/* 🔴 등급 없음(null)은 '판정 없음' — A 도 공백도 아니다 */}
                    <Text style={[s.gradeValue, (g.overallGrade === 'D1' || g.overallGrade === 'D2' || g.overallGrade === 'C2') && s.gradeWarn]}>
                      {g.overallGrade ?? '판정 없음'}
                    </Text>
                  </View>
                ))}
              </InfoCard>
            )}

            {trends.length > 0 && (
              <InfoCard title="항목별 추이" subtitle="2회 이상 측정된 항목만 비교합니다" accentColor="#3B82F6">
                {trends.map((t, i) => (
                  <View key={i} style={s.trendBlock}>
                    <Text style={s.trendName}>{t.testName}{t.unit ? ` (${t.unit})` : ''}</Text>
                    <View style={s.pointRow}>
                      {t.dataPoints.map((p, j) => (
                        <View key={j} style={s.point}>
                          <Text style={[s.pointValue, p.finding === 'ABNORMAL' && s.pointAbn, p.finding === 'CRITICAL' && s.pointCrit]}>{p.value}</Text>
                          <Text style={s.pointDate}>{p.date.slice(2)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </InfoCard>
            )}
          </>
        )}

        {/* 셀프 예약 */}
        <InfoCard title="검진 셀프 예약" subtitle="프로그램을 고르고 날짜를 선택하세요" accentColor="#10B981">
          {programs.isError ? (
            <ErrorState message="프로그램 목록을 불러오지 못했습니다." onRetry={() => programs.refetch()} />
          ) : programList.length === 0 ? (
            <EmptyState icon="medkit-outline" message="예약 가능한 검진 프로그램이 없습니다." />
          ) : (
            programList.map((p) => (
              <TouchableOpacity key={p.id} style={[s.programRow, selProgram?.id === p.id && s.programRowOn]} onPress={() => { setSelProgram(selProgram?.id === p.id ? null : p); setSelDate(null); }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.programName}>{p.name}</Text>
                  {p.duration ? <Text style={s.programMeta}>{p.duration}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.programPrice}>{discounted(p).toLocaleString()}원</Text>
                  {p.discountRate > 0 && <Text style={s.programOrig}>{p.price.toLocaleString()}원</Text>}
                </View>
              </TouchableOpacity>
            ))
          )}

          {selProgram && (
            <View style={s.dateArea}>
              <Text style={s.dateTitle}>날짜 선택 (3주 내 · 잔여 있는 평일)</Text>
              {capacity.isLoading ? (
                <Text style={s.dateLoading}>잔여 조회 중…</Text>
              ) : capacity.isError ? (
                <ErrorState message="잔여 일정을 불러오지 못했습니다." onRetry={() => capacity.refetch()} />
              ) : capList.length === 0 ? (
                <Text style={s.dateLoading}>3주 내 예약 가능한 날짜가 없습니다.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.dateRow}>
                    {capList.map((c) => (
                      <TouchableOpacity key={c.date} style={[s.dateChip, selDate === c.date && s.dateChipOn]} onPress={() => setSelDate(c.date)}>
                        <Text style={[s.dateChipText, selDate === c.date && s.dateChipTextOn]}>{c.date.slice(5)}</Text>
                        <Text style={[s.dateChipSub, selDate === c.date && s.dateChipTextOn]}>잔여 {c.available}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}
              <TouchableOpacity
                style={[s.reserveBtn, (!selDate || reserve.isPending) && s.reserveBtnOff]}
                disabled={!selDate || reserve.isPending}
                onPress={() => selDate && reserve.mutate({ programId: selProgram.id, scheduledDate: selDate })}
              >
                <Text style={s.reserveBtnText}>{reserve.isPending ? '예약 중…' : selDate ? `${selDate} ${selProgram.name} 예약` : '날짜를 선택하세요'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </InfoCard>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  gradeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  gradeDate: { fontSize: 12, color: '#6B7280', width: 84 },
  gradeProgram: { fontSize: 13, color: '#374151', flex: 1 },
  gradeValue: { fontSize: 16, fontWeight: '800', color: '#4F46E5' },
  gradeWarn: { color: '#DC2626' },
  trendBlock: { marginBottom: 12 },
  trendName: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4 },
  pointRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  point: { alignItems: 'center' },
  pointValue: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  pointAbn: { color: '#DC2626' },
  pointCrit: { color: '#DC2626', textDecorationLine: 'underline' },
  pointDate: { fontSize: 9, color: '#9CA3AF', marginTop: 2 },
  programRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 8, backgroundColor: '#FFFFFF' },
  programRowOn: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  programName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  programMeta: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  programPrice: { fontSize: 14, fontWeight: '700', color: '#059669' },
  programOrig: { fontSize: 11, color: '#9CA3AF', textDecorationLine: 'line-through' },
  dateArea: { marginTop: 10 },
  dateTitle: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 8 },
  dateLoading: { fontSize: 12, color: '#9CA3AF', paddingVertical: 8 },
  dateRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  dateChip: { minHeight: 48, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  dateChipOn: { backgroundColor: '#10B981' },
  dateChipText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  dateChipTextOn: { color: '#FFFFFF' },
  dateChipSub: { fontSize: 10, color: '#6B7280', marginTop: 1 },
  reserveBtn: { minHeight: 48, borderRadius: 12, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  reserveBtnOff: { opacity: 0.4 },
  reserveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
