'use client';

import { useState } from 'react';
import { auditNewWindowPrint } from '@/components/print/PrintGuard';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { DraftBanner, recordDraftApplied, warnIfDraftNotRecorded, type DraftProvenance } from '@/components/ai/DraftBanner';
import { proposalIdFrom, markProposalPresented } from '@/lib/ai-proposal';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { canCloseConsult, canReplyConsult } from '@/lib/consultation-close';
import { useAuthStore } from '@/stores/auth-store';
import { KDate, StaffName } from '@/components/ui/display';

const referralSchema = z.object({
  targetDepartment: z.string().min(1, '진료과를 선택하세요'),
  targetDoctorId: z.string().optional(),
  reason: z.string().min(1, '의뢰 사유를 입력하세요'),
  clinicalQuestion: z.string().optional(),
  urgency: z.string().min(1),
});
type ReferralForm = z.infer<typeof referralSchema>;

interface ConsultRecord {
  id: string;
  toDepartment: string;
  reason: string;
  clinicalQuestion?: string;
  urgency: string;
  status: string;
  replyContent?: string;
  recommendations?: string;
  repliedAt?: string;
  createdAt: string;
  requestingDoctorId?: string | null;
  toDoctorId?: string | null;
  requestingDoctor?: { familyName?: string; givenName?: string; department?: string };
  toDoctor?: { familyName?: string; givenName?: string };
  /** 의뢰한 진료(환자 전체 조회 · 2026-10-10) */
  encounter?: { id: string; createdAt?: string } | null;
  replyDoctor?: { familyName?: string; givenName?: string };
  /** 종결 — 누가·언제(2026-10-10 신설 · 그 전에 종결된 협진은 null = 기록 없음) */
  closedAt?: string | null;
  closedBy?: { familyName?: string; givenName?: string } | null;
}

interface ReferralLetterRecord {
  id: string;
  type: string;
  toDepartment: string;
  urgency: string;
  status: string;
  content: string;
  letterNumber?: string;
  aiModel?: string;
  editedByDoctor: boolean;
  signedAt?: string;
  createdAt: string;
  fromDoctor?: { familyName?: string; givenName?: string; department?: string };
  toDoctor?: { familyName?: string; givenName?: string };
}

const DEPARTMENTS = [
  '내과', '외과', '정형외과', '신경외과', '산부인과', '소아청소년과',
  '이비인후과', '안과', '피부과', '비뇨의학과', '정신건강의학과',
  '재활의학과', '가정의학과', '응급의학과', '영상의학과', '마취통증의학과',
  '치과', '성형외과', '흉부외과', '심장내과',
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  REQUESTED: { label: '의뢰 대기', color: 'bg-amber-100 text-amber-700' },
  ACCEPTED: { label: '접수됨', color: 'bg-blue-100 text-blue-700' },
  REPLIED: { label: '회신 완료', color: 'bg-emerald-100 text-emerald-700' },
  CLOSED: { label: '종료', color: 'bg-gray-100 text-gray-600' },
};

const LETTER_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '초안', color: 'bg-gray-100 text-gray-600' },
  SIGNED: { label: '서명', color: 'bg-blue-100 text-blue-700' },
  SENT: { label: '전송', color: 'bg-indigo-100 text-indigo-700' },
  RECEIVED: { label: '수신', color: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: '거절', color: 'bg-red-100 text-red-700' },
  VOIDED: { label: '무효', color: 'bg-gray-200 text-gray-500' },
  ARCHIVED: { label: '보관', color: 'bg-gray-100 text-gray-500' },
};

const URGENCY_MAP: Record<string, { label: string; color: string }> = {
  ROUTINE: { label: '일반', color: 'bg-gray-100 text-gray-600' },
  URGENT: { label: '긴급', color: 'bg-orange-100 text-orange-700' },
  EMERGENT: { label: '응급', color: 'bg-red-100 text-red-700' },
};

