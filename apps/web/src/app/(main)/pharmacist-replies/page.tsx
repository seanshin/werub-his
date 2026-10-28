'use client';

import Link from 'next/link';
import { SubstitutionDecision } from '@/components/pharmacy/SubstitutionDecision';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { INTERVENTION_TYPE_COLOR, INTERVENTION_TYPE_LABEL } from '@/lib/pharmacist-intervention';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import PageHeader from '@/components/ui/PageHeader';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName, StaffName } from '@/components/ui/display';
import DurOverrideList from '@/components/pharmacy/DurOverrideList';

/**
 * 약사 회신 요청(의사) — 🔴 2026-09-30 신설.
 *
 * 종전엔 약사 중재 회신(PATCH)·대체조제 승인이 **의사에게 열려 있었지만** 목록은 약사·관리자 전용이고
 * 화면도 약사 메뉴(/pharmacist-activity·/pharmacy/admin)뿐이라, 의사는 **자기 앞으로 온 요청을 볼 길이 없었다**
 * (워크리스트가 없으면 직원은 기억으로 일한다). 여기는 **내가 책임 처방의인 처방**에 달린 것만 보인다 —
 * 서버가 좁힌다(`interventions/mine`·`substitution/mine`). 다른 의사의 처방에는 회신·판정할 수 없다(403).
 *
 * 관계 모드: 사람의 판단을 기록하는 화면이다 — 시스템은 권고하지 않는다(선택지와 기록만).
 */

interface MyIntervention {
  id: string;
  patientId: string;
  patientName: string | null;
  prescriptionId: string | null;
  prescriptionDrug: string | null;
  pharmacistName: string | null;
  type: string;
  reason: string;
  suggestion: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
}

interface MySubstitution {
  id: string;
  reason: string;
  status: string;
  requestedAt: string;
  originalPrescription?: { medicationCode?: { nameKo?: string | null; code?: string | null } | null; encounter?: { patient?: { id?: string | null; familyName?: string | null; givenName?: string | null; mrn?: string | null } | null } | null } | null;
  substituteMedication?: { nameKo?: string | null; code?: string | null } | null;
  pharmacist?: { familyName?: string | null; givenName?: string | null } | null;
}

/**
 * 회신 선택지 — "수정 수락"은 서버 상태로는 수락(ACCEPTED)이다(별도 상태 어휘가 없다 — 지어내지 않는다).
 * 수정 내용은 회신 본문에 남는다. 거절·수정 수락은 사유가 있어야 약사가 다음 판단을 할 수 있다.
 */
type ReplyKind = 'ACCEPT' | 'MODIFY' | 'REJECT';
const REPLY_STATUS: Record<ReplyKind, 'ACCEPTED' | 'REJECTED'> = { ACCEPT: 'ACCEPTED', MODIFY: 'ACCEPTED', REJECT: 'REJECTED' };
const REPLY_LABEL: Record<ReplyKind, string> = { ACCEPT: '수락', MODIFY: '수정 수락', REJECT: '거절' };
const REASON_REQUIRED: Record<ReplyKind, boolean> = { ACCEPT: false, MODIFY: true, REJECT: true };

export default function PharmacistRepliesPage() {
  const tAttr = useTAttr();
  return (
    <div className="space-y-8">
      <PageHeader title={tAttr('약사 회신 요청')} />
      <p className="text-xs text-gray-500 -mt-4"><T k="내가 책임 처방의인 처방에 달린 요청만 보입니다 — 판단은 처방의가 하고, 화면은 기록만 합니다." /></p>
      <InterventionSection />
      <SubstitutionSection />
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-gray-800"><T k="내 처방의 DUR 경고 무시 기록" /></h2>
        <DurOverrideList />
      </section>
    </div>
  );
}

