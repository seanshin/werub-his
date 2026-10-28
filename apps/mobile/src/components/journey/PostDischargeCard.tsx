import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InfoCard } from '../common/InfoCard';
import type { JourneyStatus } from '../../hooks/useJourneyStatus';
import { useAuthStore } from '../../stores/auth-store';

interface Props { data: JourneyStatus }

export function PostDischargeCard({ data }: Props) {
  const user = useAuthStore((s) => s.user);
  const d = data.discharge;

  return (
    <View>
      <View style={styles.banner}>
        <Text style={styles.bannerEmoji}>🏠</Text>
        {user?.name ? <Text style={styles.bannerName}>{user.name}님</Text> : null}
        {/* 🔴 모르는 경과일을 0 으로 말하지 않는다 */}
        <Text style={styles.bannerTitle}>
          {d?.daysSinceDischarge != null ? `퇴원 ${d.daysSinceDischarge}일차` : '퇴원 후 관리'}
        </Text>
        {d?.attendingDoctor && (
          <Text style={styles.bannerSub}>주치의: {d.attendingDoctor.familyName}{d.attendingDoctor.givenName}</Text>
        )}
      </View>

      {d?.diagnosis && (
        <InfoCard title="퇴원 진단" accentColor="#10B981">
          <Text style={styles.text}>{d.diagnosis}</Text>
        </InfoCard>
      )}

      {(d?.followUpPlan || d?.followUpDate) && (
        <InfoCard title="추적 계획" accentColor="#3B82F6">
          {d?.followUpPlan && <Text style={styles.text}>{d.followUpPlan}</Text>}
          {d?.followUpDate && <Text style={styles.dateText}>다음 외래: {new Date(d.followUpDate).toLocaleDateString('ko-KR')}</Text>}
        </InfoCard>
      )}

      {data.nextAppointment && (
        <InfoCard title="다음 예약" accentColor="#4F46E5">
          <Text style={styles.text}>
            {new Date(data.nextAppointment.scheduledAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
          </Text>
          {data.nextAppointment.doctor && (
            <Text style={styles.subText}>{data.nextAppointment.doctor.familyName}{data.nextAppointment.doctor.givenName} 선생님</Text>
          )}
        </InfoCard>
      )}

      {data.activeMedications && data.activeMedications.length > 0 && (
        <InfoCard title="퇴원약" accentColor="#8B5CF6">
          {data.activeMedications.map((m) => (
            <View key={m.id} style={styles.medRow}>
              <Text style={styles.medName}>{m.drugName ?? '약물'}</Text>
              <Text style={styles.medDose}>{m.dosage} · {m.frequency}</Text>
            </View>
          ))}
        </InfoCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#D1FAE5', borderRadius: 12, padding: 20, marginBottom: 12, alignItems: 'center' },
  bannerEmoji: { fontSize: 32 },
  bannerName: { fontSize: 15, fontWeight: '600', color: '#047857', marginTop: 6 },
  bannerTitle: { fontSize: 20, fontWeight: '800', color: '#065F46', marginTop: 2 },
  bannerSub: { fontSize: 13, color: '#047857', marginTop: 4 },
  text: { fontSize: 13, color: '#374151', lineHeight: 20 },
  subText: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  dateText: { fontSize: 13, fontWeight: '600', color: '#4F46E5', marginTop: 6 },
  medRow: { paddingVertical: 4 },
  medName: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  medDose: { fontSize: 12, color: '#6B7280', marginTop: 1 },
});
