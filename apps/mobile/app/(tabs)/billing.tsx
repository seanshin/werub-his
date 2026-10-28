import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { StatusBadge } from '../../src/components/StatusBadge';
import { formatAmount } from '../../src/lib/format';
import { ErrorState } from '../../src/components/common/ErrorState';

interface BillingItem {
  id: string;
  createdAt: string;
  totalAmount: number;
  insuranceCovered?: number;
  patientCopay?: number;
  paidAmount: number;
  status: string;
  encounter?: { doctor?: { familyName: string; givenName: string } };
}

const statusMap: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'error' | 'default' }
> = {
  PAID: { label: '수납 완료', variant: 'success' },
  PARTIAL: { label: '부분 수납', variant: 'warning' },
  UNPAID: { label: '미수납', variant: 'error' },
  CANCELLED: { label: '취소', variant: 'default' },
};

export default function BillingScreen() {
  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['billings'],
    queryFn: () =>
      apiClient.get<{ data: BillingItem[] }>('/api/v1/portal/billings'),
  });

  const billings: BillingItem[] = (data as any)?.data ?? [];

  const totalAmount = billings.reduce((sum, b) => sum + b.totalAmount, 0);
  const unpaidAmount = billings.reduce(
    (sum, b) => sum + (b.totalAmount - b.paidAmount),
    0,
  );

  const renderItem = ({ item }: { item: BillingItem }) => {
    const status = statusMap[item.status] ?? {
      label: item.status,
      variant: 'default' as const,
    };
    const balance = item.totalAmount - item.paidAmount;

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={14} color="#6B7280" />
            <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</Text>
          </View>
          <StatusBadge label={status.label} variant={status.variant} />
        </View>
        {item.encounter?.doctor && (
          <Text style={styles.department}>{item.encounter.doctor.familyName}{item.encounter.doctor.givenName} 선생님</Text>
        )}
        <View style={styles.amountRow}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>총액</Text>
            <Text style={styles.amountValue}>
              {formatAmount(item.totalAmount)}
            </Text>
          </View>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>수납액</Text>
            <Text style={[styles.amountValue, { color: '#10B981' }]}>
              {formatAmount(item.paidAmount)}
            </Text>
          </View>
          {balance > 0 && (
            <View style={styles.amountItem}>
              <Text style={styles.amountLabel}>잔액</Text>
              <Text style={[styles.amountValue, { color: '#EF4444' }]}>
                {formatAmount(balance)}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '수납 내역', headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      </SafeAreaView>
    );
  }

  /**
   * 🔴 종전엔 조회가 실패해도 `billings` 가 `[]` 가 되어
   *    합계 `unpaidAmount` 가 **0** 이 되고 요약 카드가 초록색 "미수납액 0원" 을 냈다 —
   *    미납이 있어도 환자는 낼 것이 없다고 읽는다(P17). 0원은 다른 사실이다.
   *    labs·encounters·notifications 와 같은 방식으로 실패는 실패라고 말한다.
   */
  if (isError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '수납 내역', headerShown: true }} />
        <ErrorState
          message={'수납 내역을 불러오지 못했습니다. 미수납액이 없다는 뜻이 아닙니다.'}
          onRetry={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen
        options={{
          title: '수납 내역',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
          headerShadowVisible: false,
        }}
      />
      <FlatList
        style={styles.container}
        contentContainerStyle={
          billings.length === 0 ? styles.empty : styles.list
        }
        data={billings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          billings.length > 0 ? (
            <View style={styles.summaryCard}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>총 청구액</Text>
                <Text style={styles.summaryValue}>
                  {formatAmount(totalAmount)}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>미수납액</Text>
                <Text
                  style={[
                    styles.summaryValue,
                    { color: unpaidAmount > 0 ? '#EF4444' : '#10B981' },
                  ]}
                >
                  {formatAmount(unpaidAmount)}
                </Text>
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyText}>수납 내역이 없습니다</Text>
          </View>
        }
      />
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
  summaryCard: {
    backgroundColor: '#4F46E5',
    borderRadius: 14,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 4,
  },
  summaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(255,255,255,0.3)',
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
    marginBottom: 10,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  date: {
    fontSize: 13,
    color: '#6B7280',
  },
  department: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  description: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
  },
  amountRow: {
    flexDirection: 'row',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 16,
  },
  amountItem: {
    flex: 1,
  },
  amountLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  amountValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginTop: 2,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },
});
