'use client';

import { useState } from 'react';
import { KDate, StaffName, Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { canCloseConsult } from '@/lib/consultation-close';
import { useSearchParams } from 'next/navigation';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { NewConsultationForm } from './new-consultation-form';

interface Consultation {
  id: string;
  toDepartment: string;
  requestingDoctorId?: string;
  toDoctorId?: string | null;
  reason: string;
  clinicalQuestion?: string;
  urgency: string;
  status: string;
  replyContent?: string;
  recommendations?: string;
  repliedAt?: string;
  createdAt: string;
  encounter?: { id: string; patient?: { id: string; familyName?: string; givenName?: string; mrn?: string } };
  requestingDoctor?: { familyName?: string; givenName?: string; department?: string };
  toDoctor?: { familyName?: string; givenName?: string };
  replyDoctor?: { familyName?: string; givenName?: string };
  /** 종결 — 누가·언제(2026-10-10 신설 · 그 전에 종결된 협진은 null = 기록 없음) */
  closedAt?: string | null;
  closedBy?: { familyName?: string; givenName?: string } | null;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  REQUESTED: { label: '의뢰 대기', color: 'bg-amber-100 text-amber-700' },
  ACCEPTED: { label: '접수됨', color: 'bg-blue-100 text-blue-700' },
  REPLIED: { label: '회신 완료', color: 'bg-emerald-100 text-emerald-700' },
  CLOSED: { label: '종료', color: 'bg-gray-100 text-gray-600' },
};

const URGENCY_MAP: Record<string, { label: string; color: string }> = {
  ROUTINE: { label: '일반', color: 'bg-gray-100 text-gray-600' },
  URGENT: { label: '긴급', color: 'bg-orange-100 text-orange-700' },
  EMERGENT: { label: '응급', color: 'bg-red-100 text-red-700' },
};

export default function ConsultationsPage() {
  /**
   * 🔴 협진의 의뢰·접수·회신·종결은 서버가 전부 `@Roles(DOCTOR, ADMIN)` 이다 —
   *    의학적 판단과 소견이 오가는 자리라 맞다. 간호사에게는 **조회 화면**이다
   *    (`GET /consultations` 는 열려 있다). 버튼을 띄우면 누를 때마다 403 이었다.
   */
  const canAct = useHasRole('DOCTOR');
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  // 알림(협진 접수·회신 도착 — 의뢰의에게 간다)은 '보낸 협진'으로 연다(?scope=sent · 2026-10-10)
  const scopeParam = useSearchParams()?.get('scope');
  const [scope, setScope] = useState<'inbox' | 'sent' | 'all'>(scopeParam === 'sent' || scopeParam === 'all' ? scopeParam : 'inbox');
  const [filter, setFilter] = useState<'all' | 'pending' | 'replied' | 'closed'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [recommendations, setRecommendations] = useState('');

  const unwrap = (d: unknown): Consultation[] => {
    const r = d as Consultation[] | { data?: Consultation[] } | undefined;
    return Array.isArray(r) ? r : (r?.data ?? []);
  };

  // 전체 협진 목록 (최근 50건)
  const { data, isLoading } = useQuery({
    queryKey: ['all-consultations'],
    queryFn: () => apiClient.get<{ data: Consultation[] }>('/api/v1/consultations?limit=50'),
  });
  const allConsultations = unwrap(data?.data);

  // 내게 온 협진(inbox) — 지정의=나 OR 미지정+내 과
  const { data: inboxData, isLoading: inboxLoading } = useQuery({
    queryKey: ['inbox-consultations'],
    queryFn: () => apiClient.get<{ data: Consultation[] }>('/api/v1/consultations/inbox?limit=50'),
    enabled: canAct,
  });
  const inboxConsultations = unwrap(inboxData?.data);

  // 🔴 보낸 협진 — 종전엔 병원 전체 최근 50건에서 내 것만 골라, 그보다 오래된 내 의뢰는 '보낸 협진'에서 사라졌다 → 서버가 의뢰의=나로 좁힌다
  const { data: sentData } = useQuery({
    queryKey: ['sent-consultations'],
    queryFn: () => apiClient.get<{ data: Consultation[] }>('/api/v1/consultations?requestedBy=me&limit=50'),
    enabled: canAct,
  });
  const sentConsultations = unwrap(sentData?.data);

  const base = scope === 'inbox'
    ? inboxConsultations
    : scope === 'sent'
      ? sentConsultations
      : allConsultations;

  const filtered = base.filter(c => {
    if (filter === 'pending') return c.status === 'REQUESTED' || c.status === 'ACCEPTED';
    if (filter === 'replied') return c.status === 'REPLIED';
    if (filter === 'closed') return c.status === 'CLOSED';
    return true;
  });

  const pendingCount = base.filter(c => c.status === 'REQUESTED' || c.status === 'ACCEPTED').length;
  const inboxPending = inboxConsultations.filter(c => c.status === 'REQUESTED' || c.status === 'ACCEPTED').length;

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ['all-consultations'] });
    qc.invalidateQueries({ queryKey: ['inbox-consultations'] });
    qc.invalidateQueries({ queryKey: ['sent-consultations'] });
    // 의사 할 일함의 '회신 도착한 내 협진'·'협진 회신 대기' 수도 같이 줄어든다
    qc.invalidateQueries({ queryKey: ['doctor-my-followups'] });
  };

  // 회신 mutation
  const replyMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consultations/${id}/reply`, {
      replyContent,
      recommendations: recommendations || undefined,
    }),
    onSuccess: () => {
      refetchAll();
      setReplyId(null);
      setReplyContent('');
      setRecommendations('');
      toast.success(tAttr('회신이 전송되었습니다.'));
    },
    onError: () => toast.error(tAttr('회신 전송 실패')),
  });

  const acceptMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consultations/${id}/accept`, {}),
    onSuccess: () => { refetchAll(); toast.success(tAttr('협진을 접수했습니다.')); },
    onError: () => toast.error(tAttr('접수 실패 — 수신 과/지정의만 접수할 수 있습니다.')),
  });

  const closeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consultations/${id}/close`, {}),
    onSuccess: () => {
      refetchAll();
      toast.success(tAttr('협진이 종료되었습니다.'));
    },
    // 🔴 종전엔 실패 처리가 없어 서버가 막아도(권한·상태) 아무 말이 없었다
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('협진을 종료하지 못했습니다.')),
  });

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="협진 의뢰" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="타과 협진 의뢰 및 회신 관리" /></p>
        </div>
        {/* 🔴 서버에 `POST /consultations` 가 있는데 이 화면은 수락·회신·종결만 했다(사람 신고) */}
        <div className="flex items-center gap-3">
        {canAct && <NewConsultationForm />}
        {!canAct && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5"><T k="협진 의뢰·회신은 의사 권한입니다 — 이 계정에서는 조회만 가능합니다." /></p>}
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
            <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-amber-700"><Tf k="대기 중 {건수}건" params={{ 건수: pendingCount }} /></span>
          </div>
        )}
        </div>
      </div>

      {/* 스코프 (내게 온 / 내가 보낸 / 전체) */}
      <div className="flex gap-2 border-b border-gray-100 pb-1">
        {/* 🔴 '내게 온'은 `GET /consultations/inbox`(의사 전용) 을 부른다 — 간호사에게는 빈 탭이 아니라 403 이었다 */}
        {(canAct
          ? ([{ key: 'inbox', label: '내게 온', badge: inboxPending },
              { key: 'sent', label: '내가 보낸', badge: 0 },
              { key: 'all', label: '전체', badge: 0 }] as const)
          : ([{ key: 'all', label: '전체', badge: 0 }] as const)
        ).map(s => (
          <button key={s.key} onClick={() => setScope(s.key)}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all relative ${scope === s.key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            <T k={s.label} />
            {s.badge > 0 && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${scope === s.key ? 'bg-white/25' : 'bg-amber-100 text-amber-700'}`}>{s.badge}</span>}
          </button>
        ))}
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체', count: base.length, color: 'text-gray-900', bg: 'bg-white' },
          { label: '대기 중', count: pendingCount, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: '회신 완료', count: base.filter(c => c.status === 'REPLIED').length, color: 'text-emerald-700', bg: 'bg-emerald-50' },
          { label: '종료', count: base.filter(c => c.status === 'CLOSED').length, color: 'text-gray-600', bg: 'bg-gray-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-gray-500 mt-1"><T k={s.label} /></p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex gap-2">
        {[
          { key: 'all', label: '전체' },
          { key: 'pending', label: '대기 중 ({건수})' },
          { key: 'replied', label: '회신 완료' },
          { key: 'closed', label: '종료' },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key as typeof filter)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${filter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <Tf k={f.label} params={{ 건수: pendingCount }} />
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div className="space-y-3">
        {(scope === 'inbox' ? inboxLoading : isLoading) ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm"><T k={scope === 'inbox' ? '내게 온 협진이 없습니다' : scope === 'sent' ? '내가 보낸 협진이 없습니다' : '해당 조건의 협진 의뢰가 없습니다'} /></p>
          </div>
        ) : (
          filtered.map(c => {
            const st = STATUS_MAP[c.status] ?? { label: c.status, color: 'bg-gray-100' };
            const urg = URGENCY_MAP[c.urgency] ?? { label: c.urgency, color: 'bg-gray-100' };
            const isExpanded = expandedId === c.id;
            const patient = c.encounter?.patient;

            return (
              <div key={c.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${c.urgency === 'EMERGENT' ? 'border-red-200' : c.status === 'REPLIED' ? 'border-emerald-200' : 'border-gray-100'}`}>
                <button onClick={() => setExpandedId(isExpanded ? null : c.id)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 text-left">
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color}`}><T k={st.label} /></span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${urg.color}`}><T k={urg.label} /></span>
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{c.requestingDoctor?.department ?? ''}</span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className="text-sm font-semibold text-blue-700">{c.toDepartment}</span>
                    </div>
                    {patient && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg">
                        {patient.familyName}{patient.givenName} ({patient.mrn})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{kdate(new Date(c.createdAt))}</span>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-5 space-y-4 border-t border-gray-100">
                    <div className="pt-4 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-bold text-gray-500 mb-1"><T k="의뢰 사유" /></p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.reason}</p>
                      </div>
                      {c.clinicalQuestion && (
                        <div>
                          <p className="text-xs font-bold text-gray-500 mb-1"><T k="임상 질문" /></p>
                          <p className="text-sm text-gray-800">{c.clinicalQuestion}</p>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      <Tf k="의뢰의: {의뢰의} ({진료과})" params={{ 의뢰의: `${c.requestingDoctor?.familyName ?? ''}${c.requestingDoctor?.givenName ?? ''}`, 진료과: c.requestingDoctor?.department ?? '' }} />
                      {patient && <> | <T k="환자" />: <a href={`/patients/${patient.id}`} className="text-blue-600 hover:underline">{patient.familyName}{patient.givenName}</a></>}
                    </div>

                    {/* 회신 내용 */}
                    {c.replyContent && (
                      <div className="bg-emerald-50 rounded-xl p-4">
                        <p className="text-xs font-bold text-emerald-700 mb-1"><T k="회신 내용" /></p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.replyContent}</p>
                        {c.recommendations && (
                          <div className="mt-2 pt-2 border-t border-emerald-200">
                            <p className="text-xs font-bold text-emerald-700 mb-1"><T k="권고사항" /></p>
                            <p className="text-sm text-gray-800">{c.recommendations}</p>
                          </div>
                        )}
                        <p className="text-[10px] text-emerald-600 mt-2">
                          {c.replyDoctor && <Tf k="회신의: {회신의}" params={{ 회신의: `${c.replyDoctor.familyName}${c.replyDoctor.givenName}` }} />}
                          {c.repliedAt && ` · ${kdate(c.repliedAt, 'datetimeSec')}`}
                        </p>
                      </div>
                    )}

                    {/* 회신 작성 폼 */}
                    {(c.status === 'REQUESTED' || c.status === 'ACCEPTED') && replyId === c.id && (
                      <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                        <p className="text-xs font-bold text-blue-700"><T k="회신 작성" /></p>
                        <textarea value={replyContent} onChange={e => setReplyContent(e.target.value)}
                          rows={4} placeholder={tAttr('소견 및 회신 내용을 입력하세요...')}
                          className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white resize-none focus:ring-2 focus:ring-blue-500" />
                        <textarea value={recommendations} onChange={e => setRecommendations(e.target.value)}
                          rows={2} placeholder={tAttr('권고사항 (선택)')}
                          className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white resize-none" />
                        <div className="flex gap-2">
                          <button onClick={() => replyMut.mutate(c.id)} disabled={!replyContent.trim() || replyMut.isPending}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40">
                            <T k={replyMut.isPending ? '전송 중...' : '회신 전송'} />
                          </button>
                          <button onClick={() => { setReplyId(null); setReplyContent(''); setRecommendations(''); }}
                            className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"><T k="취소" /></button>
                        </div>
                      </div>
                    )}

                    {/* 종결 기록 — 그 전 종결은 기록 없음(지어내지 않는다) */}
                    {c.status === 'CLOSED' && (
                      <p className="text-xs text-gray-500" data-consult-closed={c.id}>
                        <T k="종결" />: <StaffName familyName={c.closedBy?.familyName} givenName={c.closedBy?.givenName} /> · <KDate value={c.closedAt} mode="datetime" unknown="UNRECORDED" />
                      </p>
                    )}

                    {/* 액션 버튼 */}
                    <div className="flex gap-2">
                      {canAct && c.status === 'REQUESTED' && replyId !== c.id && (
                        <button onClick={() => acceptMut.mutate(c.id)} disabled={acceptMut.isPending}
                          className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-40">
                          <T k={acceptMut.isPending ? '접수 중...' : '접수@버튼'} />
                        </button>
                      )}
                      {canAct && (c.status === 'REQUESTED' || c.status === 'ACCEPTED') && replyId !== c.id && (
                        <button onClick={() => setReplyId(c.id)}
                          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                          <T k="회신 작성" />
                        </button>
                      )}
                      {canAct && c.status === 'REPLIED' && canCloseConsult(c, user) && (
                        <button onClick={() => closeMut.mutate(c.id)}
                          className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200">
                          <T k="종료" />
                        </button>
                      )}
                      {patient && (
                        <a href={`/patients/${patient.id}?tab=referrals`}
                          className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg">
                          <T k="환자 차트" /> →
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
