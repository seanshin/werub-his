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

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const signup = useAuthStore((s) => s.signup);

  /**
   * 🔴 2026-08-14(W9). 이 화면의 가입은 **한 번도 성공할 수 없었다.**
   *    서버 PatientSignupDto 필수값 = ci·name·dateOfBirth·gender·phone·password.
   *    앱은 ci 와 gender 를 아예 보내지 않았고(그리고 phone/dateOfBirth 를 다른 이름으로 보냈다)
   *    ValidationPipe 400 → "회원가입 실패 + 서버 검증 메시지" 만 반복됐다.
   *    ci 는 NICE 본인인증 결과값인데 이 앱에는 본인인증 연동이 없다
   *    (sms/verify 는 `{verified:boolean}` 만 준다 — ci 를 발급하지 않는다).
   *    → 될 수 없는 일을 시도해 실패 문구를 보여주는 대신, 왜 안 되는지와 대안을 말한다.
   *      본인인증 연동은 사람 판단·외부 계약 사안이다(W9 보고서 이연 목록).
   */
  const handleSignup = async () => {
    Alert.alert(
      '앱에서 가입할 수 없습니다',
      '회원가입에는 휴대폰 본인인증이 필요하며, 현재 앱 버전에는 본인인증이 연동되어 있지 않습니다.\n\n' +
        '병원 홈페이지 또는 원무과 접수창구에서 가입하신 뒤 이 앱에서 로그인해 주세요.',
      [{ text: '확인' }],
    );
  };

  /** 본인인증(ci) 연동이 붙으면 이 경로로 실제 가입한다. 지금은 호출되지 않는다. */
  const submitSignup = async (ci: string, gender: string) => {
    if (!name.trim() || !phoneNumber.trim() || !birthDate.trim() || !password.trim()) {
      Alert.alert('입력 오류', '모든 필드를 입력해주세요.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('입력 오류', '비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      await signup({
        ci,
        gender,
        name,
        phone: phoneNumber.replace(/-/g, ''),
        dateOfBirth: birthDate,
        password,
      });
    } catch (err: any) {
      Alert.alert('회원가입 실패', err?.message ?? '다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };
  void submitSignup;

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
          <Text style={styles.title}>회원가입</Text>
          <Text style={styles.subtitle}>환자 포털 계정 만들기</Text>
        </View>

        {/* 🔴 될 수 없는 일을 시켜놓고 실패시키지 않는다 — 먼저 사실을 말한다 */}
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            회원가입에는 휴대폰 본인인증이 필요합니다. 현재 앱 버전에는 본인인증이 연동되어
            있지 않아 앱에서는 가입을 완료할 수 없습니다. 병원 홈페이지 또는 원무과에서
            가입하신 뒤 로그인해 주세요.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>이름</Text>
          <TextInput
            style={styles.input}
            placeholder="홍길동"
            placeholderTextColor="#9CA3AF"
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.label}>전화번호</Text>
          <TextInput
            style={styles.input}
            placeholder="010-1234-5678"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
          />

          <Text style={styles.label}>생년월일</Text>
          <TextInput
            style={styles.input}
            placeholder="1990-01-01"
            placeholderTextColor="#9CA3AF"
            keyboardType="numbers-and-punctuation"
            value={birthDate}
            onChangeText={setBirthDate}
          />

          <Text style={styles.label}>비밀번호</Text>
          <TextInput
            style={styles.input}
            placeholder="8자 이상"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Text style={styles.label}>비밀번호 확인</Text>
          <TextInput
            style={styles.input}
            placeholder="비밀번호 다시 입력"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignup}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? '가입 중...' : '가입하기'}
            </Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>이미 계정이 있으신가요? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={styles.footerLink}>로그인</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
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
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 6,
  },
  notice: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  noticeText: { fontSize: 13, color: '#92400E', lineHeight: 20 },
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
});
