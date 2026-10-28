'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { ratioText } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface QItem { id: string; status: string; locale: string; category?: string; aiMode?: string; assigneeId?: string | null; escalationLevel?: number; leadEscalatedAt?: string | null; escalationReason?: string | null; waitingSec?: number; patient: { mrn: string; name: string } | null; lastMessage: { sender: string; content: string } | null }
interface Agent { userId: string; name: string; role: string; status: string; maxConcurrent: number; activeCount: number }
interface Stats { days: number; total: number; closed: number; closeRate: number | null; avgFirstRespSec: number | null; avgRating: number | null; ratedCount: number; aiRatio: number | null; aiMessages?: number; totalMessages?: number; agents: { userId: string; name: string; handled: number }[] }

const fmtWait = (s?: number) => !s || s < 60 ? `${s ?? 0}초` : s < 3600 ? `${Math.floor(s / 60)}분` : `${Math.floor(s / 3600)}시간`;
const LANG: Record<string, string> = { ko: '한국어', en: 'EN', zh: '中文', ja: '日本語' };
const CAT: Record<string, string> = { GENERAL: '일반', INTERNATIONAL: '국제', CHECKUP: '검진', BILLING: '수납' };
const ST: Record<string, string> = { ONLINE: '🟢', AWAY: '🟡', BUSY: '🔴', OFFLINE: '⚪' };
interface TeamLite { id: string; name: string; categories: string[]; isDefault: boolean }
interface Tpl { id: string; teamId: string | null; title: string; body: string; active: boolean }

