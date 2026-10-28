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
import { apiClient } from '../../src/lib/api-client';
import { StatusBadge } from '../../src/components/StatusBadge';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { formatDate } from '../../src/lib/format';
import { isAbnormalFlag, isCriticalFlag, flagMark, summarizeFlags } from '../../src/lib/lab-flags';

interface LabResult {
  id: string;
  orderedAt: string; // 서버 정규화 계약(완료시각) — completedAt 아님
  notes?: string;
  items: LabItem[];
}

interface LabItem {
  testName: string;
  value: string;
  unit: string;
  normalMin?: number;
  normalMax?: number;
  flag?: string;
}

export default function LabsScreen() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['lab-results'],
    queryFn: () =>
      apiClient.get<{ data: LabResult[] }>('/api/v1/portal/lab-results'),
  });

  const labResults: LabResult[] = (data as any)?.data ?? [];

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const renderItem = ({ item }: { item: LabResult }) => {
    const isExpanded = expandedId === item.id;
    // 🔴 종전 `r.flag !== 'NORMAL'` → 서버가 내는 'N'(정상)이 전부 "이상"으로 잡혔다(거짓 경보).
    //    동시에 'H'/'HH' 는 'HIGH' 비교에 안 걸려 위급이 조용히 정상처럼 보였다. 정본 판정으로 수렴.
    // 🔴 (2026-10-20 결정 portal.labResultRelease) 의료진 확인 전이면 서버가 판정을 비운다 — 판정 대신 그 사실을 말한다
    const badge = (item as LabResult & { release?: string }).release === 'AWAITING_REVIEW'
      ? { label: '의료진 확인 전', variant: 'default' as const }
      : summarizeFlags(item.items?.map((r) => r.flag) ?? []);
    /**
     * 🔴 서버 FE 계약은 `orderedAt` 이다(portal.service 가 완료시각을 그 이름으로 정규화 —
     *    "FE 계약(LabResult { id, orderName, orderedAt, items })" 주석 참조).
     *    종전 `completedAt` 은 응답에 **없어서** 완료된 검사가 전부 "검사 중"으로 그려졌다
     *    (2026-08-31 실응답 대조). 이 EP 는 COMPLETED 만 주므로 날짜 없음 = 자료 없음이다.
     */
    const dateStr = item.orderedAt ? formatDate(item.orderedAt) : '-';
    const firstTest = item.items?.[0]?.testName ?? '검사';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardTop}>
          <View>
            <Text style={styles.testName}>{firstTest}{item.items.length > 1 ? ` 외 ${item.items.length - 1}건` : ''}</Text>
            <Text style={styles.testDate}>{dateStr}</Text>
          </View>
          <View style={styles.cardRight}>
            {badge && (
              <StatusBadge label={badge.label} variant={badge.variant} />
            )}
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color="#9CA3AF"
            />
          </View>
        </View>

        {isExpanded && item.items && (
          <View style={styles.resultList}>
            <View style={styles.resultHeader}>
              <Text style={[styles.resultCol, styles.colName]}>항목</Text>
              <Text style={[styles.resultCol, styles.colValue]}>결과</Text>
              <Text style={[styles.resultCol, styles.colRef]}>참고치</Text>
            </View>
            {item.items.map((result, idx) => {
              const isAbnormal = isAbnormalFlag(result.flag);
              const isCritical = isCriticalFlag(result.flag);
              const refRange = result.normalMin != null && result.normalMax != null ? `${result.normalMin}-${result.normalMax}` : '';
              return (
                <View
                  key={idx}
                  style={[
                    styles.resultRow,
                    isAbnormal && styles.resultRowAbnormal,
                  ]}
                >
                  <Text style={[styles.resultCol, styles.colName]}>
                    {result.testName}
                  </Text>
                  <Text
                    style={[
                      styles.resultCol,
                      styles.colValue,
                      isAbnormal && styles.abnormalValue,
                      isCritical && styles.criticalValue,
                    ]}
                  >
                    {result.value} {result.unit}
                    {flagMark(result.flag)}
                  </Text>
                  <Text style={[styles.resultCol, styles.colRef]}>
                    {refRange}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={
        labResults.length === 0 ? styles.empty : styles.list
      }
      data={labResults}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Ionicons name="flask-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>검사 결과가 없습니다</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  testName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  testDate: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  resultList: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 12,
  },
  resultHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  resultRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  resultRowAbnormal: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 6,
  },
  resultCol: {
    fontSize: 13,
    color: '#374151',
  },
  colName: {
    flex: 2,
    fontWeight: '500',
  },
  colValue: {
    flex: 1.5,
    textAlign: 'center',
  },
  colRef: {
    flex: 1.5,
    textAlign: 'right',
    color: '#9CA3AF',
    fontSize: 12,
  },
  abnormalValue: {
    color: '#DC2626',
    fontWeight: '700',
  },
  // 위급값(HH/LL/CRITICAL)은 일반 '이상'과 구분한다 — 같은 빨강이면 위급이 묻힌다.
  criticalValue: {
    color: '#FFFFFF',
    backgroundColor: '#DC2626',
    fontWeight: '800',
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },
});
