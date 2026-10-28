'use client';

import { useState, useRef, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface ChatMessage {
  role: string;
  content: string;
}

interface AgentSessionResponse {
  id: string;
  messages?: ChatMessage[];
}

interface AgentMessageResponse {
  response: string;
  state?: string;
  patient?: Record<string, unknown>;
  symptoms?: string | string[];
  department?: string;
}

export function AiReceptionChat({ onPatientFound, onSymptomDetected, onDeptSuggested, onNewPatient, autoInput }: {
  onPatientFound?: (p: Record<string, unknown>) => void;
  onSymptomDetected?: (s: string) => void;
  onDeptSuggested?: (d: string) => void;
  onNewPatient?: (name: string) => void; // 신환 인지 → 신규 등록 이관
  autoInput?: { q: string; ts: number } | null; // 환자 선택 검색어 자동 전달
}) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initError, setInitError] = useState(false);
  const [newPatientName, setNewPatientName] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAutoRef = useRef<string>('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.post<{ data: AgentSessionResponse }>('/api/v1/agent/session', { channel: 'HIS_RECEPTION' });
        setSessionId(res.data.id);
        const msgs = res.data.messages ?? [];
        setMessages(msgs.map((m: ChatMessage) => ({ role: m.role, content: m.content })));
      } catch {
        setInitError(true);
        // 🔴 AI 표기(AI기본법 §31)는 번역하지 않고 자리표시자로 끼운다
        toast.error(tfAttr('{출처} 접수 어시스턴트를 시작하지 못했습니다. 새로고침 후 다시 시도하세요.', { 출처: AI_ORIGIN_TEXT }));
      }
    })();
  }, []);

  const parseAiResponse = (response: string, resData: AgentMessageResponse) => {
    // 구조화 데이터 우선 — 대화 문장(prose)에서 증상/진료과를 긁어오지 않음(오염 방지)
    if (resData?.patient) { onPatientFound?.(resData.patient); setNewPatientName(null); }
    if (resData?.symptoms) onSymptomDetected?.(Array.isArray(resData.symptoms) ? resData.symptoms.join(', ') : resData.symptoms);
    if (resData?.department) onDeptSuggested?.(resData.department);

    // 신환 인지(원무 데스크) — '이름' 검색 결과 없음 → 신규 등록 이관 버튼 노출
    const newM = response.match(/'([가-힣]{2,4})'\s*검색\s*결과\s*없음/);
    if (newM && /신규 환자로 등록/.test(response)) setNewPatientName(newM[1]);
    else if (resData?.patient) setNewPatientName(null);

    // 구조화 patient가 없을 때만 프로즈 폴백(기존/신규 환자 MRN 추출)
    if (!resData?.patient) {
      const mrnMatch = response.match(/(?:기존 환자 발견|환자 등록 완료)[\s\S]*?([A-Z]{2,}-?[\dA-Z-]{4,}|P2026-\d{4})/);
      if (mrnMatch) {
        const mrn = mrnMatch[1];
        apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/patients`, { q: mrn, limit: 1 })
          .then(res => { if (res.data?.[0]) onPatientFound?.(res.data[0]); })
          .catch(() => {});
      }
    }
  };

  const sendMessage = async (msg: string) => {
    if (!msg.trim() || loading) return;
    if (!sessionId) { toast.error(tfAttr('{출처} 어시스턴트 세션이 없습니다. 새로고침 후 다시 시도하세요.', { 출처: AI_ORIGIN_TEXT })); return; }
    const text = msg.trim();
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const res = await apiClient.post<{ data: AgentMessageResponse }>(`/api/v1/agent/session/${sessionId}/message`, { message: text });
      setMessages(prev => [...prev, { role: 'agent', content: res.data.response }]);
      parseAiResponse(res.data.response, res.data);
      if (res.data.state === 'COMPLETED') toast.success(tAttr('접수가 완료되었습니다!'));
    } catch {
      setMessages(prev => [...prev, { role: 'agent', content: tAttr('오류가 발생했습니다.') }]);
    }
    setLoading(false);
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(msg);
  };

  // 환자 선택 검색어 자동 전달 → WeRU.B가 동명이인/신규 자동 인식
  useEffect(() => {
    const q = autoInput?.q?.trim();
    if (!q || !sessionId || loading) return;
    if (q === lastAutoRef.current) return;
    lastAutoRef.current = q;
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    void (async () => {
      try {
        const res = await apiClient.post<{ data: AgentMessageResponse }>(`/api/v1/agent/session/${sessionId}/message`, { message: q });
        setMessages(prev => [...prev, { role: 'agent', content: res.data.response }]);
        parseAiResponse(res.data.response, res.data);
      } catch {
        setMessages(prev => [...prev, { role: 'agent', content: tAttr('오류가 발생했습니다.') }]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInput?.ts]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  return (
    <div className="bg-white rounded-xl border border-indigo-200 shadow-sm" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="bg-indigo-600 px-4 py-3 flex items-center gap-2 rounded-t-xl" style={{ flexShrink: 0 }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
        <span className="text-white font-semibold text-sm"><Tf k="{출처} 접수 어시스턴트" params={{ 출처: AI_ORIGIN_TEXT }} /></span>
        <span className="text-white/50 text-xs"><T k="이름, 증상 자유 입력" /></span>
      </div>

      <div ref={scrollRef} className="p-4 space-y-3 bg-gray-50/50" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {messages.length === 0 && !initError && (
          <div className="text-center text-gray-400 text-xs py-8">
            <p className="mb-2"><T k="환자 정보를 자유롭게 입력하세요" /></p>
            {/* 🔴 예시 안의 사람 이름은 예시값이라 번역 대상이 아니다 — 문장 틀만 옮긴다 */}
            <p className="text-[11px]"><T k="예: 홍길동 고혈압 재진 / 머리가 아파요 / 진료카드 번호" /></p>
          </div>
        )}
        {initError && (
          <div className="text-center text-red-500 text-xs py-8">
            <p className="mb-1 font-medium"><Tf k="{출처} 접수 어시스턴트를 시작하지 못했습니다." params={{ 출처: AI_ORIGIN_TEXT }} /></p>
            <p className="text-[11px] text-red-400"><T k="잠시 후 페이지를 새로고침 해주세요." /></p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
              msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-800 border border-gray-200 shadow-sm'
            }`}>{msg.content}</div>
          </div>
        ))}
        {loading && <div className="text-xs text-gray-400 animate-pulse"><Tf k="{출처} 처리 중..." params={{ 출처: AI_ORIGIN_TEXT }} /></div>}
        {newPatientName && onNewPatient && (
          <div className="flex justify-start">
            <button
              onClick={() => { onNewPatient(newPatientName); setNewPatientName(null); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-300 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 transition-colors"
            >
              📝 &lsquo;{newPatientName}&rsquo; 신규 환자 등록하기 →
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 p-3 flex gap-2 rounded-b-xl bg-white" style={{ flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={tAttr(initError ? '어시스턴트 사용 불가' : '예: 김영수 고혈압 재진')} className="min-w-0 flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50" disabled={loading || initError} />
        <button onClick={send} disabled={loading || initError || !input.trim()} className="shrink-0 whitespace-nowrap px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"><T k="전송@버튼" /></button>
      </div>
    </div>
  );
}
