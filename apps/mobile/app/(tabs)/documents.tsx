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
  SafeAreaView,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { StatusBadge } from '../../src/components/StatusBadge';

interface Document {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

/**
 * 🔴 2026-08-14(W9) 서류 종류 코드가 서버와 전부 어긋나 있었다.
 *    서버 정본은 portal.service.requestDocument 의 TYPE_FEES 키다:
 *      MEDICAL_RECORD(1,000) · DIAGNOSIS_CERT(20,000) · OPINION(10,000) · RECEIPT(0)
 *      TAX_INVOICE(0) · ADMISSION_CERT(3,000) · DETAILED_BILL(1,000) · ATTENDANCE_CERT(3,000)
 *    종전 모바일은 DIAGNOSIS_CERTIFICATE·MEDICAL_RECORD_COPY 처럼 존재하지 않는 코드를 보냈다.
 *    DTO 는 type 을 자유 문자열로 받으므로 400 이 나지 않고 **신청은 생성된다** — 대신
 *    `TYPE_FEES[type] ?? 0` 이라 수수료가 전부 0원으로 기록되고, 원무과 처리 화면에서는
 *    알 수 없는 종류로 남는다. "신청 완료" 라고 말은 했지만 제대로 접수된 적이 없다.
 *    수수료는 서버가 계산하는 값이므로 여기서는 안내용으로만 표시한다(별도 계산 금지).
 */
const DOCUMENT_TYPES = [
  { value: 'DIAGNOSIS_CERT', label: '진단서', fee: 20000 },
  { value: 'OPINION', label: '소견서', fee: 10000 },
  { value: 'MEDICAL_RECORD', label: '의무기록 사본', fee: 1000 },
  { value: 'ADMISSION_CERT', label: '입퇴원확인서', fee: 3000 },
  { value: 'ATTENDANCE_CERT', label: '통원확인서', fee: 3000 },
  { value: 'DETAILED_BILL', label: '진료비 세부내역서', fee: 1000 },
  { value: 'RECEIPT', label: '진료비 영수증', fee: 0 },
  { value: 'TAX_INVOICE', label: '계산서', fee: 0 },
];

const statusMap: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'default' }
> = {
  // 🔴 스키마 실제 status 는 REQUESTED·PROCESSING·READY·DELIVERED·REJECTED 다.
  //    READY(수령 가능)·DELIVERED(수령 완료)가 빠져 있어 영문 enum 이 그대로 배지에 찍혔고,
  //    "수령하러 오세요"라는 가장 중요한 상태를 환자가 알 수 없었다. COMPLETED/CANCELLED 는 없는 값.
  REQUESTED: { label: '신청됨', variant: 'info' },
  PROCESSING: { label: '처리중', variant: 'warning' },
  // 🔴 (2026-10-10) 발급 업무가 실제로 쓰는 상태(기록 동결·증명서 작성 후 검토 중) — 빠져 영문 enum 이 배지에 찍혔다
  IN_REVIEW: { label: '처리중', variant: 'warning' },
  READY: { label: '수령 가능', variant: 'success' },
  DELIVERED: { label: '수령 완료', variant: 'default' },
  REJECTED: { label: '반려', variant: 'error' },
};

export default function DocumentsScreen() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['documents'],
    queryFn: () =>
      apiClient.get<{ data: Document[] }>('/api/v1/portal/documents/requests'),
  });

  const requestMutation = useMutation({
    mutationFn: (type: string) =>
      apiClient.post('/api/v1/portal/documents/request', { type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowModal(false);
      Alert.alert('알림', '서류 신청이 완료되었습니다.');
    },
    onError: (err: any) => {
      Alert.alert('오류', err?.message ?? '서류 신청에 실패했습니다.');
    },
  });

  const documents: Document[] = (data as any)?.data ?? [];

  const handleRequest = (type: string) => {
    const t = DOCUMENT_TYPES.find((d) => d.value === type);
    const feeText = t && t.fee > 0 ? `\n수수료 ${t.fee.toLocaleString('ko-KR')}원(1부 기준)` : '';
    Alert.alert('서류 신청', `${t?.label ?? type}을(를) 신청하시겠습니까?${feeText}`, [
      { text: '취소', style: 'cancel' },
      { text: '신청', onPress: () => requestMutation.mutate(type) },
    ]);
  };

  const renderItem = ({ item }: { item: Document }) => {
    const status = statusMap[item.status] ?? {
      label: item.status,
      variant: 'default' as const,
    };

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.iconRow}>
            <Ionicons name="document-text" size={18} color="#4F46E5" />
            <Text style={styles.docType}>{DOCUMENT_TYPES.find(d => d.value === item.type)?.label ?? item.type}</Text>
          </View>
          <StatusBadge label={status.label} variant={status.variant} />
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>신청일</Text>
          <Text style={styles.infoValue}>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</Text>
        </View>
        {item.completedAt && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>완료일</Text>
            <Text style={styles.infoValue}>{new Date(item.completedAt).toLocaleDateString('ko-KR')}</Text>
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '서류 신청/조회', headerShown: true }} />
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
          title: '서류 신청/조회',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
          headerShadowVisible: false,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setShowModal(true)}
              style={styles.headerButton}
            >
              <Ionicons name="add-circle" size={28} color="#4F46E5" />
            </TouchableOpacity>
          ),
        }}
      />
      <FlatList
        style={styles.container}
        contentContainerStyle={
          documents.length === 0 ? styles.empty : styles.list
        }
        data={documents}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="document-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyText}>서류 내역이 없습니다</Text>
            <TouchableOpacity
              style={styles.requestBtn}
              onPress={() => setShowModal(true)}
            >
              <Text style={styles.requestBtnText}>서류 신청하기</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* 서류 유형 선택 모달 */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>서류 유형 선택</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>
            {DOCUMENT_TYPES.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={styles.typeItem}
                onPress={() => handleRequest(type.value)}
              >
                <Ionicons name="document-text-outline" size={20} color="#4F46E5" />
                <Text style={styles.typeLabel}>{type.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />
              </TouchableOpacity>
            ))}
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
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
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
    marginBottom: 12,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docType: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  infoValue: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  requestBtn: {
    marginTop: 16,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  requestBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },
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
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  typeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  typeLabel: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
});
