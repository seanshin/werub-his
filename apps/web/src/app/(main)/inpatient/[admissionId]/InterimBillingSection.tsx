'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { INTERIM_PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type InterimPaymentMethod } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { kdate } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Money, Num } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

export interface InterimPaymentLine {
  id: string;
  method: string;
  amount: number;
  cardApprovalNo?: string | null;
  cardCompany?: string | null;
  createdAt: string;
}

export interface InterimRefundLine {
  id: string;
  amount: number;
  method: string;
  reason: string;
  refundedAt: string;
}

export interface InterimBillingRecord {
  id: string;
  sequenceNo?: number;
  status?: string;
  copayAmount?: number | string;
  paidAmount?: number | string | null;
  totalAmount?: number | string;
  insuranceAmount?: number | string;
  periodStart?: string;
  periodEnd?: string;
  paidAt?: string | null;
  days?: number | null;
  dailyRate?: number | string | null;
  priceBasis?: string | null;
  copayRate?: number | string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
  payments?: InterimPaymentLine[];
  refunds?: InterimRefundLine[];
}

const refundedOf = (b: InterimBillingRecord) => (b.refunds ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);

/** 단가 출처 → 사람이 읽는 말 · DEFAULT_CONSTANT 는 근거 없는 상수(경고) */
const PRICE_BASIS_LABEL: Record<string, string> = {
  CODE: '수가 마스터 단가',
  CONFIG_BED_CLASS: '병상 등급 일당 설정',
  CONFIG_DAILY: '기본 일당 설정',
  DEFAULT_CONSTANT: '설정된 단가 없음 — 상수 50,000원',
};

const STATUS_LABEL: Record<string, string> = { PAID: '수납완료', OVERDUE: '연체', NOTIFIED: '안내완료', GENERATED: '생성', VOID: '무효' };

/**
 * 입원료 중간정산(2026-10-22 재작성 · 종전 입원 상세 페이지 안 섹션).
 *  · 🔴 수납은 수단을 고른 뒤에만(미선택 시작) — 종전엔 버튼 한 번에 수단 없이 "수납 완료"였다(일마감 시재·카드 대사·ERP 계정에 남지 않음)
 *  · 🔴 실패는 서버가 말한 이유 그대로 — 종전엔 "수납에 실패했습니다" 한 마디(같은 날 두 번·재원 아님·금액 불일치를 구분 못 함)
 *  · 산정 근거(박 수 × 일당 · 단가 출처 · 급여율) — 퇴원 입원료 청구와 같은 정본 · 상수 단가는 그렇다고 말한다
 *  · 무효 — 수납 전·마지막 회차만 · 사유 필수(지우지 않는다)
 *  · 환불(2026-10-22 · ERP R5) — 수납된 회차 · 부분 환불 · 누적 ≤ 받은 금액 · 금액·수단 미선택 시작 · 사유 필수 · 회차는 수납완료 그대로
 */
