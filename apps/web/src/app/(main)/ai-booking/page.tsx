'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/**
 * 빠른 입력 칩 — 누르면 **입력창에 들어가 AI 에게 보내는 문장**이다(전송값). 번역하지 않는다(i18n ops12 의도적 미등재).
 * 표시 언어를 바꿨다고 상담 요청 문장이 바뀌면 사용자가 보낸 것과 화면이 보여준 것이 달라진다.
 */
const QUICK_PROMPTS = ['두통이 심해요', '감기 증상이에요', '건강검진 예약', '피부 트러블', '허리가 아파요'];

interface Department {
  id: string;
  name: string;
  slug?: string;
}

interface Doctor {
  id: string;
  familyName?: string;
  givenName?: string;
  department?: string;
  specialty?: string;
}

interface AiSuggestion {
  department?: string;
  doctors?: string[];
  urgency?: string;
  reason?: string;
  suggestedDate?: string;
  suggestedTime?: string;
}

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
  suggestion?: AiSuggestion;
  /** 출처 3상태(서버 보고값). 미보고(undefined)면 배지를 붙이지 않는다 — 모르는 것을 AI 라 단정하지 않는다 */
  source?: 'AI' | 'FALLBACK' | 'UNAVAILABLE';
}

export default function AiBookingPage() {
  // 화면이 스스로 만드는 안내 문장(인사·연결 오류)만 번역한다 — 서버 답변(reply)은 번역하지 않는다
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [step, setStep] = useState<'chat' | 'confirm' | 'done'>('chat');
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ai', content: tfAttr('안녕하세요! {AI표기} 예약 도우미입니다. 어떤 증상이나 진료과를 원하시나요?', { AI표기: AI_ORIGIN_TEXT }) },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<AiSuggestion | null>(null);
  // AI 추천 진료과는 **초안**이다 — 확정 전 사람이 원내 진료과 목록에서 고칠 수 있어야 한다
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 진료과 목록 — 예약 확인 단계의 진료과 선택에 쓴다(포털 예약 `_care/CareTab` 과 같은 정본·같은 계약).
  // 🔴 AI 가 말한 진료과 문자열이 원내 진료과와 다르면 가용 슬롯 조회가 빈 결과를 돌려주고
  //    화면은 "가용 슬롯이 없습니다" 라고 **원인을 바꿔서** 말한다 → 사람이 고를 수 있게 한다.
  const { data: deptData, isError: deptIsError, error: deptError, refetch: refetchDepts } = useQuery({
    queryKey: ['departments-public'],
    queryFn: () => apiClient.get<{ data: Department[] }>('/api/v1/public/departments'),
  });
  const departments: Department[] = (() => {
    const d = deptData?.data;
    return Array.isArray(d) ? d : (d as Record<string, unknown> | undefined)?.data as Department[] ?? [];
  })();
  const deptNames: string[] = departments.map((d) => d.name).filter(Boolean);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      // WeRU.B 예약 상담 API 호출
      const res = await apiClient.post<{ data: { reply: string; suggestion?: AiSuggestion } }>('/api/v1/concierge/chat', {
        message: userMsg,
        patientId,
        context: 'booking',
      });

      const data = res.data as Record<string, unknown>;
      const reply = (data?.reply as string) ?? (data?.data as Record<string, unknown>)?.reply as string ?? tAttr('죄송합니다. 다시 말씀해 주세요.');
      const suggestion = (data?.suggestion as AiSuggestion) ?? (data?.data as Record<string, unknown>)?.suggestion as AiSuggestion ?? undefined;
      const rawSource = (data?.source ?? (data?.data as Record<string, unknown>)?.source) as string | undefined;
      const source = rawSource === 'AI' || rawSource === 'FALLBACK' || rawSource === 'UNAVAILABLE' ? rawSource : undefined;

      setMessages(prev => [...prev, { role: 'ai', content: reply, suggestion, source }]);
      if (suggestion) setSelectedSuggestion(suggestion);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', content: tAttr('연결에 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.') }]);
    }
    setLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const confirmBooking = async () => {
    if (!patientId || !selectedDept || !selectedDate) {
      toast.error(tAttr('환자, 진료과, 날짜를 선택해 주세요.'));
      return;
    }
    setLoading(true);
    try {
      // 가용 슬롯 조회 → 요청 시간 또는 첫 가용 슬롯 확정(부하분산 자동배정)
      const avail = await apiClient.get<{ data: { sessions: { doctorId: string; closed: boolean; slots: { start: string; available: boolean }[] }[] } }>(
        `/api/v1/appointments/availability?departmentName=${encodeURIComponent(selectedDept)}&date=${selectedDate}`,
      );
      const sessions = avail?.data?.sessions ?? [];
      let scheduledAt: string | null = null;
      if (selectedTime) {
        const wanted = new Date(`${selectedDate}T${selectedTime}:00+09:00`).toISOString();
        for (const s of sessions) if (!s.closed) for (const sl of s.slots) if (sl.available && sl.start === wanted) scheduledAt = sl.start;
      }
      if (!scheduledAt) {
        for (const s of sessions) {
          if (s.closed) continue;
          const first = s.slots.find((sl) => sl.available);
          if (first) { scheduledAt = first.start; break; }
        }
      }
      if (!scheduledAt) {
        toast.error(tAttr('해당 날짜에 가용 슬롯이 없습니다. 다른 날짜를 선택하세요.'));
        setLoading(false);
        return;
      }
      await apiClient.post('/api/v1/appointments', {
        patientId,
        departmentName: selectedDept, // doctorId 생략 → 부하분산 자동배정
        scheduledAt,
        reason: selectedSuggestion?.reason ?? '예약',
        bookedVia: 'AI',
      });
      toast.success(tAttr('예약이 완료되었습니다!'));
      setStep('done');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tAttr('예약 생성 실패'));
    }
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">🤖 <Tf k="{AI표기} 예약 도우미" params={{ AI표기: AI_ORIGIN_TEXT }} /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="증상을 설명하면 적합한 진료과와 일정을 추천해 드립니다" /></p>
      </div>

      {/* Patient Selection */}
      {!patientId && (
        <div className="bg-white rounded-2xl border shadow-sm p-6 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3"><T k="환자 선택" /></h3>
          <PatientSelector
            onChange={(id, p) => { if (id) { setPatientId(id); setPatientName(`${p.familyName}${p.givenName}`); } }}
            context="schedule"
            autoFocus
          />
        </div>
      )}

      {patientId && step === 'chat' && (
        <>
          {/* Chat Messages */}
          <div className="bg-white rounded-2xl border shadow-sm p-4 mb-4 h-[400px] overflow-y-auto">
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                    {msg.role === 'ai' && msg.source === 'FALLBACK' && (
                      <p className="mt-1 text-[11px] text-amber-700" data-origin="FALLBACK"><Tf k="{AI표기} 미응답 · 규칙 기반 답변" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
                    )}
                    {msg.role === 'ai' && msg.source === 'UNAVAILABLE' && (
                      <p className="mt-1 text-[11px] text-gray-500" data-origin="UNAVAILABLE"><Tf k="{AI표기} 응답을 받지 못했습니다" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
                    )}
                    {msg.suggestion && (
                      <div className="mt-2 bg-white/90 rounded-xl p-3 space-y-1">
                        <p className="text-xs font-bold text-blue-700"><Tf k="{AI표기} 추천" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
                        {/* 값(진료과·긴급도·추천일)은 AI 응답 원문 — 번역하지 않는다 */}
                        {msg.suggestion.department && <p className="text-xs"><Tf k="진료과: {진료과}" params={{ 진료과: <strong>{msg.suggestion.department}</strong> }} /></p>}
                        {msg.suggestion.urgency && <p className="text-xs"><Tf k="긴급도: {값}" params={{ 값: msg.suggestion.urgency }} /></p>}
                        {msg.suggestion.suggestedDate && <p className="text-xs"><Tf k="추천일: {날짜}" params={{ 날짜: msg.suggestion.suggestedDate }} /></p>}
                        <button onClick={() => { setSelectedSuggestion(msg.suggestion!); setSelectedDept(msg.suggestion!.department ?? ''); setSelectedDate(msg.suggestion!.suggestedDate ?? ''); setStep('confirm'); }}
                          className="mt-1 px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium"><T k="이 추천으로 예약" /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-2.5 animate-pulse">
                    <p className="text-sm text-gray-400"><Tf k="{AI표기}가 답변을 준비하고 있습니다..." params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={tAttr('증상이나 원하는 진료과를 말씀해 주세요...')}
              className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
            <button onClick={sendMessage} disabled={loading || !input.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
              <T k="전송" />
            </button>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {QUICK_PROMPTS.map(q => (
              <button key={q} onClick={() => { setInput(q); }}
                className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full text-xs hover:bg-gray-200">{q}</button>
            ))}
          </div>
        </>
      )}

      {/* Confirm Step */}
      {step === 'confirm' && selectedSuggestion && (
        <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
          <h3 className="text-lg font-bold text-gray-900"><T k="예약 확인" /></h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자" /></label>
              <p className="text-sm font-semibold">{patientName}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="ai-booking-dept"><T k="진료과" /></label>
              <select
                id="ai-booking-dept"
                value={selectedDept}
                onChange={e => setSelectedDept(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="">{tAttr('진료과 선택')}</option>
                {deptNames.map(d => <option key={d} value={d}>{d}</option>)}
                {/* AI 가 말한 진료과가 목록에 없으면 **버리지 않고** 그 사실과 함께 남긴다 */}
                {selectedDept && !deptNames.includes(selectedDept) && (
                  <option value={selectedDept}>{tfAttr('{진료과} (AI 추천 · 원내 진료과 목록에 없음)', { 진료과: selectedDept })}</option>
                )}
              </select>
              {selectedSuggestion.department && (
                <p className="mt-1 text-[11px] text-gray-400"><Tf k="{AI표기} 추천: {진료과}" params={{ AI표기: AI_ORIGIN_TEXT, 진료과: selectedSuggestion.department }} /></p>
              )}
              {deptIsError && (
                <div className="mt-1">
                  <QueryErrorFallback error={deptError} onRetry={() => refetchDepts()} size="compact" />
                  <p className="mt-1 text-[11px] text-amber-700"><Tf k="진료과 목록을 불러오지 못해 {AI표기} 추천값만 고를 수 있습니다." params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
                </div>
              )}
              {!deptIsError && selectedDept && !deptNames.includes(selectedDept) && deptNames.length > 0 && (
                <p className="mt-1 text-[11px] text-amber-700">
                  <T k="추천 진료과가 원내 진료과 목록에 없습니다 — 그대로 예약하면 가용 시간이 조회되지 않습니다." />
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="예약 날짜" /></label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="예약 시간" /></label>
              <input type="time" value={selectedTime} onChange={e => setSelectedTime(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          {selectedSuggestion.reason && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs text-blue-700">{selectedSuggestion.reason}</p>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep('chat')} className="flex-1 py-2.5 bg-gray-100 rounded-xl text-sm"><T k="돌아가기" /></button>
            <button onClick={confirmBooking} disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
              {loading ? <T k="예약 중..." /> : <T k="예약 확정" />}
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h3 className="text-xl font-bold text-gray-900 mb-2"><T k="예약이 완료되었습니다" /></h3>
          <p className="text-sm text-gray-500 mb-6">{patientName} · {selectedDept} · {selectedDate}</p>
          <button onClick={() => { setStep('chat'); setMessages([{ role: 'ai', content: tAttr('다른 예약도 도와드릴까요?') }]); setSelectedSuggestion(null); setSelectedDept(''); setSelectedDate(''); setSelectedTime(''); }}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium"><T k="새 예약" /></button>
        </div>
      )}
    </div>
  );
}
