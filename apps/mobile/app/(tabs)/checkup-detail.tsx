import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { InfoCard } from '../../src/components/common/InfoCard';
import { formatDate } from '../../src/lib/format';

export default function CheckupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['checkup-detail', id],
    queryFn: () => apiClient.get(`/api/v1/portal/checkup-visits/${id}`),
    enabled: !!id,
  });

  const summary = useQuery({
    queryKey: ['checkup-summary', id],
    queryFn: () => apiClient.get(`/api/v1/portal/checkup-visits/${id}/summary`),
    enabled: !!id,
  });

  const visit: any = (data as any)?.data;
  const summaryData: any = (summary.data as any)?.data;

  if (isLoading) return <LoadingState />;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '검진 결과 상세', headerShown: true }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); summary.refetch(); }} />}>

        {visit && (
          <>
            <View style={s.banner}>
              <Text style={s.programName}>{visit.program?.name ?? '건강검진'}</Text>
              <Text style={s.visitDate}>{visit.scheduledDate ? formatDate(visit.scheduledDate) : ''}</Text>
            </View>

            {/* 종합 판정 */}
            {summaryData && (
              <InfoCard title="종합 판정" accentColor="#4F46E5">
                {summaryData.overallGrade && (
                  <View style={s.gradeRow}>
                    <Text style={s.gradeLabel}>종합 등급</Text>
                    <Text style={s.gradeValue}>{summaryData.overallGrade}</Text>
                  </View>
                )}
                {summaryData.doctorOpinion && <Text style={s.opinion}>{summaryData.doctorOpinion}</Text>}
                {summaryData.recommendations?.length > 0 && (
                  <View style={s.recSection}>
                    <Text style={s.recTitle}>권고사항</Text>
                    {summaryData.recommendations.map((r: string, i: number) => (
                      <View key={i} style={s.recRow}>
                        <Ionicons name="checkmark-circle-outline" size={14} color="#10B981" />
                        <Text style={s.recText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {summaryData.sections?.length > 0 && (
                  <View style={s.sectionsArea}>
                    {summaryData.sections.map((sec: any, i: number) => (
                      <View key={i} style={s.sectionRow}>
                        <Text style={s.sectionArea}>{sec.area}</Text>
                        <Text style={[s.sectionGrade, (sec.grade === 'C2' || sec.grade === 'D1' || sec.grade === 'D2') && s.gradeWarn]}>{sec.grade}</Text>
                        {sec.findings && <Text style={s.sectionFindings} numberOfLines={2}>{sec.findings}</Text>}
                      </View>
                    ))}
                  </View>
                )}
              </InfoCard>
            )}

            {/* 검사 항목 */}
            {visit.items?.length > 0 && (
              <InfoCard title={`검사 항목 (${visit.items.length})`} accentColor="#3B82F6">
                {visit.items.map((item: any, i: number) => (
                  <View key={i} style={s.itemRow}>
                    <Ionicons name={item.finding === 'NORMAL' ? 'checkmark-circle' : item.finding === 'ABNORMAL' ? 'alert-circle' : 'ellipse-outline'} size={16} color={item.finding === 'NORMAL' ? '#10B981' : item.finding === 'ABNORMAL' ? '#EF4444' : '#9CA3AF'} />
                    <Text style={s.itemName} numberOfLines={1}>{item.testName}</Text>
                    <Text style={[s.itemValue, item.finding === 'ABNORMAL' && s.itemFlag]}>{item.value ?? ''}{item.unit ? ` ${item.unit}` : ''}</Text>
                  </View>
                ))}
              </InfoCard>
            )}

            {/* 추적 관리 */}
            {visit.followUps?.length > 0 && (
              <InfoCard title="추적 관리" accentColor="#F59E0B">
                {visit.followUps.map((f: any, i: number) => (
                  <View key={i} style={s.followRow}>
                    <Text style={s.followType}>{f.followUpType}</Text>
                    <Text style={s.followDesc}>{f.description}</Text>
                    {f.dueDate && <Text style={s.followDate}>예정: {formatDate(f.dueDate)}</Text>}
                  </View>
                ))}
              </InfoCard>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  banner: { backgroundColor: '#EEF2FF', borderRadius: 12, padding: 16, marginBottom: 12, alignItems: 'center' },
  programName: { fontSize: 18, fontWeight: '700', color: '#4338CA' },
  visitDate: { fontSize: 13, color: '#6366F1', marginTop: 4 },
  gradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  gradeLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  gradeValue: { fontSize: 28, fontWeight: '800', color: '#4F46E5' },
  opinion: { fontSize: 14, color: '#374151', lineHeight: 22, marginBottom: 10 },
  recSection: { marginTop: 8 },
  recTitle: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4 },
  recRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 3 },
  recText: { fontSize: 13, color: '#374151', flex: 1, lineHeight: 20 },
  sectionsArea: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  sectionArea: { fontSize: 13, color: '#374151', flex: 1 },
  sectionGrade: { fontSize: 14, fontWeight: '700', color: '#4F46E5', width: 30, textAlign: 'center' },
  gradeWarn: { color: '#DC2626' },
  sectionFindings: { fontSize: 11, color: '#6B7280', flex: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  itemName: { fontSize: 13, color: '#374151', flex: 1 },
  itemValue: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  itemFlag: { color: '#DC2626' },
  followRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  followType: { fontSize: 11, fontWeight: '600', color: '#F59E0B' },
  followDesc: { fontSize: 13, color: '#374151', marginTop: 2 },
  followDate: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
});
