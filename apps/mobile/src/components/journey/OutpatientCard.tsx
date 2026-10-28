import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InfoCard } from '../common/InfoCard';
import type { JourneyStatus } from '../../hooks/useJourneyStatus';
import { useAuthStore } from '../../stores/auth-store';
import { isAbnormalFlag, flagMark } from '../../lib/lab-flags';

interface Props { data: JourneyStatus }

export function OutpatientCard({ data }: Props) {
  const user = useAuthStore((s) => s.user);
  const q = data.queue;
  const isCalled = data.phase === 'OUTPATIENT_CALLED';
  const isConsulting = data.phase === 'OUTPATIENT_IN_CONSULTATION';

  return (
    <View>
      {/* 대기/호출/진료 배너 */}
      <View style={[styles.banner, isCalled ? styles.bannerCalled : isConsulting ? styles.bannerConsulting : styles.bannerWaiting]}>
        <Text style={styles.bannerEmoji}>{isCalled ? '🔔' : isConsulting ? '💊' : '⏳'}</Text>
        {user?.name ? <Text style={styles.bannerName}>{user.name}님</Text> : null}
        <Text style={styles.bannerTitle}>
          {isCalled ? '호출되었습니다!' : isConsulting ? '진료 진행 중' : `${q?.departmentName ?? '진료'} 대기 중`}
        </Text>
        {isCalled && <Text style={styles.bannerSub}>진료실로 이동해주세요</Text>}
        {isConsulting && q?.doctor && <Text style={styles.bannerSub}>{q.doctor.familyName}{q.doctor.givenName} 선생님</Text>}
      </View>

      {/* 대기 정보 */}
      {q && !isConsulting && (
        <InfoCard title="대기 현황" accentColor={isCalled ? '#EF4444' : '#F59E0B'}>
          <View style={styles.queueRow}>
            <View style={styles.queueItem}>
              <Text style={styles.queueNumber}>#{q.queueNumber}</Text>
              <Text style={styles.queueLabel}>대기번호</Text>
            </View>
            <View style={styles.queueItem}>
              <Text style={styles.queueNumber}>{q.aheadCount}명</Text>
              <Text style={styles.queueLabel}>앞 대기</Text>
            </View>
            {/* 🔴 서버가 표본 부족이면 estimatedWaitMinutes 를 null 로 낸다.
                종전 `~{q.estimatedWaitMinutes}분` 은 그 경우 화면에 "~분"만 남겼다.
                모르면 모른다고 말한다 — 0분이라고 말하지 않는다. */}
            <View style={styles.queueItem}>
              {q.estimatedWaitMinutes != null ? (
                <Text style={styles.queueNumber}>~{q.estimatedWaitMinutes}분</Text>
              ) : (
                <Text style={styles.queueUnknown}>산출 불가</Text>
              )}
              <Text style={styles.queueLabel}>예상 시간</Text>
            </View>
          </View>
        </InfoCard>
      )}

      {/* 오늘 예약 */}
      {data.todayAppointments && data.todayAppointments.length > 0 && (
        <InfoCard title="오늘 예약" accentColor="#3B82F6">
          {data.todayAppointments.map((a, i) => (
            <View key={a.id} style={[styles.apptRow, i > 0 && styles.apptBorder]}>
              <Text style={styles.apptTime}>{new Date(a.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</Text>
              <Text style={styles.apptDoctor}>{a.doctor ? `${a.doctor.familyName}${a.doctor.givenName}` : a.type}</Text>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 검사/영상 오더 진행 현황 */}
      {(data as any).pendingOrders && (
        (() => {
          const po = (data as any).pendingOrders;
          const hasOrders = (po.lab?.length > 0) || (po.imaging?.length > 0) || (po.diagnostic?.length > 0);
          if (!hasOrders) return null;

          return (
            <InfoCard title="검사 진행 현황" accentColor="#EF4444">
              {po.lab?.map((o: any, i: number) => (
                <View key={`lab-${i}`} style={styles.orderRow}>
                  <Text style={styles.orderIcon}>🩸</Text>
                  <View style={styles.orderBody}>
                    <Text style={styles.orderName}>{o.testNames?.join(', ') || '혈액검사'}</Text>
                    <Text style={styles.orderLocation}>{o.location}</Text>
                    <View style={[styles.orderBadge, o.labStatus === 'IN_PROGRESS' ? styles.badgeProgress : styles.badgePending]}>
                      <Text style={styles.orderBadgeText}>
                        {o.labStatus === 'IN_PROGRESS' ? '검사 중' : o.labStatus === 'COLLECTED' ? '채혈 완료' : '채혈 대기'}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
              {po.imaging?.map((o: any, i: number) => (
                <View key={`img-${i}`} style={styles.orderRow}>
                  <Text style={styles.orderIcon}>📷</Text>
                  <View style={styles.orderBody}>
                    <Text style={styles.orderName}>{o.modality} — {o.bodyPart}</Text>
                    <Text style={styles.orderLocation}>{o.location}</Text>
                    <View style={[styles.orderBadge, styles.badgePending]}>
                      <Text style={styles.orderBadgeText}>촬영 대기</Text>
                    </View>
                  </View>
                </View>
              ))}
              {po.diagnostic?.map((o: any, i: number) => (
                <View key={`diag-${i}`} style={styles.orderRow}>
                  <Text style={styles.orderIcon}>{o.testType === 'ECG' ? '💓' : '🔬'}</Text>
                  <View style={styles.orderBody}>
                    <Text style={styles.orderName}>{o.testName}</Text>
                    <Text style={styles.orderLocation}>{o.location}</Text>
                    {o.scheduledAt && (
                      <Text style={styles.orderSchedule}>
                        예정: {new Date(o.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    )}
                    <View style={[styles.orderBadge, styles.badgePending]}>
                      <Text style={styles.orderBadgeText}>검사 대기</Text>
                    </View>
                  </View>
                </View>
              ))}
            </InfoCard>
          );
        })()
      )}

      {/* 완료된 검사 결과 */}
      {(data as any).completedLabs?.length > 0 && (
        <InfoCard title="오늘 완료된 검사" accentColor="#10B981">
          {(data as any).completedLabs.map((r: any) => (
            <View key={r.id} style={styles.labResultRow}>
              {r.items?.map((item: any, i: number) => (
                <View key={i} style={styles.labItemRow}>
                  <Text style={styles.labItemName}>{item.testName}</Text>
                  {/* 🔴 종전 `flag !== 'NORMAL'` 은 정상('N')을 전부 붉게 칠하고 'H'/'HH' 는 화살표를 못 붙였다 */}
                  <Text style={[styles.labItemValue, isAbnormalFlag(item.flag) ? styles.labItemFlag : null]}>
                    {item.value} {item.unit}{flagMark(item.flag)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </InfoCard>
      )}

      {/* 여정 타임라인 */}
      {data.timeline && data.timeline.length > 0 && (
        <InfoCard title="오늘 여정" accentColor="#6B7280">
          {data.timeline.map((e, i) => {
            const isDone = e.type === 'LAB_RESULT' || e.type === 'IMAGING_RESULT' || e.type === 'BILLING_PAID' || e.type === 'ENCOUNTER_SIGNED';
            return (
              <View key={i} style={styles.timelineRow}>
                <View style={[styles.timelineDot, isDone && styles.timelineDotDone]} />
                <Text style={styles.timelineTime}>{new Date(e.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</Text>
                <Text style={[styles.timelineDesc, isDone && styles.timelineDescDone]}>{e.description}</Text>
              </View>
            );
          })}
        </InfoCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 12, padding: 20, marginBottom: 12, alignItems: 'center' },
  bannerWaiting: { backgroundColor: '#FEF3C7' },
  bannerCalled: { backgroundColor: '#FEE2E2' },
  bannerConsulting: { backgroundColor: '#DBEAFE' },
  bannerEmoji: { fontSize: 32 },
  bannerName: { fontSize: 15, fontWeight: '600', color: '#4B5563', marginTop: 6 },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginTop: 2 },
  bannerSub: { fontSize: 14, color: '#4B5563', marginTop: 4 },
  queueRow: { flexDirection: 'row', justifyContent: 'space-around' },
  queueItem: { alignItems: 'center' },
  queueNumber: { fontSize: 22, fontWeight: '800', color: '#1F2937' },
  queueUnknown: { fontSize: 15, fontWeight: '700', color: '#9CA3AF', paddingVertical: 4 },
  queueLabel: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  apptRow: { flexDirection: 'row', paddingVertical: 6, alignItems: 'center' },
  apptBorder: { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  apptTime: { fontSize: 13, fontWeight: '600', color: '#4F46E5', width: 55 },
  apptDoctor: { fontSize: 13, color: '#374151' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  timelineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9CA3AF', marginRight: 8 },
  timelineTime: { fontSize: 12, color: '#6B7280', width: 50, fontVariant: ['tabular-nums'] },
  timelineDesc: { fontSize: 12, color: '#374151', flex: 1 },
  timelineDotDone: { backgroundColor: '#10B981' },
  timelineDescDone: { color: '#9CA3AF' },
  orderRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 10 },
  orderIcon: { fontSize: 20, marginTop: 2 },
  orderBody: { flex: 1 },
  orderName: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  orderLocation: { fontSize: 12, color: '#4F46E5', marginTop: 2 },
  orderSchedule: { fontSize: 11, color: '#F59E0B', marginTop: 2 },
  orderBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  badgePending: { backgroundColor: '#FEF3C7' },
  badgeProgress: { backgroundColor: '#DBEAFE' },
  orderBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400E' },
  labResultRow: { marginBottom: 6 },
  labItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  labItemName: { fontSize: 13, color: '#6B7280' },
  labItemValue: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  labItemFlag: { color: '#EF4444' },
});
