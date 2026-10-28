'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { safeFormat as format } from '@/lib/safe-date';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import ClaimAdjustmentSection from './ClaimAdjustmentSection';
import { money } from '@/lib/ui-settings';
import { Money } from '@/components/ui/display';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { RECEIPT_CLASSES, receiptClassOf } from '@hospital-run/shared';
import { downloadClaimXml } from '@/lib/claim-xml-download';

type AnyRecord = Record<string, unknown>;

interface ClaimData {
  status?: string; claimDate?: string; reviewResult?: string; reviewedAt?: string;
  claimedAmount?: number; approvedAmount?: number; insuranceAmount?: number;
  copayAmount?: number; reducedReason?: string; billingId?: string;
  /** 원장 칸 — 🔴 (P4-3) 화면은 `reviewResult`·`reducedReason` 을 읽었는데 Claim 에 그 칸이 없어 심사결과·이의신청 버튼이 늘 안 보였다 */
  rejectReason?: string | null; reducedAmount?: number | null;
  patient?: { familyName?: string; givenName?: string };
  billing?: {
    patient?: { familyName?: string; givenName?: string };
    items?: AnyRecord[]; prescriptions?: AnyRecord[];
  };
  items?: AnyRecord[];
}


// 법정 13개 항목 분류 (의료법 시행규칙 별지 제11호)
// 법정 항목 — 정본 shared `RECEIPT_CLASSES`(영수증·수납 상세와 같은 표).
// 🔴 (P4-3) 청구 응답의 항목은 원장 그대로라 칸 이름이 `codeType` 이다 — 종전엔 `type`/`category` 만 읽어 항목 내역이 늘 비었다.
//    이 화면은 서버 분류(receiptClass)를 받지 않으므로 codeType 으로만 나눈다(진찰료·입원료 라인은 ⑨ 로 보인다 — 법정 영수증은 수납 화면이 정본).
const CATEGORIES = RECEIPT_CLASSES.map(c => ({ no: c.no, name: c.name, key: c.key }));

