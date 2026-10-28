import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { InfoCard } from '../../src/components/common/InfoCard';
import { AI_ORIGIN_TEXT } from '../../src/lib/ai-brand';

export default function AiHealthScreen() {
  const score = useQuery({ queryKey: ['health-score'], queryFn: () => apiClient.get('/api/v1/portal/health-score') });
  const followup = useQuery({ queryKey: ['followup-rec'], queryFn: () => apiClient.get('/api/v1/portal/followup-recommendation') });
  const dashboard = useQuery({ queryKey: ['health-dashboard'], queryFn: () => apiClient.get('/api/v1/portal/health-dashboard') });
  const labs = useQuery({ queryKey: ['lab-results'], queryFn: () => apiClient.get('/api/v1/portal/lab-results') });
  const meds = useQuery({ queryKey: ['medications'], queryFn: () => apiClient.get('/api/v1/portal/medications') });
  const encounters = useQuery({ queryKey: ['encounters'], queryFn: () => apiClient.get('/api/v1/portal/encounters') });

  const isLoading = score.isLoading;
  const onRefresh = () => { score.refetch(); followup.refetch(); dashboard.refetch(); labs.refetch(); meds.refetch(); encounters.refetch(); };

  const scoreData = (score.data as any)?.data;
  const followupData = (followup.data as any)?.data;
  const dashData = (dashboard.data as any)?.data;
  const labList: any[] = (labs.data as any)?.data ?? [];
  const medList: any[] = (meds.data as any)?.data ?? [];
  const encounterList: any[] = (encounters.data as any)?.data ?? [];

  if (isLoading) return <LoadingState message={`${AI_ORIGIN_TEXT} 분석 중...`} />;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: `${AI_ORIGIN_TEXT} 건강 관리`, headerShown: true }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={score.isRefetching} onRefresh={onRefresh} />}>

        {/* 0. AI 건강 상담 — 자유 질문 */}
        <AiFreeQuestion />

        {/* 1. AI 건강 종합 요약 */}
        <AiExplainCard
          title={`${AI_ORIGIN_TEXT} 건강 종합 요약`}
          icon="sparkles"
          color="#4F46E5"
          prompt={`환자의 전체 건강 상태를 종합적으로 요약해주세요.\n\n바이탈: ${JSON.stringify(dashData?.vitals ?? {})}\n문제목록: ${(dashData?.problems ?? []).map((p: any) => p.description ?? p).join(', ') || '기록 없음(없음으로 확인된 것은 아님)'}\n알레르기: ${(dashData?.allergies ?? []).map((a: any) => a.allergen ?? a.name ?? a).join(', ') || '기록 없음(문진 여부 미상 — 없음으로 가정하지 말 것)'}\n최근 진료: ${encounterList.length}회\n검사: ${labList.length}건`}
        />

        {/* 2. AI 건강 스코어 —
            🔴 서버는 { answer, keyPoints[], relatedQuestions[], disclaimer } 객체를 낸다(실측).
               종전 `JSON.stringify(...).slice(0,500)` 은 원시 JSON 을 500자에서 자른 채
               환자 화면에 그대로 찍었고, 서버가 함께 보낸 **면책 고지(disclaimer)를 버렸다**.
               AI 생성 임상 문구를 고지 없이 환자에게 보여주면 안 된다. */}
        <InfoCard title={`${AI_ORIGIN_TEXT} 건강 스코어`} accentColor="#10B981">
          {score.isError ? (
            <Text style={s.emptyText}>{AI_ORIGIN_TEXT} 건강 스코어를 불러오지 못했습니다.</Text>
          ) : scoreData?.score ? (
            <AiAnswer value={scoreData.score} />
          ) : (
            // 🔴 서버는 "검증된 산출 도구가 없어 산출하지 않았다"(UNAVAILABLE·NO_VALIDATED_INSTRUMENT)고 말한다.
            //    "데이터가 쌓이면 제공됩니다"는 없는 기능을 약속하는 문구였다 — 서버 사유를 그대로 보여준다.
            <Text style={s.emptyText}>{typeof scoreData?.reason === 'string' ? scoreData.reason : '건강 점수를 산출하지 않습니다(검증된 산출 도구 없음).'}</Text>
          )}
        </InfoCard>

        {/* 3. AI 재진 권고 — 서버 실측 shape: { recommendation: {answer, ...}, lastVisit, source } */}
        <InfoCard title={`${AI_ORIGIN_TEXT} 재진 권고`} accentColor="#F59E0B">
          {followup.isError ? (
            <Text style={s.emptyText}>재진 권고를 불러오지 못했습니다.</Text>
          ) : followupData?.recommendation ? (
            <AiAnswer value={followupData.recommendation} />
          ) : (
            <Text style={s.emptyText}>진료 이력 기반으로 다음 방문 시기를 추천합니다</Text>
          )}
        </InfoCard>

        {/* 4. AI 검사 결과 해석 */}
        {labList.length > 0 && labList[0]?.items?.length > 0 && (
          <AiExplainCard
            title={`${AI_ORIGIN_TEXT} 검사 결과 해석`}
            icon="flask"
            color="#3B82F6"
            prompt={`다음 검사 결과를 환자가 이해하기 쉽게 한국어로 설명해주세요. 이상 수치가 있으면 의미와 주의사항을 알려주세요.\n\n${labList[0].items.slice(0, 10).map((i: any) => `${i.testName}: ${i.value} ${i.unit} (flag: ${i.flag ?? 'N/A'})`).join('\n')}`}
          />
        )}

        {/* 5. AI 약물 상호작용 */}
        {medList.length >= 2 && (
          <AiDrugInteractionCard medications={medList} />
        )}

        {/* 6. AI 진료 이력 요약 */}
        {encounterList.length > 0 && (
          <AiExplainCard
            title={`${AI_ORIGIN_TEXT} 진료 이력 요약`}
            icon="document-text"
            color="#8B5CF6"
            prompt={`다음 진료 이력을 환자가 이해하기 쉽게 한국어로 요약해주세요.\n\n${encounterList.slice(0, 3).map((e: any) => `- ${e.createdAt}: ${(e.diagnoses ?? []).map((d: any) => d.diagnosisCode?.nameKo).filter(Boolean).join(', ') || '진단 기록 없음'}`).join('\n')}`}
          />
        )}

        {/* 바이탈/문제/알레르기 대시보드 */}
        {dashData?.vitals && (
          <InfoCard title="최근 바이탈" accentColor="#EF4444">
            <View style={s.vitalsGrid}>
              {dashData.vitals.systolicBp != null && <VitalChip label="BP" value={`${dashData.vitals.systolicBp}/${dashData.vitals.diastolicBp}`} />}
              {dashData.vitals.heartRate != null && <VitalChip label="HR" value={String(dashData.vitals.heartRate)} />}
              {dashData.vitals.temperature != null && <VitalChip label="T" value={String(dashData.vitals.temperature)} />}
              {dashData.vitals.spo2 != null && <VitalChip label="SpO2" value={String(dashData.vitals.spo2)} />}
            </View>
          </InfoCard>
        )}

        {dashData?.problems?.length > 0 && (
          <InfoCard title={`활성 건강 문제 (${dashData.problems.length})`} accentColor="#F59E0B">
            {dashData.problems.map((p: any, i: number) => (
              <View key={i} style={s.itemRow}><Ionicons name="alert-circle-outline" size={14} color="#F59E0B" /><Text style={s.itemText}>{p.description ?? p.name ?? p}</Text></View>
            ))}
          </InfoCard>
        )}

        {dashData?.allergies?.length > 0 && (
          <InfoCard title={`알레르기 (${dashData.allergies.length})`} accentColor="#DC2626">
            {dashData.allergies.map((a: any, i: number) => (
              <View key={i} style={s.itemRow}><Ionicons name="warning-outline" size={14} color="#DC2626" /><Text style={s.itemText}>{a.allergen ?? a.name ?? a}</Text></View>
            ))}
          </InfoCard>
        )}
      </ScrollView>
    </View>
  );
}

