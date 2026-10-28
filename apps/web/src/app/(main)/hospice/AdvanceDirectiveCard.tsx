'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { StaffName } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

function fmtDate(d?: string | null) { return d ? kdate(d) : '—'; }

interface AdvanceDirective {
  id: string; documentType: string; registeredAt: string; status: string;
  cprDecision?: string | null; ventilatorDecision?: string | null; dialysisDecision?: string | null;
  transfusionDecision?: string | null; chemotherapyDecision?: string | null;
  hospiceConsent?: boolean | null; organDonation?: boolean | null;
  patientSignedAt?: string | null; familySignedAt?: string | null; doctorSignedAt?: string | null;
  /** 철회 — 2026-10-10 전에 철회된 문서는 기록자·사유가 없다(null = 기록 없음) */
  revokedAt?: string | null; revokeReason?: string | null;
  revokedBy?: { familyName?: string | null; givenName?: string | null } | null;
}

/** 문서 종류 — 서버 저장값 AD(사전연명의료의향서)·POLST(연명의료계획서). 모르는 값은 원문 그대로 */
const DIRECTIVE_DOC_LABEL: Record<string, string> = { AD: '사전연명의료의향서', POLST: '연명의료계획서' };
/** 연명의료 항목 — 값은 저장 원문(DNR·DO 등)을 그대로 보인다(해석해 바꾸지 않는다) */
const DIRECTIVE_ITEMS: Array<[keyof AdvanceDirective, string]> = [
  ['cprDecision', '심폐소생술'], ['ventilatorDecision', '인공호흡기'], ['dialysisDecision', '혈액투석'],
  ['transfusionDecision', '수혈'], ['chemotherapyDecision', '항암제'],
];

/** 저장 어휘 → 표시(등록 폼과 같은 어휘 · 모르는 값은 원문 그대로) */
const DECISION_LABEL: Record<string, string> = { DNR: '시행하지 않음(유보·중단)', DO: '시행' };
function decisionText(v: string | null | undefined) {
  if (v == null || v === '') return <span className="text-gray-400">—</span>;
  return DECISION_LABEL[v] ? <T k={DECISION_LABEL[v]} /> : v;
}

/**
 * 사전연명의료 카드 — 환자의 유효(ACTIVE) 문서. 🔴 '없음'(조회 성공 · 0건)과 '조회 실패'를 다르게 말한다 —
 * 실패를 "문서 없음"으로 그리면 연명의료를 원하지 않는다는 환자의 결정이 화면에서 사라진다.
 */
