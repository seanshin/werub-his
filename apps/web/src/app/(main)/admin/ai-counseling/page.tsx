'use client';

import { useState, useRef, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 W8-R6/E — 상담 위기감지 실패가 "위기 없음"으로 뒤바뀌던 화면.
 * 서버가 `res.ok` 를 검사하지 않아 상류 502 의 에러 본문이 그대로 내려왔고, 거기엔 `is_crisis` 가 없어
 * `undefined`(falsy) → **위기 배너 미표시 + 빈 말풍선**이 되었다. 자살위험 상담에서 실패가 안전으로 downgrade.
 *   → 서버가 실패를 503 으로 올리고, 200 이어도 상류가 판정하지 않았으면 `crisis_assessed=false` 를 내린다.
 *   → 이 화면은 ①판정된 위기 ②**판정 불가** ③실패 를 각각 다르게 말한다(모르면 "없음"이라 하지 않는다).
 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** true=위기 판정 · false=위기 아님 · null/undefined=판정 불가 */
  is_crisis?: boolean | null;
  crisis_assessed?: boolean;
  failed?: boolean;
  pipeline?: { quality?: { risk_band?: string } };
}

export default function AiCounselingPage() {
  const tAttr = useTAttr();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await apiClient.fetch<{ data: { message?: string; session_id?: string; is_crisis?: boolean | null; crisis_assessed?: boolean; pipeline?: { quality?: { risk_band?: string } } } }>('/api/v1/ai/counseling/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, session_id: sessionId }),
      });
      if (res.data?.session_id) setSessionId(res.data.session_id);
      const content = typeof res.data?.message === 'string' ? res.data.message.trim() : '';
      setMessages(prev => [...prev, {
        role: 'assistant',
        // 🔴 빈 말풍선 금지 — 본문이 없으면 "응답 본문 없음"이라 말한다.
        content: content || '(상담 응답 본문이 비어 있습니다 — 내용 없음)',
        is_crisis: res.data?.is_crisis ?? null,
        crisis_assessed: res.data?.crisis_assessed === true,
        failed: !content,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `상담 ${AI_ORIGIN_TEXT} 연결에 실패했습니다 — ${e instanceof Error ? e.message : '원인 미상'}`,
        is_crisis: null,
        crisis_assessed: false,
        failed: true,
      }]);
    }
    setLoading(false);
  };

  const handleNewSession = () => {
    setMessages([]);
    setSessionId(null);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{AI_ORIGIN_TEXT} 상담 어시스턴트</h1>
          <p className="text-sm text-gray-500 mt-1"><T k="mindwell + qwen 오케스트레이션 (위기 감지 내장)" /></p>
        </div>
        <button onClick={handleNewSession} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
          <T k="새 상담" />
        </button>
      </div>

      {/* 채팅 영역 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm min-h-[500px] max-h-[600px] flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <p className="text-4xl mb-3">🧠</p>
              <p className="text-sm text-gray-500"><T k="환자 상담을 시작하세요" /></p>
              <p className="text-xs text-gray-400 mt-1">CBT/마인드풀니스 기반 {AI_ORIGIN_TEXT} 상담 + 위기 자동 감지</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.role === 'assistant' && msg.is_crisis === true && (
                  <div className="mt-2 p-2 bg-red-100 rounded-lg text-xs text-red-700 font-medium">
                    ⚠️ <T k="위기 감지 — 자살예방상담전화 1393" />
                  </div>
                )}
                {/* 🔴 판정 불가를 "위기 없음"으로 표시하지 않는다(P1) */}
                {msg.role === 'assistant' && msg.crisis_assessed === false && (
                  <div className="mt-2 p-2 bg-amber-100 rounded-lg text-xs text-amber-800 font-medium">
                    ⚠️ 위기 여부 <strong>판단 불가</strong> — 자동 위기 감지가 동작하지 않았습니다.
                    <span className="block font-normal mt-0.5">
                      <T k="상담자가 직접 위험도를 확인하세요. 위기 의심 시 자살예방상담전화 1393." />
                    </span>
                  </div>
                )}
                {msg.pipeline?.quality?.risk_band && msg.pipeline.quality.risk_band !== 'low' && (
                  <p className="text-[10px] mt-1 opacity-60">risk: {msg.pipeline.quality.risk_band}</p>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-3">
                <div className="flex gap-1"><span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" /><span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} /><span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} /></div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 입력 */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={tAttr('상담 내용을 입력하세요...')}
              className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm" disabled={loading} />
            <button onClick={handleSend} disabled={loading || !input.trim()}
              className="px-6 py-3 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-30">
              <T k="전송@버튼" />
            </button>
          </div>
          {sessionId && <p className="text-[10px] text-gray-400 mt-1"><T k="세션:" /> {sessionId.slice(0, 8)}...</p>}
        </div>
      </div>

      <div className="bg-amber-50 rounded-2xl p-3 border border-amber-200">
        <p className="text-xs text-amber-700">{AI_ORIGIN_TEXT} 상담은 보조 도구입니다. 전문 상담이 필요한 경우 정신건강의학과 전문의 또는 자살예방상담전화(1393)를 이용하세요.</p>
      </div>
    </div>
  );
}
