import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TextInput, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';
import { LoadingState } from '../../src/components/common/LoadingState';
import { EmptyState } from '../../src/components/common/EmptyState';
import { formatRelativeTime } from '../../src/lib/format';

export default function MessagesScreen() {
  const queryClient = useQueryClient();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['portal-messages'],
    queryFn: () => apiClient.get('/api/v1/portal/messages'),
  });

  const sendReply = useMutation({
    // 🔴 (2026-09-14) 서버 DTO 는 `messageId` 다 — 종전 `parentId` 는 전역 whitelist 가 지우고 IsNotEmpty 로 400 이었다(답장 전건 실패).
    mutationFn: (body: { messageId: string; content: string }) =>
      apiClient.post('/api/v1/portal/messages/reply', body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['portal-messages'] }); setReplyTo(null); setReplyText(''); },
  });

  const messages: any[] = (data as any)?.data ?? [];

  if (isLoading) return <LoadingState />;

  const renderItem = ({ item }: { item: any }) => (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.avatarCircle}>
          <Ionicons name="person" size={16} color="#4F46E5" />
        </View>
        <View style={s.cardBody}>
          {/* 🔴 종전 `a ?? b ? c : d` 는 `(a ?? b) ? c : d` 로 묶여, senderName 이 있는 메시지에서
              오히려 sender 객체를 읽어 "undefinedundefined" 를 그렸다(연산자 우선순위). */}
          {/* 🔴 (2026-09-14) `sender` 는 'PATIENT'|'DOCTOR' 문자열이다 — 종전은 객체로 읽어 **환자 본인이 보낸 메시지도 '담당의'** 로 그렸다.
              이제 의사 답변이 실제로 오므로(직원 측 수신처 신설) 누가 보냈는지를 사실대로 그린다. */}
          <Text style={s.senderName}>
            {item.sender === 'PATIENT'
              ? '나'
              : item.doctor?.familyName
                ? `${item.doctor.familyName}${item.doctor.givenName ?? ''} 선생님`
                : '담당의'}
          </Text>
          <Text style={s.messageTime}>{item.createdAt ? formatRelativeTime(item.createdAt) : ''}</Text>
        </View>
      </View>
      <Text style={s.messageText}>{item.content ?? item.message}</Text>

      {replyTo === item.id ? (
        <View style={s.replyBox}>
          <TextInput style={s.replyInput} value={replyText} onChangeText={setReplyText} placeholder="답장 입력..." placeholderTextColor="#9CA3AF" multiline />
          <View style={s.replyActions}>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Text style={s.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.sendBtn, !replyText.trim() && s.sendBtnDisabled]}
              disabled={!replyText.trim()}
              onPress={() => sendReply.mutate({ messageId: item.id, content: replyText.trim() })}
            >
              <Ionicons name="send" size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={s.replyBtn} onPress={() => setReplyTo(item.id)}>
          <Ionicons name="return-down-forward-outline" size={14} color="#4F46E5" />
          <Text style={s.replyBtnText}>답장</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '담당의 메시지', headerShown: true }} />
      <FlatList
        contentContainerStyle={messages.length === 0 ? s.empty : s.list}
        data={messages}
        keyExtractor={(item, i) => item.id ?? String(i)}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        ListEmptyComponent={<EmptyState icon="chatbubble-outline" message="담당의로부터 메시지가 없습니다" />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  list: { padding: 16, paddingBottom: 32 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  avatarCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center' },
  cardBody: { flex: 1 },
  senderName: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  messageTime: { fontSize: 11, color: '#9CA3AF' },
  messageText: { fontSize: 14, color: '#374151', lineHeight: 21 },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-end' },
  replyBtnText: { fontSize: 12, color: '#4F46E5', fontWeight: '600' },
  replyBox: { marginTop: 10, backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10 },
  replyInput: { fontSize: 14, color: '#1F2937', minHeight: 50 },
  replyActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 8 },
  cancelText: { fontSize: 13, color: '#6B7280' },
  sendBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#4F46E5', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
