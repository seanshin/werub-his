import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';

/**
 * 서버 `/api/v1/portal/medication-schedule` 실제 응답(실측):
 *   [{ id, name, dosage, frequency, route, slots: ['아침 식후', ...], checks: { '아침 식후': true } }]
 *
 * 🔴 2026-08-14(W9) 두 건을 함께 봉합.
 *  1) 슬롯 문자열 불일치 — 서버 정본(apps/api .../frequency-slots.util.ts MEDICATION_SLOTS)은
 *     '아침 식후'·'점심 식후'·'저녁 식후'·'취침 전' 이다. 종전 모바일은 `slots.includes('아침')`
 *     처럼 **완전 일치**로 비교해 단 하나도 매칭되지 않았고, `slots.length === 0` 폴백도 타지
 *     않아(길이 1) 처방 7건이 전부 어느 시간대에도 안 들어갔다 → 전 시간대 "복약이 없습니다",
 *     진행률 0/0. 운영 계정에서 실측 확인.
 *  2) 복용 체크 상태 — 서버는 `checks[slot]` 로 준다. 종전 화면은 존재하지도 않는 `isChecked`
 *     를 읽어 **체크해도 영구 미완료**였고, POST 때 slot 을 'manual' 로 보내 정본 슬롯과
 *     다른 칸에 기록돼 복약 리마인더 크론도 그 체크를 보지 못했다(했는데 안 한 것이 됨).
 */
const MEDICATION_SLOTS = ['아침 식후', '점심 식후', '저녁 식후', '취침 전'] as const;
type MedicationSlot = (typeof MEDICATION_SLOTS)[number];

interface MedicationItem {
  id: string;
  name: string | null;
  dosage: string | null;
  frequency: string | null;
  route?: string | null;
  slots: string[];
  checks?: Record<string, boolean>;
}

type ScheduleData = Record<MedicationSlot, MedicationItem[]>;

const EMPTY_SCHEDULE = (): ScheduleData => ({
  '아침 식후': [], '점심 식후': [], '저녁 식후': [], '취침 전': [],
});

/** 서버가 준 slots 를 그대로 신뢰한다 — 모바일이 frequency 를 다시 해석하면 정본이 둘이 된다. */
function classifyBySlot(meds: MedicationItem[]): { schedule: ScheduleData; unslotted: MedicationItem[] } {
  const schedule = EMPTY_SCHEDULE();
  const unslotted: MedicationItem[] = [];
  for (const m of meds) {
    const slots = (m.slots ?? []).filter((sl): sl is MedicationSlot =>
      (MEDICATION_SLOTS as readonly string[]).includes(sl),
    );
    if (slots.length === 0) {
      // 🔴 슬롯을 모르는 약을 '아침'에 밀어넣지 않는다 — 임의 배정은 복약 시각 오정보다.
      unslotted.push(m);
      continue;
    }
    for (const sl of slots) schedule[sl].push(m);
  }
  return { schedule, unslotted };
}

const isTaken = (med: MedicationItem, slot: MedicationSlot) => med.checks?.[slot] === true;

const TIME_SLOTS: {
  key: MedicationSlot;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}[] = [
  { key: '아침 식후', label: '아침 식후', icon: 'sunny-outline', color: '#F59E0B' },
  { key: '점심 식후', label: '점심 식후', icon: 'partly-sunny-outline', color: '#10B981' },
  { key: '저녁 식후', label: '저녁 식후', icon: 'moon-outline', color: '#6366F1' },
  { key: '취침 전', label: '취침 전', icon: 'bed-outline', color: '#8B5CF6' },
];