export default function ConsultLeadPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [queue, setQueue] = useState<QItem[]>([]);
  const [board, setBoard] = useState<Agent[]>([]);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState(7);
  // 부서(팀) 큐 이관 — 수동. 자동 분류하지 않는다.
  const [teams, setTeams] = useState<{ state: 'loading' | 'ok' | 'error'; items: TeamLite[] }>({ state: 'loading', items: [] });
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const [routeTeam, setRouteTeam] = useState('');
  const [routeCat, setRouteCat] = useState('');
  const [routeReason, setRouteReason] = useState('');
  // 빠른답변 템플릿 관리(팀장=자기 팀) — 전송 기능 없음
  const [tpls, setTpls] = useState<{ state: 'loading' | 'ok' | 'error'; items: Tpl[] }>({ state: 'loading', items: [] });
  const [tplTitle, setTplTitle] = useState('');
  const [tplBody, setTplBody] = useState('');

  const load = () => apiClient.get<{ data: { queue: QItem[]; board: Agent[] } }>(`/api/v1/consult/lead/queue`)
    .then((r) => { setQueue(r.data?.queue ?? []); setBoard(r.data?.board ?? []); })
    .catch(() => toast.error(tAttr('큐 조회 실패')));
  const loadStats = (d: number) => apiClient.get<{ data: Stats }>(`/api/v1/consult/lead/analytics?days=${d}`).then((r) => setStats(r.data)).catch(() => {});

  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);
  useEffect(() => { loadStats(days); }, [days]);
  const loadTeams = () => apiClient.get<{ data: TeamLite[] }>(`/api/v1/consult/lead/teams`)
    .then((r) => setTeams({ state: 'ok', items: r.data ?? [] }))
    .catch(() => setTeams({ state: 'error', items: [] }));
  const loadTpls = () => apiClient.get<{ data: Tpl[] }>(`/api/v1/consult/templates`)
    .then((r) => setTpls({ state: 'ok', items: r.data ?? [] }))
    .catch(() => setTpls({ state: 'error', items: [] }));
  useEffect(() => { loadTeams(); loadTpls(); }, []);

  const route = async (id: string) => {
    if (!routeTeam) return;
    try {
      const r = await apiClient.post<{ data: { changed: boolean } }>(`/api/v1/consult/lead/sessions/${id}/route`, {
        teamId: routeTeam, ...(routeCat ? { category: routeCat } : {}), ...(routeReason.trim() ? { reason: routeReason.trim() } : {}),
      });
      toast.success(r.data?.changed ? tAttr('부서 큐로 이관했습니다') : tAttr('이미 그 팀·분류입니다'));
      setRouteFor(null); setRouteTeam(''); setRouteCat(''); setRouteReason('');
      load();
    } catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('부서 이관 실패')); }
  };
  const addTpl = async () => {
    if (!tplTitle.trim() || !tplBody.trim()) return;
    try {
      await apiClient.post(`/api/v1/consult/templates`, { title: tplTitle.trim(), body: tplBody });
      setTplTitle(''); setTplBody(''); loadTpls(); toast.success(tAttr('빠른답변을 저장했습니다'));
    } catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('빠른답변 저장 실패')); }
  };
  const offTpl = async (id: string) => {
    try { await apiClient.del(`/api/v1/consult/templates/${id}`); loadTpls(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('빠른답변 비활성 실패')); }
  };

  const autoAssign = async () => {
    try { const r = await apiClient.post<{ data: { assigned: number; reason?: string } }>(`/api/v1/consult/lead/auto-assign`, {}); load(); toast.success(r.data?.assigned ? tfAttr('{건수}건 자동 배분', { 건수: r.data.assigned }) : tAttr(r.data?.reason === 'NO_ONLINE_AGENT' ? '대기 상담원 없음' : '배분 대상 없음')); }
    catch { toast.error(tAttr('자동 배분 실패')); }
  };
  const fmtSec = (s: number | null) => s == null ? '—' : s < 60 ? `${s}초` : `${Math.round(s / 60)}분`;

  const assign = async (sessionId: string, agentUserId: string) => {
    try { await apiClient.post(`/api/v1/consult/lead/sessions/${sessionId}/assign`, { agentUserId }); setAssignFor(null); load(); toast.success(tAttr('배정 완료')); }
    catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('배정 실패')); }
  };
  const transfer = async (sessionId: string) => {
    if (!confirm(tAttr('본인(팀장) 담당으로 이관할까요?'))) return;
    try { await apiClient.post(`/api/v1/consult/lead/sessions/${sessionId}/transfer`, {}); load(); toast.success(tAttr('이관 완료')); }
    catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('이관 실패')); }
  };
  const resolveEsc = async (sessionId: string) => {
    try { await apiClient.post(`/api/v1/consult/lead/sessions/${sessionId}/resolve-escalation`, {}); load(); toast.success(tAttr('에스컬레이션 해제')); }
    catch { toast.error(tAttr('해제 실패')); }
  };

  const nameOf = (uid?: string | null) => board.find((a) => a.userId === uid)?.name ?? (uid ? tAttr('담당자') : tAttr('미배정'));

  return (
    <div className="w-full p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="팀장 콘솔" /></h1>
          <p className="text-sm text-gray-500"><T k="팀 상담 큐와 상담원 부하를 보고 배정합니다." /></p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={autoAssign} className="text-xs text-white bg-emerald-600 rounded-lg px-3 py-1.5 hover:bg-emerald-700">⚡ <T k="자동 배분" /></button>
          <Link href="/consult" className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">← <T k="데스크" /></Link>
        </div>
      </div>

      {/* 분석 지표 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-800"><T k="상담 분석" /></h2>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-[11px] border border-gray-200 rounded-lg px-2 py-1">
            <option value={7}>{tfAttr('최근 {일수}일', { 일수: 7 })}</option><option value={30}>{tfAttr('최근 {일수}일', { 일수: 30 })}</option><option value={90}>{tfAttr('최근 {일수}일', { 일수: 90 })}</option>
          </select>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          {[
            ['상담', stats ? `${stats.total}` : '—'],
            ['종료율', ratioText(stats?.closed, stats?.total)],
            ['평균 첫응답', fmtSec(stats?.avgFirstRespSec ?? null)],
            ['만족도', stats?.avgRating != null ? `${stats.avgRating}★` : '—'],
            ['{AI표기} 비중', stats ? ratioText(stats.aiMessages, stats.totalMessages) : '—'],
            ['처리 1위', stats?.agents?.[0] ? `${stats.agents[0].name}(${stats.agents[0].handled})` : '—'],
          ].map(([l, v]) => (
            <div key={l} className="bg-gray-50 rounded-xl py-2">
              {/* 라벨은 키 원문 — `{AI표기}` 자리표시자가 든 라벨이 있어 전부 보간 경로로 그린다(없는 키는 그대로 지나간다) */}
              <div className="text-[10px] text-gray-400"><Tf k={l} params={{ AI표기: AI_ORIGIN_TEXT }} /></div>
              <div className="text-sm font-bold text-gray-800 truncate px-1">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 상담원 보드 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3"><Tf k="상담원 ({수})" params={{ 수: board.length }} /></h2>
          <div className="space-y-1.5">
            {board.map((a) => {
              const full = a.activeCount >= a.maxConcurrent;
              return (
                <div key={a.userId} className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-50">
                  <span className="text-sm text-gray-700">{ST[a.status] ?? '⚪'} {a.name} {a.role === 'LEAD' && <span className="text-[9px] bg-indigo-100 text-indigo-600 rounded px-1"><T k="팀장" /></span>}</span>
                  <span className={`text-xs font-medium ${full ? 'text-red-500' : 'text-gray-500'}`}>{a.activeCount}/{a.maxConcurrent}</span>
                </div>
              );
            })}
            {board.length === 0 && <p className="text-xs text-gray-400 py-2"><T k="상담원 없음" /></p>}
          </div>
        </div>

        {/* 큐 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3"><Tf k="상담 큐 ({수})" params={{ 수: queue.length }} /></h2>
          <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
            {queue.map((s) => {
              const esc = s.escalationLevel ?? 0;
              const lead = !!s.leadEscalatedAt;
              return (
                <div key={s.id} className={`px-3 py-2.5 rounded-xl border ${lead ? 'border-purple-300 bg-purple-50' : esc === 2 ? 'border-red-200 bg-red-50/60' : esc === 1 ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">
                      {s.patient?.name ?? <T k="환자" />} <span className="text-[10px] text-gray-400">{s.patient?.mrn} · {LANG[s.locale] ?? s.locale}{s.category ? <> · <T k={CAT[s.category] ?? s.category} /></> : ''}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      {lead && <span className="text-[9px] bg-purple-600 text-white rounded-full px-1.5 py-0.5 font-bold"><T k="팀장요청" /></span>}
                      {esc > 0 && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white ${esc === 2 ? 'bg-red-600' : 'bg-amber-500'}`}><T k={esc === 2 ? '🚨긴급' : '⏰지연'} /> {fmtWait(s.waitingSec)}</span>}
                      {s.aiMode === 'OFF' && <span className="text-[9px] bg-gray-200 text-gray-500 rounded-full px-1.5 py-0.5">{AI_ORIGIN_TEXT} OFF</span>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500 truncate max-w-[220px]">{s.escalationReason ? <Tf k="사유: {사유}" params={{ 사유: s.escalationReason }} /> : (s.lastMessage?.content ?? '')}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-400"><Tf k="담당: {담당}" params={{ 담당: nameOf(s.assigneeId) }} /></span>
                      {s.leadEscalatedAt && <button onClick={() => resolveEsc(s.id)} className="text-[11px] text-purple-600 border border-purple-200 rounded-lg px-2 py-0.5 hover:bg-purple-50"><T k="해제" /></button>}
                      <button onClick={() => transfer(s.id)} className="text-[11px] text-indigo-600 border border-indigo-200 rounded-lg px-2 py-0.5 hover:bg-indigo-50"><T k="이관" /></button>
                      <button onClick={() => { setRouteFor(routeFor === s.id ? null : s.id); setRouteTeam(''); setRouteCat(''); setRouteReason(''); }} className="text-[11px] text-teal-700 border border-teal-200 rounded-lg px-2 py-0.5 hover:bg-teal-50"><T k="부서 이관" /></button>
                      {assignFor === s.id ? (
                        <select autoFocus onChange={(e) => e.target.value && assign(s.id, e.target.value)} onBlur={() => setAssignFor(null)} className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-0.5">
                          <option value="">{tAttr('상담원…')}</option>
                          {board.filter((a) => a.role !== 'ADMIN').map((a) => <option key={a.userId} value={a.userId} disabled={a.activeCount >= a.maxConcurrent}>{a.name} ({a.activeCount}/{a.maxConcurrent})</option>)}
                        </select>
                      ) : (
                        <button onClick={() => setAssignFor(s.id)} className="text-[11px] text-white bg-indigo-600 rounded-lg px-2 py-0.5 hover:bg-indigo-700"><T k="배정" /></button>
                      )}
                    </div>
                  </div>
                  {routeFor === s.id && (
                    <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-1.5">
                      {teams.state === 'error' ? (
                        <span className="text-[11px] text-red-500"><T k="팀 목록을 불러오지 못했습니다" /></span>
                      ) : (
                        <select value={routeTeam} onChange={(e) => setRouteTeam(e.target.value)} disabled={teams.state !== 'ok'} className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-0.5">
                          <option value="">{teams.state === 'loading' ? tAttr('팀 불러오는 중…') : tAttr('이관할 팀 선택')}</option>
                          {teams.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      )}
                      <select value={routeCat} onChange={(e) => setRouteCat(e.target.value)} className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-0.5">
                        <option value="">{tAttr('분류 유지')}</option>
                        {Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
                      </select>
                      <input value={routeReason} onChange={(e) => setRouteReason(e.target.value)} maxLength={300} placeholder={tAttr('이관 사유(직원 전용 메모로 남음)')} className="flex-1 min-w-[140px] text-[11px] border border-gray-200 rounded-lg px-2 py-0.5" />
                      <button onClick={() => route(s.id)} disabled={!routeTeam} className="text-[11px] text-white bg-teal-600 rounded-lg px-2 py-0.5 hover:bg-teal-700 disabled:opacity-50"><T k="이관 실행" /></button>
                      <span className="w-full text-[10px] text-gray-400"><T k="담당 상담원이 해제되고 새 팀 대기열로 들어갑니다. 환자에게는 보이지 않습니다." /></span>
                    </div>
                  )}
                </div>
              );
            })}
            {queue.length === 0 && <p className="text-xs text-gray-400 text-center py-8"><T k="대기 상담 없음" /></p>}
          </div>
        </div>
      </div>

      {/* 빠른답변 템플릿 — 입력 보조(전송 없음) */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mt-4">
        <h2 className="text-sm font-bold text-gray-800"><T k="빠른답변 템플릿" /></h2>
        <p className="text-[11px] text-gray-500 mb-3"><T k="상담 데스크 입력칸에 넣는 문구입니다. 환자에게 자동으로 보내지 않습니다. 진료 판단·금액·시간은 확인된 사실만 적으세요." /></p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} maxLength={80} placeholder={tAttr('제목')} className="sm:w-48 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <textarea value={tplBody} onChange={(e) => setTplBody(e.target.value)} maxLength={2000} rows={2} placeholder={tAttr('문구')} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <button onClick={addTpl} disabled={!tplTitle.trim() || !tplBody.trim()} className="text-xs text-white bg-indigo-600 rounded-lg px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"><T k="추가" /></button>
        </div>
        {tpls.state === 'error' ? (
          <p className="text-xs text-red-500"><T k="빠른답변을 불러오지 못했습니다" /></p>
        ) : tpls.state === 'loading' ? (
          <p className="text-xs text-gray-400"><T k="불러오는 중…" /></p>
        ) : tpls.items.length === 0 ? (
          <p className="text-xs text-gray-400"><T k="등록된 빠른답변 없음" /></p>
        ) : (
          <div className="space-y-1.5">
            {tpls.items.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-2 px-3 py-2 rounded-xl bg-gray-50">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-800">{t.title} {t.teamId === null && <span className="text-[9px] bg-gray-200 text-gray-600 rounded px-1"><T k="공용" /></span>}</div>
                  <div className="text-[11px] text-gray-600 whitespace-pre-wrap line-clamp-2">{t.body}</div>
                </div>
                <button onClick={() => offTpl(t.id)} className="shrink-0 text-[11px] text-gray-500 border border-gray-200 rounded-lg px-2 py-0.5 hover:bg-white"><T k="비활성" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
