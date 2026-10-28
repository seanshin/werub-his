import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/lib/api-client';

type TabIcon = React.ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  name: string;
  title: string;
  icon: TabIcon;
  iconFocused: TabIcon;
}

const tabs: TabConfig[] = [
  { name: 'index', title: '홈', icon: 'home-outline', iconFocused: 'home' },
  {
    name: 'appointments',
    title: '예약',
    icon: 'calendar-outline',
    iconFocused: 'calendar',
  },
  {
    name: 'encounters',
    title: '진료',
    icon: 'medkit-outline',
    iconFocused: 'medkit',
  },
  {
    name: 'labs',
    title: '검사',
    icon: 'flask-outline',
    iconFocused: 'flask',
  },
  {
    name: 'more',
    title: '더보기',
    icon: 'ellipsis-horizontal-outline',
    iconFocused: 'ellipsis-horizontal',
  },
];

function NotificationBell() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () =>
      apiClient.get<{ data: { count: number } }>(
        '/api/v1/patient-auth/notifications/unread-count',
      ),
  });

  const unreadCount = (data as any)?.data?.count ?? 0;

  return (
    <TouchableOpacity
      style={bellStyles.container}
      onPress={() => router.push('/notifications')}
    >
      <Ionicons name="notifications-outline" size={24} color="#111827" />
      {unreadCount > 0 && (
        <View style={bellStyles.badge}>
          <Text style={bellStyles.badgeText}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const bellStyles = StyleSheet.create({
  container: {
    position: 'relative',
    marginRight: 12,
    padding: 10,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#4F46E5',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E7EB',
          height: 88,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: '#FFFFFF',
        },
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
          color: '#111827',
        },
        headerShadowVisible: false,
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? tab.iconFocused : tab.icon}
                size={size}
                color={color}
              />
            ),
            ...(tab.name === 'index' && {
              headerRight: () => <NotificationBell />,
            }),
          }}
        />
      ))}
      {/* 탭바에서 숨기되 라우트로 접근 가능한 화면 (탭바 유지) */}
      {[
        { name: 'notifications', title: '알림' },
        { name: 'booking', title: 'AI 예약' },
        { name: 'billing', title: '수납' },
        { name: 'billing-summary', title: '수납 요약' },
        { name: 'medication', title: '복약 관리' },
        { name: 'consent', title: '동의서' },
        { name: 'documents', title: '서류' },
        { name: 'questionnaire', title: '문진표' },
        { name: 'telehealth', title: '원격진료' },
        { name: 'telehealth-book', title: '원격진료 예약' },
        { name: 'imaging', title: '영상검사' },
        { name: 'ai-health', title: 'AI 건강' },
        { name: 'health', title: '건강 관리' },
        { name: 'messages', title: '담당의 메시지' },
        { name: 'notices', title: '공지사항' },
        { name: 'profile', title: '내 프로필' },
        { name: 'guardians', title: '보호자' },
        { name: 'checkup-detail', title: '검진 상세' },
        { name: 'checkup-compare', title: '검진 비교·예약' },
        { name: 'chronic-trend', title: '만성질환 추이' },
        { name: 'access-log', title: '내 기록 접근 이력' },
        { name: 'settings', title: '설정' },
      ].map((screen) => (
        <Tabs.Screen
          key={screen.name}
          name={screen.name}
          options={{ title: screen.title, href: null }}
        />
      ))}
    </Tabs>
  );
}
