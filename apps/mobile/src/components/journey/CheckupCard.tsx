import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InfoCard } from '../common/InfoCard';
import { useAuthStore } from '../../stores/auth-store';

interface Props { data: any }

export function CheckupCard({ data }: Props) {
  const user = useAuthStore((s) => s.user);
  const ck = data.checkup;
  const progress = ck?.progress;
  const elapsed = ck?.elapsedMinutes ?? 0;
  const total = ck?.estimatedDuration ?? 180;

  return (
    <View>
      {/* 배너 — 컴팩트 가로 */}
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <View style={s.iconCircle}>
            <Ionicons name="fitness-outline" size={22} color="#2563EB" />
          </View>
          <View>
            <Text style={s.patientName}>{user?.name ?? '환자'}님</Text>
            <Text style={s.programName}>{ck?.programName ?? '건강검진'}</Text>
          </View>
        </View>
        <View style={s.bannerRight}>
          <Text style={s.elapsedText}>{elapsed < 300 ? `${elapsed}분` : '-'} / {total}분</Text>
          {progress && <Text style={s.progressPercent}>{progress.percent}%</Text>}
        </View>
      </View>

      {/* 진행률 바 */}
      {progress && (
        <View style={s.progressCard}>
          <View style={s.progressHeader}>
            <Text style={s.progressLabel}>검사 진행률</Text>
            <Text style={s.progressCount}>{progress.completed}/{progress.total}</Text>
          </View>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${progress.percent}%` }]} />
          </View>
        </View>
      )}

      {/* 다음 추천 검사 */}
      {data.nextRecommended && (
        <View style={s.recommendCard}>
          <View style={s.recommendHeader}>
            <Ionicons name="navigate-outline" size={16} color="#2563EB" />
            <Text style={s.recommendLabel}>다음 검사</Text>
          </View>
          <Text style={s.recommendName}>{data.nextRecommended.testName}</Text>
          <View style={s.recommendMeta}>
            <Ionicons name="location-outline" size={14} color="#6B7280" />
            {/* 위치는 스테이션의 공간 연결에서만 온다(P0-5) — 연결 전이면 모른다고 말한다(종전 하드코딩 층은 공간 정본과 달랐다) */}
            <Text style={s.recommendLocation}>{data.nextRecommended.location ?? '위치 미등록'}</Text>
            {/* 🔴 미상을 '혼잡'으로 단정하지 않는다 — 종전 삼항은 LOW/MEDIUM 이 아니면 전부 혼잡이었다 */}
            <View style={[s.congDot, CONG_DOT[data.nextRecommended.congestionLevel] ?? s.congUnknown]} />
            <Text style={s.recommendWait}>
              {CONG_TEXT[data.nextRecommended.congestionLevel] ?? '대기 정보 없음'}
              {typeof data.nextRecommended.waitingCount === 'number' && data.nextRecommended.waitingCount > 0
                ? ` · ${data.nextRecommended.waitingCount}명 대기`
                : ''}
              {/* P4 이동 거리 — 마지막 검사실에서 확정 도면 경로(m) · 시간으로 바꾸지 않는다 · 모르면 쓰지 않는다 */}
              {typeof data.nextRecommended.distanceM === 'number' ? ` · 약 ${data.nextRecommended.distanceM}m` : ''}
            </Text>
          </View>
        </View>
      )}

      {/* 남은 검사 */}
      {data.pendingItems?.length > 1 && (
        <InfoCard title={`남은 검사 (${data.pendingItems.length}건)`} accentColor="#F59E0B">
          {data.pendingItems.slice(1).map((item: any, i: number) => (
            <View key={i} style={s.pendingRow}>
              <Ionicons
                name={item.category === 'LAB' ? 'water-outline' : item.category === 'IMAGING' ? 'scan-outline' : 'pulse-outline'}
                size={16} color="#6B7280"
              />
              <View style={s.pendingBody}>
                <Text style={s.pendingName}>{item.testName}</Text>
                <Text style={s.pendingLocation}>{item.location ?? '위치 미등록'}</Text>
              </View>
              <View style={s.congRow}>
                <View style={[s.congDotSmall, CONG_DOT[item.congestionLevel] ?? s.congUnknown]} />
                <Text style={s.congText}>
                  {typeof item.waitingCount === 'number' ? `${item.waitingCount}명` : '—'}
                </Text>
              </View>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 이상 소견 */}
      {data.abnormalItems?.length > 0 && (
        <InfoCard title={`이상 소견 (${data.abnormalItems.length}건)`} accentColor="#EF4444">
          {data.abnormalItems.map((item: any, i: number) => (
            <View key={i} style={s.abnormalRow}>
              <Ionicons name="warning-outline" size={14} color="#DC2626" />
              <Text style={s.abnormalName}>{item.testName}</Text>
              <Text style={s.abnormalValue}>{item.value} {item.unit}</Text>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 완료된 검사 */}
      {data.completedItems?.length > 0 && (
        <InfoCard title={`완료 (${data.completedItems.length}건)`} accentColor="#10B981">
          {data.completedItems.slice(0, 8).map((item: any, i: number) => (
            <View key={i} style={s.completedRow}>
              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
              <Text style={s.completedName} numberOfLines={1}>{item.testName}</Text>
              {item.value ? (
                <Text style={[s.completedValue, (item.finding === 'ABNORMAL' || item.finding === 'CRITICAL') && s.completedFlag]}>
                  {item.value}{item.unit ? ` ${item.unit}` : ''}
                </Text>
              ) : (
                <Text style={s.completedNormal}>정상</Text>
              )}
            </View>
          ))}
          {data.completedItems.length > 8 && (
            <Text style={s.moreText}>외 {data.completedItems.length - 8}건</Text>
          )}
        </InfoCard>
      )}

      {/* 타임라인 */}
      {data.timeline?.length > 0 && (
        <InfoCard title="오늘 여정" accentColor="#6B7280">
          {data.timeline.slice(0, 8).map((e: any, i: number) => {
            const isDone = e.type === 'LAB_RESULT' || e.type === 'IMAGING_RESULT' || e.type === 'RECEPTION_CHECKIN';
            return (
              <View key={i} style={s.timeRow}>
                <View style={[s.timeDot, isDone && s.timeDotDone]} />
                <Text style={s.timeText}>
                  {isDone ? new Date(e.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '대기'}
                </Text>
                <Text style={[s.timeDesc, isDone && s.timeDescDone]} numberOfLines={1}>{e.description}</Text>
              </View>
            );
          })}
        </InfoCard>
      )}
    </View>
  );
}

const CONG_TEXT: Record<string, string> = { LOW: '여유', MEDIUM: '보통', HIGH: '혼잡' };

const s = StyleSheet.create({
  banner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 14, padding: 16, marginBottom: 12 },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#DBEAFE', justifyContent: 'center', alignItems: 'center' },
  patientName: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  programName: { fontSize: 12, color: '#2563EB', fontWeight: '500', marginTop: 1 },
  bannerRight: { alignItems: 'flex-end' },
  elapsedText: { fontSize: 12, color: '#6B7280' },
  progressPercent: { fontSize: 20, fontWeight: '800', color: '#2563EB', marginTop: 2 },
  progressCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  progressCount: { fontSize: 13, fontWeight: '700', color: '#2563EB' },
  progressBar: { height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#2563EB', borderRadius: 4 },
  recommendCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#2563EB', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  recommendHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  recommendLabel: { fontSize: 11, fontWeight: '700', color: '#2563EB', textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  recommendName: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  recommendMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  recommendLocation: { fontSize: 13, color: '#6B7280', marginRight: 6 },
  recommendWait: { fontSize: 12, color: '#374151' },
  congDot: { width: 8, height: 8, borderRadius: 4 },
  congDotSmall: { width: 6, height: 6, borderRadius: 3 },
  congLow: { backgroundColor: '#10B981' },
  congMed: { backgroundColor: '#F59E0B' },
  congHigh: { backgroundColor: '#EF4444' },
  congUnknown: { backgroundColor: '#D1D5DB' },
  congRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  congText: { fontSize: 11, color: '#6B7280' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  pendingBody: { flex: 1 },
  pendingName: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  pendingLocation: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  abnormalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  abnormalName: { fontSize: 13, color: '#1F2937', flex: 1 },
  abnormalValue: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
  completedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  completedName: { fontSize: 12, color: '#6B7280', flex: 1 },
  completedValue: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  completedFlag: { color: '#DC2626' },
  completedNormal: { fontSize: 12, color: '#10B981', fontWeight: '500' },
  moreText: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 6 },
  timeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  timeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D1D5DB' },
  timeDotDone: { backgroundColor: '#10B981' },
  timeText: { fontSize: 11, color: '#9CA3AF', width: 40, fontVariant: ['tabular-nums'] },
  timeDesc: { fontSize: 12, color: '#374151', flex: 1 },
  timeDescDone: { color: '#6B7280' },
});

const CONG_DOT: Record<string, object> = { LOW: s.congLow, MEDIUM: s.congMed, HIGH: s.congHigh };
