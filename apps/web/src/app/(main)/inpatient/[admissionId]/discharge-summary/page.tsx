'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { extractErrorMessage } from '@/lib/error-utils';
import SmartSignButton from '@/components/signature/SmartSignButton';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { DraftBanner, recordDraftApplied, type DraftProvenance } from '@/components/ai/DraftBanner';
import { markProposalPresented, proposalIdFrom } from '@/lib/ai-proposal';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { DischargeRxPanel } from '@/components/prescription/DischargeRxPanel';
import { DiagnosisPoaPanel } from './DiagnosisPoaPanel';
import { asDischargeMedList, dischargeMedLabel, dischargeMedName } from '@/lib/discharge-med';

const dischargeSummarySchema = z.object({
  admitDate: z.string().optional(),
  dischargeDate: z.string().optional(),
  admitDiagnosis: z.string().optional(),
  dischargeDiagnosis: z.string().optional(),
  hospitalCourse: z.string().optional(),
  procedures: z.string().optional(),
  significantFindings: z.string().optional(),
  conditionAtDischarge: z.string().optional(),
  followUpPlan: z.string().optional(),
  dietaryInstructions: z.string().optional(),
  activityRestrictions: z.string().optional(),
  patientEducation: z.string().optional(),
});
type DischargeSummaryFormData = z.infer<typeof dischargeSummarySchema>;

interface DischargeSummary {
  status: string;
  admitDate?: string;
  dischargeDate?: string;
  admitDiagnosis?: string;
  dischargeDiagnosis?: string;
  hospitalCourse?: string;
  procedures?: string;
  significantFindings?: string;
  conditionAtDischarge?: string;
  followUpPlan?: string;
  dietaryInstructions?: string;
  activityRestrictions?: string;
  patientEducation?: string;
  signedAt?: string;
  doctor?: { familyName?: string; givenName?: string };
  /** 문자열(옛 자유 기재)·객체(프리필·서명 스냅샷)가 섞인다 — `lib/discharge-med` 로만 읽는다 */
  dischargeMedications?: unknown;
}

interface DischargePrefill {
  admitDate?: string;
  dischargeDate?: string;
  admitDiagnosis?: string;
  diagnosisCodes?: string[];
  procedures?: string;
  dischargeMedications?: unknown;
  chronicCourse?: string | null; // P2b — 만성질환 경과(SoT 파생)
}

interface DischargeSummaryForm {
  admitDate?: string;
  dischargeDate?: string;
  admitDiagnosis?: string;
  dischargeDiagnosis?: string;
  hospitalCourse?: string;
  procedures?: string;
  significantFindings?: string;
  conditionAtDischarge?: string;
  followUpPlan?: string;
  dietaryInstructions?: string;
  activityRestrictions?: string;
  patientEducation?: string;
  diagnosisCodes?: string[];
  dischargeMedications?: string[];
}

