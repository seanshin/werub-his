import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  SafeAreaView,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { StatusBadge } from '../../src/components/StatusBadge';

interface TelehealthSession {
  id: string;
  scheduledAt: string;
  status: string;
  roomId?: string;
  chiefComplaint?: string;
  doctor?: { familyName: string; givenName: string; department?: any };
}

const statusMap: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'default' }
> = {
  SCHEDULED: { label: '예약됨', variant: 'info' },
  READY: { label: '진료 가능', variant: 'success' },
  // 🔴 스키마 주석의 실제 상태값은 SCHEDULED·WAITING·IN_PROGRESS·COMPLETED·CANCELLED·NO_SHOW 이다.
  //    WAITING(대기실 입장)·NO_SHOW 가 빠져 있어 영문 enum 이 그대로 배지에 찍혔다.
  WAITING: { label: '대기실 입장', variant: 'warning' },
  IN_PROGRESS: { label: '진행중', variant: 'warning' },
  COMPLETED: { label: '완료', variant: 'default' },
  CANCELLED: { label: '취소', variant: 'error' },
  NO_SHOW: { label: '미참여', variant: 'error' },
};

export default function TelehealthScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['telehealth-sessions'],
    queryFn: () =>
      apiClient.get<{ data: TelehealthSession[] }>(
        '/api/v1/portal/telehealth',
      ),
  });

  const sessions: TelehealthSession[] = (data as any)?.data ?? [];

  /**
   * 🔴 2026-08-14(W9). 종전엔 서버에 알리지 않고 곧장 Jitsi URL 을 열었다 —
   *    서버 `PATCH /portal/telehealth/:id/join`(대기실 입장 = status WAITING) 이 호출되지
   *    않아, 환자가 대기실에 들어와 있어도 의료진 화면에는 아무 표시가 나지 않았다.
   *    입장을 먼저 기록하고, 그 다음에 연다.
   */
  const handleJoinSession = async (session: TelehealthSession) => {
    if (!session.roomId) {
      Alert.alert('알림', '아직 진료실이 준비되지 않았습니다.');
      return;
    }
    try {
      await apiClient.patch(`/api/v1/portal/telehealth/${session.id}/join`);
      queryClient.invalidateQueries({ queryKey: ['telehealth-sessions'] });
    } catch (e: any) {
      // 입장 기록에 실패했으면 "들어갔다"고 말하지 않는다.
      Alert.alert('입장 실패', e?.message ?? '대기실 입장을 기록하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    const base = process.env.EXPO_PUBLIC_TELEHEALTH_URL ?? 'https://his.example.org:8443';
    const jitsiUrl = `${base}/${session.roomId}`;
    try {
      const canOpen = await Linking.canOpenURL(jitsiUrl);
      if (canOpen) {
        await Linking.openURL(jitsiUrl);
      } else {
        Alert.alert('오류', '원격진료 링크를 열 수 없습니다.');
      }
    } catch {
      Alert.alert('오류', '원격진료 연결에 실패했습니다.');
    }
  };

  const renderItem = ({ item }: { item: TelehealthSession }) => {
    const status = statusMap[item.status] ?? {
      label: item.status,
      variant: 'default' as const,
    };
    // 대기실에 이미 들어간(WAITING) 세션도 다시 입장할 수 있어야 한다(앱을 껐다 켠 경우).
    const canJoin = item.status === 'READY' || item.status === 'WAITING' || item.status === 'IN_PROGRESS';
    const dt = new Date(item.scheduledAt);
    const dateStr = dt.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
    const timeStr = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const doctorName = item.doctor ? `${item.doctor.familyName}${item.doctor.givenName}` : '';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.dateRow}>
            <Ionicons name="videocam" size={18} color="#4F46E5" />
            <Text style={styles.date}>{dateStr} {timeStr}</Text>
          </View>
          <StatusBadge label={status.label} variant={status.variant} />
        </View>

        {doctorName ? <Text style={styles.doctor}>{doctorName} 선생님</Text> : null}
        {item.chiefComplaint && <Text style={styles.reason}>{item.chiefComplaint}</Text>}

        {canJoin && (
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={() => handleJoinSession(item)}
          >
            <Ionicons name="videocam" size={18} color="#FFFFFF" />
            <Text style={styles.joinBtnText}>진료 시작</Text>
          </TouchableOpacity>
        )}

        {item.status === 'SCHEDULED' && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>
              진료 시간이 되면 '진료 시작' 버튼이 활성화됩니다
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '원격진료', headerShown: true }} />
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
          title: '원격진료',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
          headerShadowVisible: false,
        }}
      />
      <FlatList
        style={styles.container}
        contentContainerStyle={
          sessions.length === 0 ? styles.empty : styles.list
        }
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          /**
           * 🔴 종전엔 `isError` 를 보지 않아, 조회가 실패해도 목록이 `[]` 가 되고
           *    "예정된 원격진료가 없습니다" 라고 단정했다 — **환자가 예약을 놓친다**(P17).
           *    빈 목록과 조회 실패는 다른 사실이다(questionnaire 화면과 같은 방식).
           *    예약 버튼은 실패해도 남긴다 — 막다른 골목을 만들지 않는다.
           */
          <View style={styles.center}>
            <Ionicons
              name={isError ? 'cloud-offline-outline' : 'videocam-outline'}
              size={48}
              color={isError ? '#F59E0B' : '#D1D5DB'}
            />
            <Text style={styles.emptyText}>
              {isError
                ? '원격진료 일정을 불러오지 못했습니다. 예정된 진료가 없다는 뜻이 아닙니다.'
                : '예정된 원격진료가 없습니다'}
            </Text>
            <TouchableOpacity style={styles.bookBtn} onPress={() => router.push('/telehealth-book' as any)}>
              <Ionicons name="add-circle-outline" size={18} color="#FFF" />
              <Text style={styles.bookBtnText}>원격진료 예약</Text>
            </TouchableOpacity>
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
  joinBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#4F46E5',
  },
  joinBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  infoBox: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F9FAFB',
    padding: 10,
    borderRadius: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  bookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  bookBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