export function InterimBillingSection({ admissionId }: { admissionId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<string | null>(null);

  const { data, isLoading, refetch, isError, error } = useQuery({
    queryKey: ['interim-billings', admissionId],
    queryFn: () => apiClient.get<{ data: InterimBillingRecord[] | { data: InterimBillingRecord[] } }>(`/api/v1/inpatient/${admissionId}/interim-billings`),
  });
  const raw = data?.data;
  const billings: InterimBillingRecord[] = Array.isArray(raw) ? raw : ((raw as { data?: InterimBillingRecord[] })?.data ?? []);
  const live = billings.filter((b) => b.status !== 'VOID');
  const totalCopay = live.reduce((s, b) => s + Number(b.copayAmount ?? 0), 0);
  const totalReceived = live.reduce((s, b) => s + Number(b.paidAmount ?? 0), 0);
  const totalRefunded = live.reduce((s, b) => s + refundedOf(b), 0);
  // 🔴 돌려준 돈은 받은 돈이 아니다 — 수납 완료 칸은 순액, 미수납은 받아야 할 것(수납 안 한 회차)만
  const totalPaid = totalReceived - totalRefunded;
  const unpaid = live.reduce((s, b) => s + (b.status === 'PAID' ? 0 : Number(b.copayAmount ?? 0) - Number(b.paidAmount ?? 0)), 0);
  const lastLiveSeq = live.reduce((m, b) => Math.max(m, b.sequenceNo ?? 0), 0);

  const refresh = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ['discharge-settlement', admissionId] });
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await apiClient.post(`/api/v1/inpatient/${admissionId}/interim-billings/generate`);
      refresh();
      toast.success(tAttr('중간 정산이 생성되었습니다.'));
    } catch (e) {
      toast.error(extractErrorMessage(e));
    }
    setGenerating(false);
  };

  return (
    <div className="space-y-4" data-interim-section>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900"><T k="입원료 중간정산" /> <span className="text-xs font-normal text-gray-400">(<T k="일당 병실료 — 처방·검사비는 진료 청구에 별도 계상" />)</span></h3>
        <button onClick={generate} disabled={generating}
          className="min-h-[44px] px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
          {generating ? <T k="생성 중..." /> : <>+ <T k="중간 정산 생성" /></>}
        </button>
      </div>
      <p className="text-xs text-gray-500"><T k="퇴원 입원료 청구와 같은 산식(수가코드 단가·자격별 급여율)으로 직전 회차가 끝난 날(첫 회차는 입원일)부터 오늘까지의 박 수를 정산합니다. 받은 돈은 퇴원 정산에서 기납부로 뺍니다." /></p>

      {/* 🔴 조회 실패에 금액 합계(0원)를 그리지 않는다 — 미수납을 0으로 보이게 한다 */}
      {isError && <QueryErrorFallback error={error} onRetry={() => refetch()} />}

      {!isError && <>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border p-4 text-center">
            <p className="text-xs text-gray-400"><T k="누적 본인부담" /></p>
            <p className="text-lg font-bold text-gray-900" data-interim-total-copay={totalCopay}><Money value={totalCopay} /></p>
          </div>
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 text-center">
            <p className="text-xs text-emerald-500"><T k="수납 완료" /></p>
            <p className="text-lg font-bold text-emerald-600" data-interim-total-paid={totalPaid}><Money value={totalPaid} /></p>
            {totalRefunded > 0 && <p className="text-[11px] text-gray-500" data-interim-total-refunded={totalRefunded}><T k="환불" /> <Money value={totalRefunded} /> <T k="뺀 금액" /></p>}
          </div>
          <div className={`rounded-xl border p-4 text-center ${unpaid > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
            <p className="text-xs text-gray-400"><T k="미수납" /></p>
            <p className={`text-lg font-bold ${unpaid > 0 ? 'text-red-600' : 'text-gray-400'}`} data-interim-unpaid={unpaid}><Money value={unpaid} /></p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : billings.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-500"><T k="중간 정산 내역이 없습니다" /></p>
            <p className="text-xs text-gray-400 mt-1"><T k='"중간 정산 생성" 버튼으로 현재까지 입원료(일당)를 정산합니다' /></p>
          </div>
        ) : (
          <div className="space-y-3">
            {billings.map((b) => {
              const isPaid = b.status === 'PAID';
              const isVoid = b.status === 'VOID';
              const copay = Number(b.copayAmount ?? 0);
              const paid = Number(b.paidAmount ?? 0);
              const refunded = refundedOf(b);
              const refundable = isPaid ? paid - refunded : 0;
              const canVoid = !isPaid && !isVoid && b.sequenceNo != null && b.sequenceNo === lastLiveSeq;
              return (
                <div key={b.id} data-interim-row={b.id} data-interim-status={b.status}
                  className={`bg-white rounded-xl border p-5 ${isVoid ? 'border-gray-200 opacity-60' : isPaid ? 'border-emerald-200' : b.status === 'OVERDUE' ? 'border-red-200' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900"><Tf k="{회차}차 중간 정산" params={{ 회차: b.sequenceNo ?? '-' }} /></span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                        isVoid ? 'bg-gray-100 text-gray-500' : isPaid ? 'bg-emerald-100 text-emerald-700' : b.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        <T k={STATUS_LABEL[b.status ?? ''] ?? (b.status ?? '')} />
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {b.periodStart ? kdate(b.periodStart) : ''} ~ {b.periodEnd ? kdate(b.periodEnd) : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs mb-2">
                    <div><span className="text-gray-400"><T k="총액" /></span><p className="font-bold text-gray-900"><Money value={Number(b.totalAmount ?? 0)} /></p></div>
                    <div><span className="text-gray-400"><T k="보험부담" /></span><p className="font-bold text-blue-600"><Money value={Number(b.insuranceAmount ?? 0)} /></p></div>
                    <div><span className="text-gray-400"><T k="본인부담" /></span><p className="font-bold text-amber-600"><Money value={copay} /></p></div>
                  </div>
                  {/* 산정 근거 — 근거 칸 전 생성분은 모른다고 */}
                  {b.days != null && b.dailyRate != null ? (
                    <p className="text-[11px] text-gray-500 mb-2" data-interim-basis={b.priceBasis ?? 'UNKNOWN'}>
                      <Tf k="{박}박" params={{ 박: b.days }} /> × <Money value={Number(b.dailyRate)} /> · <T k={PRICE_BASIS_LABEL[b.priceBasis ?? ''] ?? '단가 출처 모름'} />
                      {b.copayRate != null && <> · <T k="본인부담률" /> <Num domain="percent" value={Number(b.copayRate) * 100} /></>}
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mb-2" data-interim-basis="LEGACY"><T k="산정 근거 기록 전에 만든 회차 — 일수·단가 출처를 모릅니다" /></p>
                  )}
                  {b.priceBasis === 'DEFAULT_CONSTANT' && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 rounded px-2 py-1 mb-2" data-interim-default-price>
                      <T k="입원료 단가가 수가 마스터·설정 어디에도 없어 상수로 계산했습니다 — 퇴원 입원료 청구도 같은 상수입니다. 수가 마스터 또는 병상 일당 설정이 필요합니다." />
                    </p>
                  )}
                  {isVoid && <p className="text-xs text-gray-500" data-interim-void-reason><T k="무효 사유" />: {b.voidReason ?? '-'}</p>}
                  {!isPaid && !isVoid && (
                    <div className="flex gap-2">
                      <button onClick={() => { setPayFor(b.id); setVoidFor(null); }} data-interim-pay-open={b.id}
                        className="flex-1 min-h-[44px] py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                        <T k="수납 처리" /> (<Money value={copay} />)
                      </button>
                      {canVoid && (
                        <button onClick={() => { setVoidFor(b.id); setPayFor(null); }} data-interim-void-open={b.id}
                          className="min-h-[44px] px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                          <T k="무효" />
                        </button>
                      )}
                    </div>
                  )}
                  {payFor === b.id && <InterimPayForm admissionId={admissionId} billingId={b.id} due={copay} onDone={() => { setPayFor(null); refresh(); }} onCancel={() => setPayFor(null)} />}
                  {refundFor === b.id && <InterimRefundForm admissionId={admissionId} billingId={b.id} refundable={refundable} onDone={() => { setRefundFor(null); refresh(); }} onCancel={() => setRefundFor(null)} />}
                  {voidFor === b.id && <InterimVoidForm admissionId={admissionId} billingId={b.id} onDone={() => { setVoidFor(null); refresh(); }} onCancel={() => setVoidFor(null)} />}
                  {isPaid && (
                    <div className="text-xs text-emerald-700" data-interim-paid>
                      <T k="수납" />: <Money value={paid} /> ({b.paidAt ? kdate(b.paidAt) : ''})
                      {(b.payments ?? []).length > 0
                        ? (b.payments ?? []).map((p) => (
                          <span key={p.id} className="ml-1" data-interim-payment-method={p.method}>
                            · <T k={PAYMENT_METHOD_LABEL[p.method] ?? p.method} />{p.cardApprovalNo ? ` ${p.cardApprovalNo}` : ''}
                          </span>
                        ))
                        : <span className="ml-1 text-gray-500" data-interim-payment-method="UNKNOWN">· <T k="수단 미기록" /></span>}
                      {(b.refunds ?? []).map((r) => (
                        <p key={r.id} className="text-gray-600" data-interim-refund={r.id}>
                          <T k="환불" />: <Money value={Number(r.amount)} /> · <T k={PAYMENT_METHOD_LABEL[r.method] ?? r.method} /> · {kdate(r.refundedAt)} · {r.reason}
                        </p>
                      ))}
                      {refundable > 0 && refundFor !== b.id && (
                        <button type="button" onClick={() => { setRefundFor(b.id); setPayFor(null); setVoidFor(null); }} data-interim-refund-open={b.id}
                          className="mt-2 min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                          <T k="환불" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>}
    </div>
  );
}

/** 수납 — 🔴 수단 미선택 시작 · 카드면 승인번호 필수 · 금액은 본인부담 전액(서버가 다시 확인) */
function InterimPayForm({ admissionId, billingId, due, onDone, onCancel }: { admissionId: string; billingId: string; due: number; onDone: () => void; onCancel: () => void }) {
  const tAttr = useTAttr();
  const [method, setMethod] = useState<InterimPaymentMethod | ''>('');
  const [approval, setApproval] = useState('');
  const [company, setCompany] = useState('');
  const [receipt, setReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = !!method && (method !== 'CARD' || approval.trim().length > 0);

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      await apiClient.patch(`/api/v1/inpatient/${admissionId}/interim-billings/${billingId}/pay`, {
        amount: due, method,
        ...(method === 'CARD' ? { cardApprovalNo: approval.trim(), ...(company.trim() ? { cardCompany: company.trim() } : {}) } : {}),
        ...(method !== 'CARD' && receipt.trim() ? { cashReceiptNo: receipt.trim() } : {}),
      });
      toast.success(tAttr('수납이 완료되었습니다.'));
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e)); // 서버가 말한 이유 그대로 — 창은 닫지 않는다
    }
    setBusy(false);
  };

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-2" data-interim-pay-form={billingId}>
      <p className="text-xs text-gray-600"><T k="받을 금액" />: <b><Money value={due} /></b> (<T k="본인부담 전액" />)</p>
      <div className="flex flex-wrap gap-2">
        {INTERIM_PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} data-interim-method={m}
            className={`min-h-[44px] px-3 rounded-lg border text-sm ${method === m ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
            <T k={PAYMENT_METHOD_LABEL[m]} />
          </button>
        ))}
      </div>
      {method === 'CARD' && (
        <div className="grid grid-cols-2 gap-2">
          <input value={approval} onChange={(e) => setApproval(e.target.value)} placeholder={tAttr('카드 승인번호(필수)')} aria-label={tAttr('카드 승인번호')}
            className="min-h-[40px] rounded-lg border border-gray-300 px-2 text-sm" data-interim-card-approval />
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={tAttr('카드사')} aria-label={tAttr('카드사')}
            className="min-h-[40px] rounded-lg border border-gray-300 px-2 text-sm" />
        </div>
      )}
      {method && method !== 'CARD' && (
        <input value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder={tAttr('현금영수증 번호(선택)')} aria-label={tAttr('현금영수증 번호')}
          className="min-h-[40px] w-full rounded-lg border border-gray-300 px-2 text-sm" />
      )}
      {err && <p className="text-xs text-red-600" role="alert" data-interim-pay-error>{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!ready || busy} data-interim-pay-submit
          className="flex-1 min-h-[44px] rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-40">
          {busy ? <T k="처리 중…" /> : <T k="수납" />}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-600"><T k="취소" /></button>
      </div>
    </div>
  );
}

/** 요청 중복 방지 키 — 브라우저가 지원하면 randomUUID, 아니면 난수 바이트(서버 형식: 영문·숫자·- 8~100자) */
function newRequestKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 환불 — 🔴 금액·수단 미선택 시작 · 1원 이상 정수 · 돌려줄 수 있는 금액(받은 돈 − 이미 환불)을 넘지 않게(서버가 다시 확인) · 사유 4자 */
function InterimRefundForm({ admissionId, billingId, refundable, onDone, onCancel }: { admissionId: string; billingId: string; refundable: number; onDone: () => void; onCancel: () => void }) {
  const tAttr = useTAttr();
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<InterimPaymentMethod | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 🔴 (v4.118.0 · ERP 2차 회신) 같은 내용을 다시 누르면(응답을 못 받은 재시도) 같은 키 → 서버가 첫 결과를 돌려준다(두 번째 환불 없음).
  //    내용을 바꾸면 새 요청이므로 새 키.
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const amount = /^\d+$/.test(amountText.trim()) ? Number(amountText.trim()) : null;
  const amountOk = amount != null && amount >= 1 && amount <= refundable;
  const ready = amountOk && !!method && reason.trim().length >= 4;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      const body = { amount, method, reason: reason.trim() };
      const sig = JSON.stringify(body);
      if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newRequestKey() };
      const res = await apiClient.post<{ meta?: { replayed?: boolean } }>(
        `/api/v1/inpatient/${admissionId}/interim-billings/${billingId}/refund`, body, { 'Idempotency-Key': keyRef.current.key },
      );
      toast.success(res?.meta?.replayed ? tAttr('이미 기록된 환불입니다 — 다시 기록하지 않았습니다.') : tAttr('환불을 기록했습니다.'));
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e)); // 서버가 말한 이유 그대로 — 창은 닫지 않는다
    }
    setBusy(false);
  };
  return (
    <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3 space-y-2" data-interim-refund-form={billingId}>
      <p className="text-xs text-gray-600"><T k="돌려줄 수 있는 금액" />: <b data-interim-refundable={refundable}><Money value={refundable} /></b> · <T k="회차는 수납완료로 남고 퇴원 정산 기납부에서 환불액을 뺍니다." /></p>
      <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="numeric" placeholder={tAttr('환불 금액(원)')} aria-label={tAttr('환불 금액')}
        className="min-h-[40px] w-full rounded-lg border border-gray-300 px-2 text-sm" data-interim-refund-amount />
      {amountText.trim() !== '' && !amountOk && <p className="text-xs text-red-600" data-interim-refund-amount-error><T k="1원 이상, 돌려줄 수 있는 금액 이하의 정수로 적어 주세요" /></p>}
      <div className="flex flex-wrap gap-2">
        {INTERIM_PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} data-interim-refund-method={m}
            className={`min-h-[44px] px-3 rounded-lg border text-sm ${method === m ? 'border-gray-700 bg-gray-700 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
            <T k={PAYMENT_METHOD_LABEL[m]} />
          </button>
        ))}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('환불 사유(4자 이상)')} aria-label={tAttr('환불 사유')}
        className="min-h-[40px] w-full rounded-lg border border-gray-300 px-2 text-sm" data-interim-refund-reason />
      {err && <p className="text-xs text-red-600" role="alert" data-interim-refund-error>{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!ready || busy} data-interim-refund-submit
          className="flex-1 min-h-[44px] rounded-lg bg-gray-700 text-white text-sm font-medium disabled:opacity-40">
          {busy ? <T k="처리 중…" /> : <T k="환불 기록" />}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-600"><T k="취소" /></button>
      </div>
    </div>
  );
}

/** 무효 — 사유 4자 이상 · 수납 전·마지막 회차만(서버가 다시 확인) */
function InterimVoidForm({ admissionId, billingId, onDone, onCancel }: { admissionId: string; billingId: string; onDone: () => void; onCancel: () => void }) {
  const tAttr = useTAttr();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = reason.trim().length >= 4;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      await apiClient.patch(`/api/v1/inpatient/${admissionId}/interim-billings/${billingId}/void`, { reason: reason.trim() });
      toast.success(tAttr('중간 정산을 무효로 했습니다.'));
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
    setBusy(false);
  };
  return (
    <div className="mt-3 rounded-lg border border-gray-300 bg-gray-50 p-3 space-y-2" data-interim-void-form={billingId}>
      <p className="text-xs text-gray-600"><T k="무효로 한 회차는 지우지 않고 사유와 함께 남습니다. 다음 회차는 이 회차의 기간부터 다시 셉니다." /></p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('무효 사유(4자 이상)')} aria-label={tAttr('무효 사유')}
        className="min-h-[40px] w-full rounded-lg border border-gray-300 px-2 text-sm" data-interim-void-reason-input />
      {err && <p className="text-xs text-red-600" role="alert" data-interim-void-error>{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!ready || busy} data-interim-void-submit
          className="flex-1 min-h-[44px] rounded-lg bg-gray-700 text-white text-sm font-medium disabled:opacity-40">
          <T k="무효로 하기" />
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm text-gray-600"><T k="취소" /></button>
      </div>
    </div>
  );
}
