'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { subscribeSseSignal } from '@/lib/sse-signal';
import { useDurationText } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface Session { id: string; status: string; locale: string; category?: string; aiMode?: string; assigneeId?: string | null; leadEscalatedAt?: string | null; updatedAt: string; priority?: string; escalationLevel?: number; waitingSec?: number; patient: { mrn: string; name: string } | null; lastMessage: { sender: string; content: string } | null }
interface Me { enrolled: boolean; role: string | null; status: string; team: { id: string; name: string } | null }

// 🔴 로컬 포맷터가 분을 버려 66일 대기가 "1587시간"으로 떴다(W0 가 고친 '1815시간 1분'과 같은 형태).
//    정본 useDurationText 경유 — 같은 세션을 VoC 화면은 이미 <Duration> 으로 그린다(정본 이중 해소).
//    🔴 단위 낱말도 UI 언어를 따라야 한다 — 문자열 경로는 `useDurationText()`(2026-09-12)
function useFmtWait() {
  const fmtDur = useDurationText();
  const tAttrL = useTAttr();
  return (s?: number) => (!s || s < 60 ? `${s ?? 0}${tAttrL('초@단위')}` : fmtDur(Math.floor(s / 60), tAttrL('0분')));
}
interface Tpl { id: string; teamId: string | null; title: string; body: string }
interface Msg { id: string; sender: string; visibility?: string; senderName?: string | null; ko: string; original: string; attachmentUrl?: string | null; lang?: string; createdAt: string }
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const SCOPE = [['team', '팀'], ['mine', '내 상담'], ['unassigned', '미배정'], ['all', '전체']] as const;
const LANG: Record<string, string> = { ko: '한국어', en: 'EN', zh: '中文', ja: '日本語' };
const CAT: Record<string, string> = { GENERAL: '일반', INTERNATIONAL: '국제', CHECKUP: '검진', BILLING: '수납' };
const AGENT_STATUS = [['ONLINE', '🟢 대기'], ['AWAY', '🟡 자리비움'], ['BUSY', '🔴 바쁨'], ['OFFLINE', '⚪ 오프라인']] as const;

