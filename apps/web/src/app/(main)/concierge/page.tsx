'use client';

import { useState, useRef, useEffect } from 'react';
import { kdate } from '@/lib/ui-settings';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 출처 3상태(서버 정본 `concierge.service.ts`) — 규칙이 답한 것을 AI 답변으로 그리지 않는다.
 *    (2026-09-09 P0-C R7: LLM 2단이 모두 실패하면 keywordFallback 이 규칙 문구를 돌려주는데 응답에 그 사실이 없었다.)
 *    `source` 가 없는 응답(옛 서버·이력 메시지)은 **AI 라고 단정하지 않는다** — 아무 배지도 붙이지 않는다.
 */
type MsgSource = 'AI' | 'FALLBACK' | 'UNAVAILABLE';

/** 값은 i18n 키 — `{AI표기}` 자리에 AI 표기(번역하지 않는 브랜드 표기)를 넣어 `<Tf>` 로 그린다 */
const ORIGIN_REASON_TEXT: Record<string, string> = {
  LLM_UNAVAILABLE: '{AI표기} 미응답 · 규칙 기반 답변',
  RULE_SAFETY: '규칙 기반 안전 안내(AI 답변 아님)',
  RULE_NO_INPUT: '규칙 기반 안내(AI 답변 아님)',
};

function OriginBadge({ source, reason }: { source?: MsgSource; reason?: string | null }) {
  if (!source || source === 'AI') return null; // 모르는 것(미보고)과 AI 를 구분: 미보고면 아무 말도 하지 않는다
  const key = (reason && ORIGIN_REASON_TEXT[reason])
    ?? (source === 'UNAVAILABLE' ? '{AI표기} 응답 불가' : '{AI표기} 미응답 · 규칙 기반 답변');
  return (
    <p data-msg-source={source} className="text-[10px] mt-1 text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 inline-block">
      <Tf k={key} params={{ AI표기: AI_ORIGIN_TEXT }} />
    </p>
  );
}

/** 환자 정보 탭 라벨(i18n 키) */
const INFO_TABS = ['진료', '약품', '예약', '바이탈'];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  source?: MsgSource;
  reason?: string | null;
}

interface Session {
  id: string;
  patientId: string;
  status: string;
  messages: Message[];
  createdAt: string;
}

