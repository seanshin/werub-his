import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { formatDate, formatTime } from '../../src/lib/format';

export default function TelehealthBookScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1: 진료과 → 2: 의사 → 3: 시간 → 4: 확인
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState<any>(null);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');

  const departments = useQuery({
    queryKey: ['telehealth-departments'],
    queryFn: () => apiClient.get('/api/v1/portal/telehealth-departments'),
  });

  const doctors = useQuery({
    queryKey: ['telehealth-doctors', selectedDept],
    queryFn: () => apiClient.get(`/api/v1/portal/telehealth-doctors?department=${selectedDept}`),
    enabled: !!selectedDept,
  });

  const today = new Date().toISOString().split('T')[0];
  const slots = useQuery({
    queryKey: ['telehealth-slots', selectedDoctor?.id],
    queryFn: () => apiClient.get(`/api/v1/portal/telehealth-slots?doctorId=${selectedDoctor?.id}&date=${today}`),
    enabled: !!selectedDoctor?.id,
  });

  const bookMutation = useMutation({
    mutationFn: () => apiClient.post('/api/v1/portal/telehealth-book', {
      doctorId: selectedDoctor.id,
      scheduledAt: selectedSlot,
      sessionType: 'VIDEO',
      chiefComplaint: chiefComplaint || undefined,
    }),
    onSuccess: () => {
      if (Platform.OS === 'web') { window.alert('예약이 완료되었습니다'); }
      router.back();
    },
  });

  const deptList: any[] = (departments.data as any)?.data ?? [];
  const doctorList: any[] = (doctors.data as any)?.data ?? [];
  const slotList: any[] = (slots.data as any)?.data ?? [];

  /**
   * 🔴 2026-08-18. 서버 변경으로 이 화면의 네 호출이 **거절될 수 있게 됐다**.
   *    - `/portal/telehealth-departments`·`-doctors` 는 관리자 설정(진료과 허용 목록)을 반영해
   *      목록을 줄인다 → 조회가 **실패**했을 때와 **정말 없을 때**가 화면에서 같아 보이면 안 된다.
   *    - `/portal/telehealth-book` 은 담당의를 서버가 검증한다(400 `담당의를 선택해주세요` /
   *      `선택한 담당의로는 예약할 수 없습니다`, 403 `…는 현재 비대면 진료를 제공하지 않습니다`).
   *      종전 이 화면은 `onError` 가 없어 **거절이 아무 표시 없이 삼켜졌다** — 환자는 버튼을
   *      눌렀는데 아무 일도 안 일어나는 것을 보고 예약이 된 줄 알거나 앱이 멈춘 줄 안다.
   *    조회 실패를 "없음"으로 말하지 않고, 거절은 서버 문구 그대로 보여준다.
   */
  const errText = (e: unknown, fallback: string): string =>
    (e as { message?: string } | null)?.message ?? fallback;

  const loadFailed = [
    departments.isError && '진료과',
    step >= 2 && doctors.isError && '의사 목록',
    step >= 3 && slots.isError && '예약 가능 시간',
  ].filter(Boolean) as string[];

  if (departments.isLoading) return <LoadingState />;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '원격진료 예약', headerShown: true }} />
      <ScrollView contentContainerStyle={s.content}>

        {/* 단계 표시 */}
        <View style={s.steps}>
          {['진료과', '의사', '시간', '확인'].map((label, i) => (
            <View key={i} style={s.stepItem}>
              <View style={[s.stepCircle, step > i && s.stepDone, step === i + 1 && s.stepActive]}>
                <Text style={[s.stepNum, (step > i || step === i + 1) && s.stepNumActive]}>{i + 1}</Text>
              </View>
              <Text style={[s.stepLabel, step === i + 1 && s.stepLabelActive]}>{label}</Text>
            </View>
          ))}
        </View>

        {/* 조회 실패 고지 — 실패를 "예약 가능한 것이 없음"으로 보이게 하지 않는다 */}
        {loadFailed.length > 0 && (
          <View style={s.failBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
            <Text style={s.failText}>
              {loadFailed.join(' · ')} 정보를 불러오지 못했습니다. 목록이 비어 있어도 “없음”이 아닙니다.
            </Text>
          </View>
        )}

        {/* Step 1: 진료과 선택 */}
        {step === 1 && (
          <View>
            <Text style={s.sectionTitle}>진료과를 선택하세요</Text>
            {deptList.map((d: any, i: number) => (
              <TouchableOpacity key={i} style={[s.optionCard, selectedDept === (d.name ?? d) && s.optionSelected]} onPress={() => { setSelectedDept(d.name ?? d); setStep(2); }}>
                <Ionicons name="medical-outline" size={18} color={selectedDept === (d.name ?? d) ? '#4F46E5' : '#6B7280'} />
                <Text style={s.optionText}>{d.name ?? d}</Text>
              </TouchableOpacity>
            ))}
            {deptList.length === 0 && !departments.isError && (
              <Text style={s.emptyText}>원격진료 가능한 진료과가 없습니다</Text>
            )}
            {departments.isError && (
              <TouchableOpacity style={s.retryBtn} onPress={() => departments.refetch()}>
                <Text style={s.retryText}>다시 시도</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Step 2: 의사 선택 */}
        {step === 2 && (
          <View>
            <Text style={s.sectionTitle}>{selectedDept} — 의사 선택</Text>
            {doctorList.map((d: any, i: number) => (
              <TouchableOpacity key={i} style={[s.optionCard, selectedDoctor?.id === d.id && s.optionSelected]} onPress={() => { setSelectedDoctor(d); setStep(3); }}>
                <Ionicons name="person-outline" size={18} color="#6B7280" />
                <Text style={s.optionText}>{d.familyName}{d.givenName} 선생님</Text>
              </TouchableOpacity>
            ))}
            {doctorList.length === 0 && !doctors.isError && !doctors.isLoading && (
              <Text style={s.emptyText}>이 진료과에 비대면 진료 가능한 의사가 없습니다</Text>
            )}
            {doctors.isError && (
              <TouchableOpacity style={s.retryBtn} onPress={() => doctors.refetch()}>
                <Text style={s.retryText}>다시 시도</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}><Text style={s.backText}>← 진료과 재선택</Text></TouchableOpacity>
          </View>
        )}

        {/* Step 3: 시간 선택 */}
        {step === 3 && (
          <View>
            <Text style={s.sectionTitle}>{selectedDoctor?.familyName}{selectedDoctor?.givenName} 선생님 — 시간 선택</Text>
            <View style={s.slotGrid}>
              {slotList.map((slot: any, i: number) => {
                const time = slot.startTime ?? slot;
                return (
                  <TouchableOpacity key={i} style={[s.slotChip, selectedSlot === time && s.slotSelected]} onPress={() => { setSelectedSlot(time); setStep(4); }}>
                    <Text style={[s.slotText, selectedSlot === time && s.slotTextSelected]}>{typeof time === 'string' && time.includes('T') ? formatTime(time) : time}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {slotList.length === 0 && !slots.isError && !slots.isLoading && (
              <Text style={s.emptyText}>오늘 가용한 시간이 없습니다</Text>
            )}
            {slots.isError && (
              <TouchableOpacity style={s.retryBtn} onPress={() => slots.refetch()}>
                <Text style={s.retryText}>다시 시도</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(2)}><Text style={s.backText}>← 의사 재선택</Text></TouchableOpacity>
          </View>
        )}

        {/* Step 4: 확인 + 예약 */}
        {step === 4 && (
          <View>
            <Text style={s.sectionTitle}>예약 확인</Text>
            <View style={s.confirmCard}>
              <View style={s.confirmRow}><Text style={s.confirmLabel}>진료과</Text><Text style={s.confirmValue}>{selectedDept}</Text></View>
              <View style={s.confirmRow}><Text style={s.confirmLabel}>의사</Text><Text style={s.confirmValue}>{selectedDoctor?.familyName}{selectedDoctor?.givenName}</Text></View>
              <View style={s.confirmRow}><Text style={s.confirmLabel}>시간</Text><Text style={s.confirmValue}>{selectedSlot.includes('T') ? formatTime(selectedSlot) : selectedSlot}</Text></View>
            </View>
            <TextInput style={s.complaintInput} value={chiefComplaint} onChangeText={setChiefComplaint} placeholder="증상을 간단히 입력해주세요 (선택)" placeholderTextColor="#9CA3AF" multiline />
            <TouchableOpacity style={s.bookBtn} onPress={() => bookMutation.mutate()} disabled={bookMutation.isPending}>
              {bookMutation.isPending ? <ActivityIndicator color="#FFF" /> : (
                <><Ionicons name="videocam" size={20} color="#FFF" /><Text style={s.bookBtnText}>예약 확정</Text></>
              )}
            </TouchableOpacity>
            {bookMutation.isError && (
              <View style={s.errBanner}>
                <Ionicons name="alert-circle-outline" size={16} color="#B91C1C" />
                <Text style={s.errText}>
                  {errText(bookMutation.error, '예약에 실패했습니다. 잠시 후 다시 시도해주세요.')}
                </Text>
              </View>
            )}
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(3)}><Text style={s.backText}>← 시간 재선택</Text></TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  steps: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  stepItem: { alignItems: 'center' },
  stepCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center' },
  stepDone: { backgroundColor: '#10B981' },
  stepActive: { backgroundColor: '#4F46E5' },
  stepNum: { fontSize: 12, fontWeight: '700', color: '#9CA3AF' },
  stepNumActive: { color: '#FFF' },
  stepLabel: { fontSize: 11, color: '#9CA3AF', marginTop: 4 },
  stepLabelActive: { color: '#4F46E5', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  optionSelected: { borderColor: '#4F46E5', backgroundColor: '#F0F0FF' },
  optionText: { fontSize: 15, color: '#1F2937' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  slotSelected: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  slotText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  slotTextSelected: { color: '#FFF' },
  confirmCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 16 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  confirmLabel: { fontSize: 13, color: '#6B7280' },
  confirmValue: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  complaintInput: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, fontSize: 14, borderWidth: 1, borderColor: '#E5E7EB', minHeight: 60, marginBottom: 16 },
  bookBtn: { backgroundColor: '#4F46E5', borderRadius: 12, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bookBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  backBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  backText: { fontSize: 13, color: '#6B7280' },
  emptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 20 },
  failBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 16 },
  failText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  errBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEE2E2', borderRadius: 10, padding: 12, marginTop: 12 },
  errText: { flex: 1, fontSize: 13, color: '#B91C1C', lineHeight: 19 },
  retryBtn: { alignSelf: 'center', marginTop: 4, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#4F46E5', borderRadius: 8 },
  retryText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
});
