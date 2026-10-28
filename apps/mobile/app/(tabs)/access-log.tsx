import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { InfoCard } from '../../src/components/common/InfoCard';
import { formatDate } from '../../src/lib/format';

/**
 * 내 기록 접근 이력 — 서버 `portal/audit-log`(일반 감사 + Break-The-Glass 긴급 접근) 배선.
 * "내 기록을 누가 봤나"를 환자 본인이 확인하는 신뢰 화면.
 * 🔴 조회 실패 ≠ 접근 없음(P17) — 실패는 실패라고 말한다.
 */

interface BtgRow { id: string; accessedBy: string; department: string | null; reason: string; resourceType: string; accessedAt: string; isApproved: boolean }
interface AccessRow { id: string; action: string; accessedBy: string; department: string | null; timestamp: string }
interface AuditData { btgAccesses: BtgRow[]; accessLogs: AccessRow[]; pagination: { page: number; limit: number; btgTotal: number; auditTotal: number } }

const ACTION_LABEL: Record<string, string> = {
  READ: '열람', VIEW: '열람', CREATE: '작성', UPDATE: '수정', DELETE: '삭제', EXPORT: '반출', PRINT: '인쇄',
};

export default function AccessLogScreen() {
  const [page, setPage] = useState(1);

  const audit = useQuery({
    queryKey: ['portal-audit-log', page],
    queryFn: () => apiClient.get(`/api/v1/portal/audit-log?page=${page}&limit=30`),
  });

  if (audit.isLoading && page === 1) return <LoadingState />;
  if (audit.isError) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: '내 기록 접근 이력', headerShown: true }} />
        <ErrorState message="접근 이력을 불러오지 못했습니다 — 접근이 없었던 것이 아닙니다." onRetry={() => audit.refetch()} />
      </View>
    );
  }

  const data = (audit.data as { data?: AuditData } | undefined)?.data;
  const btg = data?.btgAccesses ?? [];
  const logs = data?.accessLogs ?? [];
  const pg = data?.pagination;
  const hasMore = pg ? page * pg.limit < pg.auditTotal : false;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '내 기록 접근 이력', headerShown: true }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={audit.isRefetching} onRefresh={() => audit.refetch()} />}>

        <View style={s.intro}>
          <Ionicons name="shield-checkmark-outline" size={18} color="#4F46E5" />
          <Text style={s.introText}>내 의무기록을 병원에서 누가, 언제 열람했는지의 기록입니다. 모든 접근은 감사 원장에 남습니다.</Text>
        </View>

        {/* 긴급 접근(BTG) — 있으면 최상단에 */}
        {btg.length > 0 && (
          <InfoCard title={`긴급 접근 (Break-The-Glass) · ${pg?.btgTotal ?? btg.length}건`} subtitle="응급 상황에서 담당이 아닌 의료진이 사유를 남기고 연 기록" accentColor="#F59E0B">
            {btg.map((b) => (
              <View key={b.id} style={s.row}>
                <View style={s.rowHead}>
                  <Text style={s.rowWho}>{b.accessedBy}{b.department ? ` · ${b.department}` : ''}</Text>
                  <Text style={s.rowWhen}>{formatDate(b.accessedAt)}</Text>
                </View>
                <Text style={s.rowReason}>사유: {b.reason}</Text>
                <Text style={[s.btgStatus, b.isApproved ? s.btgOk : s.btgPending]}>
                  {b.isApproved ? '사후 승인됨' : '사후 승인 대기'}
                </Text>
              </View>
            ))}
          </InfoCard>
        )}

        <InfoCard title={`일반 접근 · ${pg?.auditTotal ?? logs.length}건`} accentColor="#4F46E5">
          {logs.length === 0 ? (
            <EmptyState icon="eye-off-outline" message="기록된 접근 이력이 없습니다." />
          ) : (
            logs.map((l) => (
              <View key={l.id} style={s.rowSlim}>
                <Text style={s.rowWho}>{l.accessedBy}{l.department ? ` · ${l.department}` : ''}</Text>
                <Text style={s.rowAction}>{ACTION_LABEL[l.action] ?? l.action}</Text>
                <Text style={s.rowWhen}>{formatDate(l.timestamp)}</Text>
              </View>
            ))
          )}
          {hasMore && (
            <TouchableOpacity style={s.moreBtn} onPress={() => setPage((p) => p + 1)} disabled={audit.isFetching}>
              <Text style={s.moreBtnText}>{audit.isFetching ? '불러오는 중…' : '이전 이력 더 보기'}</Text>
            </TouchableOpacity>
          )}
          {page > 1 && (
            <Text style={s.pageNote}>{page}페이지 표시 중 — 페이지 단위로 조회합니다.</Text>
          )}
        </InfoCard>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  intro: { flexDirection: 'row', gap: 8, backgroundColor: '#EEF2FF', borderRadius: 12, padding: 12, marginBottom: 12, alignItems: 'flex-start' },
  introText: { flex: 1, fontSize: 12, color: '#4338CA', lineHeight: 18 },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  rowSlim: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowWho: { fontSize: 13, fontWeight: '600', color: '#111827', flex: 1 },
  rowAction: { fontSize: 12, color: '#4F46E5', fontWeight: '600' },
  rowWhen: { fontSize: 11, color: '#9CA3AF' },
  rowReason: { fontSize: 12, color: '#374151', marginTop: 3 },
  btgStatus: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  btgOk: { color: '#059669' },
  btgPending: { color: '#D97706' },
  moreBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8, borderRadius: 10, backgroundColor: '#F3F4F6' },
  moreBtnText: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
  pageNote: { fontSize: 10, color: '#9CA3AF', textAlign: 'center', marginTop: 6 },
});
