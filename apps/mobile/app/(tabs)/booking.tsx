import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { useAuthStore } from '../../src/stores/auth-store';
import { AI_ORIGIN_TEXT } from '../../src/lib/ai-brand';

interface Message {
  role: 'user' | 'agent';
  content: string;
  uiDirective?: any;
}

interface QuickReply { label: string; value: string; icon?: string }

const COMMON_SYMPTOMS = [
  { label: '두통', icon: '🤕', value: '머리가 아파요' },
  { label: '복통', icon: '🤢', value: '배가 아파요' },
  { label: '기침/감기', icon: '🤧', value: '기침이 나고 감기 증상이 있어요' },
  { label: '발열', icon: '🌡️', value: '열이 나요' },
  { label: '허리통증', icon: '💪', value: '허리가 아파요' },
  { label: '소화불량', icon: '😣', value: '소화가 안 돼요' },
  { label: '건강검진', icon: '🩺', value: '건강검진을 받고 싶어요' },
  { label: '원격진료', icon: '📹', value: '원격진료를 예약하고 싶어요' },
];

export default function BookingScreen() {
  const user = useAuthStore((s) => s.user);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSymptoms, setShowSymptoms] = useState(true);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const flatListRef = useRef<FlatList>(null);

  // 세션 시작
  useEffect(() => {
    startSession();
  }, []);

  const startSession = async () => {
    try {
      const res: any = await apiClient.post('/api/v1/booking/session', {});
      const sid = res?.data?.id ?? res?.data?.sessionId ?? res?.sessionId;
      if (sid) {
        setSessionId(sid);

        // 로그인된 환자 MRN 자동 전송 → 환자 인식
        let profile: any = null;
        try {
          profile = await apiClient.get('/api/v1/portal/profile');
        } catch {}
        const mrn = (profile as any)?.data?.mrn;

        if (mrn) {
          const mrnRes: any = await apiClient.post(`/api/v1/booking/session/${sid}/message`, { message: mrn });
          const agentMsg = mrnRes?.data?.response ?? mrnRes?.data?.message ?? '어떤 증상으로 예약하시겠어요?';
          setMessages([{ role: 'agent', content: agentMsg }]);
        } else {
          setMessages([{ role: 'agent', content: '안녕하세요! 어떤 증상으로 예약하시겠어요?\n아래 증상을 선택하거나 직접 입력해주세요.' }]);
        }
      } else {
        setMessages([{ role: 'agent', content: '안녕하세요! 어떤 증상으로 예약하시겠어요?\n아래 증상을 선택하거나 직접 입력해주세요.' }]);
      }
    } catch {
      setMessages([{ role: 'agent', content: '안녕하세요! 어떤 증상으로 예약하시겠어요?\n아래 증상을 선택하거나 직접 입력해주세요.' }]);
    }
  };

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || loading) return;

    setInput('');
    setShowSymptoms(false);
    setQuickReplies([]);
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      let sid = sessionId;
      if (!sid) {
        const res: any = await apiClient.post('/api/v1/booking/session', {});
        sid = res?.data?.sessionId ?? res?.sessionId;
        setSessionId(sid);
      }

      const res: any = await apiClient.post(`/api/v1/booking/session/${sid}/message`, { message: msg });
      const agentMsg = res?.data?.response ?? res?.data?.message ?? res?.message ?? '처리 중입니다...';
      const uiDirective = res?.data?.uiDirective;
      const qr = uiDirective?.payload?.quickReplies ?? res?.data?.quickReplies ?? [];

      setMessages(prev => [...prev, { role: 'agent', content: agentMsg, uiDirective }]);
      if (qr.length > 0) setQuickReplies(qr);

      // UI 디렉티브 처리
      if (uiDirective?.type === 'DEPT_CARDS') {
        const depts = uiDirective.payload?.departments ?? [];
        if (depts.length > 0) {
          setQuickReplies(depts.map((d: any) => ({ label: d.name, value: d.name })));
        }
      } else if (uiDirective?.type === 'DATE_PICKER') {
        const dates = uiDirective.payload?.dates ?? [];
        if (dates.length > 0) {
          setQuickReplies(dates.map((d: any) => ({ label: d.label ?? d.dayName, value: d.value ?? d.date })));
        }
      } else if (uiDirective?.type === 'TIME_PICKER') {
        const times = uiDirective.payload?.times ?? [];
        const allSlots = times.flatMap((t: any) => t.slots ?? []);
        if (allSlots.length > 0) {
          setQuickReplies(allSlots.slice(0, 8).map((s: any) => ({ label: s.label ?? s.time, value: s.value ?? s.time })));
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'agent', content: '죄송합니다, 일시적 오류가 발생했습니다. 다시 시도해주세요.' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[s.msgRow, isUser && s.msgRowUser]}>
        {!isUser && (
          <View style={s.avatar}>
            <Ionicons name="medkit" size={16} color="#4F46E5" />
          </View>
        )}
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAgent]}>
          <Text style={[s.bubbleText, isUser && s.bubbleTextUser]}>{item.content}</Text>

          {/* 진료과 카드 */}
          {item.uiDirective?.type === 'DEPT_CARDS' && item.uiDirective.payload?.departments?.map((d: any, i: number) => (
            <TouchableOpacity key={i} style={s.deptCard} onPress={() => sendMessage(d.name)}>
              <Text style={s.deptName}>{d.name}</Text>
              {d.reason && <Text style={s.deptReason}>{d.reason}</Text>}
              {d.confidence != null && (
                <View style={s.confBar}>
                  <View style={[s.confFill, { width: `${d.confidence}%` }]} />
                </View>
              )}
            </TouchableOpacity>
          ))}

          {/* 예약 완료 */}
          {item.uiDirective?.type === 'BOOKING_COMPLETE' && (
            <View style={s.completeCard}>
              <Ionicons name="checkmark-circle" size={32} color="#10B981" />
              <Text style={s.completeTitle}>예약 완료!</Text>
              {item.uiDirective.payload?.department && <Text style={s.completeDetail}>{item.uiDirective.payload.department}</Text>}
              {item.uiDirective.payload?.doctor && <Text style={s.completeDetail}>{item.uiDirective.payload.doctor} 선생님</Text>}
              {item.uiDirective.payload?.date && <Text style={s.completeDetail}>{item.uiDirective.payload.date} {item.uiDirective.payload.time}</Text>}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: `${AI_ORIGIN_TEXT} 예약`, headerShown: true }} />

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderMessage}
        contentContainerStyle={s.chatList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* 증상 칩 */}
      {showSymptoms && messages.length <= 1 && (
        <View style={s.chipContainer}>
          <Text style={s.chipTitle}>자주 찾는 증상</Text>
          <View style={s.chipGrid}>
            {COMMON_SYMPTOMS.map((sym, i) => (
              <TouchableOpacity key={i} style={s.chip} onPress={() => sendMessage(sym.value)}>
                <Text style={s.chipIcon}>{sym.icon}</Text>
                <Text style={s.chipLabel}>{sym.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* 퀵 리플라이 */}
      {quickReplies.length > 0 && (
        <View style={s.qrContainer}>
          {quickReplies.map((qr, i) => (
            <TouchableOpacity key={i} style={s.qrChip} onPress={() => sendMessage(qr.value)}>
              <Text style={s.qrText}>{qr.icon ?? ''}{qr.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* 입력 */}
      <View style={s.inputRow}>
        <TextInput
          style={s.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="증상이나 원하는 진료를 입력하세요"
          placeholderTextColor="#9CA3AF"
          onSubmitEditing={() => sendMessage()}
          returnKeyType="send"
          editable={!loading}
        />
        <TouchableOpacity style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]} onPress={() => sendMessage()} disabled={!input.trim() || loading}>
          {loading ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  chatList: { padding: 16, paddingBottom: 8 },
  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  msgRowUser: { justifyContent: 'flex-end' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  bubble: { maxWidth: '78%', borderRadius: 16, padding: 12 },
  bubbleAgent: { backgroundColor: '#FFF', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  bubbleUser: { backgroundColor: '#4F46E5', borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, color: '#1F2937', lineHeight: 22 },
  bubbleTextUser: { color: '#FFF' },
  deptCard: { backgroundColor: '#F0F0FF', borderRadius: 10, padding: 10, marginTop: 8 },
  deptName: { fontSize: 14, fontWeight: '700', color: '#4F46E5' },
  deptReason: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  confBar: { height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  confFill: { height: '100%', backgroundColor: '#4F46E5', borderRadius: 2 },
  completeCard: { alignItems: 'center', backgroundColor: '#F0FDF4', borderRadius: 10, padding: 16, marginTop: 8 },
  completeTitle: { fontSize: 18, fontWeight: '800', color: '#065F46', marginTop: 6 },
  completeDetail: { fontSize: 14, color: '#374151', marginTop: 2 },
  chipContainer: { paddingHorizontal: 16, paddingBottom: 8 },
  chipTitle: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', marginBottom: 8 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  chipIcon: { fontSize: 16 },
  chipLabel: { fontSize: 13, color: '#374151' },
  qrContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  qrChip: { backgroundColor: '#EEF2FF', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#C7D2FE' },
  qrText: { fontSize: 13, color: '#4F46E5', fontWeight: '500' },
  inputRow: { flexDirection: 'row', padding: 12, gap: 8, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  textInput: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#E5E7EB' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4F46E5', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
