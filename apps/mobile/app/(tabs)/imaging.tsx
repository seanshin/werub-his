import React from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { formatDate } from '../../src/lib/format';

export default function ImagingScreen() {
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['imaging-studies'],
    queryFn: () => apiClient.get('/api/v1/portal/imaging/studies'),
  });
  const reports = useQuery({
    queryKey: ['imaging-reports'],
    queryFn: () => apiClient.get('/api/v1/portal/imaging/reports'),
  });

  /**
   * 🔴 2026-08-14(W9) 계약 불일치. 서버(PACS 프록시)는 **객체**를 낸다(실측):
   *      /portal/imaging/studies → { data: { studies: [...], total_studies: N } }
   *      /portal/imaging/reports → { data: { reports: [...] } }
   *    종전 `(data as any)?.data ?? []` 는 그 객체를 그대로 FlatList 에 넘겼고,
   *    VirtualizedList 는 배열이 아니면 항목 수를 0 으로 보므로 **영상이 있어도 항상
   *    "영상검사 기록이 없습니다"** 였다. reportList 는 계산만 하고 어디에도 안 그렸다.
   */
  const studiesPayload: any = (data as any)?.data;
  const studies: any[] = Array.isArray(studiesPayload)
    ? studiesPayload
    : Array.isArray(studiesPayload?.studies) ? studiesPayload.studies : [];

  const reportsPayload: any = (reports.data as any)?.data;
  const reportList: any[] = Array.isArray(reportsPayload)
    ? reportsPayload
    : Array.isArray(reportsPayload?.reports) ? reportsPayload.reports : [];

  /**
   * 🔴 2026-08-18. 서버가 오늘부터 **PACS 조회 실패를 503 `PACS_UNAVAILABLE` 로 말한다**
   *    (종전: HTTP 200 + 빈 목록). `/portal/imaging/studies` 와 `/imaging/reports` 둘 다 해당한다.
   *    - studies 는 `isError` 분기가 있었지만 문구가 일반 오류라 "영상이 없는 게 아니다"를 못 전했다.
   *    - 🔴 reports 는 실패해도 `reportList` 가 `[]` 가 되어 **판독 리포트 푸터가 통째로 사라졌다** —
   *      조회 실패가 "판독문 없음"으로 보이던 것(P17). 실패는 실패라고 말한다.
   */
  const failMessage = (e: unknown, fallback: string): string => {
    const code = (e as { code?: string } | null)?.code;
    const msg = (e as { message?: string } | null)?.message;
    if (code === 'PACS_UNAVAILABLE') {
      return msg ?? '영상 보관 시스템에서 자료를 불러오지 못했습니다. 영상이 없는 것이 아닙니다.';
    }
    return msg ?? fallback;
  };

  if (isLoading) return <LoadingState />;
  if (isError) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: '영상검사', headerShown: true }} />
        <ErrorState
          message={failMessage(error, '영상검사 목록을 불러오지 못했습니다')}
          onRetry={() => { refetch(); reports.refetch(); }}
        />
      </View>
    );
  }

  const renderStudy = ({ item }: { item: any }) => (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.iconCircle}>
          <Ionicons name="scan-outline" size={18} color="#6366F1" />
        </View>
        <View style={s.cardBody}>
          <Text style={s.studyName}>{item.modality ?? 'Study'} — {item.bodyPart ?? item.description ?? ''}</Text>
          <Text style={s.studyDate}>{item.studyDate ? formatDate(item.studyDate) : item.accessionNumber ?? ''}</Text>
        </View>
        {/* 🔴 종전 이진 삼항이라 판독 상태를 모르는 검사(undefined)·취소 건까지 전부 "대기"라고
            단정했다. 아는 값만 말하고 모르면 모른다고 한다. */}
        {(() => {
          const st = REPORT_STATUS[item.reportStatus];
          if (!st) {
            return (
              <View style={[s.statusBadge, s.badgeGray]}>
                <Text style={[s.statusText, s.statusTextGray]}>
                  {item.reportStatus ? String(item.reportStatus) : '상태 미상'}
                </Text>
              </View>
            );
          }
          return (
            <View style={[s.statusBadge, st.style]}>
              <Text style={[s.statusText, st.textStyle]}>{st.label}</Text>
            </View>
          );
        })()}
      </View>
      {item.finding && (
        <View style={s.findingBox}>
          <Text style={s.findingLabel}>판독 소견</Text>
          <Text style={s.findingText} numberOfLines={3}>{item.finding}</Text>
        </View>
      )}
      {item.impression && (
        <Text style={s.impression} numberOfLines={2}>{item.impression}</Text>
      )}
    </View>
  );

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '영상검사', headerShown: true }} />
      <FlatList
        contentContainerStyle={studies.length === 0 ? s.empty : s.list}
        data={studies}
        keyExtractor={(item, i) => item.studyInstanceUid ?? item.id ?? String(i)}
        renderItem={renderStudy}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); reports.refetch(); }} />}
        ListEmptyComponent={<EmptyState icon="scan-outline" message="영상검사 기록이 없습니다" />}
        /* 🔴 판독문 조회가 실패했으면 푸터가 비는 것을 "판독문 없음"으로 읽게 두지 않는다(2026-08-18). */
        ListHeaderComponent={
          reports.isError ? (
            <View style={s.failBanner}>
              <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
              <View style={s.failBody}>
                <Text style={s.failText}>
                  {failMessage(reports.error, '판독 리포트를 불러오지 못했습니다. 판독문이 없는 것이 아닙니다.')}
                </Text>
                <TouchableOpacity onPress={() => reports.refetch()}>
                  <Text style={s.failRetry}>다시 시도</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null
        }
        /* 🔴 판독 리포트는 받아만 놓고 어디에도 그리지 않았다 — 환자가 앱에서 판독문을 볼 수 없었다. */
        ListFooterComponent={
          reportList.length > 0 ? (
            <View>
              <Text style={s.reportHeader}>판독 리포트 ({reportList.length})</Text>
              {reportList.map((r: any, i: number) => (
                <View key={r.id ?? r.studyInstanceUid ?? i} style={s.reportCard}>
                  <Text style={s.reportTitle}>
                    {[r.modality, r.bodyPart ?? r.description].filter(Boolean).join(' — ') || '판독 리포트'}
                  </Text>
                  {(r.reportedAt ?? r.studyDate) && (
                    <Text style={s.reportDate}>{formatDate(r.reportedAt ?? r.studyDate)}</Text>
                  )}
                  {(r.impression ?? r.finding ?? r.text) && (
                    <Text style={s.reportBody}>{r.impression ?? r.finding ?? r.text}</Text>
                  )}
                </View>
              ))}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  list: { padding: 16, paddingBottom: 32 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center' },
  cardBody: { flex: 1 },
  studyName: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  studyDate: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeGreen: { backgroundColor: '#D1FAE5' },
  badgeAmber: { backgroundColor: '#FEF3C7' },
  badgeGray: { backgroundColor: '#F3F4F6' },
  statusText: { fontSize: 11, fontWeight: '600', color: '#065F46' },
  statusTextAmber: { color: '#92400E' },
  statusTextGray: { color: '#6B7280' },
  failBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 12 },
  failBody: { flex: 1 },
  failText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  failRetry: { fontSize: 12, fontWeight: '700', color: '#B45309', marginTop: 6, textDecorationLine: 'underline' },
  reportHeader: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 8, marginBottom: 8 },
  reportCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: '#6366F1' },
  reportTitle: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  reportDate: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  reportBody: { fontSize: 13, color: '#374151', marginTop: 6, lineHeight: 20 },
  findingBox: { marginTop: 10, backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10 },
  findingLabel: { fontSize: 11, fontWeight: '600', color: '#6B7280', marginBottom: 4 },
  findingText: { fontSize: 13, color: '#374151', lineHeight: 20 },
  impression: { fontSize: 12, color: '#6B7280', marginTop: 6, fontStyle: 'italic' },
});

/**
 * PACS 판독 상태 표시 — 아는 값만 등재한다.
 * 🔴 여기에 없는 값(취소·재판독·미정 등)을 "대기"로 뭉뚱그리지 않는다.
 * (StyleSheet `s` 이후에 선언해야 TDZ 를 피한다 — CheckupCard 의 CONG_DOT 과 같은 패턴)
 */
const REPORT_STATUS: Record<string, { label: string; style: any; textStyle?: any }> = {
  REPORTED: { label: '판독완료', style: s.badgeGreen },
  FINAL: { label: '판독완료', style: s.badgeGreen },
  PRELIMINARY: { label: '예비판독', style: s.badgeAmber, textStyle: s.statusTextAmber },
  PENDING: { label: '판독 대기', style: s.badgeAmber, textStyle: s.statusTextAmber },
  UNREPORTED: { label: '판독 대기', style: s.badgeAmber, textStyle: s.statusTextAmber },
  CANCELLED: { label: '취소', style: s.badgeGray, textStyle: s.statusTextGray },
};
