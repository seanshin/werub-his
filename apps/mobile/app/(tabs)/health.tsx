import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput, Alert, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { InfoCard } from '../../src/components/common/InfoCard';
import { formatDate } from '../../src/lib/format';
import { isAbnormalFlag, flagMark } from '../../src/lib/lab-flags';
import { VACCINATION_RECORDING_SUPPORTED, VACCINATION_UNSUPPORTED_NOTE } from '../../src/lib/record-availability';

export default function HealthScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [memoText, setMemoText] = useState('');

  const vaccinations = useQuery({ queryKey: ['vaccinations'], queryFn: () => apiClient.get('/api/v1/portal/vaccinations') });
  const allergies = useQuery({ queryKey: ['allergies'], queryFn: () => apiClient.get('/api/v1/portal/allergies') });
  const memos = useQuery({ queryKey: ['health-memos'], queryFn: () => apiClient.get('/api/v1/portal/health-memos') });
  const labTrends = useQuery({ queryKey: ['lab-trends'], queryFn: () => apiClient.get('/api/v1/portal/lab-trends') });
  const checkups = useQuery({ queryKey: ['checkup-visits'], queryFn: () => apiClient.get('/api/v1/portal/checkup-visits') });
  const satisfaction = useQuery({ queryKey: ['satisfaction'], queryFn: () => apiClient.get('/api/v1/portal/satisfaction') });
  const surgeryChecklist = useQuery({ queryKey: ['surgery-checklist'], queryFn: () => apiClient.get('/api/v1/portal/surgery-checklist') });
  const insuranceGuide = useQuery({ queryKey: ['insurance-guide'], queryFn: () => apiClient.get('/api/v1/portal/insurance-guide') });

  const createMemo = useMutation({
    mutationFn: (content: string) => apiClient.post('/api/v1/portal/health-memos', { content }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['health-memos'] }); setMemoText(''); },
  });

  const vaccList: any[] = (vaccinations.data as any)?.data ?? [];
  const allergyList: any[] = (allergies.data as any)?.data ?? [];
  const memoList: any[] = (memos.data as any)?.data ?? [];
  const trendList: any[] = (labTrends.data as any)?.data ?? [];
  const checkupList: any[] = (checkups.data as any)?.data ?? [];
  const satList: any[] = (satisfaction.data as any)?.data ?? [];
  const checklistRaw: any = (surgeryChecklist.data as any)?.data;
  // 🔴 서버는 수술전 체크리스트를 **배열**로 낸다. 종전 `checklist && (...)` 는 빈 배열([])도 truthy 라
  //    항목이 하나도 없는 환자에게 "수술 전 체크리스트" 카드를 띄우고 본문에 `[]` 를 그대로 찍었다.
  const checklist: any[] = Array.isArray(checklistRaw) ? checklistRaw : checklistRaw ? [checklistRaw] : [];
  const insurance: any = (insuranceGuide.data as any)?.data;

  const isLoading = vaccinations.isLoading;
  const onRefresh = () => {
    vaccinations.refetch(); allergies.refetch(); memos.refetch();
    labTrends.refetch(); checkups.refetch(); satisfaction.refetch();
    surgeryChecklist.refetch(); insuranceGuide.refetch();
  };

  if (isLoading) return <LoadingState />;

  // 🔴 종전: 어느 쿼리가 실패해도 `?? []` 로 빈 배열이 되어 화면이 "없습니다"라고 말했다.
  //    알레르기 조회 실패를 "알레르기 없음"으로 보이게 하는 건 환자 안전 문제다(P17).
  //    조회에 실패한 항목은 실패했다고 말한다.
  const failed = [
    allergies.isError && '알레르기',
    vaccinations.isError && '예방접종',
    labTrends.isError && '검사 추이',
    checkups.isError && '건강검진 이력',
    memos.isError && '건강 메모',
    satisfaction.isError && '만족도',
    surgeryChecklist.isError && '수술 전 체크리스트',
    insuranceGuide.isError && '실비보험 안내',
  ].filter(Boolean) as string[];

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '건강 관리', headerShown: true }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={vaccinations.isRefetching} onRefresh={onRefresh} />}>

        {/* 조회 실패 고지 — 실패를 "없음"으로 보이게 하지 않는다 */}
        {failed.length > 0 && (
          <View style={s.failBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
            <Text style={s.failText}>
              {failed.join(' · ')} 정보를 불러오지 못했습니다. 아래 목록이 비어 있어도 “없음”이 아닙니다.
            </Text>
          </View>
        )}

        {/* 검사 추이 */}
        {trendList.length > 0 && (
          <InfoCard title="검사 결과 추이" accentColor="#3B82F6">
            {trendList.slice(0, 5).map((t: any, i: number) => (
              <View key={i} style={s.trendRow}>
                <Text style={s.trendName}>{t.testName}</Text>
                <View style={s.trendValues}>
                  {/* 🔴 종전 `flag !== 'NORMAL'` → 서버 실측값 'N'(정상)이 전부 붉게 칠해졌다 */}
                  {(t.data ?? []).slice(-3).map((d: any, j: number) => (
                    <Text key={j} style={[s.trendValue, isAbnormalFlag(d.flag) && s.trendFlag]}>
                      {d.value}{d.unit ? ` ${d.unit}` : ''}{flagMark(d.flag)}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </InfoCard>
        )}

        {/* 알레르기 */}
        {allergyList.length > 0 && (
          <InfoCard title={`알레르기 (${allergyList.length})`} accentColor="#DC2626">
            {allergyList.map((a: any, i: number) => (
              <View key={i} style={s.itemRow}>
                <Ionicons name="warning-outline" size={14} color="#DC2626" />
                <Text style={s.itemText}>{a.allergen ?? a.name ?? a.substance}</Text>
                {a.severity && <Text style={s.severity}>{a.severity}</Text>}
              </View>
            ))}
          </InfoCard>
        )}

        {/* 예방접종 */}
        <InfoCard title={`예방접종 (${vaccList.length})`} accentColor="#10B981">
          {vaccList.length > 0 ? vaccList.slice(0, 8).map((v: any, i: number) => (
            <View key={i} style={s.vaccRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color="#10B981" />
              <Text style={s.vaccName}>{v.vaccineName ?? v.name}</Text>
              <Text style={s.vaccDate}>{v.administeredAt ? formatDate(v.administeredAt) : v.date ? formatDate(v.date) : ''}</Text>
            </View>
          )) : (
            /* 🔴 원내에 접종을 쓰는 경로가 없다(2026-09-02 실측 — 읽는 곳 3, 쓰는 곳 0).
               그런 빈 목록을 "기록이 없습니다"라고 말하면 환자는 자기 이력으로 읽는다. */
            <Text style={s.emptyText}>
              {VACCINATION_RECORDING_SUPPORTED ? '예방접종 기록이 없습니다' : VACCINATION_UNSUPPORTED_NOTE}
            </Text>
          )}
        </InfoCard>

        {/* 건강검진 이력 */}
        {checkupList.length > 0 && (
          <InfoCard title={`건강검진 이력 (${checkupList.length})`} accentColor="#6366F1">
            {/* 🔴 검진 상세 화면(app/(tabs)/checkup-detail.tsx)은 만들어져 있었지만 앱 어디에서도
                열 수 없었다(라우터 진입점 부재). 목록에서 들어갈 수 있게 잇는다. */}
            {checkupList.slice(0, 5).map((c: any, i: number) => (
              <TouchableOpacity
                key={i}
                style={s.checkupRow}
                onPress={() => router.push({ pathname: '/checkup-detail', params: { id: c.id } } as any)}
              >
                <Text style={s.checkupProgram}>{c.program?.name ?? '건강검진'}</Text>
                {/* 판정 등급이 아직 없으면 '-'(값 없음)이 아니라 "판정 전"이라고 말한다 */}
                <Text style={s.checkupGrade}>{c.summary?.overallGrade ?? '판정 전'}</Text>
                <Text style={s.checkupDate}>{c.scheduledDate ? formatDate(c.scheduledDate) : ''}</Text>
                <Ionicons name="chevron-forward" size={14} color="#D1D5DB" />
              </TouchableOpacity>
            ))}
          </InfoCard>
        )}

        {/* 만족도 평가 */}
        {Array.isArray(satList) && satList.length > 0 && (
          <InfoCard title="만족도 평가 이력" accentColor="#F59E0B">
            {satList.slice(0, 3).map((sat: any, i: number) => (
              <View key={i} style={s.satRow}>
                {/* 🔴 평점이 없는 응답을 ☆☆☆☆☆(0점)으로 표시하지 않는다 — 미평가와 최저점은 다른 사실이다 */}
                {typeof sat.overallRating === 'number' ? (
                  <Text style={s.satRating}>{'★'.repeat(sat.overallRating)}{'☆'.repeat(Math.max(0, 5 - sat.overallRating))}</Text>
                ) : (
                  <Text style={s.satComment}>평점 미입력</Text>
                )}
                {sat.comment && <Text style={s.satComment} numberOfLines={1}>{sat.comment}</Text>}
              </View>
            ))}
          </InfoCard>
        )}

        {/* 수술전 체크리스트 */}
        {checklist.length > 0 && (
          <InfoCard title={`수술 전 체크리스트 (${checklist.length})`} accentColor="#EF4444">
            {checklist.map((c: any, i: number) => (
              <View key={i} style={s.itemRow}>
                <Ionicons
                  name={c.done || c.completed ? 'checkmark-circle' : 'ellipse-outline'}
                  size={14}
                  color={c.done || c.completed ? '#10B981' : '#9CA3AF'}
                />
                <Text style={s.itemText}>{c.title ?? c.label ?? c.description ?? c.name ?? c.item ?? ''}</Text>
                {c.dueDate && <Text style={s.checkupDate}>{formatDate(c.dueDate)}</Text>}
              </View>
            ))}
          </InfoCard>
        )}

        {/* 실비보험 안내 — 🔴 종전 JSON.stringify(...).slice(0,300) 로 원시 JSON 이 문장 중간에서
            잘린 채 환자 화면에 그대로 찍혔다. 서버는 {title, steps[], requiredDocuments[], tips[]} 를 낸다. */}
        {insurance && (
          <InfoCard title={insurance.title ?? '실비보험 청구 안내'} accentColor="#8B5CF6">
            {typeof insurance === 'string' ? (
              <Text style={s.insuranceText}>{insurance}</Text>
            ) : (
              <>
                {Array.isArray(insurance.steps) && insurance.steps.map((st: any, i: number) => (
                  <View key={`st-${i}`} style={s.stepRow}>
                    <Text style={s.stepNum}>{st.step ?? i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.stepTitle}>{st.title}</Text>
                      {st.description && <Text style={s.stepDesc}>{st.description}</Text>}
                    </View>
                  </View>
                ))}
                {Array.isArray(insurance.requiredDocuments) && insurance.requiredDocuments.length > 0 && (
                  <View style={s.subSection}>
                    <Text style={s.subTitle}>필요 서류</Text>
                    {insurance.requiredDocuments.map((d: any, i: number) => (
                      <Text key={`doc-${i}`} style={s.stepDesc}>
                        · {d.name}{d.where ? ` — ${d.where}` : ''}{d.note ? ` (${d.note})` : ''}
                      </Text>
                    ))}
                  </View>
                )}
                {Array.isArray(insurance.tips) && insurance.tips.length > 0 && (
                  <View style={s.subSection}>
                    <Text style={s.subTitle}>참고</Text>
                    {insurance.tips.map((t: string, i: number) => (
                      <Text key={`tip-${i}`} style={s.stepDesc}>· {t}</Text>
                    ))}
                  </View>
                )}
              </>
            )}
          </InfoCard>
        )}

        {/* 건강 메모 */}
        <InfoCard title={`건강 메모 (${memoList.length})`} accentColor="#6B7280">
          <View style={s.memoInput}>
            <TextInput
              style={s.memoTextInput}
              value={memoText}
              onChangeText={setMemoText}
              placeholder="건강 메모를 입력하세요"
              placeholderTextColor="#9CA3AF"
              multiline
            />
            <TouchableOpacity
              style={[s.memoBtn, !memoText.trim() && s.memoBtnDisabled]}
              disabled={!memoText.trim() || createMemo.isPending}
              onPress={() => createMemo.mutate(memoText.trim())}
            >
              <Ionicons name="add" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
          {memoList.slice(0, 5).map((m: any, i: number) => (
            <View key={i} style={s.memoRow}>
              <Text style={s.memoContent}>{m.content}</Text>
              <Text style={s.memoDate}>{m.createdAt ? formatDate(m.createdAt) : ''}</Text>
            </View>
          ))}
        </InfoCard>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  emptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 8 },
  trendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  trendName: { fontSize: 13, fontWeight: '600', color: '#374151', flex: 1 },
  trendValues: { flexDirection: 'row', gap: 12 },
  trendValue: { fontSize: 12, color: '#1F2937', fontVariant: ['tabular-nums'] },
  trendFlag: { color: '#EF4444', fontWeight: '700' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  itemText: { fontSize: 13, color: '#374151', flex: 1 },
  severity: { fontSize: 11, fontWeight: '600', color: '#DC2626' },
  vaccRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  vaccName: { fontSize: 13, color: '#374151', flex: 1 },
  vaccDate: { fontSize: 11, color: '#9CA3AF' },
  checkupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  checkupProgram: { fontSize: 13, color: '#374151', flex: 1 },
  checkupGrade: { fontSize: 13, fontWeight: '800', color: '#4F46E5', width: 52, textAlign: 'center' },
  checkupDate: { fontSize: 11, color: '#9CA3AF', width: 80 },
  satRow: { paddingVertical: 4 },
  satRating: { fontSize: 14, color: '#F59E0B' },
  satComment: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  insuranceText: { fontSize: 13, color: '#374151', lineHeight: 20 },
  failBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 12 },
  failText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  stepRow: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#EDE9FE', color: '#6D28D9', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 20, overflow: 'hidden' },
  stepTitle: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  stepDesc: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 18 },
  subSection: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  subTitle: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 4 },
  memoInput: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  memoTextInput: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, borderWidth: 1, borderColor: '#E5E7EB', minHeight: 40 },
  memoBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#4F46E5', justifyContent: 'center', alignItems: 'center' },
  memoBtnDisabled: { opacity: 0.4 },
  memoRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  memoContent: { fontSize: 13, color: '#374151' },
  memoDate: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
});
