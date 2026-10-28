import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InfoCard } from '../common/InfoCard';
import type { JourneyStatus } from '../../hooks/useJourneyStatus';
import { useAuthStore } from '../../stores/auth-store';
import { isAbnormalFlag, flagMark } from '../../lib/lab-flags';
import { formatMeasuredAt, isStale } from '../../lib/format';

interface Props { data: JourneyStatus }

export function InpatientCard({ data }: Props) {
  const user = useAuthStore((s) => s.user);
  const adm = data.admission;
  const v = data.vitals;
  const meds = data.todayMedications ?? [];
  const labs = data.recentLabResults ?? [];
  const notes = data.recentProgressNotes ?? [];

  return (
    <View>
      {/* 배너 — 컴팩트 */}
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <View style={s.iconCircle}>
            <Ionicons name="bed-outline" size={22} color="#7C3AED" />
          </View>
          <View>
            <Text style={s.patientName}>{user?.name ?? '환자'}님</Text>
            {/* 🔴 모르는 재원일을 0 으로 말하지 않는다 — "입원 0일차"는 틀린 사실이다 */}
            <Text style={s.daysBadge}>
              {adm?.daysSinceAdmit != null ? `입원 ${adm.daysSinceAdmit}일차` : '입원 중'}
            </Text>
          </View>
        </View>
        <View style={s.bannerRight}>
          <Text style={s.wardText}>{[adm?.ward, adm?.room ? `${adm.room}호` : null, adm?.bed].filter(Boolean).join(' ')}</Text>
          {adm?.attendingDoctor && (
            <Text style={s.doctorText}>주치의 {adm.attendingDoctor.familyName}{adm.attendingDoctor.givenName}</Text>
          )}
        </View>
      </View>

      {/* 바이탈 — 그리드 */}
      {v && (v.systolicBp != null || v.heartRate != null) && (
        <View style={s.vitalsCard}>
          <View style={s.vitalsHeader}>
            <Ionicons name="heart" size={14} color="#EF4444" />
            <Text style={s.vitalsTitle}>바이탈</Text>
            {/* 🔴 종전 시:분만 찍어 66일 전 측정치가 오늘 잰 값처럼 보였다(운영 실측). */}
            <Text style={[s.vitalsTime, isStale(v.measuredAt) && s.vitalsTimeStale]}>
              {formatMeasuredAt(v.measuredAt) || '측정 시각 미상'}
              {isStale(v.measuredAt) ? ' 측정' : ''}
            </Text>
          </View>
          <View style={s.vitalsGrid}>
            {v.systolicBp != null && <VitalChip label="BP" value={`${v.systolicBp}/${v.diastolicBp}`} unit="mmHg" />}
            {v.heartRate != null && <VitalChip label="HR" value={String(v.heartRate)} unit="bpm" />}
            {v.temperature != null && <VitalChip label="T" value={String(v.temperature)} unit="°C" />}
            {v.spo2 != null && <VitalChip label="SpO2" value={String(v.spo2)} unit="%" />}
          </View>
        </View>
      )}

      {/* 투약 */}
      {meds.length > 0 && (
        <InfoCard title={`오늘 투약 (${meds.filter(m => m.status === 'ADMINISTERED').length}/${meds.length})`} accentColor="#8B5CF6">
          {meds.slice(0, 6).map((m) => (
            <View key={m.id} style={s.medRow}>
              <Ionicons name={m.status === 'ADMINISTERED' ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={m.status === 'ADMINISTERED' ? '#10B981' : '#D1D5DB'} />
              <Text style={s.medTime}>{new Date(m.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</Text>
              <Text style={[s.medName, m.status === 'ADMINISTERED' && s.medDone]} numberOfLines={1}>{m.drugName ?? '약물'} {m.dose}</Text>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 검사 결과 */}
      {labs.length > 0 && (
        <InfoCard title="최근 검사" accentColor="#3B82F6">
          {labs.slice(0, 3).map((r: any) => (
            <View key={r.id} style={s.labGroup}>
              {r.items?.slice(0, 4).map((item: any, i: number) => (
                <View key={i} style={s.labRow}>
                  <Text style={s.labName} numberOfLines={1}>{item.testName}</Text>
                  {/* 🔴 종전 `flag !== 'NORMAL'` → 정상('N')까지 붉게. 방향 표식도 없어 H/L 구분 불가였다 */}
                  <Text style={[s.labValue, isAbnormalFlag(item.flag) && s.labFlag]}>
                    {item.value} {item.unit}{flagMark(item.flag)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </InfoCard>
      )}

      {/* 경과기록 */}
      {notes.length > 0 && (
        <InfoCard title="최근 경과기록" accentColor="#10B981">
          {notes.slice(0, 3).map((n: any) => (
            <View key={n.id} style={s.noteRow}>
              <Text style={s.noteDate}>{new Date(n.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}</Text>
              <Text style={s.noteText} numberOfLines={2}>{n.content}</Text>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 수술 */}
      {data.nextSurgery && (
        <InfoCard title="예정 수술" accentColor="#EF4444">
          <View style={s.surgeryRow}>
            <Ionicons name="cut-outline" size={18} color="#EF4444" />
            <View style={{ flex: 1 }}>
              <Text style={s.surgeryName}>{data.nextSurgery.procedureName}</Text>
              <Text style={s.surgeryDate}>{new Date(data.nextSurgery.scheduledAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          </View>
        </InfoCard>
      )}
    </View>
  );
}

function VitalChip({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={s.vitalChip}>
      <Text style={s.vitalLabel}>{label}</Text>
      <Text style={s.vitalValue}>{value}</Text>
      <Text style={s.vitalUnit}>{unit}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, marginBottom: 12 },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EDE9FE', justifyContent: 'center', alignItems: 'center' },
  patientName: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  daysBadge: { fontSize: 13, fontWeight: '800', color: '#7C3AED', marginTop: 1 },
  bannerRight: { alignItems: 'flex-end' },
  wardText: { fontSize: 12, color: '#6D28D9', fontWeight: '500' },
  doctorText: { fontSize: 11, color: '#8B5CF6', marginTop: 2 },
  vitalsCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  vitalsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  vitalsTitle: { fontSize: 13, fontWeight: '700', color: '#374151', flex: 1 },
  vitalsTime: { fontSize: 11, color: '#9CA3AF' },
  vitalsTimeStale: { color: '#D97706', fontWeight: '600' },
  vitalsGrid: { flexDirection: 'row', gap: 8 },
  vitalChip: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, alignItems: 'center' },
  vitalLabel: { fontSize: 10, fontWeight: '600', color: '#9CA3AF' },
  vitalValue: { fontSize: 18, fontWeight: '800', color: '#1F2937', marginTop: 2 },
  vitalUnit: { fontSize: 10, color: '#9CA3AF', marginTop: 1 },
  medRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  medTime: { fontSize: 12, color: '#6B7280', width: 48, fontVariant: ['tabular-nums'] },
  medName: { fontSize: 13, color: '#374151', flex: 1 },
  medDone: { color: '#9CA3AF', textDecorationLine: 'line-through' },
  labGroup: { marginBottom: 4 },
  labRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  labName: { fontSize: 13, color: '#6B7280', flex: 1 },
  labValue: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  labFlag: { color: '#EF4444' },
  noteRow: { flexDirection: 'row', paddingVertical: 6, gap: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  noteDate: { fontSize: 11, color: '#9CA3AF', width: 42, marginTop: 2 },
  noteText: { fontSize: 13, color: '#374151', flex: 1, lineHeight: 19 },
  surgeryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  surgeryName: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  surgeryDate: { fontSize: 12, color: '#6B7280', marginTop: 2 },
});
