import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  SafeAreaView,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';

type AnswerValue = string | number | Array<string | number>;

interface QuestionOption {
  label: string;
  value: string | number;
}

interface Question {
  id: string;
  questionText: string;
  questionType: 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE';
  options?: QuestionOption[];
  required: boolean;
}

interface Questionnaire {
  tokenId: string | null;
  formSchemaId?: string;
  title: string;
  description?: string;
  questions: Question[];
  /** 이 문진표에 렌더러가 모르는 필드가 있으면 몇 개인지 — 조용히 빼먹지 않기 위해 센다. */
  unsupportedCount: number;
}

/**
 * 🔴 2026-08-14(W9) 계약 재정렬.
 *
 * 서버 `/api/v1/portal/questionnaire/active` 는 **배열**을 낸다(실측):
 *   [{ tokenId, token, appointmentId, status, expiresAt, sentVia,
 *      formSchema: { id, name, description, category, estimatedMinutes, schema } }]
 *   schema = { title, fields: [{ key, type, label, options: [{label, value}] }], ... }
 *
 * 종전 모바일은 이걸 `{ id, title, questions[] }` 단일 객체로 읽었다. 배열에는 `.questions` 가
 * 없으니 questions 는 항상 []가 되고, 화면은 문진표가 **있어도** 늘 "작성할 문진표가 없습니다"
 * 였다. 즉 앱에서 문진표를 작성한 환자는 한 명도 있을 수 없었다.
 *
 * 또 하나: 토큰이 없으면 서버는 오늘 예약 기반 안내 항목(`tokenId: null`·formSchema 없음)을
 * 낸다. 그건 작성 가능한 문진표가 아니라 "접수처에서 받으세요" 안내다 — 구분해서 말한다.
 */
function adaptQuestionnaire(raw: any): { form: Questionnaire | null; notice: string | null } {
  const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (list.length === 0) return { form: null, notice: null };

  const withSchema = list.find((t) => t?.formSchema?.schema?.fields?.length);
  if (!withSchema) {
    // 토큰은 없고 예약 기반 안내만 온 경우 — 서버 메시지를 그대로 전한다(문구를 지어내지 않는다).
    const msg = list.find((t) => t?.message)?.message;
    return { form: null, notice: msg ?? null };
  }

  const schema = withSchema.formSchema.schema;
  const fields: any[] = schema.fields ?? [];
  const questions: Question[] = [];
  let unsupportedCount = 0;

  for (const f of fields) {
    const opts: QuestionOption[] = Array.isArray(f.options)
      ? f.options.map((o: any) =>
          typeof o === 'object' && o !== null
            ? { label: String(o.label ?? o.value), value: o.value ?? o.label }
            : { label: String(o), value: o },
        )
      : [];

    const type = String(f.type ?? '').toLowerCase();
    let questionType: Question['questionType'] | null = null;
    if (type === 'select' || type === 'radio' || type === 'single_choice') questionType = 'SINGLE_CHOICE';
    else if (type === 'multiselect' || type === 'checkbox' || type === 'multi_choice') questionType = 'MULTI_CHOICE';
    else if (type === 'scale' || type === 'range') questionType = 'SCALE';
    else if (type === 'text' || type === 'textarea' || type === 'string' || type === 'number') questionType = 'TEXT';

    if (!questionType) {
      // 🔴 모르는 필드 타입을 임의로 TEXT 로 바꿔 제출하지 않는다 — 셌다고만 말하고 넘긴다.
      unsupportedCount += 1;
      continue;
    }

    questions.push({
      id: String(f.key),
      questionText: String(f.label ?? f.key),
      questionType,
      options: opts.length > 0 ? opts : undefined,
      required: f.required === true,
    });
  }

  return {
    form: {
      tokenId: withSchema.tokenId ?? null,
      formSchemaId: withSchema.formSchema.id,
      title: schema.title ?? withSchema.formSchema.name ?? '문진표',
      description: withSchema.formSchema.description ?? undefined,
      questions,
      unsupportedCount,
    },
    notice: null,
  };
}

