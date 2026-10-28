'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { subscribeSseSignal } from '@/lib/sse-signal';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { PT, usePortalTAttr } from '../_shared/PT';

interface Msg { id?: string; sender: string; content: string; attachmentUrl?: string | null; createdAt?: string }
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const LANGS: { v: string; l: string }[] = [
  { v: 'ko', l: '한국어' }, { v: 'en', l: 'English' }, { v: 'zh', l: '中文' }, { v: 'ja', l: '日本語' },
];
const PLACEHOLDER: Record<string, string> = {
  ko: '메시지를 입력하세요…', en: 'Type a message…', zh: '请输入消息…', ja: 'メッセージを入力…',
};
const TITLE: Record<string, string> = { ko: '상담실', en: 'Consultation', zh: '咨询室', ja: '相談室' };
const WELCOME: Record<string, string> = {
  ko: '안녕하세요! 예약·수납·검진·증명 등 무엇이든 문의해 주세요.',
  en: 'Hello! Ask us anything — appointments, billing, check-ups, certificates.',
  zh: '您好！预约、缴费、体检、证明等都可以咨询。',
  ja: 'こんにちは！予約・会計・健診・証明など何でもご相談ください。',
};
const OFFLINE: Record<string, string> = {
  ko: '상담 운영시간(평일 09:00~18:00)이 아닙니다. 남겨주시면 확인 후 안내드립니다.',
  en: 'Outside business hours (Mon–Fri 09:00–18:00). Leave a message and we will reply.',
  zh: '非咨询时间（工作日09:00~18:00）。留言后我们会回复您。',
  ja: '相談時間外（平日09:00~18:00）です。メッセージを残していただければ後ほどご案内します。',
};
const WAITING: Record<string, string> = {
  ko: '상담원 연결 대기 중 (앞 {n}명)',
  en: 'Waiting for an agent ({n} ahead)',
  zh: '正在等待客服（前面 {n} 位）',
  ja: '相談員の対応待ち（あと{n}人）',
};

/** 포털 도움 버튼이 상담실을 여는 신호 */
export const PORTAL_OPEN_CONSULT = 'portal:open-consult';