export default function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [reviewResult, setReviewResult] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [reducedReason, setReducedReason] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [showAppeal, setShowAppeal] = useState(false);
  const [appealReason, setAppealReason] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['claim-detail', id],
    queryFn: () => apiClient.get<AnyRecord>(`/api/v1/claims/${id}`),
  });

  // 🔴 (P2-3) 종전 `parseFloat(approvedAmount) || 0` — 인정액 칸을 비우면 0 을 보내 '인정 0 · 삭감 0' 이 원장·수납·ERP 로 나갔다.
  //    인정 = 청구액 전액 · 반려 = 0 · 부분인정만 사람이 적는다(비어 있으면 저장 불가 · 서버도 같은 규칙으로 거부).
  const reviewApproved = (claimed: number | null): number | null => {
    if (reviewResult === 'APPROVED') return claimed;
    if (reviewResult === 'REJECTED') return 0;
    if (reviewResult !== 'PARTIALLY_APPROVED' || approvedAmount.trim() === '') return null;
    const n = Number(approvedAmount);
    return Number.isInteger(n) && n >= 0 && claimed != null && n < claimed ? n : null;
  };
  const reviewMutation = useMutation({
    mutationFn: (approved: number) => apiClient.patch(`/api/v1/claims/${id}/review`, {
      reviewResult,
      approvedAmount: approved,
      reducedReason,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim-detail', id] });
      qc.invalidateQueries({ queryKey: ['claims'] });
      setShowReview(false);
      toast.success(tAttr('심사 결과가 반영되었습니다.'));
    },
    onError: () => toast.error(tAttr('심사 결과 저장에 실패했습니다.')),
  });

  const appealMutation = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/claims/${id}/appeal`, { reason: appealReason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim-detail', id] });
      qc.invalidateQueries({ queryKey: ['claims'] });
      setShowAppeal(false); setAppealReason('');
      toast.success(tAttr('이의신청이 제출되었습니다.'));
    },
    onError: () => toast.error(tAttr('이의신청에 실패했습니다.')),
  });

  const _raw = data?.data as AnyRecord;
  const claim = ((_raw?.data ?? _raw) as ClaimData) ?? null;
  // 심사 결과는 원장 상태에서 — 심사된 상태(인정·부분인정·반려)일 때만 · 사유는 rejectReason(삭감·반려 공용 칸)
  const reviewResultView = claim?.reviewResult ?? (['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'].includes(claim?.status ?? '') ? claim?.status : undefined);
  const reducedReasonView = claim?.reducedReason ?? claim?.rejectReason ?? undefined;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  if (isLoading) return (
    <div className="max-w-4xl mx-auto space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
    </div>
  );

  if (!claim) return (
    <div className="max-w-4xl mx-auto text-center py-20">
      <p className="text-gray-500"><T k="청구 데이터를 찾을 수 없습니다." /></p>
      <Link href="/claims" className="text-blue-600 hover:underline text-sm mt-2 block"><T k="목록으로" /></Link>
    </div>
  );

  const patient = claim.patient ?? claim.billing?.patient;
  const patientName = patient ? `${patient.familyName ?? ''}${patient.givenName ?? ''}` : '-';
  const items = claim.items ?? claim.billing?.items ?? claim.billing?.prescriptions ?? [];

  // 항목 분류
  const categoryAmounts = CATEGORIES.map(cat => {
    const matched = items.filter((item: AnyRecord) => receiptClassOf({ codeType: String(item.codeType ?? item.type ?? item.category ?? '') }) === cat.key);
    const amount = matched.reduce((s: number, i: AnyRecord) => s + Number(i.totalPrice ?? i.amount ?? 0), 0);
    return { ...cat, amount, items: matched };
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/claims" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        <T k="청구 목록" />
      </Link>

      {/* 헤더 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900"><T k="청구 상세" /></h2>
            <p className="text-sm text-gray-500 mt-1">{patientName} · {claim.claimDate ? format(new Date(claim.claimDate), 'yyyy.MM.dd') : '-'}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge domain="claim" status={claim.status ?? ''} className="text-xs font-bold" />
            {(claim.status === 'SUBMITTED' || claim.status === 'UNDER_REVIEW') && (
              <button onClick={() => setShowReview(!showReview)}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
                <T k="심사결과 입력" />
              </button>
            )}
          </div>
        </div>

        {/* 요약 */}
        <div className="grid grid-cols-4 gap-4 mt-6">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-400"><T k="총 청구액" /></p>
            <p className="text-lg font-bold text-gray-900">{(claim.claimedAmount ?? 0).toLocaleString()}<span className="text-xs font-normal text-gray-400">원</span></p>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-400"><T k="보험자부담" /></p>
            {/* 🔴 claimedAmount 는 **보험자 청구분 전액**이다(billing.insuranceCovered). 종전엔 이를
                ×0.7/×0.3 으로 쪼개 "보험자 53,200 / 본인 22,800" 같은 없는 수를 만들었다(W6). */}
            <p className="text-lg font-bold text-blue-600">{(claim.claimedAmount ?? 0).toLocaleString()}<span className="text-xs font-normal text-gray-400">원</span></p>
          </div>
          <div className="bg-amber-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-400"><T k="본인부담" /></p>
            <p className="text-lg font-bold text-amber-600">{claim.copayAmount != null ? claim.copayAmount.toLocaleString() : <T k="수납 화면 참조" />}<span className="text-xs font-normal text-gray-400">{claim.copayAmount != null ? '원' : ''}</span></p>
          </div>
          <div className={`rounded-xl p-3 text-center ${claim.approvedAmount != null ? 'bg-emerald-50' : 'bg-gray-50'}`}>
            <p className="text-[10px] text-gray-400"><T k="인정액" /></p>
            <p className={`text-lg font-bold ${claim.approvedAmount != null ? 'text-emerald-600' : 'text-gray-400'}`}>
              {claim.approvedAmount != null ? `${money(claim.approvedAmount)}` : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* 심사결과 입력 폼 */}
      {showReview && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-blue-900"><T k="심사 결과 입력" /></h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="심사 결과" /></label>
              <select value={reviewResult} onChange={e => setReviewResult(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">{tAttr('선택')}</option>
                <option value="APPROVED">{tAttr('인정')}</option>
                <option value="PARTIALLY_APPROVED">{tAttr('부분인정')}</option>
                <option value="REJECTED">{tAttr('반려')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="인정액" /></label>
              {reviewResult === 'PARTIALLY_APPROVED' ? (
                <input type="number" min={0} step={1} value={approvedAmount} onChange={e => setApprovedAmount(e.target.value)}
                  data-claim-approved-input className="w-full border rounded-lg px-3 py-2 text-sm" />
              ) : (
                <p className="px-3 py-2 text-sm font-mono text-gray-700" data-claim-approved-fixed>
                  {reviewResult === 'APPROVED' ? (claim.claimedAmount ?? 0).toLocaleString() : reviewResult === 'REJECTED' ? '0' : '—'}
                </p>
              )}
            </div>
          </div>
          {(reviewResult === 'PARTIALLY_APPROVED' || reviewResult === 'REJECTED') && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="삭감/반려 사유" /></label>
              <ReasonInput domain="claimReject" multiline rows={2} value={reducedReason} onChange={setReducedReason}
                placeholder="삭감 또는 반려 사유를 입력하세요..." className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { const a = reviewApproved(claim.claimedAmount ?? null); if (a != null) reviewMutation.mutate(a); }}
              disabled={!reviewResult || reviewApproved(claim.claimedAmount ?? null) == null || reviewMutation.isPending}
              className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <T k={reviewMutation.isPending ? '저장 중...' : '심사결과 저장'} />
            </button>
            <button onClick={() => setShowReview(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 심사 결과 표시 (이미 심사된 경우) */}
      {reviewResultView && (
        <div className={`rounded-2xl border p-5 ${reviewResultView === 'APPROVED' ? 'bg-emerald-50 border-emerald-200' : reviewResultView === 'REJECTED' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-900"><T k="심사 결과" /></h4>
            <StatusBadge domain="claim" status={reviewResultView} className="text-xs font-bold" />
          </div>
          {claim.approvedAmount != null && (
            <p className="text-sm text-gray-700"><Tf k="인정액: {인정액} (삭감: {삭감})" params={{ 인정액: <strong><Money value={claim.approvedAmount} /></strong>, 삭감: <Money value={((claim.claimedAmount ?? 0) - claim.approvedAmount)} /> }} /></p>
          )}
          {reducedReasonView && <p className="text-xs text-gray-500 mt-1"><Tf k="사유: {사유}" params={{ 사유: reducedReasonView }} /></p>}
          {claim.reviewedAt && <p className="text-[10px] text-gray-400 mt-1"><Tf k="심사일: {일시}" params={{ 일시: format(new Date(claim.reviewedAt), 'yyyy.MM.dd HH:mm') }} /></p>}
          {(reviewResultView === 'PARTIALLY_APPROVED' || reviewResultView === 'REJECTED') && (
            <button onClick={() => setShowAppeal(!showAppeal)}
              className="mt-3 px-4 py-2 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700">
              이의신청
            </button>
          )}
        </div>
      )}

      {/* 이의신청 폼 */}
      {showAppeal && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-orange-900">이의신청</h3>
          <p className="text-xs text-orange-700"><T k="삭감 또는 반려된 청구에 대해 이의를 신청합니다. 사유를 상세히 작성하세요." /></p>
          <textarea value={appealReason} onChange={e => setAppealReason(e.target.value)} rows={4}
            placeholder={tAttr('이의신청 사유를 상세히 기재하세요.\n예: 해당 진료행위는 환자 상태상 의학적으로 필요한 조치였으며...')}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
          <div className="flex gap-2">
            <button onClick={() => appealMutation.mutate()} disabled={!appealReason.trim() || appealMutation.isPending}
              className="flex-1 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 disabled:opacity-50">
              <T k={appealMutation.isPending ? '제출 중...' : '이의신청 제출'} />
            </button>
            <button onClick={() => setShowAppeal(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 행목별 상세 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="행목별 진료 내역" /></h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 text-left text-gray-500"><T k="구분" /></th>
              <th className="py-2 text-left text-gray-500"><T k="항목" /></th>
              <th className="py-2 text-right text-gray-500"><T k="금액" /></th>
              <th className="py-2 text-right text-gray-500"><T k="보험자" /></th>
              <th className="py-2 text-right text-gray-500"><T k="본인" /></th>
            </tr>
          </thead>
          <tbody>
            {categoryAmounts.filter(c => c.amount > 0).map(cat => (
              <tr key={cat.no} className="border-b border-gray-50">
                <td className="py-2 text-gray-600">{cat.no} <T k={cat.name} /></td>
                <td className="py-2 text-gray-800">
                  {cat.items.length > 0 ? cat.items.map((i: AnyRecord) => {
                    const mc = i.medicationCode as Record<string, string> | undefined;
                    const pc = i.procedureCode as Record<string, string> | undefined;
                    return String(i.name ?? i.codeName ?? i.description ?? mc?.nameKo ?? pc?.nameKo ?? '-');
                  }).join(', ') : '-'}
                </td>
                <td className="py-2 text-right font-mono text-gray-900">{cat.amount.toLocaleString()}</td>
                <td className="py-2 text-right font-mono text-gray-400" colSpan={2}>—</td>
              </tr>
            ))}
            {categoryAmounts.every(c => c.amount === 0) && (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400"><T k="행목별 상세 내역이 없습니다." /></td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-bold">
              <td className="py-2" colSpan={2}><T k="합계" /></td>
              <td className="py-2 text-right font-mono">{(claim.claimedAmount ?? 0).toLocaleString()}</td>
              {/* 행목별 보험자/본인 분해는 청구 데이터에 없다 — 지어내지 않는다(수납 상세가 정본) */}
              <td className="py-2 text-right font-mono text-gray-400" colSpan={2}><T k="수납 상세 참조" /></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 심사 삭감 조정 라인 (R3-3) */}
      {/* 🔴 (P4-3) 심사 전 청구를 '청구액 전액 삭감'으로 말하지 않는다 — 삭감액은 심사가 기록한 값 */}
      <ClaimAdjustmentSection claimId={id} reducedAmount={claim.reducedAmount ?? undefined} />

      {/* 영수증/XML 다운로드 */}
      <div className="flex gap-3">
        <Link href={`/print/receipt/${claim.billingId ?? id}`}
          className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50">
          <T k="영수증 보기" />
        </Link>
        <button onClick={async () => {
          const err = await downloadClaimXml(id).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
          if (err) toast.error(err);
        }} className="px-4 py-2 bg-purple-50 text-purple-700 text-sm font-medium rounded-xl hover:bg-purple-100 border border-purple-200">
          <T k="XML 다운로드" />
        </button>
      </div>
    </div>
  );
}
