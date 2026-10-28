import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  SafeAreaView,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { StatusBadge } from '../../src/components/StatusBadge';

/**
 * 🔴 2026-08-14(W9) 이 화면은 서버 계약과 양쪽 모두 어긋나 있었다.
 *
 * (1) 조회 — 서버 `GET /patient-auth/guardians` 는 **객체**를 낸다:
 *       { asGuardian: PatientGuardian[], asDependent: PatientGuardian[] }
 *     종전 코드는 `Array.isArray(rawData) ? rawData : []` 였으므로 **항상 빈 배열**이 되어,
 *     보호자가 등록돼 있어도 두 섹션 모두 영구히 "등록된 항목이 없습니다" 였다.
 *     행 필드도 달랐다(name/phoneNumber/status/type 은 서버에 없는 키 — 카드가 전부 공백).
 *     실제 행: { id, relationship, legalBasis, isApproved, rejectedReason, expiresAt,
 *               dependent|guardian: { phone, patient: { familyName, givenName, mrn } } }
 *
 * (2) 신청 — 서버 DTO(GuardianRequestDto)는 dependentMrn·relationship·legalBasis 를
 *     **모두 필수(@IsNotEmpty)** 로 받는다. 종전 폼은 `{ phoneNumber, relationship(한글) }`
 *     을 보냈으므로 ValidationPipe 에서 400 — 즉 앱을 통한 보호자 등록은 성공한 적이 없다.
 *     서버는 전화번호가 아니라 **피부양자 MRN**으로 사람을 찾는다.
 */
interface GuardianRow {
  id: string;
  relationship: string;
  legalBasis?: string;
  isApproved: boolean;
  rejectedReason?: string | null;
  expiresAt?: string | null;
  counterpart: {
    phone?: string | null;
    patient?: { familyName?: string; givenName?: string; mrn?: string } | null;
  } | null;
}

/** 서버 relationship 코드 ↔ 표시 라벨 (DTO 주석 기준) */
const RELATIONSHIPS: { code: string; label: string }[] = [
  { code: 'SPOUSE', label: '배우자' },
  { code: 'PARENT', label: '부모' },
  { code: 'CHILD', label: '자녀' },
  { code: 'GRANDPARENT', label: '조부모' },
  { code: 'LEGAL_GUARDIAN', label: '법정대리인' },
  { code: 'OTHER', label: '기타' },
];

/** 서버 legalBasis 코드 ↔ 표시 라벨 (DTO 주석 기준) */
const LEGAL_BASES: { code: string; label: string }[] = [
  { code: 'PATIENT_CONSENT', label: '환자 동의' },
  { code: 'MINOR_GUARDIAN', label: '미성년 보호자' },
  { code: 'POWER_OF_ATTORNEY', label: '위임장' },
  { code: 'UNCONSCIOUS', label: '의식 없음' },
  { code: 'DECEASED', label: '사망' },
];

const relLabel = (code: string) => RELATIONSHIPS.find((r) => r.code === code)?.label ?? code;

function toRow(raw: any, side: 'dependent' | 'guardian'): GuardianRow {
  return {
    id: raw.id,
    relationship: raw.relationship,
    legalBasis: raw.legalBasis,
    isApproved: raw.isApproved === true,
    rejectedReason: raw.rejectedReason ?? null,
    expiresAt: raw.expiresAt ?? null,
    counterpart: raw[side] ?? null,
  };
}

const rowName = (r: GuardianRow) => {
  const p = r.counterpart?.patient;
  const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
  return name || '이름 미상';
};

