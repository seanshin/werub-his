import React from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { formatDate } from '../../src/lib/format';

export default function NoticesScreen() {
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['notices'],
    queryFn: () => apiClient.get('/api/v1/portal/notices'),
  });

  const notices: any[] = (data as any)?.data ?? [];

  if (isLoading) return <LoadingState />;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '공지사항', headerShown: true }} />
      <FlatList
        contentContainerStyle={notices.length === 0 ? s.empty : s.list}
        data={notices}
        keyExtractor={(item, i) => item.id ?? String(i)}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.row}>
              <Ionicons name="megaphone-outline" size={16} color="#6366F1" />
              <Text style={s.title} numberOfLines={2}>{item.title}</Text>
            </View>
            {item.content && <Text style={s.content} numberOfLines={3}>{item.content}</Text>}
            <Text style={s.date}>{item.date ? formatDate(item.date) : ''}</Text>
          </View>
        )}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        ListEmptyComponent={<EmptyState icon="megaphone-outline" message="공지사항이 없습니다" />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  list: { padding: 16, paddingBottom: 32 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: 15, fontWeight: '600', color: '#1F2937', flex: 1 },
  content: { fontSize: 13, color: '#6B7280', marginTop: 8, lineHeight: 20 },
  date: { fontSize: 11, color: '#9CA3AF', marginTop: 8 },
});