function InterventionSection() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; kind: ReplyKind } | null>(null);
  const [text, setText] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-pharmacist-interventions'],
    queryFn: () => apiClient.get<{ data: MyIntervention[]; meta?: { truncated: boolean; limit: number } }>('/api/v1/pharmacist/interventions/mine'),
  });

  const reply = useMutation({
    mutationFn: ({ id, kind, doctorResponse }: { id: string; kind: ReplyKind; doctorResponse: string }) =>
      apiClient.patch(`/api/v1/pharmacist/interventions/${id}`, {
        status: REPLY_STATUS[kind],
        doctorResponse: doctorResponse.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(tAttr('회신을 기록했습니다'));
      setTarget(null); setText('');
      qc.invalidateQueries({ queryKey: ['my-pharmacist-interventions'] });
    },
    // 실패는 실패로 — 403(다른 의사의 처방)·409(이미 처리됨) 사유를 서버 문장 그대로 보인다
    onError: (e: unknown) => toast.error(extractErrorMessage(e)),
  });

  const items = Array.isArray(data?.data) ? data!.data : [];

  return (
    <section className="space-y-3" data-section="interventions">
      <h2 className="text-sm font-bold text-gray-800">
        <T k="약사 중재 — 회신 대기" />{!isLoading && !isError && <span className="ml-1 text-gray-400">({items.length})</span>}
      </h2>
      {isError ? <QueryErrorFallback error={error} onRetry={refetch} size="compact" /> :
       isLoading ? <div className="py-6 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div> :
       <>
        {data?.meta?.truncated && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Tf k="최근 {건}건만 표시했습니다 — 기록이 더 있습니다" params={{ 건: data.meta.limit }} />
          </p>
        )}
        {items.length === 0 ? <EmptyState icon="💊" title="회신을 기다리는 약사 중재가 없습니다" className="bg-white rounded-2xl border" compact /> : (
          <div className="space-y-3">
            {items.map((i) => (
              <div key={i.id} className="bg-white rounded-2xl border p-4 space-y-2" data-intervention-row={i.id}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${INTERVENTION_TYPE_COLOR[i.type] ?? 'bg-gray-100 text-gray-600'}`}><T k={INTERVENTION_TYPE_LABEL[i.type] ?? i.type} /></span>
                      {/* 중재는 처방에 달린 일 — 차트 투약 이력으로(종전엔 차트로 가는 길이 없었다) */}
                      {i.patientId
                        ? <Link href={`/patients/${i.patientId}?tab=medications`} className="text-sm font-bold text-gray-900 hover:underline" data-inbox-chart-link="medications">{i.patientName ?? <T k="이름 미상" />}</Link>
                        : <span className="text-sm font-bold text-gray-900">{i.patientName ?? <span className="text-gray-400"><T k="이름 미상" /></span>}</span>}
                      <span className="text-xs text-gray-600">{i.prescriptionDrug ?? <span className="text-gray-400"><T k="미기재" /></span>}</span>
                    </div>
                    <p className="text-xs text-gray-600"><T k="사유:" /> {i.reason}</p>
                    <p className="text-xs text-blue-700"><T k="약사 제안" />: {i.suggestion}</p>
                    <p className="text-[10px] text-gray-400"><T k="약사:" /> <StaffName name={i.pharmacistName} /> · <KDate value={i.createdAt} mode="datetime" /></p>
                  </div>
                  <div className="flex gap-1.5">
                    {(['ACCEPT', 'MODIFY', 'REJECT'] as const).map((k) => (
                      <button key={k} type="button" data-reply={k}
                        onClick={() => { setTarget({ id: i.id, kind: k }); setText(''); }}
                        className={`min-h-[44px] px-3 text-xs font-medium rounded-lg ${k === 'REJECT' ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : k === 'MODIFY' ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                        <T k={REPLY_LABEL[k]} />
                      </button>
                    ))}
                  </div>
                </div>
                {target?.id === i.id && (
                  <div className="border-t pt-3 space-y-2" data-reply-form>
                    <label className="block text-xs font-medium text-gray-700">
                      <T k={REPLY_LABEL[target.kind]} /> · <T k={REASON_REQUIRED[target.kind] ? '사유(필수)' : '회신 내용(선택)'} />
                      {target.kind === 'MODIFY' && <span className="ml-1 text-gray-400"><T k="— 수정 내용을 적어 주세요. 상태는 수락으로 기록됩니다" /></span>}
                    </label>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
                      className="w-full border rounded-lg px-3 py-2 text-sm" aria-label={tAttr('회신 내용')} />
                    <div className="flex gap-2">
                      <button type="button" data-reply-submit
                        disabled={reply.isPending || (REASON_REQUIRED[target.kind] && !text.trim())}
                        onClick={() => reply.mutate({ id: i.id, kind: target.kind, doctorResponse: text })}
                        className="min-h-[44px] px-4 text-sm font-medium rounded-xl bg-gray-900 text-white disabled:opacity-50">
                        <T k={reply.isPending ? '기록 중...' : '회신 기록'} />
                      </button>
                      <button type="button" onClick={() => setTarget(null)} className="min-h-[44px] px-4 text-sm rounded-xl bg-gray-100 text-gray-600"><T k="취소" /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
       </>}
    </section>
  );
}

function SubstitutionSection() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-substitutions'],
    queryFn: () => apiClient.get<{ data: MySubstitution[] }>('/api/v1/pharmacy/substitution/mine'),
  });


  const items = Array.isArray(data?.data) ? data!.data : [];

  return (
    <section className="space-y-3" data-section="substitutions">
      <h2 className="text-sm font-bold text-gray-800">
        <T k="대체조제 — 승인 대기" />{!isLoading && !isError && <span className="ml-1 text-gray-400">({items.length})</span>}
      </h2>
      {isError ? <QueryErrorFallback error={error} onRetry={refetch} size="compact" /> :
       isLoading ? <div className="py-6 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div> :
       items.length === 0 ? <EmptyState icon="🔄" title="승인을 기다리는 대체조제가 없습니다" className="bg-white rounded-2xl border" compact /> : (
        <div className="space-y-3">
          {items.map((s) => {
            const pt = s.originalPrescription?.encounter?.patient;
            return (
              <div key={s.id} className="bg-white rounded-2xl border p-4 flex items-start justify-between gap-3 flex-wrap" data-substitution-row={s.id}>
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">
                    {pt ? (pt.id
                      ? <Link href={`/patients/${pt.id}?tab=medications`} className="hover:underline" data-inbox-chart-link="substitution"><PatientName familyName={pt.familyName} givenName={pt.givenName} mrn={pt.mrn} /></Link>
                      : <PatientName familyName={pt.familyName} givenName={pt.givenName} mrn={pt.mrn} />) : <span className="text-gray-400"><T k="이름 미상" /></span>}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-red-600 line-through">{s.originalPrescription?.medicationCode?.nameKo ?? <T k="미기재" />}</span>
                    <span className="text-gray-400">→</span>
                    <span className="text-emerald-700 font-medium">{s.substituteMedication?.nameKo ?? <T k="미기재" />}</span>
                  </div>
                  <p className="text-xs text-gray-600"><T k="사유:" /> {s.reason}</p>
                  <p className="text-[10px] text-gray-400"><T k="약사:" /> <StaffName familyName={s.pharmacist?.familyName} givenName={s.pharmacist?.givenName} /> · <KDate value={s.requestedAt} mode="datetime" /></p>
                </div>
                {/* 판정자·시각·사유가 서버에 남는다 · 거부는 사유 필수(2026-09-30) */}
                <SubstitutionDecision id={s.id} onDone={() => qc.invalidateQueries({ queryKey: ['my-substitutions'] })} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
