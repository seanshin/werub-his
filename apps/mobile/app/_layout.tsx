import React, { Component, useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, StyleSheet, Text, TouchableOpacity, Platform } from 'react-native';
import { useAuthStore } from '../src/stores/auth-store';
import { queryClient } from '../src/lib/query-client';

// WeRuby ITMS 모니터링 (웹 전용)
//
// 🔴 2026-08-14(W9) PHI 유출 경로 축소. 이 앱의 거의 모든 요청은 `/api/v1/portal/*` 이고
//    그 응답은 환자 본인의 검사결과·진단·투약·MRN·연락처다. `autoCapture.network: true` 는
//    그 요청/응답을 외부 모니터링 호스트(itms.example.org)로 함께 실어보낸다 —
//    환자 동의 근거도, 보존·파기 규약도 없는 경로였다. 네트워크 수집을 끈다.
//    (오류 스택 수집은 유지 — 다만 SDK 가 오류 컨텍스트에 응답 본문을 담는지는
//     확인되지 않았다. 운영 유지 여부는 사람 판단 필요: 보고서 '사람 판단 이연분' 참조.)
if (Platform.OS === 'web') {
  try {
    const { WeRubyITMS } = require('@werubyitms/browser');
    WeRubyITMS.init({
      dsn: 'https://9f58e7594a304095b346af853edbce15@itms.example.org/services/a86014e0-70e6-4eca-9d65-d173768fadd7',
      release: '0.1.0',
      environment: __DEV__ ? 'development' : 'production',
      autoCapture: { errors: true, network: false },
    });
  } catch {
    // @werubyitms/browser 미설치 시 무시
  }
}

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>오류가 발생했습니다</Text>
          <Text style={styles.errorMessage}>{this.state.error?.message}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

function AuthGate() {
  const { isAuthenticated, isLoading, restoreSession } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <AuthGate />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