export default function ConciergePage() {
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientName, setSelectedPatientName] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'info'>('chat');
  const [ratingOpen, setRatingOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  // 만족도 통계 (메인 쿼리)
  const { data: statsRes, isError, error, refetch: refetchStats } = useQuery({
    queryKey: ['concierge-stats'],
    queryFn: () => apiClient.get<any>('/api/v1/concierge/ratings/stats'),
  });

  // 환자 검색
  const { data: patientsRes } = useQuery({
    queryKey: ['concierge-patients', patientSearch],
    queryFn: () => apiClient.get<any>('/api/v1/patients', { q: patientSearch, limit: 10 }),
    enabled: patientSearch.length >= 1,
  });
  const patients = patientsRes?.data ?? [];

  // 환자 정보 조회
  const { data: encountersRes } = useQuery({
    queryKey: ['concierge-encounters', selectedPatientId],
    queryFn: () => apiClient.get<any>('/api/v1/concierge/encounters', { patientId: selectedPatientId! }),
    enabled: !!selectedPatientId,
  });
  const { data: medsRes } = useQuery({
    queryKey: ['concierge-meds', selectedPatientId],
    queryFn: () => apiClient.get<any>('/api/v1/concierge/medications', { patientId: selectedPatientId! }),
    enabled: !!selectedPatientId,
  });
  const { data: apptRes } = useQuery({
    queryKey: ['concierge-appt', selectedPatientId],
    queryFn: () => apiClient.get<any>('/api/v1/concierge/appointments', { patientId: selectedPatientId! }),
    enabled: !!selectedPatientId,
  });
  const { data: vitalsRes } = useQuery({
    queryKey: ['concierge-vitals', selectedPatientId],
    queryFn: () => apiClient.get<any>('/api/v1/concierge/vitals', { patientId: selectedPatientId! }),
    enabled: !!selectedPatientId,
  });

  // 세션 생성
  const createSession = useMutation({
    mutationFn: (patientId: string) =>
      apiClient.post<any>('/api/v1/concierge/sessions', { patientId }),
    onSuccess: (res) => {
      setSessionId(res.data?.id ?? res.data?.sessionId);
      setMessages([]);
      toast.success(tAttr('컨시어지 세션이 시작되었습니다.'));
    },
    onError: () => toast.error(tAttr('세션 생성 실패')),
  });

  // 메시지 전송
  const sendMessage = useMutation({
    mutationFn: (content: string) =>
      apiClient.post<any>(`/api/v1/concierge/sessions/${sessionId}/messages`, {
        patientId: selectedPatientId,
        content,
      }),
    onSuccess: (res) => {
      const aiReply = res.data?.reply ?? res.data?.content ?? res.data?.message ?? '';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: aiReply,
          timestamp: new Date().toISOString(),
          // 출처는 서버가 정한다(FE 가 추정하지 않는다)
          source: res.data?.source as MsgSource | undefined,
          reason: (res.data?.reason ?? null) as string | null,
        },
      ]);
    },
    onError: () => toast.error(tAttr('메시지 전송 실패')),
  });

  // 세션 종료
  const closeSession = useMutation({
    mutationFn: () =>
      apiClient.patch(`/api/v1/concierge/sessions/${sessionId}/close`, {
        patientId: selectedPatientId,
      }),
    onSuccess: () => {
      toast.success(tAttr('세션이 종료되었습니다.'));
      setRatingOpen(true);
    },
    onError: () => toast.error(tAttr('세션 종료 실패')),
  });

  // 평가
  const rateSession = useMutation({
    mutationFn: () =>
      apiClient.patch(`/api/v1/concierge/sessions/${sessionId}/rate`, {
        patientId: selectedPatientId,
        rating,
        comment: ratingComment,
      }),
    onSuccess: () => {
      toast.success(tAttr('평가가 등록되었습니다.'));
      setRatingOpen(false);
      setSessionId(null);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: ['concierge-stats'] });
    },
    onError: () => toast.error(tAttr('평가 등록 실패')),
  });

  // 자동 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !sessionId) return;
    const content = input.trim();
    setMessages((prev) => [...prev, { role: 'user', content, timestamp: new Date().toISOString() }]);
    setInput('');
    sendMessage.mutate(content);
  };

  const selectPatient = (p: any) => {
    setSelectedPatientId(p.id);
    setSelectedPatientName(`${p.familyName}${p.givenName}`);
    setPatientSearch('');
  };

  const stats = statsRes?.data;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetchStats} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><Tf k="{AI표기} 컨시어지" params={{ AI표기: AI_ORIGIN_TEXT }} /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><Tf k="환자 맞춤 {AI표기} 안내 서비스" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span><Tf k="평균 만족도 {점수}" params={{ 점수: <strong className="text-blue-600">{stats.average?.toFixed(1) ?? '-'}<Unit>점</Unit></strong> }} /></span>
            <span><Tf k="총 {수}" params={{ 수: <>{stats.total ?? 0}<Unit>건</Unit></> }} /></span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 좌측: 환자 선택 + 정보 */}
        <div className="space-y-4">
          {/* 환자 검색 */}
          <div className="bg-white border rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3"><T k="환자 선택" /></h3>
            <div className="relative">
              <input
                type="text"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                placeholder={tAttr('이름 또는 MRN으로 검색...')}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {patients.length > 0 && patientSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                  {patients.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => selectPatient(p)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0"
                    >
                      <span className="font-medium">{p.familyName}{p.givenName}</span>
                      <span className="text-gray-400 ml-2">{p.mrn}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedPatientId && (
              <div className="mt-3 p-3 bg-blue-50 rounded-xl">
                <p className="text-sm font-semibold text-blue-800">{selectedPatientName}</p>
                {!sessionId ? (
                  <button
                    onClick={() => createSession.mutate(selectedPatientId)}
                    disabled={createSession.isPending}
                    className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createSession.isPending ? <T k="세션 생성 중..." /> : <T k="세션 시작" />}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium"><T k="세션 활성" /></span>
                    <button
                      onClick={() => closeSession.mutate()}
                      className="px-3 py-1.5 bg-red-100 text-red-700 rounded-xl text-xs font-medium hover:bg-red-200"
                    >
                      <T k="세션 종료" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 환자 정보 탭 */}
          {selectedPatientId && (
            <div className="bg-white border rounded-2xl p-4">
              <div className="flex gap-1 mb-3">
                {INFO_TABS.map((t, i) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(i === 0 ? 'info' : 'info')}
                    className="px-2 py-1 text-[10px] font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    <T k={t} />
                  </button>
                ))}
              </div>

              {/* 진료 이력 */}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {(encountersRes?.data ?? []).slice(0, 5).map((e: any, i: number) => (
                  <div key={i} className="p-2 bg-gray-50 rounded-lg text-xs">
                    <p className="font-medium text-gray-700">{e.department ?? e.type ?? <T k="진료" />}</p>
                    <p className="text-gray-400">{e.date ?? e.createdAt ?? '-'}</p>
                  </div>
                ))}
                {(medsRes?.data ?? []).slice(0, 3).map((m: any, i: number) => (
                  <div key={`med-${i}`} className="p-2 bg-teal-50 rounded-lg text-xs">
                    <p className="font-medium text-teal-700">{m.name ?? m.medicationName ?? '-'}</p>
                    <p className="text-teal-400">{m.dosage ?? ''} {m.frequency ?? ''}</p>
                  </div>
                ))}
                {(apptRes?.data ?? []).slice(0, 3).map((a: any, i: number) => (
                  <div key={`appt-${i}`} className="p-2 bg-amber-50 rounded-lg text-xs">
                    <p className="font-medium text-amber-700">{a.department ?? a.type ?? <T k="예약" />}</p>
                    <p className="text-amber-400">{a.date ?? a.scheduledAt ?? '-'}</p>
                  </div>
                ))}
                {(vitalsRes?.data ?? []).slice(0, 3).map((v: any, i: number) => (
                  <div key={`vital-${i}`} className="p-2 bg-rose-50 rounded-lg text-xs">
                    {/* 표시 부품 정본 — 미측정 '—'·단위·임계 정본 색(systolic/diastolic 별칭은 부품이 읽는다) */}
                    <p className="font-medium"><VitalSignsStrip vitals={v} keys={['systolicBp', 'heartRate', 'temperature']} /></p>
                    <p className="text-rose-400">{v.recordedAt ?? v.date ?? '-'}</p>
                  </div>
                ))}
                {!encountersRes?.data?.length && !medsRes?.data?.length && !apptRes?.data?.length && (
                  <p className="text-xs text-gray-400 text-center py-4"><T k="정보 없음" /></p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 우측: 채팅 영역 */}
        <div className="lg:col-span-2 bg-white border rounded-2xl flex flex-col" style={{ minHeight: 500 }}>
          {/* 채팅 헤더 */}
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900">
                {selectedPatientName ? <Tf k="{환자} 컨시어지" params={{ 환자: selectedPatientName }} /> : <Tf k="{AI표기} 컨시어지 채팅" params={{ AI표기: AI_ORIGIN_TEXT }} />}
              </h3>
              <p className="text-[10px] text-gray-400">
                {sessionId ? <T k="세션 활성 중" /> : <T k="환자를 선택하고 세션을 시작하세요" />}
              </p>
            </div>
          </div>

          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {!sessionId && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-5xl mb-4">🤖</div>
                  <p className="text-gray-400 text-sm"><T k="환자를 선택하고 세션을 시작하세요" /></p>
                  <p className="text-gray-300 text-xs mt-1"><T k="진료 안내, 검사 결과 문의, 예약 확인 등을 도와드립니다" /></p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-800 rounded-bl-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === 'assistant' && <OriginBadge source={msg.source} reason={msg.reason} />}
                  {msg.timestamp && (
                    <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                      {kdate(msg.timestamp, 'time')}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {sendMessage.isPending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-md">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* 입력 */}
          <div className="px-5 py-3 border-t">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder={sessionId ? tAttr('메시지를 입력하세요...') : tAttr('세션을 먼저 시작하세요')}
                disabled={!sessionId}
                className="flex-1 border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <button
                onClick={handleSend}
                disabled={!sessionId || !input.trim() || sendMessage.isPending}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <T k="전송" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 평가 모달 */}
      {ratingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRatingOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4"><T k="서비스 만족도 평가" /></h3>
            <div className="flex justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`text-3xl transition-transform ${n <= rating ? 'scale-110' : 'opacity-30'}`}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-gray-500 mb-4">{rating}<Unit>점</Unit></p>
            <textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder={tAttr('의견을 남겨주세요 (선택)')}
              className="w-full border rounded-xl px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setRatingOpen(false); setSessionId(null); setMessages([]); }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"
              >
                <T k="건너뛰기" />
              </button>
              <button
                onClick={() => rateSession.mutate()}
                disabled={rateSession.isPending}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <T k="평가 등록" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
