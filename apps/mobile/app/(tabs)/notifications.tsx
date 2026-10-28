import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { formatRelativeTime } from '../../src/lib/format';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

const typeIconMap: Record<
  string,
  { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }
> = {
  APPOINTMENT: { icon: 'calendar', color: '#4F46E5' },
  ARRIVAL_CHECK: { icon: 'walk', color: '#E11D48' }, // 접수 데스크 도착 확인 호출(2026-08-05)
  LAB_RESULT: { icon: 'flask', color: '#10B981' },
  BILLING: { icon: 'receipt', color: '#F59E0B' },
  MEDICATION: { icon: 'medical', color: '#EF4444' },
  DOCUMENT: { icon: 'document-text', color: '#6366F1' },
  TELEHEALTH: { icon: 'videocam', color: '#06B6D4' },
  GENERAL: { icon: 'notifications', color: '#6B7280' },
};

export default function NotificationsScreen() {
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiClient.get<{ data: Notification[] }>(
        '/api/v1/patient-auth/notifications',
      ),
  });

  const readMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.put(`/api/v1/patient-auth/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const rawData = (data as any)?.data;
  const notifications: Notification[] = Array.isArray(rawData) ? rawData : rawData?.items ?? [];

  const handlePress = (item: Notification) => {
    if (!item.isRead) {
      readMutation.mutate(item.id);
    }
  };

  // formatRelativeTime 사용 (src/lib/format.ts)

  const renderItem = ({ item }: { item: Notification }) => {
    const typeInfo = typeIconMap[item.type] ?? typeIconMap.GENERAL;

    return (
      <TouchableOpacity
        style={[styles.card, !item.isRead && styles.cardUnread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconCircle, { backgroundColor: typeInfo.color + '18' }]}>
          <Ionicons name={typeInfo.icon} size={20} color={typeInfo.color} />
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={[styles.title, !item.isRead && styles.titleUnread]} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.isRead && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.message} numberOfLines={2}>
            {item.body}
          </Text>
          <Text style={styles.time}>{formatRelativeTime(item.createdAt)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={
        notifications.length === 0 ? styles.empty : styles.list
      }
      data={notifications}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Ionicons name="notifications-off-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>알림이 없습니다</Text>
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
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardUnread: {
    backgroundColor: '#F0F0FF',
    borderLeftWidth: 3,
    borderLeftColor: '#4F46E5',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
    flex: 1,
  },
  titleUnread: {
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4F46E5',
    marginLeft: 8,
  },
  message: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 6,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },
});
