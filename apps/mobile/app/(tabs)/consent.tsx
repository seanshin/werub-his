import React, { useState, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, TextInput, Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { formatDate } from '../../src/lib/format';

interface ConsentItem {
  id: string;
  type: string;
  templateName: string;
  consentType: string;
  status: string;
  createdAt: string;
  signedAt: string | null;
  risks: string | null;
  alternatives: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  SURGERY: '수술', ANESTHESIA: '마취', PROCEDURE: '시술',
  TRANSFUSION: '수혈', RESEARCH: '연구', DNR: '심폐소생술 거부',
  TREATMENT: '치료', GENERAL: '일반',
};

/** ConsentStatus(prisma) 전량 */
const STATUS_LABELS: Record<string, string> = {
  PENDING: '서명 대기', SIGNED: '서명 완료', EXPIRED: '만료됨', REVOKED: '철회됨',
};

export default function ConsentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signatureText, setSignatureText] = useState('');
  const [agreed, setAgreed] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['portal-consents'],
    queryFn: () => apiClient.get<{ data: ConsentItem[] }>('/api/v1/portal/consents'),
  });

  const signMutation = useMutation({
    mutationFn: (consentId: string) =>
      apiClient.put(`/api/v1/portal/consents/${consentId}/sign`, {
        signature: signatureText || 'electronic-signature',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-consents'] });
      queryClient.invalidateQueries({ queryKey: ['journey'] });
      setSelectedId(null);
      setSignatureText('');
      setAgreed(false);
    },
    onError: (err: Error) => {
      Alert.alert('서명 실패', err.message || '잠시 후 다시 시도해주세요.');
    },
  });

  const consents: ConsentItem[] = (data as any)?.data ?? [];
  const pending = consents.filter(c => c.status === 'PENDING' && !c.signedAt);
  const signed = consents.filter(c => c.status === 'SIGNED' || c.signedAt);
  /**
   * 🔴 ConsentStatus 는 PENDING·SIGNED·EXPIRED·REVOKED 네 가지다(prisma schema).
   *    종전 화면은 앞 두 개만 분류해서, 만료·철회된 동의서는 어느 목록에도 안 들어가고
   *    `consents.length === 0` 도 아니라 빈 상태 안내조차 없이 **조용히 사라졌다**.
   *    동의 철회는 환자가 반드시 확인할 수 있어야 하는 사실이다.
   */
  const other = consents.filter(c => !pending.includes(c) && !signed.includes(c));
  const selected = consents.find(c => c.id === selectedId);

  if (isLoading) return <LoadingState />;

  /**
   * 🔴 종전엔 `isError` 를 아예 구조분해하지 않아, 조회가 실패하면 `consents` 가 `[]` 가 되고
   *    화면이 EmptyState "동의서가 없습니다" 를 띄웠다 — **환자가 서명해야 할 동의서를
   *    "없다"고 읽는다**(P17). 빈 목록과 조회 실패는 다른 사실이다.
   *    labs·encounters·notifications 와 같은 방식으로 실패는 실패라고 말한다.
   */
  if (isError) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: '동의서', headerShown: true }} />
        <ErrorState
          message={'동의서를 불러오지 못했습니다. 서명할 동의서가 없다는 뜻이 아닙니다.'}
          onRetry={() => refetch()}
        />
      </View>
    );
  }

  // 서명 화면
  if (selected) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: selected.templateName, headerShown: true }} />
        <ScrollView contentContainerStyle={s.signContent}>
          {/* 동의서 정보 */}
          <View style={s.infoCard}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>유형</Text>
              <Text style={s.infoValue}>{TYPE_LABELS[selected.consentType] ?? selected.type}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>요청일</Text>
              <Text style={s.infoValue}>{formatDate(selected.createdAt)}</Text>
            </View>
          </View>

          {/* 위험성 */}
          {selected.risks && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>위험성 및 부작용</Text>
              <Text style={s.sectionText}>{selected.risks}</Text>
            </View>
          )}

          {/* 대안 */}
          {selected.alternatives && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>대안적 치료</Text>
              <Text style={s.sectionText}>{selected.alternatives}</Text>
            </View>
          )}

          {/* 동의 체크 */}
          <TouchableOpacity style={s.agreeRow} onPress={() => setAgreed(!agreed)}>
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={24} color={agreed ? '#4F46E5' : '#9CA3AF'} />
            <Text style={s.agreeText}>위 내용을 모두 읽고 이해하였으며, 동의합니다</Text>
          </TouchableOpacity>

          {/* 서명 입력 */}
          <View style={s.signatureBox}>
            <Text style={s.signatureLabel}>서명 (이름 입력)</Text>
            <TextInput
              style={s.signatureInput}
              value={signatureText}
              onChangeText={setSignatureText}
              placeholder="성명을 입력해주세요"
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {/* 서명 버튼 */}
          <TouchableOpacity
            style={[s.signButton, (!agreed || !signatureText.trim()) && s.signButtonDisabled]}
            disabled={!agreed || !signatureText.trim() || signMutation.isPending}
            onPress={() => signMutation.mutate(selected.id)}
          >
            {signMutation.isPending ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="create-outline" size={20} color="#FFF" />
                <Text style={s.signButtonText}>서명 제출</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelButton} onPress={() => { setSelectedId(null); setAgreed(false); setSignatureText(''); }}>
            <Text style={s.cancelText}>취소</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // 목록 화면
  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '동의서', headerShown: true }} />
      <ScrollView contentContainerStyle={s.listContent}>
        {/* 서명 필요 */}
        {pending.length > 0 && (
          <>
            <Text style={s.sectionHeader}>서명 필요 ({pending.length})</Text>
            {pending.map(c => (
              <TouchableOpacity key={c.id} style={s.card} onPress={() => setSelectedId(c.id)}>
                <View style={s.cardLeft}>
                  <View style={[s.statusDot, s.dotPending]} />
                  <View>
                    <Text style={s.cardTitle}>{c.templateName}</Text>
                    <Text style={s.cardType}>{TYPE_LABELS[c.consentType] ?? c.type} · {formatDate(c.createdAt)}</Text>
                  </View>
                </View>
                <View style={s.signBadge}>
                  <Text style={s.signBadgeText}>서명하기</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* 서명 완료 */}
        {signed.length > 0 && (
          <>
            <Text style={s.sectionHeader}>서명 완료 ({signed.length})</Text>
            {signed.map(c => (
              <View key={c.id} style={s.card}>
                <View style={s.cardLeft}>
                  <View style={[s.statusDot, s.dotSigned]} />
                  <View>
                    <Text style={[s.cardTitle, s.cardTitleDone]}>{c.templateName}</Text>
                    <Text style={s.cardType}>{TYPE_LABELS[c.consentType] ?? c.type} · {formatDate(c.signedAt ?? c.createdAt)}</Text>
                  </View>
                </View>
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
              </View>
            ))}
          </>
        )}

        {/* 만료·철회 등 — 서명 대상도, 서명 완료도 아닌 동의서 */}
        {other.length > 0 && (
          <>
            <Text style={s.sectionHeader}>만료·철회 ({other.length})</Text>
            {other.map(c => (
              <View key={c.id} style={s.card}>
                <View style={s.cardLeft}>
                  <View style={[s.statusDot, s.dotOther]} />
                  <View>
                    <Text style={[s.cardTitle, s.cardTitleDone]}>{c.templateName}</Text>
                    <Text style={s.cardType}>
                      {TYPE_LABELS[c.consentType] ?? c.type} · {STATUS_LABELS[c.status] ?? c.status} · {formatDate(c.createdAt)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        {consents.length === 0 && <EmptyState icon="document-outline" message="동의서가 없습니다" />}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  listContent: { padding: 16, paddingBottom: 40 },
  signContent: { padding: 16, paddingBottom: 40 },
  sectionHeader: { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotPending: { backgroundColor: '#F59E0B' },
  dotSigned: { backgroundColor: '#10B981' },
  dotOther: { backgroundColor: '#9CA3AF' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937' },
  cardTitleDone: { color: '#6B7280' },
  cardType: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  signBadge: { backgroundColor: '#4F46E5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  signBadgeText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  infoCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infoLabel: { fontSize: 13, color: '#6B7280' },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  section: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8 },
  sectionText: { fontSize: 13, color: '#4B5563', lineHeight: 20 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 4 },
  agreeText: { fontSize: 14, color: '#1F2937', flex: 1, lineHeight: 20 },
  signatureBox: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 16 },
  signatureLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  signatureInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontWeight: '600', color: '#1F2937', textAlign: 'center' },
  signButton: { backgroundColor: '#4F46E5', borderRadius: 12, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  signButtonDisabled: { opacity: 0.4 },
  signButtonText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  cancelButton: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontSize: 14, color: '#6B7280' },
});