export default function MedicationScreen() {
  const queryClient = useQueryClient();
  const [expandedSlot, setExpandedSlot] = useState<MedicationSlot | null>('아침 식후');

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['medication-schedule'],
    queryFn: () =>
      apiClient.get<{ data: MedicationItem[] }>(
        '/api/v1/portal/medication-schedule',
      ),
  });

  // 🔴 체크는 정본 슬롯 이름으로 보낸다. 종전 'manual' 은 서버 MedicationCheckLog 에 정본과
  //    다른 슬롯으로 저장돼 화면에도, 복약 리마인더에도 반영되지 않았다.
  const checkMutation = useMutation({
    mutationFn: ({ prescriptionId, slot, taken }: { prescriptionId: string; slot: MedicationSlot; taken: boolean }) =>
      apiClient.post('/api/v1/portal/medication-check', { prescriptionId, slot, taken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medication-schedule'] });
    },
    onError: (err: any) => {
      Alert.alert('오류', err?.message ?? '복약 체크에 실패했습니다.');
    },
  });

  const rawData = (data as any)?.data;
  const medList: MedicationItem[] = Array.isArray(rawData) ? rawData : [];
  const { schedule, unslotted } = classifyBySlot(medList);

  // 진행률의 분모는 "오늘 복용해야 하는 (약 × 시간대)" 이다.
  const totalCount = TIME_SLOTS.reduce((n, slot) => n + schedule[slot.key].length, 0);
  const checkedCount = TIME_SLOTS.reduce(
    (n, slot) => n + schedule[slot.key].filter((m) => isTaken(m, slot.key)).length,
    0,
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '복약 관리', headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen
        options={{
          title: '복약 관리',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {/* 🔴 조회 실패를 "복약 없음"으로 보이게 하지 않는다 */}
        {isError && (
          <View style={styles.errorBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
            <Text style={styles.errorText}>
              복약 정보를 불러오지 못했습니다. 아래가 비어 있어도 “복약 없음”이 아닙니다.
            </Text>
          </View>
        )}

        {/* 진행률 */}
        <View style={styles.progressCard}>
          <Text style={styles.progressTitle}>오늘의 복약 현황</Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width:
                    totalCount > 0
                      ? `${(checkedCount / totalCount) * 100}%`
                      : '0%',
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {totalCount > 0 ? `${checkedCount}/${totalCount}건 완료` : '오늘 예정된 복약이 없습니다'}
          </Text>
        </View>

        {/* 시간대별 약물 */}
        {TIME_SLOTS.map((slot) => {
          const items = schedule[slot.key] ?? [];
          const isExpanded = expandedSlot === slot.key;
          const slotChecked = items.filter((m) => isTaken(m, slot.key)).length;

          return (
            <View key={slot.key} style={styles.slotCard}>
              <TouchableOpacity
                style={styles.slotHeader}
                onPress={() =>
                  setExpandedSlot(isExpanded ? null : slot.key)
                }
                activeOpacity={0.7}
              >
                <View style={styles.slotLeft}>
                  <View style={[styles.slotIcon, { backgroundColor: slot.color + '18' }]}>
                    <Ionicons name={slot.icon} size={20} color={slot.color} />
                  </View>
                  <View>
                    <Text style={styles.slotLabel}>{slot.label}</Text>
                    <Text style={styles.slotCount}>
                      {items.length}종 / {slotChecked}건 완료
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#9CA3AF"
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.slotBody}>
                  {items.length === 0 ? (
                    <Text style={styles.emptyText}>해당 시간대 복약이 없습니다</Text>
                  ) : (
                    items.map((med) => {
                      const taken = isTaken(med, slot.key);
                      return (
                        <TouchableOpacity
                          key={med.id}
                          style={styles.medRow}
                          disabled={checkMutation.isPending}
                          onPress={() =>
                            // 다시 누르면 해제 — 잘못 누른 복약 기록을 되돌릴 방법이 있어야 한다.
                            checkMutation.mutate({ prescriptionId: med.id, slot: slot.key, taken: !taken })
                          }
                          activeOpacity={0.7}
                        >
                          <View style={[styles.checkbox, taken && styles.checkboxChecked]}>
                            {taken && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                          </View>
                          <View style={styles.medInfo}>
                            {/* 🔴 약품명이 원장에 없으면 "약물"이라고 아는 척하지 않는다 */}
                            <Text style={[styles.medName, taken && styles.medNameChecked]}>
                              {med.name ?? '약품명 미상'}
                            </Text>
                            <Text style={styles.medDose}>
                              {[med.dosage, med.frequency].filter(Boolean).join(' / ') || '용법 정보 없음'}
                            </Text>
                            {med.route && <Text style={styles.medInst}>{med.route}</Text>}
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* 🔴 시간대를 알 수 없는 약을 조용히 버리지 않는다(종전엔 목록에서 사라졌다) */}
        {unslotted.length > 0 && (
          <View style={styles.slotCard}>
            <View style={styles.slotHeader}>
              <View style={styles.slotLeft}>
                <View style={[styles.slotIcon, { backgroundColor: '#F3F4F6' }]}>
                  <Ionicons name="help-outline" size={20} color="#6B7280" />
                </View>
                <View>
                  <Text style={styles.slotLabel}>복용 시간 미지정</Text>
                  <Text style={styles.slotCount}>{unslotted.length}종 · 담당 약사/간호사에게 확인</Text>
                </View>
              </View>
            </View>
            <View style={styles.slotBody}>
              {unslotted.map((med) => (
                <View key={med.id} style={styles.medRow}>
                  <View style={styles.medInfo}>
                    <Text style={styles.medName}>{med.name ?? '약품명 미상'}</Text>
                    <Text style={styles.medDose}>
                      {[med.dosage, med.frequency].filter(Boolean).join(' / ') || '용법 정보 없음'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  progressCard: {
    backgroundColor: '#4F46E5',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 8,
    textAlign: 'right',
  },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  slotCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  slotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  slotLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  slotIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  slotCount: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  slotBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  medInfo: {
    flex: 1,
  },
  medName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  medNameChecked: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },
  medDose: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  medInst: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 16,
  },
});