export default function QuestionnaireScreen() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [currentIdx, setCurrentIdx] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['questionnaire'],
    queryFn: () =>
      apiClient.get<{ data: any }>(
        '/api/v1/portal/questionnaire/active',
      ),
  });

  const submitMutation = useMutation({
    mutationFn: (body: { tokenId?: string; formSchemaId?: string; responses: Record<string, any> }) =>
      apiClient.post('/api/v1/portal/questionnaire/submit', body),
    onSuccess: () => {
      Alert.alert('완료', '문진표가 제출되었습니다.', [
        { text: '확인', onPress: () => router.back() },
      ]);
    },
    onError: (err: any) => {
      Alert.alert('오류', err?.message ?? '문진표 제출에 실패했습니다.');
    },
  });

  const { form: questionnaire, notice } = adaptQuestionnaire((data as any)?.data);
  const questions = questionnaire?.questions ?? [];
  const currentQ = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const progress = questions.length > 0 ? (currentIdx + 1) / questions.length : 0;

  const setAnswer = (questionId: string, value: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const toggleMultiChoice = (questionId: string, option: string | number) => {
    const current = (answers[questionId] as Array<string | number>) ?? [];
    const updated = current.includes(option)
      ? current.filter((o) => o !== option)
      : [...current, option];
    setAnswer(questionId, updated);
  };

  const handleNext = () => {
    if (currentQ?.required) {
      const ans = answers[currentQ.id];
      if (!ans || (Array.isArray(ans) && ans.length === 0)) {
        Alert.alert('알림', '필수 항목을 입력해주세요.');
        return;
      }
    }

    if (isLast) {
      handleSubmit();
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const handleSubmit = () => {
    if (!questionnaire) return;
    // 🔴 종전엔 목록의 `id`(존재하지 않는 키)를 tokenId 로 보냈다. 서버는 tokenId 또는
    //    formSchemaId 중 하나를 요구한다(둘 다 없으면 400).
    const body =
      questionnaire.tokenId
        ? { tokenId: questionnaire.tokenId, responses: answers }
        : questionnaire.formSchemaId
          ? { formSchemaId: questionnaire.formSchemaId, responses: answers }
          : null;
    if (!body) {
      Alert.alert('제출 불가', '이 문진표는 앱에서 제출할 수 없습니다. 접수처에 문의해 주세요.');
      return;
    }
    Alert.alert('제출', '문진표를 제출하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '제출', onPress: () => submitMutation.mutate(body) },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '문진표', headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      </SafeAreaView>
    );
  }

  if (!questionnaire || questions.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen
          options={{
            title: '문진표',
            headerStyle: { backgroundColor: '#FFFFFF' },
            headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
            headerShadowVisible: false,
          }}
        />
        <View style={styles.center}>
          <Ionicons
            name={isError ? 'cloud-offline-outline' : 'clipboard-outline'}
            size={48}
            color={isError ? '#F59E0B' : '#D1D5DB'}
          />
          {/* 🔴 조회 실패를 "문진표 없음"으로 말하지 않는다 */}
          <Text style={styles.emptyText}>
            {isError
              ? '문진표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
              : notice ?? '작성할 문진표가 없습니다'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen
        options={{
          title: questionnaire.title,
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
          headerShadowVisible: false,
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* 진행률 */}
        <View style={styles.progressSection}>
          <Text style={styles.progressLabel}>
            {currentIdx + 1} / {questions.length}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${progress * 100}%` }]}
            />
          </View>
        </View>

        {/* 🔴 앱이 그릴 수 없는 문항을 조용히 빼놓고 "제출 완료"라고 말하지 않는다 */}
        {questionnaire.unsupportedCount > 0 && (
          <View style={styles.unsupportedBanner}>
            <Ionicons name="alert-circle-outline" size={16} color="#B45309" />
            <Text style={styles.unsupportedText}>
              이 앱 버전에서 표시할 수 없는 문항 {questionnaire.unsupportedCount}개가 제외되었습니다.
              전체 문항은 접수처 또는 웹에서 작성해 주세요.
            </Text>
          </View>
        )}

        {/* 질문 카드 */}
        {currentQ && (
          <View style={styles.questionCard}>
            <View style={styles.qHeader}>
              {currentQ.required && (
                <Text style={styles.required}>필수</Text>
              )}
              <Text style={styles.questionText}>{currentQ.questionText}</Text>
            </View>

            {/* TEXT */}
            {currentQ.questionType === 'TEXT' && (
              <TextInput
                style={styles.textInput}
                value={(answers[currentQ.id] as string) ?? ''}
                onChangeText={(v) => setAnswer(currentQ.id, v)}
                placeholder="답변을 입력해주세요"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            )}

            {/* SINGLE_CHOICE — 🔴 저장값은 label 이 아니라 option.value 다.
                IPSS 처럼 점수화(scoring)되는 문진표는 label 을 보내면 채점이 불가능해진다. */}
            {currentQ.questionType === 'SINGLE_CHOICE' &&
              currentQ.options?.map((opt) => {
                const selected = answers[currentQ.id] === opt.value;
                return (
                  <TouchableOpacity
                    key={String(opt.value)}
                    style={[styles.optionItem, selected && styles.optionItemActive]}
                    onPress={() => setAnswer(currentQ.id, opt.value)}
                  >
                    <View style={[styles.radio, selected && styles.radioActive]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <Text style={[styles.optionText, selected && styles.optionTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}

            {/* MULTI_CHOICE */}
            {currentQ.questionType === 'MULTI_CHOICE' &&
              currentQ.options?.map((opt) => {
                const selected = (
                  (answers[currentQ.id] as Array<string | number>) ?? []
                ).includes(opt.value);
                return (
                  <TouchableOpacity
                    key={String(opt.value)}
                    style={[
                      styles.optionItem,
                      selected && styles.optionItemActive,
                    ]}
                    onPress={() => toggleMultiChoice(currentQ.id, opt.value)}
                  >
                    <View
                      style={[styles.checkbox, selected && styles.checkboxActive]}
                    >
                      {selected && (
                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}

            {/* SCALE (1-10) */}
            {currentQ.questionType === 'SCALE' && (
              <View style={styles.scaleRow}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={[
                      styles.scaleItem,
                      answers[currentQ.id] === String(n) &&
                        styles.scaleItemActive,
                    ]}
                    onPress={() => setAnswer(currentQ.id, String(n))}
                  >
                    <Text
                      style={[
                        styles.scaleText,
                        answers[currentQ.id] === String(n) &&
                          styles.scaleTextActive,
                      ]}
                    >
                      {n}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* 네비게이션 버튼 */}
        <View style={styles.navRow}>
          {currentIdx > 0 && (
            <TouchableOpacity
              style={styles.prevBtn}
              onPress={() => setCurrentIdx(currentIdx - 1)}
            >
              <Ionicons name="arrow-back" size={18} color="#4F46E5" />
              <Text style={styles.prevBtnText}>이전</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={handleNext}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.nextBtnText}>
                  {isLast ? '제출' : '다음'}
                </Text>
                {!isLast && (
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                )}
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },
  progressSection: {
    marginBottom: 20,
  },
  unsupportedBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 16 },
  unsupportedText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  progressLabel: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    marginBottom: 6,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4F46E5',
    borderRadius: 3,
  },
  questionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  qHeader: {
    marginBottom: 16,
  },
  required: {
    fontSize: 11,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 6,
  },
  questionText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 24,
  },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 100,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  optionItemActive: {
    borderColor: '#4F46E5',
    backgroundColor: '#F0F0FF',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioActive: {
    borderColor: '#4F46E5',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4F46E5',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  optionText: {
    fontSize: 15,
    color: '#374151',
  },
  optionTextActive: {
    color: '#4F46E5',
    fontWeight: '600',
  },
  scaleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  scaleItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scaleItemActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  scaleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  scaleTextActive: {
    color: '#FFFFFF',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  prevBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4F46E5',
  },
  prevBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4F46E5',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: '#4F46E5',
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
