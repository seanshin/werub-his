import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InfoCard } from '../common/InfoCard';
import type { JourneyStatus } from '../../hooks/useJourneyStatus';
import { useAuthStore } from '../../stores/auth-store';

interface Props { data: JourneyStatus }

export function IdleCard({ data }: Props) {
  const user = useAuthStore((s) => s.user);

  return (
    <View>
      <View style={styles.banner}>
        <Text style={styles.bannerEmoji}>👋</Text>
        <Text style={styles.bannerTitle}>안녕하세요{user?.name ? `, ${user.name}님` : ''}</Text>
      </View>

      {data.nextAppointment && (
        <InfoCard title="다음 예약" accentColor="#4F46E5">
          <Text style={styles.dateText}>
            {new Date(data.nextAppointment.scheduledAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
          </Text>
          {data.nextAppointment.doctor && (
            <Text style={styles.subText}>{data.nextAppointment.doctor.familyName}{data.nextAppointment.doctor.givenName} 선생님</Text>
          )}
        </InfoCard>
      )}

      {data.activeMedications && data.activeMedications.length > 0 && (
        <InfoCard title={`복용 중인 약 (${data.activeMedications.length})`} accentColor="#8B5CF6">
          {data.activeMedications.map((m) => (
            <View key={m.id} style={styles.medRow}>
              <Text style={styles.medName}>{m.drugName ?? '약물'}</Text>
              <Text style={styles.medDose}>{m.dosage} · {m.frequency}</Text>
            </View>
          ))}
        </InfoCard>
      )}

      {data.lastEncounter && (
        <InfoCard title="마지막 진료" accentColor="#6B7280">
          <Text style={styles.text}>{new Date(data.lastEncounter.createdAt).toLocaleDateString('ko-KR')}</Text>
          {data.lastEncounter.chiefComplaint && (
            <Text style={styles.subText}>{data.lastEncounter.chiefComplaint}</Text>
          )}
        </InfoCard>
      )}

      {/* 건강 대시보드 */}
      {data.healthDashboard && (
        <InfoCard title="건강 관리" accentColor="#10B981">
          {data.healthDashboard.vitals && (
            <View style={styles.vitalsRow}>
              {data.healthDashboard.vitals.systolicBp != null && (
                <Text style={styles.vitalItem}>BP {data.healthDashboard.vitals.systolicBp}/{data.healthDashboard.vitals.diastolicBp}</Text>
              )}
              {data.healthDashboard.vitals.heartRate != null && (
                <Text style={styles.vitalItem}>HR {data.healthDashboard.vitals.heartRate}</Text>
              )}
            </View>
          )}
          {data.healthDashboard.problems && data.healthDashboard.problems.length > 0 && (
            <View style={styles.problemsRow}>
              <Text style={styles.problemLabel}>활성 문제:</Text>
              {/* 🔴 `p.description ?? p.name ?? p` 는 두 키가 모두 없으면 **객체 자체**를 자식으로
                  넘겨 RN 이 "Objects are not valid as a React child" 로 화면을 통째로 죽인다.
                  문자열로 뽑을 수 없으면 그리지 않는다. */}
              {data.healthDashboard.problems.slice(0, 3).map((p: any, i: number) => {
                const label =
                  typeof p === 'string' ? p
                    : p?.description ?? p?.name ?? p?.problemName ?? p?.diagnosisName ?? null;
                if (!label) return null;
                return <Text key={i} style={styles.problemItem}>{String(label)}</Text>;
              })}
            </View>
          )}
          {!data.healthDashboard.vitals && !data.healthDashboard.problems?.length && (
            <Text style={styles.subText}>건강 데이터를 축적 중입니다</Text>
          )}
        </InfoCard>
      )}

      {data.unreadNotifications != null && data.unreadNotifications > 0 && (
        <InfoCard title={`알림 (${data.unreadNotifications})`} accentColor="#F59E0B">
          <Text style={styles.subText}>읽지 않은 알림이 있습니다</Text>
        </InfoCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#F3F4F6', borderRadius: 12, padding: 20, marginBottom: 12, alignItems: 'center' },
  bannerEmoji: { fontSize: 32 },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginTop: 6 },
  dateText: { fontSize: 14, fontWeight: '600', color: '#4F46E5' },
  text: { fontSize: 13, color: '#374151' },
  subText: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  medRow: { paddingVertical: 4 },
  medName: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  medDose: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  vitalsRow: { flexDirection: 'row', gap: 16, marginBottom: 6 },
  vitalItem: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  problemsRow: { marginTop: 4 },
  problemLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 2 },
  problemItem: { fontSize: 12, color: '#374151', paddingLeft: 8 },
});