/** AI 자유 질문 — 환자가 직접 건강 질문 */
/**
 * WeRU.B AI 응답 표시 정본.
 * 🔴 서버 AI 응답은 `{ answer, keyPoints[], relatedQuestions[], disclaimer }` 객체다.
 *    문자열로 오는 경우도 방어하되, **객체를 JSON.stringify 로 찍지 않는다**.
 *    disclaimer 는 서버가 준 그대로 반드시 함께 노출한다(문구를 앱에서 지어내지 않는다).
 */
function AiAnswer({ value }: { value: any }) {
  if (typeof value === 'string') return <Text style={s.aiText}>{value}</Text>;
  if (!value || typeof value !== 'object') return null;

  const answer = typeof value.answer === 'string' ? value.answer : null;
  const keyPoints: string[] = Array.isArray(value.keyPoints) ? value.keyPoints.filter((k: any) => typeof k === 'string') : [];
  const disclaimer = typeof value.disclaimer === 'string' ? value.disclaimer : null;

  if (!answer && keyPoints.length === 0) {
    return <Text style={s.emptyText}>표시할 수 있는 응답이 없습니다.</Text>;
  }

  return (
    <View>
      {answer && <Text style={s.aiText}>{answer}</Text>}
      {keyPoints.length > 0 && (
        <View style={s.keyPoints}>
          {keyPoints.map((k, i) => (
            <Text key={i} style={s.keyPoint}>· {k}</Text>
          ))}
        </View>
      )}
      {disclaimer && <Text style={s.disclaimer}>{disclaimer}</Text>}
    </View>
  );
}

