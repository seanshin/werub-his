import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InfoCard } from '../common/InfoCard';
import { useAuthStore } from '../../stores/auth-store';

/**
 * 방문 전(PRE_VISIT) — 예약이 D-7 이내인 상태.
 *
 * 🔴 2026-08-14(W9) 신설. 서버 `/portal/journey/status` 는 이 phase 를 오래전부터 내고 있었는데
 *    모바일 홈(app/(tabs)/index.tsx)에는 분기가 아예 없어서, **예약이 잡힌 평범한 환자**가
 *    홈에 들어오면 상단 배지 하나만 있고 그 아래가 통째로 빈 화면이었다.
 *    (배지도 PRE_VISIT 를 몰라 IDLE 로 떨어져 "건강 관리"라고 잘못 말했다.)
 */
interface Props { data: any }

export function PreVisitCard({ data }: Props) {
  const user = useAuthStore((s) => s.user);
  const appt = data.appointment;
  const checklist = data.checklist;
  const meds: any[] = data.activeMedications ?? [];

  const dLabel =
    appt?.daysUntil == null ? null
      : appt.daysUntil <= 0 ? '오늘'
      : appt.daysUntil === 1 ? '내일'
      : `D-${appt.daysUntil}`;

  return (
    <View>
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <View style={s.iconCircle}>
            <Ionicons name="calendar" size={22} color="#4F46E5" />
          </View>
          <View>
            <Text style={s.patientName}>{user?.name ?? '환자'}님</Text>
            <Text style={s.subText}>
              {appt?.department ?? ''}
              {appt?.doctor ? ` · ${appt.doctor.familyName}${appt.doctor.givenName} 선생님` : ''}
            </Text>
          </View>
        </View>
        {dLabel && <Text style={s.dBadge}>{dLabel}</Text>}
      </View>

      {appt?.scheduledAt && (
        <InfoCard title="예약 일시" accentColor="#4F46E5">
          <Text style={s.apptDate}>
            {new Date(appt.scheduledAt).toLocaleString('ko-KR', {
              year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
              hour: '2-digit', minute: '2-digit',
            })}
          </Text>
          {appt.reason ? <Text style={s.apptReason}>{appt.reason}</Text> : null}
        </InfoCard>
      )}

      {/* 준비 사항 — 서버가 실제로 세어 준 값만 보여준다. 0 이면 "완료"가 아니라 "없음"이다. */}
      {checklist && (
        <InfoCard title="방문 전 준비" accentColor="#F59E0B">
          <CheckRow
            icon="create-outline"
            label="서명 대기 동의서"
            value={checklist.consentPending > 0 ? `${checklist.consentPending}건` : '없음'}
            warn={checklist.consentPending > 0}
          />
          <CheckRow
            icon="clipboard-outline"
            label="작성 대기 문진표"
            value={checklist.questionnairePending > 0 ? `${checklist.questionnairePending}건` : '없음'}
            warn={checklist.questionnairePending > 0}
          />
          {checklist.hasFastingTest && (
            <CheckRow icon="restaurant-outline" label="금식 필요 검사" value="있음" warn />
          )}
          <CheckRow
            icon="medical-outline"
            label="복용 중인 약"
            value={`${checklist.medicationCount ?? meds.length}종`}
          />
        </InfoCard>
      )}

      {meds.length > 0 && (
        <InfoCard title={`복용 중인 약 (${meds.length})`} accentColor="#8B5CF6">
          {meds.map((m: any) => (
            <View key={m.id} style={s.medRow}>
              {/* 약품명이 원장에 없으면 "약물"이라고 아는 척하지 않는다 */}
              <Text style={s.medName}>{m.drugName ?? '약품명 미상'}</Text>
              <Text style={s.medDose}>
                {[m.dosage, m.frequency].filter(Boolean).join(' · ') || '용법 미상'}
              </Text>
            </View>
          ))}
        </InfoCard>
      )}
    </View>
  );
}

function CheckRow({ icon, label, value, warn }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string; value: string; warn?: boolean;
}) {
  return (
    <View style={s.checkRow}>
      <Ionicons name={icon} size={16} color={warn ? '#D97706' : '#9CA3AF'} />
      <Text style={s.checkLabel}>{label}</Text>
      <Text style={[s.checkValue, warn && s.checkValueWarn]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#EEF2FF', borderRadius: 14, padding: 16, marginBottom: 12 },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E0E7FF', justifyContent: 'center', alignItems: 'center' },
  patientName: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  subText: { fontSize: 12, color: '#4F46E5', marginTop: 2 },
  dBadge: { fontSize: 18, fontWeight: '800', color: '#4F46E5' },
  apptDate: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  apptReason: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  checkLabel: { fontSize: 13, color: '#374151', flex: 1 },
  checkValue: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  checkValueWarn: { color: '#D97706' },
  medRow: { paddingVertical: 4 },
  medName: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  medDose: { fontSize: 12, color: '#6B7280', marginTop: 1 },
});