export default function ConsultChat() {
  const tAttr = usePortalTAttr();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(PORTAL_OPEN_CONSULT, onOpen);
    return () => window.removeEventListener(PORTAL_OPEN_CONSULT, onOpen);
  }, []);
  const [locale, setLocale] = useState('ko');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [rated, setRated] = useState(false);
  const [online, setOnline] = useState(true);
  const [waitPos, setWaitPos] = useState(0);
  const [assigned, setAssigned] = useState(false);
  const [liveAvailable, setLiveAvailable] = useState(true);
  /**
   * 🔴 (2026-10-22 포털 A6) 연결 문제를 말한다 — 종전엔 상담 시작 실패·이전 대화 조회 실패·화상 연결 실패를 전부 삼켰다.
   *    세션이 없으면 입력해도 아무 일도 일어나지 않는 막다른 길이었고, 대화 조회 실패는 "대화 없음"으로 보였다.
   */
  const [connIssue, setConnIssue] = useState<'SESSION' | 'MESSAGES' | 'VIDEO' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const JITSI = process.env.NEXT_PUBLIC_JITSI_URL || '/meet';

  const checkStatus = async () => {
    if (!sessionId) return;
    try {
      const r = await apiClient.get<{ data: { status: string; rating?: number; serviceOnline?: boolean; waitingPosition?: number; assigned?: boolean; liveAvailable?: boolean } }>(`/api/v1/portal/consult/${sessionId}`);
      setClosed(r.data?.status === 'CLOSED');
      setRated(!!r.data?.rating);
      setOnline(r.data?.serviceOnline !== false);
      setWaitPos(r.data?.waitingPosition ?? 0);
      setAssigned(!!r.data?.assigned);
      setLiveAvailable(r.data?.liveAvailable !== false);
    } catch { /* */ }
  };

  const uploadAttachment = async (file: File) => {
    if (!sessionId) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      await fetch(`${API_BASE}/api/v1/portal/consult/${sessionId}/attachment`, { method: 'POST', headers: { Authorization: `Bearer ${apiClient.getToken()}` }, body: fd });
    } catch { /* */ }
  };

  const rate = async (n: number) => {
    if (!sessionId) return;
    try { await apiClient.post(`/api/v1/portal/consult/${sessionId}/rate`, { rating: n }); setRated(true); } catch { /* */ }
  };

  const startVideo = async () => {
    if (!sessionId) return;
    try {
      const r = await apiClient.post<{ data: { room: string; token: string } }>(`/api/v1/portal/consult/${sessionId}/video`, {});
      setVideoUrl(`${JITSI}/${r.data.room}?jwt=${r.data.token}#config.prejoinPageEnabled=false`);
    } catch { setConnIssue('VIDEO'); }
  };

  const startSession = async (loc: string) => {
    try {
      const r = await apiClient.post<{ data: { id: string } }>('/api/v1/portal/consult', { locale: loc });
      setSessionId(r.data.id);
      setConnIssue(null);
      try {
        const m = await apiClient.get<{ data: Msg[] }>(`/api/v1/portal/consult/${r.data.id}/messages`);
        setMsgs(m.data ?? []);
      } catch { setConnIssue('MESSAGES'); }
    } catch { setConnIssue('SESSION'); }
  };

  useEffect(() => { if (open && !sessionId) startSession(locale); /* eslint-disable-next-line */ }, [open]);
  useEffect(() => { if (open && sessionId) startSession(locale); /* eslint-disable-next-line */ }, [locale]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, loading]);
  // SSE 실시간: AI/직원 답변 신호 → 메시지 재조회
  useEffect(() => {
    if (!open || !sessionId) return;
    // 받은 대화는 남기고(덮어쓰지 않는다) 실패했다고만 말한다 · 성공하면 그 표시를 거둔다
    const reload = () => { apiClient.get<{ data: Msg[] }>(`/api/v1/portal/consult/${sessionId}/messages`).then((m) => { setMsgs(m.data ?? []); setConnIssue((c) => (c === 'MESSAGES' ? null : c)); }).catch(() => setConnIssue('MESSAGES')); checkStatus(); };
    reload();
    const unsub = subscribeSseSignal(`/api/v1/portal/consult/${sessionId}/stream`, reload);
    return () => unsub();
    /* eslint-disable-next-line */
  }, [open, sessionId]);

  const send = async () => {
    const text = input.trim();
    if (!text || !sessionId || loading) return;
    setInput('');
    setMsgs((p) => [...p, { sender: 'PATIENT', content: text }]);
    setLoading(true);
    try {
      // 전송만 — AI/직원 답변은 SSE 신호로 수신(위 useEffect)
      await apiClient.post(`/api/v1/portal/consult/${sessionId}/message`, { content: text });
    } catch {
      setMsgs((p) => [...p, { sender: 'AI', content: '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* 🔴 (2026-10-19 포털 세련화 A5) 여는 버튼은 포털의 도움 버튼 하나(`PortalHelpLauncher`)가 갖는다 — 종전 왼쪽 아래 버튼이
          모바일 하단 탭과 본문을 가렸고, 오른쪽 AI 버튼과 둘이 따로 떠 있었다. 패널은 모바일 하단 탭 위로 띄운다. */}
      {open && (
        <div className="fixed bottom-24 md:bottom-5 left-1/2 -translate-x-1/2 md:left-5 md:translate-x-0 z-50 w-[92vw] max-w-sm h-[70vh] max-h-[560px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden" data-portal-consult-panel>
          <div className="bg-blue-600 text-white px-4 py-3 flex items-center justify-between">
            <span className="font-bold text-sm">💬 {TITLE[locale] ?? '상담실'}</span>
            <div className="flex items-center gap-2">
              <button onClick={startVideo} title={tAttr('화상 상담')} className="text-white/90 hover:text-white text-base">📹</button>
              <select value={locale} onChange={(e) => setLocale(e.target.value)} className="text-[11px] bg-white/15 rounded px-1.5 py-1 outline-none">
                {LANGS.map((l) => <option key={l.v} value={l.v} className="text-gray-800">{l.l}</option>)}
              </select>
              <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
            </div>
          </div>
          {videoUrl && (
            <div className="relative bg-black" style={{ height: 220 }}>
              <iframe src={videoUrl} allow="camera; microphone; fullscreen; display-capture; autoplay" className="w-full h-full" />
              <button onClick={() => setVideoUrl(null)} className="absolute top-1 right-1 bg-black/60 text-white text-[11px] rounded px-2 py-0.5"><PT k="화상 종료" /></button>
            </div>
          )}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
            <div className="text-center text-[11px] text-gray-400 py-2">{WELCOME[locale] ?? WELCOME.ko}</div>
            {connIssue && (
              <div className="text-center text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg py-2 px-2" data-portal-consult-issue={connIssue}>
                {connIssue === 'SESSION' ? <PT k="상담을 시작하지 못했습니다. 창을 닫았다가 다시 열어 주세요." />
                  : connIssue === 'MESSAGES' ? <PT k="대화 내용을 불러오지 못했습니다 — 대화가 없는 것이 아닙니다." />
                  : <PT k="화상 상담을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." />}
                {connIssue === 'SESSION' && (
                  <button onClick={() => startSession(locale)} className="ml-2 underline" data-portal-consult-retry><PT k="다시 시도" /></button>
                )}
              </div>
            )}
            {!online && (
              <div className="text-center text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg py-2 px-2">
                {OFFLINE[locale] ?? OFFLINE.ko}
              </div>
            )}
            {online && !assigned && !closed && waitPos > 0 && (
              <div className="text-center text-[11px] text-blue-600 bg-blue-50 border border-blue-100 rounded-lg py-1.5 px-2">
                {(WAITING[locale] ?? WAITING.ko).replace('{n}', String(waitPos))}
              </div>
            )}
            {/* D1/D2: 상담원 연결이 어려우면(온라인 0명·영업시간 외) 비동기 문의로 폴백 안내 */}
            {!liveAvailable && !assigned && !closed && (
              <div className="text-[11px] text-gray-600 bg-white border border-gray-200 rounded-lg py-2 px-3 space-y-1.5">
                <p>지금은 상담원 연결이 어렵습니다. 문의를 남기시면 담당자가 확인 후 답변드립니다.</p>
                <a href="/portal?tab=services&segment=voc"
                  className="inline-block px-3 py-1.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors">
                  <PT k="문의로 남기기" />
                </a>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={m.id ?? i} className={`flex flex-col ${m.sender === 'PATIENT' ? 'items-end' : 'items-start'}`}>
                {m.sender !== 'PATIENT' && <span className="text-[9px] text-gray-400 mb-0.5 ml-1">{m.sender === 'AI' ? `🤖 ${AI_ORIGIN_TEXT} 도우미` : '상담팀'}</span>}
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.sender === 'PATIENT' ? 'bg-blue-600 text-white' : m.sender === 'AI' ? 'bg-indigo-50 border border-indigo-100 text-indigo-900' : 'bg-white border border-gray-200 text-gray-800'}`}>
                  {m.attachmentUrl ? (
                    /\.(png|jpe?g|webp)$/i.test(m.attachmentUrl)
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={`${API_BASE}${m.attachmentUrl}`} alt={tAttr('첨부')} className="rounded-lg max-w-full max-h-40" />
                      : <a href={`${API_BASE}${m.attachmentUrl}`} target="_blank" rel="noopener" className="underline"><PT k="📎 첨부 파일" /></a>
                  ) : m.content}
                </div>
              </div>
            ))}
            {loading && <div className="text-xs text-gray-400 animate-pulse">…</div>}
            {closed && !rated && (
              <div className="text-center bg-amber-50 border border-amber-100 rounded-xl py-3 mt-2">
                <p className="text-xs text-gray-600 mb-1.5">상담은 어떠셨나요?</p>
                <div className="flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => rate(n)} className="text-xl text-amber-400 hover:scale-110">★</button>)}
                </div>
              </div>
            )}
            {closed && rated && <div className="text-center text-xs text-gray-400 mt-2"><PT k="평가해 주셔서 감사합니다 🙏" /></div>}
          </div>
          <div className="border-t border-gray-200 p-2 flex gap-2 bg-white items-center">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={!sessionId} title={tAttr('첨부')} className="text-gray-400 hover:text-gray-600 text-lg disabled:opacity-40">📎</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder={PLACEHOLDER[locale] ?? PLACEHOLDER.ko} disabled={loading || !sessionId}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50" />
            <button onClick={send} disabled={loading || !input.trim() || !sessionId}
              className="px-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">↑</button>
          </div>
        </div>
      )}
    </>
  );
}
