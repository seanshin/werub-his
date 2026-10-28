import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth-store';

export default function LoginScreen() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async () => {
    if (!phoneNumber.trim() || !password.trim()) {
      Alert.alert('입력 오류', '전화번호와 비밀번호를 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      await login(phoneNumber, password);
    } catch (err: any) {
      Alert.alert(
        '로그인 실패',
        err?.message ?? '전화번호 또는 비밀번호를 확인해주세요.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.logo}>Hospital RUN</Text>
          <Text style={styles.subtitle}>환자 포털 로그인</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>전화번호</Text>
          <TextInput
            style={styles.input}
            placeholder="010-1234-5678"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
            autoCapitalize="none"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
          />

          <Text style={styles.label}>비밀번호</Text>
          <TextInput
            style={styles.input}
            placeholder="비밀번호 입력"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? '로그인 중...' : '로그인'}
            </Text>
          </TouchableOpacity>

          <Link href="/(auth)/pin" asChild>
            <TouchableOpacity style={styles.linkButton}>
              <Text style={styles.linkText}>PIN으로 로그인</Text>
            </TouchableOpacity>
          </Link>

          <View style={styles.footer}>
            <Text style={styles.footerText}>계정이 없으신가요? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text style={styles.footerLink}>회원가입</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>

        {/* ── 테스트 계정 (개발 환경만) ── */}
        {__DEV__ && <View style={styles.testSection}>
          <Text style={styles.testTitle}>테스트 계정</Text>
          <Text style={styles.testPassword}>비밀번호: patient1234!</Text>
          <View style={styles.testGrid}>
            {[
              { name: '김영수', phone: '010-1234-5678', desc: '68세 남 · 고혈압+당뇨' },
              { name: '이미숙', phone: '010-2345-6789', desc: '61세 여 · 위식도역류' },
              { name: '정민호', phone: '010-5678-9012', desc: '41세 남 · 감기' },
              { name: '한지영', phone: '010-6789-0123', desc: '36세 여 · 불안장애' },
              { name: '윤서연', phone: '010-0123-4567', desc: '31세 여 · 두드러기' },
            ].map((t) => (
              <TouchableOpacity
                key={t.phone}
                style={styles.testCard}
                onPress={() => {
                  setPhoneNumber(t.phone);
                  setPassword('patient1234!');
                }}
              >
                <Text style={styles.testName}>{t.name}</Text>
                <Text style={styles.testPhone}>{t.phone}</Text>
                <Text style={styles.testDesc}>{t.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 32,
    fontWeight: '700',
    color: '#4F46E5',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 8,
  },
  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  button: {
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  linkText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  footerText: {
    color: '#6B7280',
    fontSize: 14,
  },
  footerLink: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
  },
  testSection: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  testTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  testPassword: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 12,
  },
  testGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  testCard: {
    width: '48%' as any,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  testName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  testPhone: {
    fontSize: 11,
    color: '#9CA3AF',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  testDesc: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
});