export function ReferralTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  /** 🔴 초안≠확정 — 초안 생성은 협진을 만들지 않는다(서버도 더 이상 만들지 않는다). 전송은 사람이 누른다. */
  const [draftProvenance, setDraftProvenance] = useState<DraftProvenance | null>(null);
  /**
   * 서버 제안 원장 id(P1) — 초안을 실제로 그린 시점에 `presented`, 사람이 협진을 전송하는 시점에 결정(수용/수정)을 남긴다.
   * 🔴 **초안을 만든 시점에 결정을 남기지 않는다** — 그건 사람이 읽기도 전에 "무수정 수용"을 기록하는 것이다(P16).
   */
  const [draftProposalId, setDraftProposalId] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'form' | 'letters'>('form');

  const { data: encounterData, isError: encIsError, error: encError, refetch: refetchEnc } = useQuery({
    queryKey: ['patient-latest-encounter', patientId],
    queryFn: () => apiClient.get<{ data: Array<{ id: string }> }>(`/api/v1/encounters?patientId=${patientId}&limit=1`),
  });
  const _encRaw = encounterData?.data as Array<{ id: string }> | { data?: Array<{ id: string }> } | undefined;
  const encounters = Array.isArray(_encRaw) ? _encRaw : ((_encRaw as { data?: Array<{ id: string }> } | undefined)?.data ?? []);
  const latestEncounterId = encounters[0]?.id;

  // 🔴 (2026-10-10) 종전엔 **가장 최근 진료 한 건**의 협진만 읽어 그 전 진료에서 의뢰한 협진·회신이 차트에서 사라졌다 — 환자 전체
  const { data: consultData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['consultations', 'patient', patientId],
    queryFn: () => apiClient.get<{ data: ConsultRecord[]; meta?: { total: number; truncated: boolean } }>(`/api/v1/consultations/patient/${patientId}`),
    enabled: !!patientId,
  });
  const _conRaw = consultData?.data as ConsultRecord[] | { data?: ConsultRecord[] } | undefined;
  const records: ConsultRecord[] = Array.isArray(_conRaw) ? _conRaw : ((_conRaw as { data?: ConsultRecord[] } | undefined)?.data ?? []);
  const consultMeta = (consultData as { meta?: { total: number; truncated: boolean } } | undefined)?.meta;

  // 의뢰서 목록
  const { data: lettersData } = useQuery({
    queryKey: ['referral-letters', patientId],
    queryFn: () => apiClient.get<{ data: ReferralLetterRecord[] }>(`/api/v1/referral-letters/by-patient/${patientId}`),
  });
  const _letRaw = lettersData?.data as ReferralLetterRecord[] | { data?: ReferralLetterRecord[] } | undefined;
  const letters: ReferralLetterRecord[] = Array.isArray(_letRaw) ? _letRaw : ((_letRaw as { data?: ReferralLetterRecord[] } | undefined)?.data ?? []);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<ReferralForm>({
    resolver: zodResolver(referralSchema),
    defaultValues: { targetDepartment: '', targetDoctorId: '', reason: '', clinicalQuestion: '', urgency: 'ROUTINE' },
  });

  const selectedDept = watch('targetDepartment');

  // 수신 과 목록(실제 활성 의사 보유 과 — 알림 대상 일치 보장), 실패 시 정적 목록
  const { data: deptData, isError: deptIsError, error: deptError, refetch: refetchDept } = useQuery({
    queryKey: ['consult-departments'],
    queryFn: () => apiClient.get<{ data: string[] }>('/api/v1/consultations/departments').then(r => (r as { data?: string[] })?.data ?? r),
  });
  const departments: string[] = (Array.isArray(deptData) ? deptData : ((deptData as { data?: string[] })?.data ?? DEPARTMENTS)) as string[];

  // 지정의 후보(선택 과 소속 의사) — 선택 시 toDoctorId 지정, 미선택 시 과 단위 의뢰
  const { data: docData } = useQuery({
    queryKey: ['consult-doctors', selectedDept],
    queryFn: () => apiClient.get<{ data: { id: string; familyName?: string; givenName?: string }[] }>(`/api/v1/consultations/doctors?department=${encodeURIComponent(selectedDept)}`),
    enabled: !!selectedDept,
  });
  const _docRaw = docData?.data as { id: string; familyName?: string; givenName?: string }[] | { data?: { id: string; familyName?: string; givenName?: string }[] } | undefined;
  const doctors = Array.isArray(_docRaw) ? _docRaw : (_docRaw?.data ?? []);

  const createMut = useMutation({
    mutationFn: (data: ReferralForm) => apiClient.post('/api/v1/consultations', {
      encounterId: latestEncounterId,
      toDepartment: data.targetDepartment,
      toDoctorId: data.targetDoctorId || undefined,
      reason: data.reason,
      clinicalQuestion: data.clinicalQuestion,
      urgency: data.urgency,
    }),
    onSuccess: async (_res, vars) => {
      // 🔴 사람이 초안을 정본(협진)으로 보낸 **이 시점**이 제안의 결정 시점이다.
      //    고쳤는지는 원본(aiDraft)과 보낸 글을 비교해 말한다 — 고쳤는데 ACCEPTED 로 남기면 수용률이 거짓이 된다.
      //    (서버는 `finalText` 로 수정량을 다시 잰다 — 편집거리 정본은 서버 하나다.)
      if (draftProposalId && aiDraft != null) {
        const recorded = await recordDraftApplied({
          resourceType: 'REFERRAL', source: 'GENERATOR', patientId,
          field: '의뢰 사유', model: draftProvenance?.model ?? null, textLength: vars.reason.length,
          proposalId: draftProposalId,
          decision: vars.reason === aiDraft ? 'ACCEPTED' : 'EDITED',
          finalText: vars.reason,
          clientContext: 'ReferralTab/협진 의뢰 전송',
        });
        // 배너를 곧 지운다 — 기록 실패는 여기서 말하지 않으면 아무 데도 남지 않는다
        warnIfDraftNotRecorded(recorded, tAttr);
      }
      qc.invalidateQueries({ queryKey: ['consultations'] });
      reset();
      setAiDraft(null);
      setDraftProvenance(null);
      setDraftProposalId(null);
      toast.success('협진 의뢰가 전송되었습니다.');
    },
    onError: () => toast.error('협진 의뢰 전송에 실패했습니다.'),
  });

  const me = useAuthStore((st) => st.user);
  // 회신 쓰기(2026-10-10) — 종전엔 차트에서 회신을 볼 수만 있었다(쓰기는 협진 화면). 수신자 규칙은 서버와 같다.
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyRec, setReplyRec] = useState('');
  const replyMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consultations/${id}/reply`, { replyContent: replyText.trim(), ...(replyRec.trim() ? { recommendations: replyRec.trim() } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations'] });
      qc.invalidateQueries({ queryKey: ['inbox-consultations'] });
      setReplyFor(null); setReplyText(''); setReplyRec('');
      toast.success(tAttr('회신했습니다.'));
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('회신하지 못했습니다.')),
  });
  const closeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consultations/${id}/close`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations'] });
      qc.invalidateQueries({ queryKey: ['doctor-my-followups'] });
      toast.success('협진이 종료되었습니다.');
    },
    // 🔴 종전엔 실패 처리가 없어 권한 밖(간호사·남의 협진) 종결이 조용히 실패했다
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('협진을 종료하지 못했습니다.')),
  });

  /**
   * WeRU.B 초안 생성 — **의뢰서 초안(DRAFT)만** 만든다.
   *
   * 🔴 종전엔 이 버튼 하나가 서버에서 `Consultation`(status REQUESTED)까지 만들어,
   *    의사가 초안을 읽어보기도 전에 타과 협진 목록에 의뢰가 접수돼 있었다(사람 승인 게이트 없음).
   *    이제 협진 정본은 의뢰서를 **서명**할 때(또는 아래 '협진 의뢰 전송' 을 누를 때)만 생긴다.
   */
  const generateAiDraft = async () => {
    if (!selectedDept) { toast.error('의뢰 진료과를 먼저 선택하세요'); return; }
    setAiGenerating(true);
    try {
      const res = await apiClient.post<{ data: { content: string; aiModel?: string; proposalId?: string | null } }>('/api/v1/referral-letters/generate', {
        type: 'CONSULTATION_REQUEST',
        patientId,
        encounterId: latestEncounterId,
        toDepartment: selectedDept,
        urgency: watch('urgency'),
      });
      const data = (res as any)?.data?.data ?? (res as any)?.data;
      const content = data?.content ?? '';
      if (content) {
        setAiDraft(content);
        setValue('reason', content);
        // 협진(Consultation)은 아직 없다 — 목록을 흔들지 않는다(있지도 않은 접수를 새로고침으로 암시하지 않는다)
        qc.invalidateQueries({ queryKey: ['referral-letters', patientId] });
        // 제안 원장: 초안이 폼에 실제로 그려진 이 시점이 **노출(presented)** 이다. 결정은 아직 아니다.
        const proposalId = proposalIdFrom(data);
        setDraftProposalId(proposalId);
        if (proposalId) await markProposalPresented(proposalId, 'ReferralTab/의뢰 사유');
        const recorded = await recordDraftApplied({
          resourceType: 'REFERRAL', source: 'GENERATOR', patientId,
          field: '의뢰 사유', model: data?.aiModel ?? null, textLength: String(content).length,
        });
        setDraftProvenance({
          source: 'GENERATOR', fields: ['의뢰 사유'], appliedAt: new Date().toISOString(),
          model: data?.aiModel ?? null, recorded, proposalId,
        });
        toast.success(`${AI_ORIGIN_TEXT} 초안이 의뢰 사유에 적용되었습니다 — 검토·수정 후 '협진 의뢰 전송'을 누르세요.`);
      } else {
        toast.error(`${AI_ORIGIN_TEXT} 초안 생성에 실패했습니다. 직접 작성해주세요.`);
      }
    } catch {
      toast.error(`${AI_ORIGIN_TEXT} 서버 연결 실패. 직접 작성해주세요.`);
    }
    setAiGenerating(false);
  };

  // 의뢰서 서명+전송 — 서명 시점에 서버가 제안 원장에 수용/수정을 남긴다(FE 가 따로 결정을 보내지 않는다)
  const signAndSend = useMutation({
    mutationFn: (id: string) => apiClient.patch<{ data?: { aiProposal?: { recorded?: boolean } | null } }>(`/api/v1/referral-letters/${id}/sign-and-send`, {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['referral-letters', patientId] });
      toast.success('의뢰서가 서명·전송되었습니다.');
      // 🔴 원장 기록 실패를 조용히 넘기지 않는다(서명은 됐고 기록만 실패한 것 — 둘을 섞어 말하지 않는다)
      const p = (res as { data?: { aiProposal?: { recorded?: boolean } | null; data?: { aiProposal?: { recorded?: boolean } | null } } } | undefined)?.data;
      const aiProposal = p && 'aiProposal' in p ? p.aiProposal : p?.data?.aiProposal;
      if (aiProposal && aiProposal.recorded === false) {
        toast.error(`서명·전송은 완료됐으나 ${AI_ORIGIN_TEXT} 초안 수용 사실을 제안 원장에 남기지 못했습니다.`);
      }
    },
    onError: () => toast.error('서명/전송 실패'),
  });

  // PDF 미리보기
  const showPreview = async (id: string) => {
    try {
      const res = await apiClient.get<{ data: { html: string } }>(`/api/v1/referral-letters/${id}/html`);
      const html = (res as any)?.data?.data?.html ?? (res as any)?.data?.html ?? '';
      setPreviewHtml(html);
    } catch {
      toast.error('미리보기 로드 실패');
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <div className="space-y-6">
      {/* 탭 전환 */}
      <div className="flex gap-2 border-b border-gray-200 pb-1">
        <button onClick={() => setActiveTab('form')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${activeTab === 'form' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          <T k="협진 의뢰 작성" />
        </button>
        <button onClick={() => setActiveTab('letters')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg relative ${activeTab === 'letters' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          {AI_ORIGIN_TEXT} <T k="의뢰서 문서" />
          {letters.length > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center">{letters.length}</span>}
        </button>
      </div>

      {activeTab === 'form' && (
        <>
          {/* 의뢰 작성 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900"><T k="협진 의뢰서 작성" /></h3>
              {latestEncounterId && (
                <button onClick={generateAiDraft} disabled={aiGenerating || !selectedDept}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-violet-700 hover:to-indigo-700 disabled:opacity-40 transition-all">
                  {aiGenerating ? (
                    <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> {AI_ORIGIN_TEXT} <T k="생성 중..." /></>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> {AI_ORIGIN_TEXT} <T k="초안 생성" /></>
                  )}
                </button>
              )}
            </div>

            {/* 정본 부품(DraftBanner) — 로컬 배너를 따로 만들지 않는다(정본이 둘이면 갈라진다) */}
            {aiDraft && <DraftBanner provenance={draftProvenance} signLabel="협진 의뢰 전송" className="mb-4" />}

            {/* 🔴 진료 조회 실패를 "진료가 없습니다"로 말하지 않는다 */}
            {encIsError ? (
              <QueryErrorFallback error={encError} onRetry={refetchEnc} />
            ) : !latestEncounterId ? (
              <p className="text-sm text-amber-600 bg-amber-50 rounded-xl p-4"><T k="진행 중인 진료(Encounter)가 없습니다. 진료를 먼저 생성하세요." /></p>
            ) : (
              <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}><T k="의뢰 진료과" /></label>
                    <select {...register('targetDepartment', { onChange: () => setValue('targetDoctorId', '') })} className={inputCls}>
                      <option value="">{tAttr('진료과를 선택하세요')}</option>
                      {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                    </select>
                    {/* 🔴 아래 목록은 조회 실패 시 정적 폴백이다 — 활성 의사 보유 과와 다를 수 있음을 밝힌다 */}
                    {deptIsError && <QueryErrorFallback error={deptError} onRetry={refetchDept} size="compact" className="mt-1" />}
                    {errors.targetDepartment && <p className="text-xs text-red-500 mt-1">{errors.targetDepartment.message}</p>}
                  </div>
                  <div>
                    <label className={labelCls}><T k="긴급도" /></label>
                    <div className="flex gap-2 mt-1">
                      {Object.entries(URGENCY_MAP).map(([key, { label, color }]) => (
                        <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" value={key} {...register('urgency')} className="text-blue-600" />
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                {selectedDept && (
                  <div>
                    <label className={labelCls}><T k="지정의" /> <span className="text-gray-400 font-normal">(선택 안 하면 {selectedDept} 전체 의료진에게 의뢰)</span></label>
                    <select {...register('targetDoctorId')} className={inputCls}>
                      <option value="">{tAttr('과 단위 의뢰 (지정 안 함)')}</option>
                      {doctors.map(d => <option key={d.id} value={d.id}>{d.familyName ?? ''}{d.givenName ?? ''}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className={labelCls}><T k="의뢰 사유" /> {aiDraft && <span className="text-violet-500 font-normal">({AI_ORIGIN_TEXT} <T k="초안 적용됨" />)</span>}</label>
                  <textarea rows={6} {...register('reason')} placeholder={`의뢰 사유를 입력하세요...&#10;&#10;${AI_ORIGIN_TEXT} 초안 생성 버튼을 누르면 환자 데이터 기반으로 자동 작성됩니다.`} className={`${inputCls} resize-none ${aiDraft ? 'border-violet-300 bg-violet-50/30' : ''}`} />
                  {errors.reason && <p className="text-xs text-red-500 mt-1">{errors.reason.message}</p>}
                </div>
                <div>
                  <label className={labelCls}><T k="임상 질문 (Clinical Question)" /></label>
                  <textarea rows={3} {...register('clinicalQuestion')} placeholder={tAttr('구체적인 임상 질문을 입력하세요...')} className={`${inputCls} resize-none`} />
                </div>
                <div className="flex gap-3">
                  <button type="submit" disabled={createMut.isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40">
                    {createMut.isPending ? <T k="전송중..." /> : <T k="협진 의뢰 전송" />}
                  </button>
                  {/* 🔴 폼에서 지우는 것은 의뢰서(DRAFT) 폐기가 아니다 — 제안을 '거부'로 닫지 않는다.
                      그 의뢰서는 문서 탭에서 여전히 서명될 수 있고, 그때 서버가 수용/수정을 남긴다. */}
                  {aiDraft && (
                    <button type="button" onClick={() => { setAiDraft(null); setDraftProvenance(null); setDraftProposalId(null); setValue('reason', ''); }}
                      className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl">
                      <T k="초안 지우기" />
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* 의뢰/회신 이력 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="의뢰/회신 이력" /></h3>
            {isError ? (
              <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
            ) : isLoading ? (
              <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            ) : records.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm"><T k="의뢰/회신 이력이 없습니다" /></p>
              </div>
            ) : (
              <div className="space-y-3">
                {records.map(r => {
                  const st = STATUS_MAP[r.status] ?? { label: r.status, color: 'bg-gray-100' };
                  const urg = URGENCY_MAP[r.urgency] ?? { label: r.urgency, color: 'bg-gray-100' };
                  const isExpanded = expandedId === r.id;
                  return (
                    <div key={r.id} className={`border rounded-xl overflow-hidden transition-all ${r.status === 'REPLIED' ? 'border-emerald-200' : r.urgency === 'EMERGENT' ? 'border-red-200' : 'border-gray-200'}`}>
                      <button onClick={() => setExpandedId(isExpanded ? null : r.id)} className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 text-left">
                        <div className="flex items-center gap-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color}`}>{st.label}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${urg.color}`}>{urg.label}</span>
                          <span className="text-sm font-medium text-gray-900">{r.toDepartment}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {canReplyConsult(r, me) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800" data-consult-awaiting-me={r.id}><T k="내 회신 대기" /></span>}
                          <span className="text-xs text-gray-400">{kdate(new Date(r.createdAt))}</span>
                          <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-5 pb-4 space-y-3 border-t border-gray-100">
                          <div className="pt-3">
                            <p className="text-xs font-bold text-gray-500 mb-1"><T k="의뢰 사유" /></p>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.reason}</p>
                          </div>
                          {r.clinicalQuestion && (
                            <div>
                              <p className="text-xs font-bold text-gray-500 mb-1"><T k="임상 질문" /></p>
                              <p className="text-sm text-gray-800">{r.clinicalQuestion}</p>
                            </div>
                          )}
                          {r.replyContent && (
                            <div className="bg-emerald-50 rounded-xl p-4 mt-2">
                              <p className="text-xs font-bold text-emerald-700 mb-1"><T k="회신 내용" /></p>
                              <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.replyContent}</p>
                              {r.recommendations && (
                                <div className="mt-2 pt-2 border-t border-emerald-200">
                                  <p className="text-xs font-bold text-emerald-700 mb-1"><T k="권고사항" /></p>
                                  <p className="text-sm text-gray-800">{r.recommendations}</p>
                                </div>
                              )}
                            </div>
                          )}
                          {canReplyConsult(r, me) && (replyFor === r.id ? (
                            <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3" data-consult-reply-form={r.id}>
                              <label className="block text-xs font-bold text-gray-600"><T k="회신 내용" /> *
                                <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal" />
                              </label>
                              <label className="block text-xs font-bold text-gray-600"><T k="권고사항" />
                                <textarea value={replyRec} onChange={(e) => setReplyRec(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal" />
                              </label>
                              <div className="flex gap-2">
                                <button type="button" disabled={!replyText.trim() || replyMut.isPending} onClick={() => replyMut.mutate(r.id)} data-consult-reply-submit={r.id}
                                  className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40"><T k="회신 보내기" /></button>
                                <button type="button" onClick={() => { setReplyFor(null); setReplyText(''); setReplyRec(''); }} className="min-h-[44px] rounded-lg border px-4 text-sm"><T k="닫기" /></button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setReplyFor(r.id); setReplyText(''); setReplyRec(''); }} data-consult-reply-open={r.id}
                              className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"><T k="회신 쓰기" /></button>
                          ))}
                          {/* 종결 기록 — 2026-10-10 전에 종결된 협진은 누가·언제인지 남지 않았다(기록 없음으로 말한다 · 지어내지 않는다) */}
                          {r.status === 'CLOSED' && (
                            <p className="text-[11px] text-gray-500" data-consult-closed={r.id}>
                              <T k="종결" />: <StaffName familyName={r.closedBy?.familyName} givenName={r.closedBy?.givenName} /> · <KDate value={r.closedAt} mode="datetime" unknown="UNRECORDED" />
                            </p>
                          )}
                          {r.status === 'REPLIED' && canCloseConsult(r, me) && (
                            <button onClick={() => closeMut.mutate(r.id)} disabled={closeMut.isPending}
                              className="min-h-[44px] px-4 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40">
                              <T k="협진 종료" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {consultMeta?.truncated && <p className="text-[11px] text-amber-700" data-consult-truncated><Tf k="최근 {shown}건만 보입니다(전체 {total}건)" params={{ shown: records.length, total: consultMeta.total }} /></p>}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'letters' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{AI_ORIGIN_TEXT} <T k="의뢰서 문서 이력" /></h3>
          {letters.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 text-sm"><T k="생성된 의뢰서가 없습니다" /></p>
              <p className="text-gray-300 text-xs mt-1">협진 의뢰 작성 탭에서 {AI_ORIGIN_TEXT} 초안 생성을 사용하세요</p>
            </div>
          ) : (
            <div className="space-y-3">
              {letters.map(l => {
                const st = LETTER_STATUS[l.status] ?? { label: l.status, color: 'bg-gray-100' };
                return (
                  <div key={l.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color}`}>{st.label}</span>
                        <span className="text-sm font-medium text-gray-900">{l.toDepartment}</span>
                        <span className="text-[10px] text-gray-400">{l.letterNumber}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{kdate(new Date(l.createdAt))}</span>
                        {l.aiModel && <span className="text-[10px] text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded">{AI_ORIGIN_TEXT}</span>}
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2 mb-3">{l.content}</p>
                    <div className="flex gap-2">
                      <button onClick={() => showPreview(l.id)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                        <T k="미리보기" />
                      </button>
                      {l.status === 'DRAFT' && (
                        <button onClick={() => signAndSend.mutate(l.id)} disabled={signAndSend.isPending}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                          {signAndSend.isPending ? <T k="처리중..." /> : <T k="서명 + 전송" />}
                        </button>
                      )}
                      {l.signedAt && <span className="text-[10px] text-emerald-600 self-center"><T k="서명" />: {kdate(l.signedAt, 'datetimeSec')}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PDF 미리보기 모달 — body 스크롤 잠금 */}
      {previewHtml && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" style={{ overscrollBehavior: 'contain' }}
          onClick={() => { setPreviewHtml(null); document.body.style.overflow = ''; }}
          ref={() => { document.body.style.overflow = 'hidden'; }}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-3 border-b sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-gray-900"><T k="의뢰서 미리보기" /></h3>
              <div className="flex gap-2">
                <button onClick={() => { auditNewWindowPrint('referral'); const w = window.open(); w?.document.write(previewHtml); w?.print(); }}
                  className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100">
                  <T k="인쇄" />
                </button>
                <button onClick={() => { setPreviewHtml(null); document.body.style.overflow = ''; }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
              </div>
            </div>
            <div className="p-6" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      )}
    </div>
  );
}
