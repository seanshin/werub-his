import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { ErrorState } from '../../src/components/common/ErrorState';

/**
 * 여정 타임라인(환자용) — 2026-10-01 여정 P3 포털 검토 반영.
 *  · 주 문장은 서버가 싣는 `label`(shared 표시 정본의 유형별 고정 문구). 종전엔 `description` 만 그려
 *    설명 안전 유형 밖(대부분)이 빈 줄이었다. label 이 없으면 원 코드가 아니라 중립 문구 '기록'.
 *  · 아이콘은 서버 `track` 으로 고른다(어휘에 없는 유형 이름을 화면이 따로 들지 않는다).
 *  · 시각: 발생 시각(occurredAt)이 있으면 그것을, 없으면 **기록일(날짜만)** — 표시용 eventAt 의 시:분을 관측 시각처럼 말하지 않는다.
 *  · 조회 실패는 빈 상태와 다르다(ErrorState + 다시 시도) · 서버가 잘랐으면(meta.truncated) 그렇다고 말한다.
 */
interface TimelineEvent {
  id: string;
  eventType: string;
  eventAt: string;
  description: string | null;
  severity: string | null;
  refType: string | null;
  occurredAt: string | null;
  occurredAtSource: string;
  occurredAtPrecision: 'SECOND' | 'MINUTE' | 'DAY' | null;
  createdAt: string;
  label: string | null;
  track: string | null;
}

interface TimelineResponse {
  data: TimelineEvent[];
  meta?: { truncated?: boolean };
}

const PAGE_LIMIT = 100;

/** 서버 트랙(shared JOURNEY_TRACKS 키) → 모바일 아이콘 */
const TRACK_ICONS: Record<string, { icon: string; color: string }> = {
  OPD: { icon: 'medkit-outline', color: '#8B5CF6' },
  ER: { icon: 'pulse-outline', color: '#EF4444' },
  IPD: { icon: 'bed-outline', color: '#6366F1' },
  OR: { icon: 'cut-outline', color: '#F59E0B' },
  CHECKUP: { icon: 'clipboard-outline', color: '#0EA5E9' },
  ORDER: { icon: 'flask-outline', color: '#3B82F6' },
  BILLING: { icon: 'card-outline', color: '#10B981' },
  CONSENT: { icon: 'document-text-outline', color: '#64748B' },
  OTHER: { icon: 'ellipse-outline', color: '#9CA3AF' },
};
const DEFAULT_ICON = { icon: 'ellipse-outline', color: '#9CA3AF' };

const RANGE_OPTIONS = [
  { label: '오늘', days: 0 },
  { label: '7일', days: 7 },
  { label: '30일', days: 30 },
  { label: '1년', days: 365 },
];

function formatDate(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('ko-KR', sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** 발생 시각이 있으면 그 시각(정밀도 DAY 면 날짜만), 없으면 '기록일 <날짜>' */
function timeText(item: TimelineEvent): { prefix: string | null; text: string } | null {
  if (item.occurredAt) {
    const d = new Date(item.occurredAt);
    if (Number.isNaN(d.getTime())) return null;
    if (item.occurredAtPrecision === 'DAY') return { prefix: null, text: formatDate(d) };
    return { prefix: null, text: `${formatDate(d)} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` };
  }
  const r = new Date(item.createdAt);
  if (Number.isNaN(r.getTime())) return null;
  return { prefix: '기록일', text: formatDate(r) };
}

export default function TimelineScreen() {
  const router = useRouter();
  const [rangeDays, setRangeDays] = useState(7);

  const from = rangeDays === 0
    ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    : new Date(Date.now() - rangeDays * 86400000).toISOString();

  const { data, isLoading, isError, isRefetching, refetch } = useQuery<TimelineResponse>({
    queryKey: ['journey', 'timeline', rangeDays],
    queryFn: () => apiClient.get<TimelineResponse>(`/api/v1/portal/journey/timeline?from=${encodeURIComponent(from)}&limit=${PAGE_LIMIT}`),
  });

  const events: TimelineEvent[] = data?.data ?? [];
  const truncated = data?.meta?.truncated === true;

  const renderItem = ({ item }: { item: TimelineEvent }) => {
    const info = (item.track && TRACK_ICONS[item.track]) || DEFAULT_ICON;
    const t = timeText(item);

    return (
      <View style={styles.eventRow}>
        <View style={styles.timelineLeft}>
          <View style={[styles.iconCircle, { backgroundColor: info.color + '20' }]}>
            <Ionicons name={info.icon as any} size={16} color={info.color} />
          </View>
          <View style={styles.timelineLine} />
        </View>
        <View style={styles.eventContent}>
          <Text style={styles.eventLabel}>{item.label ?? '기록'}</Text>
          {item.description ? <Text style={styles.eventDesc}>{item.description}</Text> : null}
          {t ? (
            <Text style={styles.eventTime}>
              {t.prefix ? <Text style={styles.eventTimePrefix}>{t.prefix} </Text> : null}
              {t.text}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>여정 타임라인</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* 기간 필터 */}
      <View style={styles.filterRow}>
        {RANGE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.days}
            style={[styles.filterChip, rangeDays === opt.days && styles.filterChipActive]}
            onPress={() => setRangeDays(opt.days)}
            accessibilityRole="button"
            accessibilityState={{ selected: rangeDays === opt.days }}
          >
            <Text style={[styles.filterText, rangeDays === opt.days && styles.filterTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 40 }} />
      ) : isError ? (
        // 조회 실패를 "기록 없음"으로 말하지 않는다
        <ErrorState message="여정 기록을 불러오지 못했습니다" onRetry={() => refetch()} />
      ) : events.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>해당 기간의 여정 이벤트가 없습니다</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={truncated ? (
            <Text style={styles.truncatedNote}>최근 {events.length}건만 표시합니다</Text>
          ) : null}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F3F4F6' },
  filterChipActive: { backgroundColor: '#4F46E5' },
  filterText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  filterTextActive: { color: '#FFFFFF' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  eventRow: { flexDirection: 'row', marginBottom: 4 },
  timelineLeft: { alignItems: 'center', width: 36, marginRight: 12 },
  iconCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  timelineLine: { width: 2, flex: 1, backgroundColor: '#E5E7EB', marginVertical: 4 },
  eventContent: { flex: 1, paddingBottom: 16 },
  eventLabel: { fontSize: 14, fontWeight: '600', color: '#111827', lineHeight: 20 },
  eventDesc: { fontSize: 13, color: '#4B5563', lineHeight: 19, marginTop: 1 },
  eventTime: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  eventTimePrefix: { fontSize: 10, color: '#9CA3AF' },
  truncatedNote: { fontSize: 12, color: '#6B7280', marginBottom: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: '#9CA3AF', marginTop: 12 },
});
