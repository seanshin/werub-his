import React from 'react';
import { ScrollView, StyleSheet, RefreshControl, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useJourneyStatus } from '../../src/hooks/useJourneyStatus';
import { OutpatientCard } from '../../src/components/journey/OutpatientCard';
import { InpatientCard } from '../../src/components/journey/InpatientCard';
import { PreDischargeCard } from '../../src/components/journey/PreDischargeCard';
import { PostDischargeCard } from '../../src/components/journey/PostDischargeCard';
import { PreVisitCard } from '../../src/components/journey/PreVisitCard';
import { IdleCard } from '../../src/components/journey/IdleCard';
import { CheckupCard } from '../../src/components/journey/CheckupCard';
import { JourneyPhaseBadge } from '../../src/components/common/JourneyPhaseBadge';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';

/** 홈에서 카드를 그릴 수 있는 phase 전량 — 서버 portal.service.getJourneyStatus 와 한 벌이다. */
const RENDERED_PHASES = [
  'OUTPATIENT_WAITING', 'OUTPATIENT_CALLED', 'OUTPATIENT_IN_CONSULTATION',
  'CHECKUP_IN_PROGRESS', 'INPATIENT', 'PRE_DISCHARGE', 'POST_DISCHARGE',
  'PRE_VISIT', 'IDLE',
];

export default function JourneyHome() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch, isError } = useJourneyStatus();

  const journey = (data as any)?.data;
  // 🔴 응답이 없을 때 'IDLE' 로 단정하지 않는다 — 조회 실패를 "예약 없음"으로 보이게 하던 폴백.
  const phase: string | null = journey?.phase ?? null;

  if (isLoading) {
    return <LoadingState message="여정 정보를 불러오는 중..." />;
  }

  if (isError) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
    >
      {phase && <JourneyPhaseBadge phase={phase} />}

      {journey && (
        <>
          {(phase === 'OUTPATIENT_WAITING' || phase === 'OUTPATIENT_CALLED' || phase === 'OUTPATIENT_IN_CONSULTATION') && (
            <OutpatientCard data={journey} />
          )}
          {phase === 'CHECKUP_IN_PROGRESS' && <CheckupCard data={journey} />}
          {phase === 'INPATIENT' && <InpatientCard data={journey} />}
          {/* 🔴 PRE_DISCHARGE·PRE_VISIT 는 종전 분기가 없어 화면이 통째로 비어 있었다 */}
          {phase === 'PRE_DISCHARGE' && <PreDischargeCard data={journey} />}
          {phase === 'POST_DISCHARGE' && <PostDischargeCard data={journey} />}
          {phase === 'PRE_VISIT' && <PreVisitCard data={journey} />}
          {phase === 'IDLE' && <IdleCard data={journey} />}

          {/* 🔴 서버가 앱이 모르는 phase 를 내면 빈 화면 대신 그 사실을 말한다(조용한 공백 금지) */}
          {phase != null && !RENDERED_PHASES.includes(phase) && (
            <View style={styles.unknownBox}>
              <Ionicons name="help-circle-outline" size={28} color="#9CA3AF" />
              <Text style={styles.unknownText}>
                현재 상태({phase})를 이 앱 버전에서 표시할 수 없습니다. 앱을 업데이트해 주세요.
              </Text>
            </View>
          )}
        </>
      )}

      {/* 입원·퇴원준비 환자는 상세로, 그 외에는 전체 여정 기록으로 — 종전 두 화면 모두 도달 경로가 없었다 */}
      {journey && (
        <View style={styles.linkRow}>
          {(phase === 'INPATIENT' || phase === 'PRE_DISCHARGE') && (
            <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/journey/inpatient-detail' as any)}>
              <Ionicons name="bed-outline" size={16} color="#4F46E5" />
              <Text style={styles.linkText}>입원 상세</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/journey/timeline' as any)}>
            <Ionicons name="time-outline" size={16} color="#4F46E5" />
            <Text style={styles.linkText}>전체 여정 기록</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 32 },
  unknownBox: { alignItems: 'center', backgroundColor: '#FFF', borderRadius: 12, padding: 20, marginTop: 12 },
  unknownText: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  linkRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  linkBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FFF', borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  linkText: { fontSize: 13, fontWeight: '600', color: '#4F46E5' },
});
