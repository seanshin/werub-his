import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { StatusBadge } from '../../src/components/StatusBadge';
import { LoadingState } from '../../src/components/common/LoadingState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { formatDateTime } from '../../src/lib/format';

interface Appointment {
  id: string;
  scheduledAt: string;
  status: string;
  type: string;
  reason?: string;
  doctor?: { familyName: string; givenName: string; department?: any };
}

const statusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'default' }> = {
  SCHEDULED: { label: '예약', variant: 'success' },
  // 🔴 서버 getAppointments 는 SCHEDULED·CONFIRMED·CHECKED_IN 을 낸다. CONFIRMED 가 빠져 있어
  //    확정된 예약이 화면에 영문 enum 'CONFIRMED' 그대로 찍혔다.
  CONFIRMED: { label: '예약 확정', variant: 'success' },
  CHECKED_IN: { label: '접수', variant: 'success' },
  IN_PROGRESS: { label: '진행', variant: 'warning' },
  COMPLETED: { label: '완료', variant: 'default' },
  CANCELLED: { label: '취소', variant: 'error' },
  NO_SHOW: { label: '미방문', variant: 'error' },
};

export default function AppointmentsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['appointments'],
    queryFn: () =>
      apiClient.get<{ data: Appointment[] }>('/api/v1/portal/appointments'),
  });

  // 🔴 서버 라우트는 `@Put('appointments/:id/cancel')` 이다(portal.controller.ts:204).
  //    종전 PATCH 는 매칭되는 핸들러가 없어 404 로 떨어졌다 — 즉 앱의 예약 취소는
  //    한 번도 서버에 닿은 적이 없다. body 의 reason 은 CancelAppointmentDto 선택 항목.
  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.put(`/api/v1/portal/appointments/${id}/cancel`, { reason: '환자 앱에서 취소' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      Alert.alert('알림', '예약이 취소되었습니다.');
    },
    onError: (err: any) => {
      Alert.alert('오류', err?.message ?? '예약 취소에 실패했습니다.');
    },
  });

  const handleCancel = (id: string) => {
    Alert.alert('예약 취소', '정말 예약을 취소하시겠습니까?', [
      { text: '아니오', style: 'cancel' },
      {
        text: '취소하기',
        style: 'destructive',
        onPress: () => cancelMutation.mutate(id),
      },
    ]);
  };

  const appointments: Appointment[] = (data as any)?.data ?? [];

  const renderItem = ({ item }: { item: Appointment }) => {
    const status = statusMap[item.status] ?? { label: item.status, variant: 'default' as const };
    const canCancel = item.status === 'SCHEDULED' || item.status === 'CHECKED_IN';
    const doctorName = item.doctor ? `${item.doctor.familyName}${item.doctor.givenName}` : '';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.dateRow}>
            <Ionicons name="calendar" size={16} color="#4F46E5" />
            <Text style={styles.date}>{formatDateTime(item.scheduledAt)}</Text>
          </View>
          <StatusBadge label={status.label} variant={status.variant} />
        </View>

        {doctorName ? <Text style={styles.doctor}>{doctorName} 선생님</Text> : null}
        {item.reason && <Text style={styles.reason}>{item.reason}</Text>}

        {canCancel && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => handleCancel(item.id)}
          >
            <Text style={styles.cancelText}>예약 취소</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={
        appointments.length === 0 ? styles.empty : styles.list
      }
      data={appointments}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      ListHeaderComponent={
        <TouchableOpacity style={styles.bookBtn} onPress={() => router.push('/booking' as any)}>
          <Ionicons name="sparkles-outline" size={18} color="#FFF" />
          <Text style={styles.bookBtnText}>AI 예약</Text>
        </TouchableOpacity>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>예약 내역이 없습니다</Text>
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
    marginBottom: 10,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  date: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  department: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  doctor: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  reason: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 6,
  },
  cancelButton: {
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
    alignItems: 'center',
  },
  cancelText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  bookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 12,
  },
  bookBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },
});
