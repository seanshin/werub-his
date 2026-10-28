import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InfoCard } from '../common/InfoCard';
import { useAuthStore } from '../../stores/auth-store';
import { formatAmount } from '../../lib/format';

/**
 * 퇴원 준비(PRE_DISCHARGE) — 퇴원요약이 서명(SIGNED/AMENDED)된 입원 환자.
 *
 * 🔴 2026-08-14(W9) 신설. 서버는 이 phase 를 내는데 모바일 홈에 분기가 없어서
 *    퇴원을 앞둔 환자에게 **빈 화면 + "건강 관리" 배지**를 보여주고 있었다.
 */
interface Props { data: any }

export function PreDischargeCard({ data }: Props) {
  const user = useAuthStore((s) => s.user);
  const adm = data.admission;
  const ds = data.dischargeSummary;
  const cl = data.checklist;
  const billing = data.billing;

  return (
    <View>
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <View style={s.iconCircle}>
            <Ionicons name="exit-outline" size={22} color="#059669" />
          </View>
          <View>
            <Text style={s.patientName}>{user?.name ?? '환자'}님</Text>
            <Text style={s.subText}>퇴원 준비 중 · 입원 {adm?.daysSinceAdmit ?? '-'}일차</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.wardText}>
            {[adm?.ward, adm?.room ? `${adm.room}호` : null].filter(Boolean).join(' ')}
          </Text>
          {adm?.attendingDoctor && (
            <Text style={s.doctorText}>
              주치의 {adm.attendingDoctor.familyName}{adm.attendingDoctor.givenName}
            </Text>
          )}
        </View>
      </View>

      {ds && (
        <InfoCard title="퇴원 안내" accentColor="#10B981">
          {ds.dischargeDate && (
            <Row label="퇴원 예정" value={new Date(ds.dischargeDate).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} />
          )}
          {ds.diagnosis && <Block label="퇴원 진단" text={ds.diagnosis} />}
          {ds.followUpPlan && <Block label="추적 계획" text={ds.followUpPlan} />}
          {ds.followUpDate && (
            <Row label="다음 외래" value={new Date(ds.followUpDate).toLocaleDateString('ko-KR')} />
          )}
          {ds.medications && <Block label="퇴원약" text={ds.medications} />}
          {ds.dietaryInstructions && <Block label="식이" text={ds.dietaryInstructions} />}
          {ds.activityRestrictions && <Block label="활동 제한" text={ds.activityRestrictions} />}
          {ds.patientEducation && <Block label="교육 사항" text={ds.patientEducation} />}
        </InfoCard>
      )}

      {cl && (
        <InfoCard title="퇴원 체크리스트" accentColor="#F59E0B">
          <CheckRow done={!!cl.dischargeSummarySigned} label="퇴원요약 작성 완료" />
          <CheckRow done={!!cl.followUpBooked} label="다음 외래 예약" />
          <CheckRow done={!!cl.billingSettled} label="입원비 정산" />
          {/*
            🔴 서버(portal.service.buildPreDischargeStatus)는 medicationReceived / satisfactionSurveyDone 을
               **측정하지 않고 상수 false 로** 내려보낸다. 그 상수를 체크박스로 그리면 실제로 약을 받은
               환자에게도 영구히 "미완료"라고 말하게 된다(없는 사실을 단정). 상태 대신 안내로만 표시한다.
          */}
          <View style={s.noteRow}>
            <Ionicons name="information-circle-outline" size={15} color="#9CA3AF" />
            <Text style={s.noteText}>
              퇴원약 수령·만족도 조사 여부는 앱에서 확인할 수 없습니다. 병동에 문의해 주세요.
            </Text>
          </View>
        </InfoCard>
      )}

      {billing && (billing.total > 0 || billing.paid > 0) && (
        <InfoCard title="입원비 (중간정산 기준)" accentColor="#EF4444">
          <Row label="청구" value={formatAmount(billing.total)} />
          <Row label="수납" value={formatAmount(billing.paid)} />
          <Row label="잔액" value={formatAmount(billing.remaining)} strong={billing.remaining > 0} />
          <Text style={s.noteText}>중간정산 합계이며 최종 확정 금액이 아닙니다.</Text>
        </InfoCard>
      )}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, strong && s.rowValueStrong]}>{value}</Text>
    </View>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <View style={s.block}>
      <Text style={s.blockLabel}>{label}</Text>
      <Text style={s.blockText}>{text}</Text>
    </View>
  );
}

function CheckRow({ done, label }: { done: boolean; label: string }) {
  return (
    <View style={s.checkRow}>
      <Ionicons
        name={done ? 'checkmark-circle' : 'ellipse-outline'}
        size={18}
        color={done ? '#10B981' : '#D1D5DB'}
      />
      <Text style={[s.checkLabel, done && s.checkLabelDone]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ECFDF5', borderRadius: 14, padding: 16, marginBottom: 12 },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center' },
  patientName: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  subText: { fontSize: 12, color: '#047857', marginTop: 2 },
  wardText: { fontSize: 12, color: '#047857', fontWeight: '500' },
  doctorText: { fontSize: 11, color: '#059669', marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 13, color: '#6B7280' },
  rowValue: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  rowValueStrong: { color: '#DC2626', fontWeight: '800' },
  block: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#F3F4F6', marginTop: 6 },
  blockLabel: { fontSize: 11, fontWeight: '700', color: '#6B7280', marginBottom: 2 },
  blockText: { fontSize: 13, color: '#374151', lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  checkLabel: { fontSize: 13, color: '#374151', flex: 1 },
  checkLabelDone: { color: '#059669', fontWeight: '600' },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  noteText: { flex: 1, fontSize: 11, color: '#9CA3AF', lineHeight: 17, marginTop: 4 },
});