function AiFreeQuestion() {
  const [question, setQuestion] = useState('');
  // 🔴 종전엔 answer 문자열만 뽑아 쓰고 서버가 준 keyPoints·disclaimer 를 버린 뒤,
  //    앱이 지어낸 고지 문구를 대신 붙였다. 응답 객체를 그대로 들고 AiAnswer 가 그린다.
  const [answer, setAnswer] = useState<any>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setErrorText(null);
    try {
      const res: any = await apiClient.post('/api/v1/portal/ai/ask', {
        question: question.trim(),
      });
      const payload = res?.data;
      if (payload?.answer || typeof payload === 'string') setAnswer(payload);
      else {
        setAnswer(null);
        setErrorText('답변을 생성하지 못했습니다.');
      }
    } catch {
      setAnswer(null);
      setErrorText(`${AI_ORIGIN_TEXT} 응답에 실패했습니다. 잠시 후 다시 시도해주세요.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.freeQCard}>
      <View style={s.freeQHeader}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#4F46E5" />
        <Text style={s.freeQTitle}>AI 건강 상담</Text>
      </View>
      <Text style={s.freeQDesc}>건강에 대한 궁금한 점을 자유롭게 질문하세요</Text>
      <View style={s.freeQInputRow}>
        <TextInput
          style={s.freeQInput}
          value={question}
          onChangeText={setQuestion}
          placeholder="예: 콜레스테롤이 높으면 어떻게 해야 하나요?"
          placeholderTextColor="#9CA3AF"
          multiline
        />
        <TouchableOpacity style={[s.freeQBtn, (!question.trim() || loading) && { opacity: 0.4 }]} onPress={ask} disabled={!question.trim() || loading}>
          {loading ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={16} color="#FFF" />}
        </TouchableOpacity>
      </View>
      {errorText && (
        <View style={s.freeQAnswer}>
          <Text style={s.emptyText}>{errorText}</Text>
        </View>
      )}
      {answer && (
        <View style={s.freeQAnswer}>
          <AiAnswer value={answer} />
        </View>
      )}
    </View>
  );
}

/** AI 설명 카드 — 포털 AI 도우미(/portal/ai/ask) 호출 (환자 토큰·PortalOrPatientGuard) */
function AiExplainCard({ title, icon, color, prompt }: { title: string; icon: string; color: string; prompt: string }) {
  const [result, setResult] = useState<any>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const res: any = await apiClient.post('/api/v1/portal/ai/ask', {
        question: prompt,
      });
      const payload = res?.data;
      // 🔴 종전 폴백은 `JSON.stringify(res?.data).slice(0,500)` — 응답 형태가 다르면
      //    원시 JSON 을 환자 화면에 그대로 찍었다. 못 읽으면 못 읽었다고 말한다.
      if (payload?.answer || typeof payload === 'string') setResult(payload);
      else {
        setResult(null);
        setErrorText(`${AI_ORIGIN_TEXT} 응답을 표시할 수 없습니다.`);
      }
    } catch {
      setResult(null);
      setErrorText(`${AI_ORIGIN_TEXT} 분석에 실패했습니다. 잠시 후 다시 시도해주세요.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <InfoCard title={title} accentColor={color}>
      {errorText ? (
        <Text style={s.emptyText}>{errorText}</Text>
      ) : result ? (
        <AiAnswer value={result} />
      ) : (
        <TouchableOpacity style={s.analyzeBtn} onPress={analyze} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#4F46E5" />
          ) : (
            <>
              <Ionicons name={icon as any} size={18} color="#4F46E5" />
              <Text style={s.analyzeBtnText}>AI 분석 시작</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </InfoCard>
  );
}

/** AI 약물 상호작용 카드 */
function AiDrugInteractionCard({ medications }: { medications: any[] }) {
  const [result, setResult] = useState<any[] | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const drugs = medications.map(m => m.name ?? m.drugName ?? m.medicationName ?? '').filter(Boolean);
      const res: any = await apiClient.post('/api/v1/portal/ai/drug-interactions', { drugs });
      const interactions = res?.data?.interactions;
      // 🔴 종전 언랩은 `res?.data?.interactions ?? []` 였다 — 응답 형태가 다르면
      //    빈 배열로 접혀 화면이 "상호작용 없음"(안심)으로 말했다.
      //    배열로 온 것만 결과로 받고, 아니면 못 읽었다고 말한다(형제 카드 :246 과 같은 방식).
      if (Array.isArray(interactions)) setResult(interactions);
      else {
        setResult(null);
        setErrorText(`${AI_ORIGIN_TEXT} 응답을 표시할 수 없습니다.`);
      }
    } catch {
      // 🔴 종전 `setResult([])` — **호출 실패가 "약물 간 상호작용이 발견되지 않았습니다"로 보였다**(P17).
      //    조회 실패는 "상호작용 없음"이 아니다.
      setResult(null);
      setErrorText(`${AI_ORIGIN_TEXT} 상호작용 검사에 실패했습니다. 상호작용이 없다는 뜻이 아닙니다. 잠시 후 다시 시도해주세요.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <InfoCard title={`${AI_ORIGIN_TEXT} 약물 상호작용 검사`} accentColor="#DC2626">
      {errorText ? (
        <Text style={s.emptyText}>{errorText}</Text>
      ) : result ? (
        result.length > 0 ? result.map((i: any, idx: number) => (
          <View key={idx} style={s.interactionRow}>
            <Ionicons name="warning" size={14} color={i.severity === 'HIGH' ? '#DC2626' : '#F59E0B'} />
            <View style={s.interactionBody}>
              <Text style={s.interactionDrugs}>{i.drug_a} ↔ {i.drug_b}</Text>
              <Text style={s.interactionDesc}>{i.description}</Text>
            </View>
          </View>
        )) : <Text style={s.safeText}>약물 간 상호작용이 발견되지 않았습니다</Text>
      ) : (
        <TouchableOpacity style={s.analyzeBtn} onPress={check} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#DC2626" /> : (
            <><Ionicons name="shield-checkmark-outline" size={18} color="#DC2626" /><Text style={[s.analyzeBtnText, { color: '#DC2626' }]}>상호작용 검사</Text></>
          )}
        </TouchableOpacity>
      )}
    </InfoCard>
  );
}

function VitalChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.vitalChip}>
      <Text style={s.vitalLabel}>{label}</Text>
      <Text style={s.vitalValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  freeQCard: { backgroundColor: '#FFF', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 2, borderColor: '#4F46E5', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  freeQHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  freeQTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  freeQDesc: { fontSize: 12, color: '#6B7280', marginBottom: 10 },
  freeQInputRow: { flexDirection: 'row', gap: 8 },
  freeQInput: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#E5E7EB', minHeight: 44 },
  freeQBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4F46E5', justifyContent: 'center', alignItems: 'center' },
  freeQAnswer: { marginTop: 12, backgroundColor: '#F0F0FF', borderRadius: 10, padding: 12 },
  aiText: { fontSize: 14, color: '#1F2937', lineHeight: 22 },
  emptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 8 },
  keyPoints: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  keyPoint: { fontSize: 13, color: '#374151', lineHeight: 20 },
  disclaimer: { fontSize: 11, color: '#9CA3AF', lineHeight: 16, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, backgroundColor: '#F0F0FF', borderRadius: 10 },
  analyzeBtnText: { fontSize: 14, fontWeight: '600', color: '#4F46E5' },
  safeText: { fontSize: 13, color: '#10B981', textAlign: 'center', paddingVertical: 8 },
  interactionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  interactionBody: { flex: 1 },
  interactionDrugs: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  interactionDesc: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 18 },
  vitalsGrid: { flexDirection: 'row', gap: 8 },
  vitalChip: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, alignItems: 'center' },
  vitalLabel: { fontSize: 10, fontWeight: '600', color: '#9CA3AF' },
  vitalValue: { fontSize: 16, fontWeight: '800', color: '#1F2937', marginTop: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  itemText: { fontSize: 13, color: '#374151' },
});