export default function ConsultDeskPage() {
  const fmtWait = useFmtWait();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [scope, setScope] = useState('team');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'reply' | 'note' | 'coreply'>('reply');
  const [draft, setDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  /**
   * 🔴 상담 데스크는 **상담원 등록** 기반이다(직무 역할이 아니다). nav 는 임상 역할 전체에 이 화면을 여는데,
   *    종전엔 미등록자에게도 데스크를 그대로 그렸다 — 상태 'OFFLINE'·세션 0 이라 "지금 상담이 없다"로 읽혔다.
   *    이제 서버가 `enrolled:false` 를 말하고(J2), 조회 실패는 실패라고 말한다.
   */
  const [meState, setMeState] = useState<'loading' | 'ok' | 'error'>('loading');
  // 빠른답변 템플릿 — 🔴 입력칸에 넣기만 한다(전송은 직원이 직접). 조회 실패를 '등록된 템플릿 없음'으로 그리지 않는다.
  const [tpl, setTpl] = useState<{ state: 'loading' | 'ok' | 'error'; items: Tpl[] }>({ state: 'loading', items: [] });
  const scrollRef = useRef<HTMLDivElement>(null);
  const JITSI = process.env.NEXT_PUBLIC_JITSI_URL || '/meet';

  useEffect(() => {
    apiClient.get<{ data: Me }>(`/api/v1/consult/agents/me`).then((r) => {
      setMe(r.data);
      setMeState('ok');
      // D1: 데스크 진입 시 등록 상담원이 OFFLINE이면 자동 ONLINE 전환(온라인 0명 → 큐 영구 적체 봉합)
      if (r.data?.enrolled && r.data?.status === 'OFFLINE') {
        apiClient.patch(`/api/v1/consult/agents/me/status`, { status: 'ONLINE' })
          .then(() => setMe((m) => m ? { ...m, status: 'ONLINE' } : m)).catch(() => {});
      }
    }).catch(() => setMeState('error'));
  }, []);
  useEffect(() => {
    apiClient.get<{ data: Tpl[] }>(`/api/v1/consult/templates`)
      .then((r) => setTpl({ state: 'ok', items: r.data ?? [] }))
      .catch(() => setTpl({ state: 'error', items: [] }));
  }, []);
  const insertTemplate = (id: string) => {
    const t = tpl.items.find((x) => x.id === id);
    if (!t) return;
    setInput((prev) => (prev.trim() ? `${prev}\n${t.body}` : t.body));
  };
  const setAgentStatus = async (st: string) => {
    try { await apiClient.patch(`/api/v1/consult/agents/me/status`, { status: st }); setMe((m) => m ? { ...m, status: st } : m); }
    catch { toast.error(tAttr('상태 변경 실패')); }
  };
  const setAi = async (next: string) => {
    if (!selId) return;
    try { await apiClient.patch(`/api/v1/consult/sessions/${selId}/ai-mode`, { mode: next }); loadSessions(); }
    catch { toast.error(tfAttr('{AI표기} 모드 변경 실패', { AI표기: AI_ORIGIN_TEXT })); }
  };
  const loadDraft = (id: string) => apiClient.get<{ data: { draft: string | null } }>(`/api/v1/consult/sessions/${id}/ai-draft`).then((r) => setDraft(r.data?.draft ?? null)).catch(() => { setDraft(null); toast.error(tfAttr('{AI표기} 답변 초안 조회 실패', { AI표기: AI_ORIGIN_TEXT })); });

  const startVideo = async () => {
    if (!selId) return;
    try {
      const r = await apiClient.post<{ data: { room: string; token: string } }>(`/api/v1/consult/sessions/${selId}/video`, {});
      setVideoUrl(`${JITSI}/${r.data.room}?jwt=${r.data.token}#config.prejoinPageEnabled=false`);
    } catch { toast.error(tAttr('화상 시작 실패')); }
  };

  const loadSessions = () => apiClient.get<{ data: Session[] }>(`/api/v1/consult/sessions?scope=${scope}`).then((r) => setSessions(r.data ?? [])).catch(() => {});
  const loadMsgs = (id: string) => apiClient.get<{ data: Msg[] }>(`/api/v1/consult/sessions/${id}/messages`).then((r) => setMsgs(r.data ?? [])).catch(() => {});

  useEffect(() => { loadSessions(); /* eslint-disable-next-line */ }, [scope]);
  useEffect(() => { const t = setInterval(loadSessions, 8000); return () => clearInterval(t); /* eslint-disable-next-line */ }, [scope]);
  useEffect(() => { setDraft(null); setMode('reply'); if (selId) { loadMsgs(selId); loadDraft(selId); } /* eslint-disable-next-line */ }, [selId]);
  // SSE 실시간: 새 메시지/초안 신호 → 재조회(+인박스 갱신). 15초 폴백 폴링.
  useEffect(() => {
    if (!selId) return;
    const unsub = subscribeSseSignal(`/api/v1/consult/sessions/${selId}/stream`, () => { loadMsgs(selId); loadSessions(); loadDraft(selId); });
    const t = setInterval(() => loadMsgs(selId), 15000);
    return () => { unsub(); clearInterval(t); };
    /* eslint-disable-next-line */
  }, [selId]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || !selId || sending) return;
    setInput(''); setSending(true);
    const ep = mode === 'note' ? `/api/v1/consult/sessions/${selId}/note`
      : mode === 'coreply' ? `/api/v1/consult/lead/sessions/${selId}/co-reply`
      : `/api/v1/consult/sessions/${selId}/reply`;
    try { await apiClient.post(ep, { content: text }); await loadMsgs(selId); loadSessions(); }
    catch { toast.error(tAttr('전송 실패')); }
    setSending(false);
  };
  const close = async () => { if (!selId) return; await apiClient.post(`/api/v1/consult/sessions/${selId}/close`, {}).catch(() => {}); loadSessions(); loadMsgs(selId); };
  const claim = async () => { if (!selId) return; await apiClient.post(`/api/v1/consult/sessions/${selId}/claim`, {}).catch(() => toast.error(tAttr('담당 배정 실패'))); loadSessions(); };
  const escalate = async () => {
    if (!selId) return;
    const reason = window.prompt(tAttr('팀장에게 요청할 사유를 입력하세요:'));
    if (reason === null) return;
    try { await apiClient.post(`/api/v1/consult/sessions/${selId}/escalate`, { reason: reason || '지원 요청' }); loadSessions(); loadMsgs(selId); toast.success(tAttr('팀장에게 에스컬레이션')); }
    catch { toast.error(tAttr('에스컬레이션 실패')); }
  };
  const transfer = async () => {
    if (!selId || !confirm(tAttr('이 상담을 본인(팀장) 담당으로 이관할까요?'))) return;
    try { await apiClient.post(`/api/v1/consult/lead/sessions/${selId}/transfer`, {}); loadSessions(); toast.success(tAttr('이관 완료')); }
    catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('이관 실패')); }
  };
  const resolveEsc = async () => {
    if (!selId) return;
    try { await apiClient.post(`/api/v1/consult/lead/sessions/${selId}/resolve-escalation`, {}); loadSessions(); toast.success(tAttr('에스컬레이션 해제')); }
    catch { toast.error(tAttr('해제 실패')); }
  };

  const sel = sessions.find((s) => s.id === selId);
  const isLead = me?.role === 'LEAD' || me?.role === 'ADMIN';

  // 미등록·조회 실패는 데스크를 그리지 않는다 — 빈 데스크는 "상담이 없다"는 **다른 사실**로 읽힌다.
  if (meState !== 'loading' && !me?.enrolled) {
    return (
      <div className="w-full p-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-3"><T k="상담 데스크" /></h1>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 max-w-xl">
          {meState === 'error' ? (
            <>
              <p className="text-sm font-semibold text-gray-900"><T k="상담 프로필을 불러오지 못했습니다" /></p>
              <p className="text-xs text-gray-500 mt-1"><T k="상담원 등록 여부를 확인하지 못했습니다 — 등록되지 않았다는 뜻이 아닙니다." /></p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-900"><T k="상담원으로 등록되지 않았습니다" /></p>
              <p className="text-xs text-gray-500 mt-1"><T k="상담 데스크는 상담원으로 등록된 직원만 사용합니다. 등록은 상담 팀 관리자에게 요청하세요." /></p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-4">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="상담 데스크" /></h1>
        <div className="flex items-center gap-2">
          {me?.team && <span className="text-[11px] text-gray-400"><Tf k="팀: {팀}" params={{ 팀: me.team.name }} /></span>}
          <select value={me?.status ?? 'OFFLINE'} onChange={(e) => setAgentStatus(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
            {AGENT_STATUS.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
          </select>
          {(me?.role === 'LEAD' || me?.role === 'ADMIN') && <Link href="/consult/lead" className="text-xs text-white bg-indigo-600 rounded-lg px-2.5 py-1 hover:bg-indigo-700"><T k="팀장 콘솔" /></Link>}
          {me?.role === 'ADMIN' && <Link href="/consult/admin" className="text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50"><T k="팀 관리" /></Link>}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4"><T k="환자 상담실 문의를 확인·응답합니다. (직원 한국어 입력 → 환자 언어 자동 번역)" /></p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ height: 'calc(100vh - 200px)' }}>
        {/* 인박스 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
          <div className="flex gap-1 p-2 border-b">
            {SCOPE.map(([v, l]) => (
              <button key={v} onClick={() => setScope(v)} className={`flex-1 text-xs py-1.5 rounded-lg font-medium ${scope === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k={l} /></button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 && <p className="text-xs text-gray-400 text-center py-8"><T k="상담 없음" /></p>}
            {[...sessions].sort((a, b) => (b.escalationLevel ?? 0) - (a.escalationLevel ?? 0) || (b.waitingSec ?? 0) - (a.waitingSec ?? 0)).map((s) => {
              const esc = s.escalationLevel ?? 0;
              return (
              <button key={s.id} onClick={() => setSelId(s.id)} className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 ${selId === s.id ? 'bg-blue-50' : ''} ${esc === 2 ? 'bg-red-50/60' : esc === 1 ? 'bg-amber-50/50' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">{s.patient?.name ?? <T k="환자" />} <span className="text-[10px] text-gray-400">{s.patient?.mrn}</span></span>
                  <div className="flex items-center gap-1">
                    {esc > 0 && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${esc === 2 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}><T k={esc === 2 ? '🚨긴급' : '⏰지연'} /> {fmtWait(s.waitingSec)}</span>}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${s.status === 'OPEN' ? 'bg-amber-100 text-amber-700' : s.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{s.status}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-gray-500 truncate max-w-[160px]">{s.lastMessage?.content ?? ''}</span>
                  <span className="text-[10px] text-indigo-500">{LANG[s.locale] ?? s.locale}</span>
                </div>
              </button>
              );
            })}
          </div>
        </div>

        {/* 대화 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
          {!sel ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400"><T k="상담을 선택하세요" /></div>
          ) : (
            <>
              <div className="px-4 py-2.5 border-b flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900">{sel.patient?.name} <span className="text-[11px] text-gray-400">{sel.patient?.mrn} · {LANG[sel.locale]}{sel.category ? <> · <T k={CAT[sel.category] ?? sel.category} /></> : ''}</span></span>
                <div className="flex items-center gap-1.5">
                  <select value={sel.aiMode ?? 'AUTO'} onChange={(e) => setAi(e.target.value)} title={tfAttr('{AI표기} 응답 모드', { AI표기: AI_ORIGIN_TEXT })}
                    className={`text-[11px] rounded-lg px-1.5 py-1 border ${sel.aiMode === 'OFF' ? 'bg-gray-100 text-gray-500 border-gray-200' : sel.aiMode === 'SUGGEST' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>
                    <option value="AUTO">{tfAttr('{AI표기} 자동', { AI표기: AI_ORIGIN_TEXT })}</option>
                    <option value="SUGGEST">{tfAttr('{AI표기} 제안', { AI표기: AI_ORIGIN_TEXT })}</option>
                    <option value="OFF">{tfAttr('{AI표기} 끔', { AI표기: AI_ORIGIN_TEXT })}</option>
                  </select>
                  {sel.status === 'OPEN' && <button onClick={claim} className="text-[11px] text-white bg-emerald-600 rounded-lg px-2 py-1 hover:bg-emerald-700"><T k="담당하기" /></button>}
                  {!sel.leadEscalatedAt && <button onClick={escalate} className="text-[11px] text-white bg-purple-600 rounded-lg px-2 py-1 hover:bg-purple-700">🆙 <T k="팀장요청" /></button>}
                  {isLead && sel.leadEscalatedAt && <button onClick={resolveEsc} className="text-[11px] text-purple-600 border border-purple-200 rounded-lg px-2 py-1 hover:bg-purple-50"><T k="해제" /></button>}
                  {isLead && <button onClick={transfer} className="text-[11px] text-indigo-600 border border-indigo-200 rounded-lg px-2 py-1 hover:bg-indigo-50"><T k="이관" /></button>}
                  <button onClick={startVideo} className="text-[11px] text-white bg-blue-600 rounded-lg px-2 py-1 hover:bg-blue-700">📹 <T k="화상" /></button>
                  <button onClick={close} className="text-[11px] text-gray-500 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50"><T k="상담 종료" /></button>
                </div>
              </div>
              {videoUrl && (
                <div className="relative bg-black" style={{ height: 280 }}>
                  <iframe src={videoUrl} allow="camera; microphone; fullscreen; display-capture; autoplay" className="w-full h-full" />
                  <button onClick={() => setVideoUrl(null)} className="absolute top-2 right-2 bg-black/60 text-white text-xs rounded px-2 py-1"><T k="화상 종료" /></button>
                </div>
              )}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
                {msgs.map((m) => m.visibility === 'INTERNAL' ? (
                  <div key={m.id} className="flex justify-center">
                    <div className="max-w-[85%] rounded-xl px-3 py-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-900">
                      <span className="text-[9px] font-bold text-amber-600 mr-1">🔒 <T k="내부메모" />{m.senderName ? ` · ${m.senderName}` : ''}</span>
                      <span className="whitespace-pre-wrap">{m.ko}</span>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className={`flex ${m.sender === 'PATIENT' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.sender === 'PATIENT' ? 'bg-white border border-gray-200 text-gray-800' : m.sender === 'AI' ? 'bg-indigo-50 text-indigo-900 border border-indigo-100' : m.sender === 'LEAD' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'}`}>
                      <div className="text-[9px] opacity-60 mb-0.5">{m.sender === 'PATIENT' ? <T k="환자" /> : m.sender === 'AI' ? <Tf k="{AI표기} 도우미" params={{ AI표기: AI_ORIGIN_TEXT }} /> : m.sender === 'LEAD' ? <><T k="팀장" />{m.senderName ? ' · ' + m.senderName : ''}</> : <><T k="직원" />{m.senderName ? ' · ' + m.senderName : ''}</>}</div>
                      {m.attachmentUrl ? (
                        /\.(png|jpe?g|webp)$/i.test(m.attachmentUrl)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <a href={`${API_BASE}${m.attachmentUrl}`} target="_blank" rel="noopener"><img src={`${API_BASE}${m.attachmentUrl}`} alt={tAttr('첨부')} className="rounded max-h-40" /></a>
                          : <a href={`${API_BASE}${m.attachmentUrl}`} target="_blank" rel="noopener" className="underline">📎 <T k="첨부 파일" /></a>
                      ) : <div className="whitespace-pre-wrap">{m.ko}</div>}
                      {m.sender === 'PATIENT' && m.lang && m.lang !== 'ko' && m.original !== m.ko && <div className="text-[10px] opacity-50 mt-1 border-t pt-1"><Tf k="원문: {원문}" params={{ 원문: m.original }} /></div>}
                    </div>
                  </div>
                ))}
                {msgs.length === 0 && <p className="text-xs text-gray-400 text-center py-6"><T k="메시지 없음" /></p>}
              </div>
              {draft && (
                <div className="border-t bg-amber-50/60 px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-amber-600">🤖 <Tf k="{AI표기} 초안 (검토 후 전송)" params={{ AI표기: AI_ORIGIN_TEXT }} /></span>
                    <div className="flex gap-1.5">
                      <button onClick={() => { setMode('reply'); setInput(draft); setDraft(null); }} className="text-[10px] text-white bg-amber-500 rounded px-2 py-0.5 hover:bg-amber-600"><T k="불러오기" /></button>
                      <button onClick={() => setDraft(null)} className="text-[10px] text-gray-400 hover:text-gray-600"><T k="무시" /></button>
                    </div>
                  </div>
                  <p className="text-xs text-amber-900 whitespace-pre-wrap line-clamp-3">{draft}</p>
                </div>
              )}
              <div className="border-t p-2">
                <div className="flex gap-1 mb-1.5">
                  <button onClick={() => setMode('reply')} className={`text-[11px] px-2 py-0.5 rounded-lg ${mode === 'reply' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}><T k="환자답변" /></button>
                  {isLead && <button onClick={() => setMode('coreply')} className={`text-[11px] px-2 py-0.5 rounded-lg ${mode === 'coreply' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-500'}`}><T k="공동응답" /></button>}
                  <button onClick={() => setMode('note')} className={`text-[11px] px-2 py-0.5 rounded-lg ${mode === 'note' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>🔒 <T k="내부메모" /></button>
                  {tpl.state === 'error' ? (
                    <span className="ml-auto text-[10px] text-red-500"><T k="빠른답변을 불러오지 못했습니다" /></span>
                  ) : (
                    <select value="" onChange={(e) => e.target.value && insertTemplate(e.target.value)} disabled={tpl.state !== 'ok'}
                      title={tAttr('입력칸에 넣기만 합니다 — 전송은 직접 누릅니다')}
                      className="ml-auto text-[11px] border border-gray-200 rounded-lg px-1.5 py-0.5 max-w-[180px] disabled:bg-gray-50">
                      <option value="">{tpl.state === 'loading' ? tAttr('빠른답변 불러오는 중…') : tAttr('빠른답변 넣기')}</option>
                      {tpl.state === 'ok' && tpl.items.length === 0 && <option value="" disabled>{tAttr('등록된 빠른답변 없음')}</option>}
                      {tpl.items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                  )}
                </div>
                <div className="flex gap-2">
                  <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder={tAttr(mode === 'note' ? '내부 메모 (환자에게 안 보임)' : mode === 'coreply' ? '공동응답 (담당 유지·환자에게 상담팀으로 표시)' : '한국어로 입력 (환자 언어로 자동 번역)')}
                    disabled={sending} className={`flex-1 px-3 py-2 text-sm border rounded-xl outline-none focus:ring-2 disabled:bg-gray-50 ${mode === 'note' ? 'border-amber-200 focus:ring-amber-100 bg-amber-50/40' : 'border-gray-200 focus:ring-blue-100'}`} />
                  <button onClick={send} disabled={sending || !input.trim()} className={`px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50 ${mode === 'note' ? 'bg-amber-500 hover:bg-amber-600' : mode === 'coreply' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}><T k="전송@버튼" /></button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
