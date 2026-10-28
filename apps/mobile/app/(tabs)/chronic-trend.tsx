import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { InfoCard } from '../../src/components/common/InfoCard';
import { formatDate } from '../../src/lib/format';
import { CHRONIC_LABEL, SMBG_CODES, TREND_LABEL } from '../../src/lib/chronic-labels';

/**
 * 만성질환 추이 — 서버 `portal/chronic-trend`(차트·발급본과 동일 SoT) 배선.
 * 🔴 추세 판정은 서버(classifyTrend)가 한다 — 화면은 번역만(로컬 재판정 금지).
 * 🔴 조회 실패 ≠ 기록 없음 — 실패는 ErrorState 로 말한다(P17).
 */

interface TrendPoint { value: number; unit: string; measuredAt: string; flag: string | null; normalMin: number | null; normalMax: number | null }
interface TrendSummary { latest: number | null; unit: string; measuredAt: string | null; delta: number | null; count: number; trend: 'IMPROVING' | 'WORSENING' | 'STABLE' | null }

export default function ChronicTrendScreen() {
  const qc = useQueryClient();
  const [smbgCode, setSmbgCode] = useState(SMBG_CODES[0].code);
  const [smbgValue, setSmbgValue] = useState('');

  const trend = useQuery({
    queryKey: ['chronic-trend'],
    queryFn: () => apiClient.get('/api/v1/portal/chronic-trend'),
  });

  const record = useMutation({
    mutationFn: (body: { code: string; value: number }) => apiClient.post('/api/v1/portal/chronic-observations', body),
    onSuccess: () => { setSmbgValue(''); qc.invalidateQueries({ queryKey: ['chronic-trend'] }); },
    onError: (e: unknown) => Alert.alert('저장 실패', (e as { message?: string })?.message ?? '자가측정 저장에 실패했습니다.'),
  });

  const submitSmbg = () => {
    const v = Number(smbgValue);
    if (!Number.isFinite(v) || v <= 0) { Alert.alert('입력 확인', '측정값을 숫자로 입력해 주세요.'); return; }
    record.mutate({ code: smbgCode, value: v });
  };

  if (trend.isLoading) return <LoadingState />;
  if (trend.isError) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: '만성질환 추이', headerShown: true }} />
        <ErrorState message="추이를 불러오지 못했습니다 — 기록이 없는 것이 아닙니다." onRetry={() => trend.refetch()} />
      </View>
    );
  }

  const data = (trend.data as { data?: { series?: Record<string, TrendPoint[]>; summary?: Record<string, TrendSummary> } } | undefined)?.data;
  const series = data?.series ?? {};
  const summary = data?.summary ?? {};
  const codes = Object.keys(series);
  const selectedMeta = SMBG_CODES.find((c) => c.code === smbgCode);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '만성질환 추이', headerShown: true }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={trend.isRefetching} onRefresh={() => trend.refetch()} />}>

        {/* 자가측정 입력 — ChronicObservation(source=SMBG) 합류 */}
        <InfoCard title="자가측정 기록" subtitle="혈압·혈당·체중을 직접 기록하면 진료 차트와 같은 원장에 남습니다" accentColor="#4F46E5">
          <View style={s.codeRow}>
            {SMBG_CODES.map((c) => (
              <TouchableOpacity key={c.code} style={[s.codeChip, smbgCode === c.code && s.codeChipOn]} onPress={() => setSmbgCode(c.code)}>
                <Text style={[s.codeChipText, smbgCode === c.code && s.codeChipTextOn]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={smbgValue}
              onChangeText={setSmbgValue}
              placeholder={selectedMeta?.placeholder ?? ''}
              keyboardType="decimal-pad"
            />
            <Text style={s.unit}>{selectedMeta?.unit ?? ''}</Text>
            <TouchableOpacity style={[s.saveBtn, (record.isPending || !smbgValue) && s.saveBtnOff]} disabled={record.isPending || !smbgValue} onPress={submitSmbg}>
              <Text style={s.saveBtnText}>{record.isPending ? '저장 중…' : '기록'}</Text>
            </TouchableOpacity>
          </View>
        </InfoCard>

        {codes.length === 0 ? (
          <EmptyState icon="pulse-outline" message="아직 만성질환 관찰 기록이 없습니다. 위에서 자가측정을 기록해 보세요." />
        ) : (
          codes.map((code) => {
            const pts = series[code] ?? [];
            const sm = summary[code];
            const recent = pts.slice(-8);
            const vals = recent.map((p) => p.value);
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const span = max - min || 1;
            const trendMeta = sm?.trend ? TREND_LABEL[sm.trend] : null;
            return (
              <InfoCard key={code} title={CHRONIC_LABEL[code] ?? code} accentColor="#3B82F6">
                <View style={s.summaryRow}>
                  <Text style={s.latest}>
                    {sm?.latest != null ? sm.latest : '—'}
                    <Text style={s.latestUnit}> {sm?.unit ?? ''}</Text>
                  </Text>
                  {sm?.delta != null && (
                    <Text style={[s.delta, sm.delta > 0 ? s.deltaUp : sm.delta < 0 ? s.deltaDown : null]}>
                      {sm.delta > 0 ? '▲' : sm.delta < 0 ? '▼' : '—'} {Math.abs(sm.delta)}
                    </Text>
                  )}
                  {trendMeta && (
                    <View style={[s.trendBadge, { backgroundColor: `${trendMeta.color}18` }]}>
                      <Text style={[s.trendText, { color: trendMeta.color }]}>{trendMeta.text}</Text>
                    </View>
                  )}
                </View>
                {sm?.measuredAt && <Text style={s.measuredAt}>최근 측정 {formatDate(sm.measuredAt)} · 총 {sm.count}회</Text>}

                {/* 최근 값 막대 — 코드 내 상대 크기. 값·플래그를 함께 찍는다(막대만으로 말하지 않는다) */}
                <View style={s.bars}>
                  {recent.map((p, i) => {
                    const h = 12 + Math.round(((p.value - min) / span) * 36);
                    const abnormal = p.flag != null && p.flag !== 'N';
                    return (
                      <View key={i} style={s.barCol}>
                        <Text style={[s.barValue, abnormal && s.barValueAbn]}>{p.value}</Text>
                        <View style={[s.bar, { height: h }, abnormal && s.barAbn]} />
                        <Text style={s.barDate}>{String(p.measuredAt).slice(5, 10)}</Text>
                      </View>
                    );
                  })}
                </View>
              </InfoCard>
            );
          })
        )}

        <Text style={s.footnote}>기록은 병원 차트와 동일한 원장(ChronicObservation)에 저장되며, 진료 시 의료진이 함께 봅니다.</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  codeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  codeChip: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderRadius: 20, backgroundColor: '#F3F4F6' },
  codeChipOn: { backgroundColor: '#4F46E5' },
  codeChipText: { fontSize: 13, color: '#4B5563', fontWeight: '600' },
  codeChipTextOn: { color: '#FFFFFF' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 12, fontSize: 16, backgroundColor: '#FFFFFF' },
  unit: { fontSize: 13, color: '#6B7280', width: 48 },
  saveBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#4F46E5', justifyContent: 'center' },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  latest: { fontSize: 26, fontWeight: '800', color: '#111827' },
  latestUnit: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  delta: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  deltaUp: { color: '#EF4444' },
  deltaDown: { color: '#2563EB' },
  trendBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  trendText: { fontSize: 12, fontWeight: '700' },
  measuredAt: { fontSize: 11, color: '#9CA3AF', marginTop: 4 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12 },
  barCol: { alignItems: 'center', flex: 1 },
  barValue: { fontSize: 9, color: '#6B7280', marginBottom: 2 },
  barValueAbn: { color: '#DC2626', fontWeight: '700' },
  bar: { width: 14, borderRadius: 4, backgroundColor: '#93C5FD' },
  barAbn: { backgroundColor: '#FCA5A5' },
  barDate: { fontSize: 8, color: '#9CA3AF', marginTop: 2 },
  footnote: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 8, lineHeight: 16 },
});