export default function DischargeSummaryPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [isEditing, setIsEditing] = useState(false);
  // 🔴 초안≠확정 — AI 자동 퇴원요약이 폼에 들어간 사실(프로비넌스). 저장·서명 전까지 배너로 보이고 감사 원장에 남긴다(§7.6-b)
  const [aiDraftProvenance, setAiDraftProvenance] = useState<DraftProvenance | null>(null);
  /**
   * @param proposalId 제안 원장(P1) — 있으면 이 적용이 사람 결정(ACCEPTED)으로 원장에 남고 `finalText` 로 편집거리를 잰다.
   *   🔴 이 화면은 초안을 폼(입원경과)에 **그대로** 넣는다 → ACCEPTED. 사람이 저장 전에 고친 양은 편집거리로 드러난다.
   *   🔴 환자 id 는 이 화면에 없다(경로가 admissionId 뿐) — 추정하지 않고 넘기지 않는다. 제안은 Admission 에 붙는다.
   */
  const markAiDraftApplied = (text: string, proposalId?: string | null) => {
    setAiDraftProvenance({ source: 'GENERATOR', fields: ['입원경과'], appliedAt: new Date().toISOString(), model: null, recorded: null, proposalId: proposalId ?? null });
    void recordDraftApplied({
      resourceType: 'DISCHARGE_SUMMARY', source: 'GENERATOR', resourceId: admissionId, field: 'hospitalCourse', textLength: text.length,
      ...(proposalId ? { proposalId, decision: 'ACCEPTED' as const, finalText: text, clientContext: 'inpatient-discharge-summary' } : {}),
    })
      .then((recorded) => setAiDraftProvenance((prev) => (prev ? { ...prev, recorded } : prev)));
  };

  const { data: summaryData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['discharge-summary', admissionId],
    queryFn: () => apiClient.get<{ data: DischargeSummary }>(`/api/v1/admissions/${admissionId}/discharge-summary`),
    retry: false,
  });

  const { data: prefillData } = useQuery({
    queryKey: ['discharge-prefill', admissionId],
    queryFn: () => apiClient.get<{ data: DischargePrefill }>(`/api/v1/admissions/${admissionId}/discharge-summary/prefill`),
    enabled: !summaryData,
  });

  const { register, handleSubmit: rhfSubmit, reset: rhfReset, setValue } = useForm<DischargeSummaryFormData>({
    resolver: zodResolver(dischargeSummarySchema),
  });

  const createMutation = useMutation({
    mutationFn: (data: DischargeSummaryForm) => apiClient.post(`/api/v1/admissions/${admissionId}/discharge-summary`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['discharge-summary', admissionId] }); setIsEditing(false); },
  });

  const signMutation = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/admissions/${admissionId}/discharge-summary/sign`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discharge-summary', admissionId] }),
    // 🔴 2026-10-09 — 서명 실패에 처리가 없어 거부돼도 화면이 아무 말도 하지 않았다(POA 필수 거부 포함)
    onError: (e: unknown) => toast.error(extractErrorMessage(e) || tAttr('서명하지 못했습니다.')),
  });

  const summary = summaryData?.data;
  const prefill = prefillData?.data;

  const handlePrefill = () => {
    if (prefill) {
      rhfReset({
        admitDate: prefill.admitDate?.split('T')[0] ?? '',
        dischargeDate: (prefill.dischargeDate ?? new Date().toISOString()).split('T')[0],
        admitDiagnosis: prefill.admitDiagnosis ?? '',
        dischargeDiagnosis: '',
        hospitalCourse: prefill.chronicCourse ?? '', // P2b — 만성질환 경과 자동초안(의사 검토·보완)
        procedures: prefill.procedures ?? '',
        significantFindings: '',
        conditionAtDischarge: '',
        followUpPlan: '',
        dietaryInstructions: '',
        activityRestrictions: '',
        patientEducation: '',
      });
      setIsEditing(true);
    }
  };

  const onFormSubmit = (data: DischargeSummaryFormData) => {
    createMutation.mutate(data);
  };

  const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: '작성중', cls: 'bg-amber-100 text-amber-700' },
    SIGNED: { label: '서명완료', cls: 'bg-emerald-100 text-emerald-700' },
    AMENDED: { label: '수정됨', cls: 'bg-blue-100 text-blue-700' },
  };

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/inpatient" className="text-sm text-gray-500 hover:text-indigo-600">&larr; <T k="입원 목록" /></Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900"><T k="퇴원요약" /></h1>
        {summary && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[summary.status]?.cls ?? ''}`}>
            <T k={STATUS_BADGE[summary.status]?.label ?? summary.status} />
          </span>
        )}
      </div>

      {/* 퇴원약 오더화(2026-09-30) — 퇴원약은 처방으로(DUR·처방집·약국 조제) */}
      <DischargeRxPanel admissionId={admissionId} />

      {isLoading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />)}
          </div>
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : summary ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={tAttr('입원일')} value={summary.admitDate?.split('T')[0]} />
            <Field label={tAttr('퇴원일')} value={summary.dischargeDate?.split('T')[0]} />
            <Field label={tAttr('입원 시 진단')} value={summary.admitDiagnosis} full />
            <Field label={tAttr('퇴원 시 진단')} value={summary.dischargeDiagnosis} full />
          </div>
          <Field label={tAttr('입원경과')} value={summary.hospitalCourse} full />
          {summary.procedures && <Field label={tAttr('시행된 시술/수술')} value={summary.procedures} full />}
          {summary.significantFindings && <Field label={tAttr('주요 검사결과')} value={summary.significantFindings} full />}
          <Field label={tAttr('퇴원 시 상태')} value={summary.conditionAtDischarge} full />
          <Field label={tAttr('추적관찰 계획')} value={summary.followUpPlan} full />
          {summary.dietaryInstructions && <Field label={tAttr('식이요법')} value={summary.dietaryInstructions} full />}
          {summary.activityRestrictions && <Field label={tAttr('활동제한')} value={summary.activityRestrictions} full />}
          {summary.patientEducation && <Field label={tAttr('환자교육')} value={summary.patientEducation} full />}
          {/* 🔴 종전 요약 보기에 퇴원약이 아예 없었다 — 저장된 값(서명 순간의 처방 스냅샷 또는 옛 자유 기재)을 그대로 보인다 */}
          {asDischargeMedList(summary.dischargeMedications).length > 0 && (
            <Field label={tAttr('퇴원약')} value={asDischargeMedList(summary.dischargeMedications).map((m) => dischargeMedLabel(m, (n) => tfAttr('{n}일', { n }))).join('\n')} full />
          )}

          {/* 진단별 POA — 필수 여부는 결정 safety.poaFlag(2026-10-09) */}
          <DiagnosisPoaPanel admissionId={admissionId} readOnly={summary.status === 'SIGNED'} />

          <div className="pt-4 border-t flex items-center justify-between">
            <p className="text-xs text-gray-400">
              <Tf k="작성: {작성자}" params={{ 작성자: `${summary.doctor?.familyName ?? ''}${summary.doctor?.givenName ?? ''}` }} />
              {summary.signedAt && <>{' | '}<Tf k="서명: {서명일}" params={{ 서명일: summary.signedAt.split('T')[0] }} /></>}
            </p>
            {summary.status === 'DRAFT' && (
              <SmartSignButton
                documentType="DISCHARGE_SUMMARY"
                documentId={admissionId}
                documentTitle="퇴원요약 서명"
                onSign={() => signMutation.mutate()}
                variant="primary"
              />
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {!isEditing ? (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-4"><T k="퇴원요약이 아직 작성되지 않았습니다" /></p>
              <div className="flex gap-3">
                <button onClick={handlePrefill} className="px-6 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
                  <T k="자동 프리필로 작성 시작" />
                </button>
                <button onClick={async () => {
                  handlePrefill();
                  try {
                    const text = `환자 입원 경과를 요약하여 퇴원요약을 작성해주세요. 입원일: ${prefill?.admitDate ?? ''}, 진단: ${prefill?.admitDiagnosis ?? ''}, 시술: ${prefill?.procedures ?? ''}, 퇴원약: ${asDischargeMedList(prefill?.dischargeMedications).map(dischargeMedName).join(', ')}`;
                    /**
                     * 🔴 종전엔 `/ai/auto-record` 를 먼저 부르고 실패하면 조용히 `/ai/writing/craft` 로
                     *    넘어갔다. 그 첫 호출은 **두 겹으로** 성공할 수 없었다.
                     *      ① 본문이 `{text, type}` 인데 DTO 필수는 `conversation` → 전역 whitelist 가
                     *         지워 **항상 400**.
                     *      ② 설령 키를 맞춰도 auto-record 응답은 `{soap, icd_codes, prescriptions}` 라
                     *         여기서 읽던 `summary`/`result` 가 **존재하지 않는다**.
                     *    auto-record 는 "진료 대화 → SOAP" 경로다. 퇴원요약의 정본 경로는
                     *    `writing/craft`(style=medical_discharge — 컨트롤러 설명도 "퇴원요약/소견서/의뢰서").
                     *    → 죽은 경로를 지우고 정본만 부른다. 실패는 폴백으로 덮지 않고 그대로 말한다.
                     */
                    const res = await apiClient.post<{ data: { result?: string } }>('/api/v1/ai/writing/craft', {
                      text,
                      style: 'medical_discharge',
                      admissionId, // 제안 원장(DISCHARGE_DRAFT)의 대상 — 없으면 서버는 제안을 만들지 않는다
                    });
                    const crafted = res?.data;
                    if (crafted?.result) {
                      setValue('hospitalCourse', crafted.result);
                      // 🔴 노출을 결정보다 먼저 보고한다(순서가 뒤집히면 원장이 NOT_PRESENTED 로 남는다)
                      const proposalId = proposalIdFrom(crafted);
                      if (proposalId) await markProposalPresented(proposalId, 'inpatient-discharge-summary');
                      markAiDraftApplied(crafted.result, proposalId);
                    } else {
                      // 🔴 "결과가 비었다"를 성공으로 넘기지 않는다 — 프리필만 남았다는 사실을 말한다.
                      // 🔴 `{출처}` 는 AI 표기라 번역하지 않고 넣는다(AI기본법 §31)
                      toast.error(tfAttr('{출처} 자동 요약 결과가 비어 있습니다 — 자동 프리필 값만 채워졌습니다.', { 출처: AI_ORIGIN_TEXT }));
                    }
                  } catch (e: unknown) {
                    // 🔴 실패를 삼키면 화면은 "프리필 = AI 요약"으로 보인다. 실패했으면 실패했다고 말한다.
                    toast.error((e as { message?: string })?.message ?? tfAttr('{출처} 자동 퇴원요약에 실패했습니다 — 자동 프리필 값만 채워졌습니다.', { 출처: AI_ORIGIN_TEXT }));
                  }
                }} className="px-6 py-2.5 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">
                  <Tf k="{출처} 자동 퇴원요약" params={{ 출처: AI_ORIGIN_TEXT }} />
                </button>
              </div>
              <Tf className="mt-3 block text-[11px] text-gray-500" k="자동 퇴원요약 초안은 {출처}가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다." params={{ 출처: AI_ORIGIN_TEXT }} />
            </div>
          ) : (
            <form onSubmit={rhfSubmit(onFormSubmit)} className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900"><T k="퇴원요약 작성" /></h3>
              <DraftBanner provenance={aiDraftProvenance} signLabel="서명" />
              <div className="grid grid-cols-2 gap-4">
                <InputField label={tAttr('입원일')} reg={register('admitDate')} type="date" />
                <InputField label={tAttr('퇴원일')} reg={register('dischargeDate')} type="date" />
              </div>
              <InputField label={tAttr('입원 시 진단')} reg={register('admitDiagnosis')} />
              <InputField label={tAttr('퇴원 시 진단')} reg={register('dischargeDiagnosis')} />
              <TextAreaField label={tAttr('입원경과')} reg={register('hospitalCourse')} />
              <InputField label={tAttr('퇴원 시 상태')} reg={register('conditionAtDischarge')} />
              <TextAreaField label={tAttr('추적관찰 계획')} reg={register('followUpPlan')} />
              <TextAreaField label={tAttr('식이요법 지시')} reg={register('dietaryInstructions')} />
              <TextAreaField label={tAttr('활동제한 사항')} reg={register('activityRestrictions')} />
              <TextAreaField label={tAttr('환자교육')} reg={register('patientEducation')} />

              <div className="flex gap-3 pt-4">
                <button type="submit" disabled={createMutation.isPending} className="px-6 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  <T k={createMutation.isPending ? '저장중...' : '저장'} />
                </button>
                <button type="button" onClick={() => setIsEditing(false)} className="px-6 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">
                  <T k="취소" />
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, full }: { label: string; value?: string; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="text-[11px] text-gray-400 font-medium mb-0.5">{label}</p>
      <p className="text-sm text-gray-900 whitespace-pre-wrap">{value || '-'}</p>
    </div>
  );
}

function InputField({ label, reg, type = 'text' }: { label: string; reg: ReturnType<typeof import('react-hook-form').useForm>['register'] extends (...args: infer A) => infer R ? R : never; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} {...reg} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
    </div>
  );
}

function TextAreaField({ label, reg }: { label: string; reg: ReturnType<typeof import('react-hook-form').useForm>['register'] extends (...args: infer A) => infer R ? R : never }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <textarea {...reg} rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
    </div>
  );
}
