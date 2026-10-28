import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { InfoCard } from '../../src/components/common/InfoCard';
import { isAbnormalFlag, flagMark } from '../../src/lib/lab-flags';

export default function InpatientDetailScreen() {
  const router = useRouter();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['journey', 'inpatient'],
    queryFn: () => apiClient.get<{ data: any }>('/api/v1/portal/journey/inpatient'),
  });

  const adm = (data as any)?.data;

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  if (!adm) {
    return (
      <View style={styles.center}>
        <Ionicons name="bed-outline" size={48} color="#D1D5DB" />
        <Text style={styles.emptyText}>현재 입원 정보가 없습니다</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>돌아가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const wardInfo = [adm.bed?.ward?.name, adm.bed?.roomNumber ? `${adm.bed.roomNumber}호` : null, adm.bed?.bedNumber ? `${adm.bed.bedNumber}침대` : null].filter(Boolean).join(' ');
  const doctorName = adm.attendingDoctor ? `${adm.attendingDoctor.familyName}${adm.attendingDoctor.givenName}` : '';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>입원 상세</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* 입원 배너 */}
      <View style={styles.banner}>
        <Text style={styles.bannerEmoji}>🏨</Text>
        {/* 🔴 모르는 재원일을 0 으로 말하지 않는다 */}
        <Text style={styles.bannerTitle}>
          {adm.daysSinceAdmit != null ? `입원 ${adm.daysSinceAdmit}일차` : '입원 중'}
        </Text>
        <Text style={styles.bannerSub}>{wardInfo}</Text>
        {doctorName ? <Text style={styles.bannerDoctor}>주치의: {doctorName}</Text> : null}
        <Text style={styles.bannerDate}>입원일: {new Date(adm.admitDate).toLocaleDateString('ko-KR')}</Text>
      </View>

      {/* 진료 기록 */}
      {adm.encounters && adm.encounters.length > 0 && (
        <InfoCard title={`진료 기록 (${adm.encounters.length}건)`} accentColor="#4F46E5">
          {adm.encounters.map((enc: any) => (
            <View key={enc.id} style={styles.itemRow}>
              <Text style={styles.itemDate}>{new Date(enc.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</Text>
              <View style={styles.itemBody}>
                {enc.chiefComplaint && <Text style={styles.itemText} numberOfLines={1}>{enc.chiefComplaint}</Text>}
              </View>
              <Text style={[styles.badge, enc.status === 'SIGNED' ? styles.badgeGreen : styles.badgeGray]}>{enc.status === 'SIGNED' ? '완료' : '작성중'}</Text>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 회진 기록 */}
      {adm.rounds && adm.rounds.length > 0 && (
        <InfoCard title={`회진 기록 (${adm.rounds.length}건)`} accentColor="#6366F1">
          {adm.rounds.map((r: any) => (
            <View key={r.id} style={styles.itemRow}>
              <Text style={styles.itemDate}>{new Date(r.roundedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</Text>
              <View style={styles.itemBody}>
                {r.doctor && <Text style={styles.itemDoctor}>{r.doctor.familyName}{r.doctor.givenName}</Text>}
              </View>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 검사 결과 */}
      {adm.labResults && adm.labResults.length > 0 && (
        <InfoCard title={`검사 결과 (${adm.labResults.length}건)`} accentColor="#3B82F6">
          {adm.labResults.map((r: any) => (
            <View key={r.id} style={styles.labRow}>
              <Text style={styles.labDate}>{r.completedAt ? new Date(r.completedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : ''}</Text>
              <View style={styles.labItems}>
                {r.items?.slice(0, 3).map((item: any, i: number) => (
                  <View key={i} style={styles.labItem}>
                    <Text style={styles.labName} numberOfLines={1}>{item.testName}</Text>
                    {/* 🔴 종전 'NORMAL'/'HIGH'/'LOW' 만 알아 서버가 실제로 내는 N/H/L/HH/LL 을 오판했다 */}
                    <Text style={[styles.labValue, isAbnormalFlag(item.flag) ? styles.labFlag : null]}>
                      {item.value} {item.unit}{flagMark(item.flag)}{item.judgmentPending ? ' (확인 전)' : ''}
                    </Text>
                  </View>
                ))}
                {r.items?.length > 3 && <Text style={styles.labMore}>외 {r.items.length - 3}건</Text>}
              </View>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 수술 */}
      {adm.surgeries && adm.surgeries.length > 0 && (
        <InfoCard title={`수술 (${adm.surgeries.length}건)`} accentColor="#EF4444">
          {adm.surgeries.map((s: any) => (
            <View key={s.id} style={styles.itemRow}>
              <Text style={styles.itemDate}>{new Date(s.scheduledAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</Text>
              <View style={styles.itemBody}>
                <Text style={styles.itemText}>{s.procedureName}</Text>
                <Text style={styles.itemSub}>{s.status === 'COMPLETED' ? '완료' : s.status === 'SCHEDULED' ? '예정' : s.status}</Text>
              </View>
            </View>
          ))}
        </InfoCard>
      )}

      {/* 중간 정산 */}
      {adm.interimBillings && adm.interimBillings.length > 0 && (
        <InfoCard title="중간 정산" accentColor="#F59E0B">
          {adm.interimBillings.map((b: any) => (
            <View key={b.id} style={styles.billingRow}>
              <Text style={styles.billingPeriod}>
                {new Date(b.periodStart).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} ~ {new Date(b.periodEnd).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
              </Text>
              <Text style={styles.billingAmount}>{(b.totalAmount ?? 0).toLocaleString('ko-KR')}원</Text>
              <Text style={[styles.badge, b.status === 'PAID' ? styles.badgeGreen : styles.badgeAmber]}>{b.status === 'PAID' ? '수납' : '미수납'}</Text>
            </View>
          ))}
        </InfoCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  emptyText: { fontSize: 15, color: '#9CA3AF', marginTop: 12 },
  backBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#4F46E5', borderRadius: 8 },
  backBtnText: { color: '#FFF', fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  banner: { backgroundColor: '#EDE9FE', borderRadius: 12, padding: 20, marginBottom: 16, alignItems: 'center' },
  bannerEmoji: { fontSize: 32 },
  bannerTitle: { fontSize: 20, fontWeight: '800', color: '#5B21B6', marginTop: 6 },
  bannerSub: { fontSize: 14, color: '#6D28D9', marginTop: 4 },
  bannerDoctor: { fontSize: 13, color: '#7C3AED', marginTop: 4 },
  bannerDate: { fontSize: 12, color: '#8B5CF6', marginTop: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  itemDate: { fontSize: 11, color: '#9CA3AF', width: 45, marginTop: 2 },
  itemBody: { flex: 1 },
  itemText: { fontSize: 13, color: '#1F2937' },
  itemSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  itemDoctor: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  badgeGreen: { backgroundColor: '#D1FAE5', color: '#065F46' },
  badgeGray: { backgroundColor: '#F3F4F6', color: '#6B7280' },
  badgeAmber: { backgroundColor: '#FEF3C7', color: '#92400E' },
  labRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  labDate: { fontSize: 11, color: '#9CA3AF', width: 45, marginTop: 2 },
  labItems: { flex: 1 },
  labItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
  labName: { fontSize: 12, color: '#6B7280', flex: 1 },
  labValue: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  labFlag: { color: '#EF4444' },
  labMore: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  billingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 8 },
  billingPeriod: { fontSize: 12, color: '#6B7280', flex: 1 },
  billingAmount: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
});
