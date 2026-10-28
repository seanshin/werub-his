import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import Constants from 'expo-constants';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { useAuthStore } from '../../src/stores/auth-store';
import { AI_ORIGIN_TEXT } from '../../src/lib/ai-brand';

interface MenuItem {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  onPress: () => void;
}

export default function MoreScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  /**
   * 🔴 종전 이 화면은 `/portal/medications` 를 세어 "복약 관리 (N건)" 이라고 썼는데,
   *    그 EP 는 **최근 30일 내 처방만·약품명 없는 행 제외·명칭 dedup** 이다. 반면 눌러서
   *    들어가는 복약 관리 화면은 `/portal/medication-schedule`(전체 ACTIVE)을 본다.
   *    운영 실측에서 메뉴는 "0건", 안쪽 화면은 7건이었다 — 같은 사실에 정본이 둘이었다.
   *    링크가 가리키는 화면과 같은 정본을 센다.
   */
  const medications = useQuery({
    queryKey: ['medication-schedule'],
    queryFn: () =>
      apiClient.get<{ data: any[] }>('/api/v1/portal/medication-schedule'),
  });

  const billings = useQuery({
    queryKey: ['billings'],
    queryFn: () =>
      apiClient.get<{ data: any[] }>('/api/v1/portal/billings'),
  });

  const notices = useQuery({
    queryKey: ['notices'],
    queryFn: () =>
      apiClient.get<{ data: any[] }>('/api/v1/portal/notices'),
  });

  const [confirmLogout, setConfirmLogout] = useState(false);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, []);

  const handleLogout = () => {
    if (confirmLogout) {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      logout();
    } else {
      setConfirmLogout(true);
      logoutTimerRef.current = setTimeout(() => setConfirmLogout(false), 3000);
    }
  };

  const medicationList: any[] = (medications.data as any)?.data ?? [];
  const billingList: any[] = (billings.data as any)?.data ?? [];
  const noticeList: any[] = (notices.data as any)?.data ?? [];

  const sections: { title: string; items: MenuItem[] }[] = [
    {
      title: '의료 정보',
      items: [
        {
          icon: 'medical-outline',
          label: `복약 관리 (${medicationList.length}건)`,
          color: '#4F46E5',
          onPress: () => router.push('/medication'),
        },
        {
          icon: 'receipt-outline',
          label: `수납/청구 (${billingList.length}건)`,
          color: '#10B981',
          onPress: () => router.push('/billing'),
        },
        {
          icon: 'create-outline',
          label: '동의서',
          color: '#8B5CF6',
          onPress: () => router.push('/consent' as any),
        },
        {
          icon: 'document-outline',
          label: '서류 신청/조회',
          color: '#F59E0B',
          onPress: () => router.push('/documents'),
        },
        {
          icon: 'clipboard-outline',
          label: '문진표 작성',
          color: '#06B6D4',
          onPress: () => router.push('/questionnaire'),
        },
        {
          icon: 'videocam-outline',
          label: '원격진료',
          color: '#8B5CF6',
          onPress: () => router.push('/telehealth'),
        },
        {
          icon: 'scan-outline',
          label: '영상검사 (PACS)',
          color: '#6366F1',
          onPress: () => router.push('/imaging' as any),
        },
      ],
    },
    {
      title: '건강 관리',
      items: [
        {
          icon: 'sparkles-outline',
          label: `${AI_ORIGIN_TEXT} 건강 관리`,
          color: '#4F46E5',
          onPress: () => router.push('/ai-health' as any),
        },
        {
          icon: 'heart-outline',
          label: '건강 관리 (검사추이/예방접종/메모)',
          color: '#10B981',
          onPress: () => router.push('/health' as any),
        },
        {
          icon: 'pulse-outline',
          label: '만성질환 추이·자가측정',
          color: '#EF4444',
          onPress: () => router.push('/chronic-trend' as any),
        },
        {
          icon: 'analytics-outline',
          label: '검진 비교·셀프 예약',
          color: '#0EA5E9',
          onPress: () => router.push('/checkup-compare' as any),
        },
        {
          icon: 'bar-chart-outline',
          label: '수납 요약 (연간/연말정산)',
          color: '#F59E0B',
          onPress: () => router.push('/billing-summary' as any),
        },
        {
          icon: 'chatbubble-outline',
          label: '담당의 메시지',
          color: '#3B82F6',
          onPress: () => router.push('/messages' as any),
        },
      ],
    },
    {
      title: '알림/공지',
      items: [
        {
          icon: 'notifications-outline',
          label: '알림',
          color: '#4F46E5',
          onPress: () => router.push('/notifications'),
        },
        {
          icon: 'megaphone-outline',
          label: `공지사항 (${noticeList.length}건)`,
          color: '#6366F1',
          onPress: () => router.push('/notices' as any),
        },
      ],
    },
    {
      title: '계정',
      items: [
        {
          icon: 'person-outline',
          label: '내 프로필',
          color: '#374151',
          onPress: () => router.push('/profile'),
        },
        {
          icon: 'people-outline',
          label: '보호자 관리',
          color: '#F59E0B',
          onPress: () => router.push('/guardians'),
        },
        {
          icon: 'shield-checkmark-outline',
          label: '내 기록 접근 이력',
          color: '#4F46E5',
          onPress: () => router.push('/access-log' as any),
        },
        {
          icon: 'settings-outline',
          label: '설정',
          color: '#6B7280',
          onPress: () => router.push('/settings'),
        },
      ],
    },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 프로필 카드 */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={32} color="#FFFFFF" />
        </View>
        <View>
          <Text style={styles.profileName}>{user?.name ?? '환자'}</Text>
          <Text style={styles.profilePhone}>{user?.phoneNumber ?? ''}</Text>
          {/* 🔴 종전 `user.patientId`(내부 UUID)를 "환자번호"로 찍었다 —
              화면에 "환자번호: 00000000-0000-4000-a000-000000d00001" 이 그대로 보였다.
              환자에게 의미 있는 번호는 등록번호(mrn)뿐이고, 없으면 아예 말하지 않는다. */}
          {user?.mrn && (
            <Text style={styles.profileId}>환자번호: {user.mrn}</Text>
          )}
        </View>
      </View>

      {/* 복약 요약 — 🔴 종전 제목이 "오늘의 복약 일정"이었는데 실제 데이터는 시간대가 아니라
          복용 중인 약 목록이다(오늘 무엇을 언제 먹는지는 복약 관리 화면이 정본). */}
      {medicationList.length > 0 && (
        <View style={styles.medCard}>
          <View style={styles.medHeader}>
            <Ionicons name="medical-outline" size={18} color="#4F46E5" />
            <Text style={styles.medTitle}>복용 중인 약</Text>
          </View>
          {medicationList.slice(0, 3).map((med: any, idx: number) => (
            <View key={idx} style={styles.medRow}>
              <Text style={styles.medName}>{med.name ?? med.medicationName ?? '약품명 미상'}</Text>
              <Text style={styles.medDose}>
                {[med.dosage, med.frequency].filter(Boolean).join(' / ') || '용법 정보 없음'}
              </Text>
            </View>
          ))}
          {medicationList.length > 3 && (
            <Text style={styles.medMore}>
              +{medicationList.length - 3}건 더보기
            </Text>
          )}
        </View>
      )}

      {/* 메뉴 섹션 */}
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.menuCard}>
            {section.items.map((item, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.menuItem,
                  idx < section.items.length - 1 && styles.menuItemBorder,
                ]}
                onPress={item.onPress}
              >
                <View style={styles.menuLeft}>
                  <Ionicons name={item.icon} size={22} color={item.color} />
                  <Text style={styles.menuLabel}>{item.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* 로그아웃 */}
      <TouchableOpacity
        style={[styles.logoutButton, confirmLogout && styles.logoutButtonConfirm]}
        onPress={handleLogout}
      >
        <Ionicons name={confirmLogout ? 'alert-circle-outline' : 'log-out-outline'} size={20} color={confirmLogout ? '#FFF' : '#EF4444'} />
        <Text style={[styles.logoutText, confirmLogout && styles.logoutTextConfirm]}>
          {confirmLogout ? '한 번 더 누르면 로그아웃' : '로그아웃'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.version}>Hospital RUN Mobile v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  profileCard: {
    backgroundColor: '#4F46E5',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profilePhone: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  profileId: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  medCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  medHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  medTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  medRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  medName: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  medDose: {
    fontSize: 13,
    color: '#6B7280',
  },
  medMore: {
    fontSize: 13,
    color: '#4F46E5',
    textAlign: 'center',
    marginTop: 8,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuLabel: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    backgroundColor: '#FFF5F5',
    marginTop: 8,
  },
  logoutButtonConfirm: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
  logoutTextConfirm: {
    color: '#FFFFFF',
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: '#D1D5DB',
    marginTop: 20,
  },
});