export default function GuardiansScreen() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    dependentMrn: '',
    relationship: '',
    legalBasis: 'PATIENT_CONSENT',
  });

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['guardians'],
    queryFn: () =>
      apiClient.get<{ data: any }>(
        '/api/v1/patient-auth/guardians',
      ),
  });

  const requestMutation = useMutation({
    mutationFn: (body: { dependentMrn: string; relationship: string; legalBasis: string }) =>
      apiClient.post('/api/v1/patient-auth/guardians/request', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardians'] });
      setShowModal(false);
      setForm({ dependentMrn: '', relationship: '', legalBasis: 'PATIENT_CONSENT' });
      Alert.alert('알림', '보호자 등록을 신청했습니다. 병원 승인 후 이용할 수 있습니다.');
    },
    onError: (err: any) => {
      Alert.alert('오류', err?.message ?? '등록 신청에 실패했습니다.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/api/v1/patient-auth/guardians/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardians'] });
      Alert.alert('알림', '보호자가 삭제되었습니다.');
    },
    onError: (err: any) => {
      Alert.alert('오류', err?.message ?? '삭제에 실패했습니다.');
    },
  });

  const rawData: any = (data as any)?.data;
  // 내가 보호자인 관계(상대 = 피부양자) / 내가 피부양자인 관계(상대 = 보호자)
  const myDependents: GuardianRow[] = Array.isArray(rawData?.asGuardian)
    ? rawData.asGuardian.map((r: any) => toRow(r, 'dependent'))
    : [];
  const myGuardians: GuardianRow[] = Array.isArray(rawData?.asDependent)
    ? rawData.asDependent.map((r: any) => toRow(r, 'guardian'))
    : [];

  const handleDelete = (id: string, name: string) => {
    Alert.alert('삭제', `${name}님과의 보호자 관계를 해제하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
    ]);
  };

  const handleSubmit = () => {
    if (!form.dependentMrn.trim()) {
      Alert.alert('알림', '피부양자의 환자번호(등록번호)를 입력해주세요.');
      return;
    }
    if (!form.relationship) {
      Alert.alert('알림', '관계를 선택해주세요.');
      return;
    }
    requestMutation.mutate({
      dependentMrn: form.dependentMrn.trim(),
      relationship: form.relationship,
      legalBasis: form.legalBasis,
    });
  };

  const renderItem = ({ item, canRemove }: { item: GuardianRow; canRemove: boolean }) => {
    const name = rowName(item);
    // 🔴 승인/거절/대기는 서로 다른 사실이다 — isApproved=false 를 전부 "거절"로 말하지 않는다.
    const status = item.isApproved
      ? { label: '승인', variant: 'success' as const }
      : item.rejectedReason
        ? { label: '거절', variant: 'error' as const }
        : { label: '승인 대기', variant: 'warning' as const };

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.personRow}>
            <View style={styles.personIcon}>
              <Ionicons name="person" size={18} color="#4F46E5" />
            </View>
            <View>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.relation}>{relLabel(item.relationship)}</Text>
            </View>
          </View>
          <StatusBadge label={status.label} variant={status.variant} />
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.phoneRow}>
            <Ionicons name="card-outline" size={14} color="#6B7280" />
            <Text style={styles.phone}>{item.counterpart?.patient?.mrn ?? '환자번호 미상'}</Text>
          </View>
          {canRemove && item.isApproved && (
            <TouchableOpacity onPress={() => handleDelete(item.id, name)}>
              <Ionicons name="trash-outline" size={18} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>
        {item.rejectedReason ? (
          <Text style={styles.rejectText}>거절 사유: {item.rejectedReason}</Text>
        ) : null}
      </View>
    );
  };

  const renderSection = (title: string, items: GuardianRow[], canRemove: boolean) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? (
        <View style={styles.emptyCard}>
          {/* 🔴 조회 실패를 "없음"으로 말하지 않는다 */}
          <Text style={styles.emptyText}>
            {isError ? '목록을 불러오지 못했습니다' : '등록된 항목이 없습니다'}
          </Text>
        </View>
      ) : (
        items.map((item) => (
          <View key={item.id}>{renderItem({ item, canRemove })}</View>
        ))
      )}
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '보호자 관리', headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen
        options={{
          title: '보호자 관리',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
          headerShadowVisible: false,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setShowModal(true)}
              style={styles.headerButton}
            >
              <Ionicons name="person-add" size={24} color="#4F46E5" />
            </TouchableOpacity>
          ),
        }}
      />
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.list}
        data={[]}
        renderItem={() => null}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <>
            {renderSection('내 보호자', myGuardians, false)}
            {renderSection('내 피부양자', myDependents, true)}
          </>
        }
      />

      {/* 보호자 등록 모달 */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>보호자 등록 신청</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* 🔴 서버는 전화번호가 아니라 피부양자 MRN 으로 상대를 찾는다(GuardianRequestDto).
                종전 전화번호 입력은 서버에 닿지도 못했다. */}
            <Text style={styles.fieldLabel}>피부양자 환자번호(등록번호)</Text>
            <TextInput
              style={styles.input}
              value={form.dependentMrn}
              onChangeText={(v) => setForm({ ...form, dependentMrn: v })}
              placeholder="진료카드에 적힌 번호"
              autoCapitalize="characters"
            />
            <Text style={styles.hintText}>
              피부양자 본인의 앱 계정이 있어야 신청할 수 있습니다.
            </Text>

            <Text style={styles.fieldLabel}>관계</Text>
            <View style={styles.relGrid}>
              {RELATIONSHIPS.map((rel) => (
                <TouchableOpacity
                  key={rel.code}
                  style={[
                    styles.relChip,
                    form.relationship === rel.code && styles.relChipActive,
                  ]}
                  onPress={() => setForm({ ...form, relationship: rel.code })}
                >
                  <Text
                    style={[
                      styles.relChipText,
                      form.relationship === rel.code && styles.relChipTextActive,
                    ]}
                  >
                    {rel.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* legalBasis 는 서버 필수값이다 — 숨겨두고 임의값을 보내지 않고 사용자가 고르게 한다. */}
            <Text style={styles.fieldLabel}>법적 근거</Text>
            <View style={styles.relGrid}>
              {LEGAL_BASES.map((lb) => (
                <TouchableOpacity
                  key={lb.code}
                  style={[
                    styles.relChip,
                    form.legalBasis === lb.code && styles.relChipActive,
                  ]}
                  onPress={() => setForm({ ...form, legalBasis: lb.code })}
                >
                  <Text
                    style={[
                      styles.relChipText,
                      form.legalBasis === lb.code && styles.relChipTextActive,
                    ]}
                  >
                    {lb.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleSubmit}
              disabled={requestMutation.isPending}
            >
              {requestMutation.isPending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>신청하기</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  headerButton: {
    marginRight: 8,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  personIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  relation: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phone: {
    fontSize: 13,
    color: '#6B7280',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  hintText: { fontSize: 11, color: '#9CA3AF', marginTop: 4, marginBottom: 4 },
  rejectText: { fontSize: 12, color: '#DC2626', marginTop: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
  },
  relGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  relChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  relChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  relChipText: {
    fontSize: 14,
    color: '#374151',
  },
  relChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
