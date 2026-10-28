import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const PHASE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  OUTPATIENT_WAITING: { label: '외래 대기', color: '#92400E', bg: '#FEF3C7' },
  OUTPATIENT_CALLED: { label: '호출됨', color: '#991B1B', bg: '#FEE2E2' },
  OUTPATIENT_IN_CONSULTATION: { label: '진료 중', color: '#1E40AF', bg: '#DBEAFE' },
  CHECKUP_IN_PROGRESS: { label: '건강검진', color: '#1E40AF', bg: '#DBEAFE' },
  INPATIENT: { label: '입원 중', color: '#5B21B6', bg: '#EDE9FE' },
  // 🔴 아래 둘은 서버가 오래전부터 내던 phase 인데 등재가 없어 IDLE 로 떨어졌다 —
  //    퇴원을 앞둔 환자·방문을 앞둔 환자에게 "건강 관리"라고 잘못 말하던 원인.
  PRE_DISCHARGE: { label: '퇴원 준비', color: '#047857', bg: '#ECFDF5' },
  PRE_VISIT: { label: '방문 예정', color: '#3730A3', bg: '#EEF2FF' },
  POST_DISCHARGE: { label: '퇴원 관리', color: '#065F46', bg: '#D1FAE5' },
  IDLE: { label: '건강 관리', color: '#374151', bg: '#F3F4F6' },
};

interface Props { phase: string }

export function JourneyPhaseBadge({ phase }: Props) {
  // 🔴 모르는 phase 를 IDLE('건강 관리')로 단정하지 않는다 — 새 phase 가 생기면 그렇게 말한다.
  const config = PHASE_CONFIG[phase] ?? { label: '상태 확인 중', color: '#6B7280', bg: '#F3F4F6' };
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 6, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontWeight: '600' },
});
