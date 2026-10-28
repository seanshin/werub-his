'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { pollMs, money, kdate } from '@/lib/ui-settings';

import { EmptyState, Money, Ratio, Unit, genderText, useDurationText } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Consultation { id: string; subject: string; channel: string; category: string; status: string; priority: string; feeAmount: number; billingStatus: string; isFreeConsult: boolean; createdAt: string; completedAt?: string; encounterId?: string; videoRoomId?: string; videoRequestedBy?: string; patient?: { id: string; mrn: string; familyName: string; givenName: string; dateOfBirth: string; gender: string }; messages?: { content: string; sender: string; createdAt: string }[]; doctorAssessment?: string; doctorPlan?: string }
interface Message { id: string; sender: string; senderId?: string; content: string; attachments?: unknown; isMedicalAdvice: boolean; isRead: boolean; readAt?: string; createdAt: string; sharedLabResultId?: string; sharedImagingId?: string }
/** 🔴 `slaNumerator`/`slaDenominator` = 24시간 내 첫 답변 / 답변한 상담 — 2026-08-20 서버가 함께 낸다
 *  (종전에는 비율만 와서 "SLA 100%"가 1건 중 1건인지 400건 중 400건인지 화면이 말할 수 없었다) */
interface Stats { pending: number; active: number; completedMonth: number; totalRevenue: number; doctorIncentive?: number; hospitalShare?: number; avgResponseHours: number; slaComplianceRate?: number | null; slaNumerator?: number; slaDenominator?: number }

const channelIcon: Record<string, string> = { TEXT: '💬', VIDEO: '📹', RESULT_REVIEW: '🔬', HYBRID: '🔄' };
const statusMap: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: '대기', cls: 'bg-amber-100 text-amber-700' },
  ACCEPTED: { label: '수락', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행 중', cls: 'bg-emerald-100 text-emerald-700' },
  COMPLETED: { label: '완료', cls: 'bg-gray-100 text-gray-600' },
  CANCELLED: { label: '취소', cls: 'bg-red-100 text-red-600' },
  REFUNDED: { label: '환불', cls: 'bg-violet-100 text-violet-700' }, // 스키마 6종 — 빠지면 환불 건이 '대기'로 폴백(P4)
};
const fmt = (d: string) => kdate(d, 'datetimeShort');
// 1일 투여 횟수 — 총량 계산의 단일 정본(빈도 select 값과 짝)
const dosesPerDay = (frequency: string) => frequency === '1일 3회' ? 3 : frequency === '1일 2회' ? 2 : 1;

