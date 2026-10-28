import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Link } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth-store';
import { getItem } from '../../src/lib/secure-storage';

const PIN_LENGTH = 6;

export default function PinScreen() {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const loginWithPin = useAuthStore((s) => s.loginWithPin);

  const handlePress = useCallback(
    async (digit: string) => {
      const next = pin + digit;
      setPin(next);

      if (next.length === PIN_LENGTH) {
        setLoading(true);
        try {
          // 🔴 서버 PIN 로그인은 phone 이 필수인데 이 화면엔 입력란이 없다.
          //    직전 로그인 때 이 기기에 저장해 둔 번호를 쓴다. 없으면 PIN 로그인을 할 수 없다.
          const phone = await getItem('lastPhone');
          if (!phone) {
            Alert.alert(
              'PIN 로그인 불가',
              '이 기기에서 먼저 전화번호와 비밀번호로 한 번 로그인해 주세요.',
            );
            setPin('');
            return;
          }
          await loginWithPin(phone, next);
        } catch (err: any) {
          Alert.alert('인증 실패', err?.message ?? 'PIN을 다시 확인해주세요.');
          setPin('');
        } finally {
          setLoading(false);
        }
      }
    },
    [pin, loginWithPin],
  );

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleBiometric = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      Alert.alert('알림', '생체 인증을 사용할 수 없습니다.');
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: '생체 인증으로 로그인',
      cancelLabel: '취소',
      fallbackLabel: 'PIN 입력',
    });

    if (result.success) {
      /*
       * 🔴 2026-08-14(W9). 생체 인증에 성공해도 로그인이 되지 않는다.
       *    PIN 을 기기에 저장하는 경로가 없고(서버에도 생체 등록 엔드포인트가 없다 —
       *    patient-auth 라우트 전수 확인), 종전 문구 "생체 인증 성공. PIN 설정이 필요합니다."
       *    는 무엇을 해야 하는지 알려주지 않은 채 성공한 것처럼만 말했다.
       *    지금은 왜 안 되는지·무엇을 하면 되는지를 말한다. 생체 로그인 구현은 사람 판단 이연분.
       */
      Alert.alert(
        '생체 인증 확인됨',
        '생체 인증으로 바로 로그인하는 기능은 아직 제공되지 않습니다. 아래 숫자판에서 PIN 을 입력해 주세요.',
      );
    }
  };

  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => (
    <View
      key={i}
      style={[styles.dot, i < pin.length && styles.dotFilled]}
    />
  ));

  const numpad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['bio', '0', 'del'],
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>PIN 입력</Text>
        <Text style={styles.subtitle}>6자리 PIN을 입력해주세요</Text>
      </View>

      <View style={styles.dots}>{dots}</View>

      <View style={styles.numpad}>
        {numpad.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key) => {
              if (key === 'bio') {
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.key}
                    onPress={handleBiometric}
                  >
                    <Text style={styles.keySpecial}>생체</Text>
                  </TouchableOpacity>
                );
              }
              if (key === 'del') {
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.key}
                    onPress={handleDelete}
                  >
                    <Text style={styles.keySpecial}>삭제</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.key}
                  onPress={() => handlePress(key)}
                  disabled={loading}
                >
                  <Text style={styles.keyText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <Link href="/(auth)/login" asChild>
        <TouchableOpacity style={styles.link}>
          <Text style={styles.linkText}>비밀번호로 로그인</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 6,
  },
  dots: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 40,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  numpad: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 20,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '600',
    color: '#111827',
  },
  keySpecial: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  link: {
    marginTop: 32,
  },
  linkText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
  },
});