export function AdvanceDirectiveCard({ patientId, registrationDnr }: { patientId: string; registrationDnr?: boolean }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 철회된 문서도 함께(누가·언제·왜) — 유효 문서만 쓰는 안전 표시줄과 키를 나눈다(같은 키에 모양이 둘이면 갈라진다)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hospice-directives', patientId, 'with-revoked'],
    queryFn: () => apiClient.get<{ data: AdvanceDirective[] }>(`/api/v1/hospice/directives/${patientId}?includeRevoked=1`),
  });
  const all: AdvanceDirective[] = Array.isArray(data?.data) ? data!.data : [];
  const rows = all.filter((d) => d.status !== 'REVOKED');
  const revoked = all.filter((d) => d.status === 'REVOKED');
  const [revokeFor, setRevokeFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/hospice/directives/${id}/revoke`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success(tAttr('철회를 기록했습니다.'));
      setRevokeFor(null); setReason('');
      qc.invalidateQueries({ queryKey: ['hospice-directives', patientId] });
      qc.invalidateQueries({ queryKey: ['safety-directive', patientId] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('철회를 기록하지 못했습니다.')),
  });
  return (
    <div className="bg-white rounded-2xl border p-5" data-advance-directive={isError ? 'ERROR' : isLoading ? 'LOADING' : rows.length ? 'PRESENT' : 'NONE'}>
      <h4 className="text-sm font-bold text-gray-900 mb-2"><T k="사전연명의료 문서" /></h4>
      {isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
        : isLoading ? <p className="text-xs text-gray-400"><T k="불러오는 중…" /></p>
        : rows.length === 0 ? (
          <p className="text-xs text-gray-600"><T k="이 병원에 등록된 유효한 사전연명의료 문서가 없습니다(국가 연명의료 정보처리시스템 조회는 별도)" /></p>
        ) : (
          <div className="space-y-2">
            {rows.map((d) => {
              const cprDnr = d.cprDecision === 'DNR';
              return (
                <div key={d.id} className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="font-bold text-gray-800">{DIRECTIVE_DOC_LABEL[d.documentType] ? <T k={DIRECTIVE_DOC_LABEL[d.documentType]} /> : d.documentType}</span>
                    <span className="text-[10px] text-gray-400"><T k="등록" /> {fmtDate(d.registeredAt)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {DIRECTIVE_ITEMS.map(([k, label]) => (
                      <span key={k}><span className="text-gray-500"><T k={label} />:</span> {decisionText(d[k] as string | null | undefined)}</span>
                    ))}
                    <span><span className="text-gray-500"><T k="호스피스 이용" />:</span> {d.hospiceConsent == null ? <span className="text-gray-400">—</span> : <T k={d.hospiceConsent ? '예' : '아니오'} />}</span>
                  </div>
                  {/* 서명 — 비어 있으면 비어 있다고(서명된 문서인지가 효력의 근거다) */}
                  <p className="text-[10px] text-gray-500">
                    <T k="서명" />: <T k="환자" /> {d.patientSignedAt ? fmtDate(d.patientSignedAt) : '—'} · <T k="가족" /> {d.familySignedAt ? fmtDate(d.familySignedAt) : '—'} · <T k="의사" /> {d.doctorSignedAt ? fmtDate(d.doctorSignedAt) : '—'}
                  </p>
                  {/* 등록 시 DNR 칸과 문서의 심폐소생술 항목이 다르면 그 사실을 말한다(어느 쪽이 맞는지는 판정하지 않는다) */}
                  {registrationDnr != null && d.cprDecision != null && registrationDnr !== cprDnr && (
                    <p className="text-[10px] font-medium text-amber-700"><T k="호스피스 등록의 DNR 표시와 문서의 심폐소생술 항목이 다릅니다 — 확인이 필요합니다" /></p>
                  )}
                  {/* 철회 — 환자(또는 법정 대리인)의 의사 표시를 기록한다. 사유 필수 · 기록자는 로그인한 사람 */}
                  {revokeFor === d.id ? (
                    <div className="space-y-1.5 pt-1" data-directive-revoke-form={d.id}>
                      <label className="block text-[11px] font-bold text-gray-600"><T k="철회 사유" /> *
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
                          placeholder={tAttr('예: 환자 본인이 구두로 철회 의사를 밝힘(입회자 기록)')}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-normal" />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" disabled={!reason.trim() || revoke.isPending} onClick={() => revoke.mutate(d.id)} data-directive-revoke-submit={d.id}
                          className="min-h-[44px] rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-40"><T k="철회 기록" /></button>
                        <button type="button" onClick={() => { setRevokeFor(null); setReason(''); }} className="min-h-[44px] rounded-lg border px-3 text-xs"><T k="닫기" /></button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setRevokeFor(d.id); setReason(''); }} data-directive-revoke-open={d.id}
                      className="min-h-[44px] rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700"><T k="철회 기록…" /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {/* 철회된 문서 — 누가·언제·왜(2026-10-10 전 철회는 기록자·사유가 없다 — 기록 없음으로 말한다) */}
      {!isError && !isLoading && revoked.length > 0 && (
        <details className="mt-2" data-directive-revoked-count={revoked.length}>
          <summary className="cursor-pointer text-[11px] text-gray-500"><Tf k="철회된 문서 {n}건" params={{ n: revoked.length }} /></summary>
          <ul className="mt-1 space-y-1">
            {revoked.map((d) => (
              <li key={d.id} className="rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600" data-directive-revoked={d.id}>
                <span className="font-medium">{DIRECTIVE_DOC_LABEL[d.documentType] ? <T k={DIRECTIVE_DOC_LABEL[d.documentType]} /> : d.documentType}</span>
                {' · '}<T k="철회" /> {fmtDate(d.revokedAt)}
                {' · '}<T k="기록자" /> <StaffName familyName={d.revokedBy?.familyName} givenName={d.revokedBy?.givenName} />
                <div className="text-gray-500" data-directive-revoke-reason><T k="철회 사유" />: {d.revokeReason ? d.revokeReason : <span className="text-gray-400"><T k="기록 없음" /></span>}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