export default function RemoteConsultPage() {
  const fmtDur = useDurationText();
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  /**
   * 🔴 (2026-09-17 L3) 화상 제안·수락·상담 종료는 서버가 `@Roles(DOCTOR, ADMIN)` 이다 —
   *    nav 는 간호사에게도 이 화면을 열어 두는데(목록·경과 확인은 간호 업무다) 버튼은 그대로 그려
   *    간호사가 누를 때마다 403 이었다. 비대면 **진료 행위**라 서버를 넓히지 않고 화면이 감춘다.
   */
  const canConduct = useHasRole('DOCTOR');
  const [filter, setFilter] = useState<'pending' | 'active' | 'completed' | ''>('pending');
  const [showDeptConfig, setShowDeptConfig] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isSimple, setIsSimple] = useState(false);
  const [linkEncounter, setLinkEncounter] = useState(false);
  const queryClient = useQueryClient();

  // 통계
  const { data: statsData } = useQuery({ queryKey: ['rc-stats'], queryFn: () => apiClient.get<{ data: Stats }>('/api/v1/remote-consultations/stats') });
  const stats = statsData?.data as Stats | undefined;

  // 목록 (10초 폴링)
  const { data: listData, isLoading } = useQuery({
    queryKey: ['rc-list', filter],
    queryFn: () => apiClient.get<{ data: Consultation[] }>(`/api/v1/remote-consultations${filter ? `?status=${filter}` : ''}`),
    refetchInterval: pollMs('fast'),
  });
  const consultations = (listData?.data ?? []) as Consultation[];

  // 상세 (5초 폴링 — 채팅 실시간)
  const { data: detailData } = useQuery({
    queryKey: ['rc-detail', selectedId],
    queryFn: () => apiClient.get<{ data: Consultation & { messages: Message[] } }>(`/api/v1/remote-consultations/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: 5000,
  });
  const detail = detailData?.data as (Consultation & { messages: Message[] }) | undefined;

  // 답변
  const replyMut = useMutation({
    mutationFn: (body: { content: string; isMedicalAdvice: boolean; isSimpleInquiry: boolean }) =>
      apiClient.post(`/api/v1/remote-consultations/${selectedId}/reply`, body),
    onSuccess: () => {
      setReplyContent('');
      queryClient.invalidateQueries({ queryKey: ['rc-detail', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['rc-list'] });
      queryClient.invalidateQueries({ queryKey: ['rc-stats'] });
    },
  });

  // 종료
  const completeMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/remote-consultations/${selectedId}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rc-detail', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['rc-list'] });
      queryClient.invalidateQueries({ queryKey: ['rc-stats'] });
    },
  });

  // 화상 전환 제안
  const videoProposeMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/remote-consultations/${selectedId}/video/propose`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rc-detail', selectedId] }),
  });
  // 화상 전환 수락 (환자 요청 → Jitsi 룸 생성)
  const videoAcceptMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/remote-consultations/${selectedId}/video/accept`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rc-detail', selectedId] }),
  });
  // 화상 진료실 입장 (Jitsi 팝업)
  const enterVideo = async () => {
    try {
      const res = await apiClient.get<{ data: { token: string; roomId: string } }>(`/api/v1/remote-consultations/${selectedId}/video/token`);
      const d = (res?.data as { data?: { token?: string; roomId?: string } })?.data ?? (res?.data as { token?: string; roomId?: string });
      const token = d?.token; const roomId = d?.roomId;
      const baseEnv = process.env.NEXT_PUBLIC_JITSI_URL || '/meet';
      const base = baseEnv.startsWith('http') ? baseEnv : `${window.location.origin}${baseEnv}`;
      window.open(`${base}/${roomId}?jwt=${token}#config.prejoinPageEnabled=false`, 'rc-video', 'width=900,height=680');
    } catch { alert(tAttr('화상 진료실 입장에 실패했습니다.')); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900"><T k="비대면 진료 관리" /></h1>
          {isAdmin && (
            <button onClick={() => setShowDeptConfig(v => !v)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100">
              <T k="⚙️ 진료과 설정" />
            </button>
          )}
        </div>

        {isAdmin && showDeptConfig && <DeptConfigPanel onClose={() => setShowDeptConfig(false)} />}

        {/* 통계 */}
        {stats && (
          <div className={`grid ${isAdmin ? 'grid-cols-7' : 'grid-cols-4'} gap-3 mb-6`}>
            {[
              { label: '미답변', value: stats.pending, cls: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', show: true },
              { label: '진행 중', value: stats.active, cls: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', show: true },
              { label: '이번 달 완료', value: stats.completedMonth, cls: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', show: true },
              // 표본 없으면 '산출 불가' — ?? 100 으로 덮으면 서버의 정직한 null 을 다시 100 으로 위조한다
              { label: 'SLA 준수(24h내/답변)', value: <Ratio className="text-lg" numerator={stats.slaNumerator} denominator={stats.slaDenominator} unavailableHint="이번 달 답변 없음" />, cls: stats.slaComplianceRate == null ? 'text-gray-400' : stats.slaComplianceRate >= 90 ? 'text-emerald-600' : 'text-red-600', bg: 'bg-teal-50 border-teal-200', show: true },
              { label: '월 수익', value: `${Number(stats.totalRevenue ?? 0).toLocaleString()}원`, cls: 'text-purple-600', bg: 'bg-purple-50 border-purple-200', show: isAdmin },
              { label: '의사 인센티브(70%)', value: `${Number(stats.doctorIncentive ?? 0).toLocaleString()}원`, cls: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200', show: isAdmin },
              { label: '평균 응답', value: stats.avgResponseHours == null ? tAttr('산출 불가') : fmtDur(Math.round(stats.avgResponseHours * 60), tAttr('0분')), cls: 'text-gray-600', bg: 'bg-gray-50 border-gray-200', show: isAdmin },
            ].filter(s => s.show).map(s => (
              <div key={s.label} className={`${s.bg} border rounded-xl p-3 text-center`}>
                <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5"><T k={s.label} /></p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-4">
          {/* 좌측: 상담 목록 */}
          <div className="w-96 shrink-0">
            <div className="flex gap-1 mb-3">
              {[
                { key: 'pending', label: '미답변' },
                { key: 'active', label: '진행 중' },
                { key: 'completed', label: '완료' },
                { key: '', label: '전체' },
              ].map(f => (
                <button key={f.key} onClick={() => setFilter(f.key as any)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${filter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  <T k={f.label} />
                </button>
              ))}
            </div>

            <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto">
              {isLoading && <div className="text-center py-8 text-sm text-gray-400"><T k="로딩 중..." /></div>}
              {consultations.map(c => {
                const patient = c.patient;
                const st = statusMap[c.status] ?? statusMap.REQUESTED;
                const lastMsg = c.messages?.[0];
                const isSelected = selectedId === c.id;
                const hoursAgo = Math.round((Date.now() - new Date(c.createdAt).getTime()) / 3600000);
                const urgencyColor = hoursAgo >= 24 ? 'border-l-red-500' : hoursAgo >= 12 ? 'border-l-amber-400' : 'border-l-blue-400';
                return (
                  <button key={c.id} onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left p-3 rounded-xl border border-l-4 ${urgencyColor} transition-all ${isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white hover:bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{channelIcon[c.channel] ?? '💬'}</span>
                        <span className="text-sm font-semibold text-gray-900 truncate max-w-[180px]">{c.subject}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${st.cls}`}><T k={st.label} /></span>
                    </div>
                    {patient && <p className="text-xs text-gray-600">{patient.familyName}{patient.givenName} ({patient.mrn})</p>}
                    {lastMsg && <p className="text-[10px] text-gray-400 truncate mt-0.5">{lastMsg.content?.substring(0, 40)}</p>}
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-gray-400">{fmt(c.createdAt)} · {fmtDur(Math.round((Date.now() - new Date(c.createdAt).getTime()) / 60000), tAttr('방금'))} <T k="전@경과" /></p>
                      {isAdmin && c.feeAmount > 0 && <span className="text-[10px] text-blue-600"><Money value={c.feeAmount} /></span>}
                    </div>
                  </button>
                );
              })}
              {!isLoading && consultations.length === 0 && (
                <EmptyState icon="📋" title="상담이 없습니다" />
              )}
            </div>
          </div>

          {/* 우측: 상담 상세 */}
          <div className="flex-1 min-w-0">
            {!detail ? (
              <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                <p className="text-4xl mb-3">🩺</p>
                <p className="text-sm"><T k="좌측에서 상담을 선택하세요" /></p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border overflow-hidden">
                {/* 헤더 */}
                <div className="bg-gray-50 border-b px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">{channelIcon[detail.channel]} {detail.subject}</h2>
                      {detail.patient && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {detail.patient.familyName}{detail.patient.givenName} · {detail.patient.mrn} · {genderText(detail.patient.gender)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${(statusMap[detail.status] ?? statusMap.REQUESTED).cls}`}>
                        <T k={(statusMap[detail.status] ?? statusMap.REQUESTED).label} />
                      </span>
                      {/* 화상 전환 컨트롤 */}
                      {canConduct && detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED' && (
                        detail.videoRoomId ? (
                          <button onClick={enterVideo} className="px-3 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700"><T k="📹 화상 입장" /></button>
                        ) : detail.videoRequestedBy === 'PATIENT' ? (
                          <button onClick={() => videoAcceptMut.mutate()} disabled={videoAcceptMut.isPending}
                            className="min-h-[44px] px-3 py-2 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"><T k="📹 화상 요청 수락" /></button>
                        ) : detail.videoRequestedBy === 'DOCTOR' ? (
                          <span className="text-[10px] text-amber-600"><T k="화상 제안됨 · 환자 대기" /></span>
                        ) : (
                          <button onClick={() => videoProposeMut.mutate()} disabled={videoProposeMut.isPending}
                            className="min-h-[44px] px-3 py-2 border border-emerald-300 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-50 disabled:opacity-50"><T k="📹 화상 제안" /></button>
                        )
                      )}
                      {canConduct && detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED' && (
                        <button onClick={() => completeMut.mutate()}
                          className="min-h-[44px] px-3 py-2 bg-gray-700 text-white text-xs font-medium rounded-lg hover:bg-gray-800">
                          <T k="상담 종료" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 메시지 */}
                <div className="p-4 max-h-[calc(100vh-420px)] overflow-y-auto space-y-3">
                  {(detail.messages ?? []).map((m: Message) => (
                    <div key={m.id} className={`flex ${m.sender === 'PATIENT' ? 'justify-start' : m.sender === 'SYSTEM' ? 'justify-center' : 'justify-end'}`}>
                      {m.sender === 'SYSTEM' ? (
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{m.content}</span>
                      ) : (
                        <div className={`max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm ${
                          m.sender === 'PATIENT' ? 'bg-gray-100 text-gray-800 rounded-bl-md' : 'bg-blue-600 text-white rounded-br-md'
                        }`}>
                          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                          {m.isMedicalAdvice && m.sender === 'DOCTOR' && <p className="text-[8px] mt-1 opacity-60"><T k="의료 상담" /></p>}
                          <p className={`text-[9px] mt-1 ${m.sender === 'PATIENT' ? 'text-gray-400' : 'text-blue-200'}`}>
                            {fmt(m.createdAt)} {m.isRead ? '✓✓' : '✓'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 처방전 */}
                <PrescriptionSection consultationId={selectedId!} detail={detail} />

                {/* 답변 입력 */}
                {detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED' && (
                  <div className="border-t p-4 space-y-3">
                    <textarea value={replyContent} onChange={e => setReplyContent(e.target.value)}
                      placeholder={tAttr('답변을 입력하세요...')} rows={3}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-200" />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={isSimple} onChange={e => setIsSimple(e.target.checked)}
                            className="rounded border-gray-300 text-blue-600" />
                          <T k="단순 문의 (무료)" />
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={linkEncounter} onChange={e => setLinkEncounter(e.target.checked)}
                            className="rounded border-gray-300 text-blue-600" />
                          <T k="진료기록에 포함" />
                        </label>
                      </div>
                      <button onClick={() => replyMut.mutate({ content: replyContent, isMedicalAdvice: !isSimple, isSimpleInquiry: isSimple })}
                        disabled={!replyContent.trim() || replyMut.isPending}
                        className="min-h-[44px] px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                        <T k={replyMut.isPending ? '전송 중...' : '답변 전송'} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 처방 섹션 ──
function PrescriptionSection({ consultationId, detail }: { consultationId: string; detail: Consultation }) {
  const tAttr = useTAttr();
  const [showForm, setShowForm] = useState(false);
  const [meds, setMeds] = useState([{ medicationCodeId: '', dosage: '', frequency: '1일 3회', duration: 7, quantity: 21, route: '경구', instructions: '' }]);
  const queryClient = useQueryClient();

  const { data: rxData } = useQuery({
    queryKey: ['rc-prescriptions', consultationId],
    queryFn: () => apiClient.get<{ data: unknown[] }>(`/api/v1/remote-consultations/${consultationId}/prescriptions`),
  });
  const prescriptions = (rxData?.data ?? []) as { id: string; dosage: string; frequency: string; duration: number; quantity: number; route: string; instructions?: string; medicationCode?: { nameKo: string; code: string } }[];

  // 약품 검색
  const [searchQuery, setSearchQuery] = useState('');
  const { data: searchData } = useQuery({
    queryKey: ['med-search', searchQuery],
    queryFn: () => apiClient.get<{ data: unknown[] }>(`/api/v1/codes/medication?q=${searchQuery}&limit=10`),
    enabled: searchQuery.length >= 2,
  });
  const searchResults = (searchData?.data ?? []) as { id: string; nameKo: string; code: string }[];

  const prescribeMut = useMutation({
    mutationFn: (body: { medications: typeof meds; dispensingType: string }) =>
      apiClient.post(`/api/v1/remote-consultations/${consultationId}/prescribe`, body),
    onSuccess: () => {
      setShowForm(false);
      setMeds([{ medicationCodeId: '', dosage: '', frequency: '1일 3회', duration: 7, quantity: 21, route: '경구', instructions: '' }]);
      queryClient.invalidateQueries({ queryKey: ['rc-prescriptions', consultationId] });
      queryClient.invalidateQueries({ queryKey: ['rc-detail', consultationId] });
    },
  });

  if (detail.status === 'COMPLETED' || detail.status === 'CANCELLED') {
    if (prescriptions.length === 0) return null;
  }

  return (
    <div className="border-t">
      {/* 기존 처방 목록 */}
      {prescriptions.length > 0 && (
        <div className="px-4 py-3 bg-emerald-50">
          <p className="text-xs font-semibold text-emerald-800 mb-2">처방전 ({prescriptions.length}<Unit><T k="건" /></Unit>)</p>
          <div className="space-y-1.5">
            {prescriptions.map(rx => (
              <div key={rx.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-xs">
                <div>
                  <span className="font-medium text-gray-900">{rx.medicationCode?.nameKo ?? tAttr('약품')}</span>
                  <span className="text-gray-500 ml-2">{rx.dosage} · {rx.frequency} · {rx.duration}<Unit><T k="일" /></Unit> · {rx.route}</span>
                </div>
                <span className="text-emerald-600 font-medium">{rx.quantity}정</span>
              </div>
            ))}
          </div>
          {detail.encounterId && (
            <a href={`/print/prescription/${detail.encounterId}`} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-2 text-xs text-blue-600 hover:underline"><T k="처방전 출력/인쇄 →" /></a>
          )}
        </div>
      )}

      {/* 처방 발행 버튼 */}
      {detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED' && !showForm && (
        <div className="px-4 py-2">
          <button onClick={() => setShowForm(true)}
            className="w-full py-2 border border-dashed border-emerald-300 rounded-xl text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors">
            <T k="+ 처방전 발행" />
          </button>
        </div>
      )}

      {/* 처방 입력 폼 */}
      {showForm && (
        <div className="px-4 py-3 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700"><T k="처방 입력" /></p>
            <button onClick={() => setShowForm(false)} className="text-xs text-gray-400 hover:text-gray-600"><T k="닫기" /></button>
          </div>

          {meds.map((med, i) => (
            <div key={i} className="bg-white rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">약품 {i + 1}</span>
                {meds.length > 1 && <button onClick={() => setMeds(meds.filter((_, j) => j !== i))} className="text-[10px] text-red-400"><T k="삭제" /></button>}
              </div>

              {/* 약품 검색 */}
              {!med.medicationCodeId ? (
                <div>
                  <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder={tAttr('약품명 검색...')} className="w-full border rounded-lg px-2.5 py-1.5 text-xs" />
                  {searchResults.length > 0 && (
                    <div className="mt-1 border rounded-lg max-h-32 overflow-y-auto">
                      {searchResults.map(r => (
                        <button key={r.id} onClick={() => {
                          const updated = [...meds]; updated[i].medicationCodeId = r.id; setMeds(updated); setSearchQuery('');
                        }} className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50 border-b last:border-0">
                          {r.nameKo} <span className="text-gray-400">({r.code})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs font-medium text-gray-900">
                  {searchResults.find(r => r.id === med.medicationCodeId)?.nameKo ?? tAttr('선택됨')}
                  <button onClick={() => { const updated = [...meds]; updated[i].medicationCodeId = ''; setMeds(updated); }}
                    className="ml-2 text-[10px] text-red-400"><T k="변경" /></button>
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                <input value={med.dosage} onChange={e => { const u = [...meds]; u[i].dosage = e.target.value; setMeds(u); }}
                  placeholder={tAttr('용량 (500mg)')} className="border rounded-lg px-2 py-1.5 text-xs" />
                {/* 🔴 총량 = 일수 × 1일 횟수 — 어느 쪽을 바꿔도 같이 재계산한다. 종전엔 일수 변경에서만
                    계산돼 '1일 3회→1회'로 바꾸면 7일치가 21정 그대로 발행됐다(최대 3배 과다). */}
                <select value={med.frequency} onChange={e => { const u = [...meds]; u[i].frequency = e.target.value; u[i].quantity = u[i].duration * dosesPerDay(e.target.value); setMeds(u); }}
                  className="border rounded-lg px-2 py-1.5 text-xs">
                  <option value="1일 1회">{tAttr('1일 1회')}</option><option value="1일 2회">{tAttr('1일 2회')}</option><option value="1일 3회">{tAttr('1일 3회')}</option><option value="필요 시(PRN)">{tAttr('필요 시(PRN)')}</option>
                </select>
                <input type="number" value={med.duration} onChange={e => { const u = [...meds]; u[i].duration = +e.target.value; u[i].quantity = +e.target.value * dosesPerDay(u[i].frequency); setMeds(u); }}
                  placeholder={tAttr('일수')} className="border rounded-lg px-2 py-1.5 text-xs" />
              </div>
              <input value={med.instructions} onChange={e => { const u = [...meds]; u[i].instructions = e.target.value; setMeds(u); }}
                placeholder={tAttr('복용 지시 (선택)')} className="w-full border rounded-lg px-2.5 py-1.5 text-xs" />
            </div>
          ))}

          <button onClick={() => setMeds([...meds, { medicationCodeId: '', dosage: '', frequency: '1일 3회', duration: 7, quantity: 21, route: '경구', instructions: '' }])}
            className="text-xs text-blue-600 hover:underline"><T k="+ 약품 추가" /></button>

          <div className="flex gap-2">
            <button onClick={() => prescribeMut.mutate({ medications: meds, dispensingType: 'EXTERNAL' })}
              disabled={meds.some(m => !m.medicationCodeId || !m.dosage) || prescribeMut.isPending}
              className="flex-1 min-h-[44px] px-3 py-2 bg-emerald-600 text-white text-xs font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50">
              <T k={prescribeMut.isPending ? '처방 중...' : '원외 처방 발행'} />
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2.5 bg-gray-100 text-gray-600 text-xs rounded-xl hover:bg-gray-200"><T k="취소" /></button>
          </div>

          <p className="text-[10px] text-gray-400"><T k="처방전 유효기간: 발행일로부터 3일 · 원외 약국에서 수령" /></p>
        </div>
      )}
    </div>
  );
}

/* ── 진료과별 비대면 ON/OFF 설정 (ADMIN, 기획서 §12.2) ── */
const DEPT_CATALOG: { name: string; fit: '높음' | '중간' | '낮음' | '불가' }[] = [
  { name: '내과', fit: '높음' }, { name: '가정의학과', fit: '높음' }, { name: '정신건강의학과', fit: '높음' }, { name: '피부과', fit: '높음' },
  { name: '정형외과', fit: '중간' }, { name: '재활의학과', fit: '중간' }, { name: '이비인후과', fit: '중간' }, { name: '소아청소년과', fit: '중간' },
  { name: '외과', fit: '낮음' }, { name: '산부인과', fit: '낮음' }, { name: '안과', fit: '낮음' }, { name: '치과', fit: '낮음' }, { name: '비뇨의학과', fit: '낮음' },
  { name: '응급의학과', fit: '불가' },
];
const fitCls: Record<string, string> = { 높음: 'bg-emerald-100 text-emerald-700', 중간: 'bg-amber-100 text-amber-700', 낮음: 'bg-orange-100 text-orange-700', 불가: 'bg-red-100 text-red-700' };

function DeptConfigPanel({ onClose }: { onClose: () => void }) {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['rc-dept-config'],
    queryFn: () => apiClient.get<{ data: { enabled: string[] | null; infectiousMode: boolean } }>('/api/v1/remote-consultations/config/departments'),
  });
  const cfg = data?.data as { enabled: string[] | null; infectiousMode: boolean } | undefined;
  // 🔴 서버의 `enabled: null` 은 **미설정 = 전체 허용**이다. 종전엔 이 상태에서 적합도 '높음/중간'
  //    9개과를 **선택된 것처럼** 칠하고 저장 버튼도 '9개 진료과'라고 적어, 관리자는 "지금 외과는
  //    비대면 불가"로 읽었지만 실제로는 허용 중이었다(설정 화면 오표기 — 계획서 §10 리스크).
  //    이제 두 모드를 명시하고, 되돌리기(전체 허용) 경로도 연다.
  const [restrict, setRestrict] = useState(false); // false = 전체 허용(미설정)
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [infectious, setInfectious] = useState(false);
  const [initialized, setInitialized] = useState(false);

  if (cfg && !initialized) {
    setRestrict(!!cfg.enabled);
    setEnabled(new Set(cfg.enabled ?? []));
    setInfectious(cfg.infectiousMode);
    setInitialized(true);
  }
  const sel = enabled;
  const toggle = (name: string) => { const n = new Set(sel); n.has(name) ? n.delete(name) : n.add(name); setEnabled(n); };
  const loadRecommended = () => setEnabled(new Set(DEPT_CATALOG.filter(d => d.fit === '높음' || d.fit === '중간').map(d => d.name)));

  const saveMut = useMutation({
    // 전체 허용은 `null` 로 저장한다 — 빈 배열은 '아무 과도 불가'라는 정반대 뜻이다
    mutationFn: () => apiClient.patch('/api/v1/remote-consultations/config/departments', { enabled: restrict ? Array.from(sel) : null, infectiousMode: infectious }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rc-dept-config'] }); onClose(); },
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900"><T k="비대면 가능 진료과 설정" /></h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>
      <p className="text-[11px] text-gray-500 mb-3"><T k="적합도는 기획 권고입니다 — 운영 정책에 따라 조정하세요." /></p>

      {/* 현재 상태를 먼저 사실대로 말한다 */}
      <div className={`text-[11px] rounded-lg px-3 py-2 mb-3 ${restrict ? 'bg-blue-50 text-blue-800' : 'bg-emerald-50 text-emerald-800'}`}>
        {restrict
          ? <><T k="현재" /> <b><T k="선택한 진료과만" /></b> <T k="비대면 진료가 가능합니다." /></>
          : <><T k="현재" /> <b><T k="제한 없음" /></b> <T k="— 모든 진료과에서 비대면 진료가 가능합니다(설정 미등록)." /></>}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={!restrict} onChange={() => setRestrict(false)} />
          <span className="text-gray-700"><T k="전체 허용" /></span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={restrict} onChange={() => setRestrict(true)} />
          <span className="text-gray-700"><T k="선택한 진료과만 허용" /></span>
        </label>
        {restrict && (
          <button onClick={loadRecommended} className="ml-auto px-2.5 py-1 text-[11px] text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50">
            <T k="권고안 불러오기(적합도 높음·중간)" />
          </button>
        )}
      </div>

      <div className={`grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4 ${restrict ? '' : 'opacity-50 pointer-events-none'}`}>
        {DEPT_CATALOG.map(d => (
          <button key={d.name} onClick={() => toggle(d.name)} disabled={!restrict}
            className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-left transition-all ${restrict && sel.has(d.name) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <span className="text-xs font-medium text-gray-800"><T k={d.name} /></span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${fitCls[d.fit]}`}><T k={d.fit} /></span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-700 mb-4">
        <input type="checkbox" checked={infectious} onChange={e => setInfectious(e.target.checked)} className="rounded" />
        <T k="감염병 유행 모드 (초진 환자도 텍스트 상담 한시 허용)" />
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg"><T k="취소" /></button>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || (restrict && sel.size === 0)}
          title={restrict && sel.size === 0 ? tAttr('한 과도 선택하지 않으면 아무도 비대면 진료를 할 수 없습니다') : undefined}
          className="min-h-[44px] px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saveMut.isPending ? tAttr('저장 중...') : restrict ? `${tAttr('저장')} (${sel.size}${tAttr('개 진료과만 허용')})` : tAttr('저장 (전체 허용)')}
        </button>
      </div>
    </div>
  );
}
