import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../src/stores/auth-store';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { apiClient } from '../../src/lib/api-client';

/**
 * 🔴 2026-08-14(W9). 종전 이 화면의 알림 토글(검사결과·예약·수납)과 생체인증 토글은
 *    전부 로컬 `useState` 뿐이었다 — 서버에 저장하지도, 읽어오지도 않았다. 환자가
 *    "수납 알림 끄기"를 눌러도 알림은 계속 왔고, 화면을 나갔다 오면 다시 전부 켜짐으로
 *    보였다(하지 않고 했다고 말함).
 *    서버에는 GET/PUT `/api/v1/patient-auth/notifications/settings` 가 실재한다.
 *    서버 기본 type: APPOINTMENT_REMINDER · LAB_RESULT · DOCUMENT_READY · BILLING ·
 *                    QUESTIONNAIRE · SYSTEM · MEDICATION_REMINDER(opt-in)
 */
interface NotificationSetting {
  type: string;
  enabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
}

const SETTING_LABELS: Record<string, { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  APPOINTMENT_REMINDER: { label: '예약 알림', icon: 'calendar', color: '#10b981' },
  LAB_RESULT: { label: '검사 결과 알림', icon: 'flask', color: '#8b5cf6' },
  DOCUMENT_READY: { label: '서류 발급 알림', icon: 'document-text', color: '#6366f1' },
  BILLING: { label: '수납 알림', icon: 'card', color: '#f59e0b' },
  QUESTIONNAIRE: { label: '문진표 알림', icon: 'clipboard', color: '#06b6d4' },
  MEDICATION_REMINDER: { label: '복약 알림', icon: 'medical', color: '#ef4444' },
  SYSTEM: { label: '시스템 공지', icon: 'information-circle', color: '#6b7280' },
};

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { expoPushToken, requestPermission } = usePushNotifications();

  const [pushEnabled, setPushEnabled] = useState(!!expoPushToken);

  const settingsQuery = useQuery({
    queryKey: ['notification-settings'],
    queryFn: () =>
      apiClient.get<{ data: NotificationSetting[] }>('/api/v1/patient-auth/notifications/settings'),
  });

  const settings: NotificationSetting[] = (settingsQuery.data as any)?.data ?? [];

  const updateSetting = useMutation({
    mutationFn: (s: NotificationSetting) =>
      apiClient.put('/api/v1/patient-auth/notifications/settings', { settings: [s] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-settings'] }),
    onError: (err: any) =>
      Alert.alert('저장 실패', err?.message ?? '알림 설정을 저장하지 못했습니다. 다시 시도해 주세요.'),
  });

  const handlePushToggle = useCallback(async (value: boolean) => {
    if (value) {
      const token = await requestPermission();
      setPushEnabled(!!token);
      if (!token) {
        Alert.alert('알림 설정', '알림 권한이 거부되었습니다. 기기 설정에서 허용해주세요.');
      }
    } else {
      // 🔴 앱 안에서 기기 알림 권한을 회수할 방법은 없다 — "껐다"고 말하지 않는다.
      Alert.alert(
        '알림 끄기',
        '기기 알림 권한은 앱에서 해제할 수 없습니다. 아래 항목별 알림을 끄거나, 기기 설정 > 알림에서 해제해 주세요.',
      );
    }
  }, [requestPermission]);

  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? '56';

  const openLegal = useCallback(async (path: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'https://his.example.org';
    const url = `${base}${path}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
    else Alert.alert('열 수 없음', `브라우저에서 ${url} 을 확인해 주세요.`);
  }, []);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.title}>설정</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 알림 설정 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>알림 설정</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Ionicons name="notifications" size={20} color="#3b82f6" />
            <Text style={styles.settingLabel}>푸시 알림</Text>
          </View>
          <Switch
            value={pushEnabled}
            onValueChange={handlePushToggle}
            trackColor={{ false: '#e5e7eb', true: '#93c5fd' }}
            thumbColor={pushEnabled ? '#3b82f6' : '#9ca3af'}
          />
        </View>

        {/* 항목별 알림 — 서버 저장분을 그대로 그린다(로컬 상태 아님) */}
        {settingsQuery.isError ? (
          <Text style={styles.noteText}>
            알림 설정을 불러오지 못했습니다. 현재 설정 상태를 확인할 수 없습니다.
          </Text>
        ) : settingsQuery.isLoading ? (
          <Text style={styles.noteText}>알림 설정을 불러오는 중…</Text>
        ) : (
          settings.map((s) => {
            const meta = SETTING_LABELS[s.type] ?? { label: s.type, icon: 'notifications' as const, color: '#6b7280' };
            return (
              <View key={s.type} style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Ionicons name={meta.icon} size={18} color={meta.color} />
                  <Text style={styles.settingLabel}>{meta.label}</Text>
                </View>
                <Switch
                  value={s.enabled}
                  disabled={updateSetting.isPending}
                  onValueChange={(v) => updateSetting.mutate({ ...s, enabled: v, pushEnabled: v })}
                  trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                  thumbColor={s.enabled ? meta.color : '#9ca3af'}
                />
              </View>
            );
          })
        )}
      </View>

      {/* 보안 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>보안</Text>

        {/*
          🔴 종전 '생체 인증' 스위치는 로컬 useState 만 바꿨다 — 켜도 아무 일이 없고,
             화면을 나가면 다시 꺼졌다. 서버 계정에 biometricEnabled 필드는 있지만
             앱에서 등록/해제할 엔드포인트가 없어(patient-auth 라우트 전수 확인) 켤 수 없다.
             켜지지 않는 스위치를 두는 대신, 지금 할 수 없다는 사실을 말한다.
        */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Ionicons name="finger-print" size={20} color="#9ca3af" />
            <Text style={[styles.settingLabel, { color: '#9ca3af' }]}>생체 인증 (Face ID/지문)</Text>
          </View>
          <Text style={styles.noteInline}>준비 중</Text>
        </View>

        <TouchableOpacity style={styles.settingRow} onPress={() => Alert.alert('비밀번호 변경', '비밀번호 변경 기능은 웹에서 이용하세요.')}>
          <View style={styles.settingInfo}>
            <Ionicons name="lock-closed" size={20} color="#ef4444" />
            <Text style={styles.settingLabel}>비밀번호 변경</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
        </TouchableOpacity>
      </View>

      {/* 앱 정보 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>앱 정보</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>앱 버전</Text>
          <Text style={styles.infoValue}>{appVersion}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Expo SDK</Text>
          <Text style={styles.infoValue}>{sdkVersion}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>플랫폼</Text>
          <Text style={styles.infoValue}>{Platform.OS} {Platform.Version}</Text>
        </View>
        {/* 🔴 종전 `user.email`·`user.familyName`·`user.givenName` 을 읽었는데 auth-store 의
            User 에는 그런 키가 없다(타입체크 에러 3건 + 화면은 빈칸). 실제 보유 값으로 그린다. */}
        {user && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>계정</Text>
            <Text style={styles.infoValue}>
              {[user.name, user.phoneNumber].filter(Boolean).join(' · ') || '-'}
            </Text>
          </View>
        )}
        {user?.mrn && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>환자번호</Text>
            <Text style={styles.infoValue}>{user.mrn}</Text>
          </View>
        )}
        {expoPushToken && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>푸시 토큰</Text>
            <Text style={[styles.infoValue, { fontSize: 10 }]} numberOfLines={1}>{expoPushToken.slice(0, 30)}...</Text>
          </View>
        )}
      </View>

      {/* 법적 정보 — 🔴 종전 두 항목 모두 onPress 가 없어 눌러도 아무 일이 없었다(법정 고지 미도달).
          앱 내 페이지가 없으므로 병원 웹 고지 페이지로 연결한다. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>법적 정보</Text>

        <TouchableOpacity style={styles.settingRow} onPress={() => openLegal('/terms')}>
          <View style={styles.settingInfo}>
            <Ionicons name="document-text" size={18} color="#6b7280" />
            <Text style={styles.settingLabel}>이용약관</Text>
          </View>
          <Ionicons name="open-outline" size={18} color="#d1d5db" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingRow} onPress={() => openLegal('/privacy')}>
          <View style={styles.settingInfo}>
            <Ionicons name="shield-checkmark" size={18} color="#6b7280" />
            <Text style={styles.settingLabel}>개인정보 처리방침</Text>
          </View>
          <Ionicons name="open-outline" size={18} color="#d1d5db" />
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: '#1f2937' },
  section: { marginTop: 16, backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', marginBottom: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  settingInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingLabel: { fontSize: 15, color: '#1f2937' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  infoLabel: { fontSize: 13, color: '#9ca3af' },
  infoValue: { fontSize: 13, color: '#374151', fontWeight: '500' },
  noteText: { fontSize: 12, color: '#9ca3af', paddingHorizontal: 16, paddingVertical: 12, lineHeight: 18 },
  noteInline: { fontSize: 12, color: '#9ca3af' },
});
