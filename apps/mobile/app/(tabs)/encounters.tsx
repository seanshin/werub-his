import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../src/lib/api-client';
import { StatusBadge } from '../../src/components/StatusBadge';
import { LoadingState } from '../../src/components/common/LoadingState';
import { ErrorState } from '../../src/components/common/ErrorState';
import { formatDate } from '../../src/lib/format';

interface Encounter {
  id: string;
  createdAt: string;
  doctor?: { familyName: string; givenName: string; department?: any };
  diagnoses?: Array<{ diagnosisCode?: { code: string; nameKo: string } }>;
}

export default function EncountersScreen() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['encounters'],
    queryFn: () =>
      apiClient.get<{ data: Encounter[] }>('/api/v1/portal/encounters'),
  });

  const encounters: Encounter[] = (data as any)?.data ?? [];
  const selected = encounters.find((e) => e.id === selectedId);

  const renderItem = ({ item }: { item: Encounter }) => {
    const doctorName = item.doctor ? `${item.doctor.familyName}${item.doctor.givenName}` : '';
    const dateStr = formatDate(item.createdAt);
    const diagnosis = item.diagnoses?.[0]?.diagnosisCode?.nameKo;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => setSelectedId(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardTop}>
          <View style={styles.dateRow}>
            <Ionicons name="document-text-outline" size={16} color="#4F46E5" />
            <Text style={styles.date}>{dateStr}</Text>
          </View>
          <StatusBadge label="완료" variant="default" />
        </View>
        {doctorName ? <Text style={styles.doctor}>{doctorName} 선생님</Text> : null}
        {diagnosis && (
          <View style={styles.diagnosisRow}>
            <Text style={styles.diagnosisLabel}>진단: </Text>
            <Text style={styles.diagnosisText} numberOfLines={1}>{diagnosis}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={
          encounters.length === 0 ? styles.empty : styles.list
        }
        data={encounters}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="medkit-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyText}>진료 이력이 없습니다</Text>
          </View>
        }
      />

      {/* SOAP 상세 모달 */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedId(null)}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>진료 상세</Text>
          <TouchableOpacity onPress={() => setSelectedId(null)}>
            <Ionicons name="close" size={24} color="#111827" />
          </TouchableOpacity>
        </View>
        {selected && (
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalDate}>{formatDate(selected.createdAt)}</Text>
            <Text style={styles.modalDept}>
              {selected.doctor ? `${selected.doctor.familyName}${selected.doctor.givenName} 선생님` : ''}
            </Text>

            {/* 🔴 (2026-10-20 결정 portal.visitSummaryScope = GENERAL) 서버가 의사 소견 원문을 싣지 않는다 — 진단명까지 */}
            {selected.diagnoses && selected.diagnoses.length > 0 && (
              <View style={styles.soapSection}>
                <Text style={styles.soapTitle}>진단</Text>
                {selected.diagnoses.map((d, i) => (
                  <Text key={i} style={styles.soapText}>{d.diagnosisCode?.nameKo ?? d.diagnosisCode?.code}</Text>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 10,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  date: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  department: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  doctor: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  complaint: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 8,
  },
  diagnosisRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  diagnosisLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  diagnosisText: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modalContent: {
    padding: 20,
  },
  modalDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4F46E5',
  },
  modalDept: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 4,
    marginBottom: 20,
  },
  soapSection: {
    marginBottom: 18,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 14,
  },
  soapTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  soapText: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 22,
  },
});
