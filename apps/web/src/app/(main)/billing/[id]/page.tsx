'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { safeFormat as format } from '@/lib/safe-date';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { copayLabel, copayKind, eligibilityWarning } from '@/lib/billing/copay-category';
import { money, kdate } from '@/lib/ui-settings';
import { Unknown, Money, Unit } from '@/components/ui/display';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { billingRemaining, RECEIPT_CLASSES, receiptClassOf, roundBy, type ReceiptClassKey } from '@hospital-run/shared';

type R = Record<string, unknown>;

interface BillingItem {
  type?: string; category?: string; totalPrice?: number; amount?: number;
  dosage?: number | string; quantity?: number | string; duration?: number | string;
  unitPrice?: number; medicationCode?: Record<string, string>; procedureCode?: Record<string, string>;
  name?: string; description?: string;
  insuranceType?: string; receiptClass?: ReceiptClassKey | null;
}
interface BillingPatient {
  familyName?: string; givenName?: string; mrn?: string; insuranceType?: string;
}
interface BillingEncounter {
  id?: string;
  doctor?: { department?: string; familyName?: string; givenName?: string };
  diagnoses?: Array<{ diagnosisCode?: { nameKo?: string; code?: string } }>;
  prescriptions?: BillingItem[];
  patient?: BillingPatient;
}
interface BillingData {
  status?: string; createdAt?: string;
  patient?: BillingPatient; encounter?: BillingEncounter;
  items?: BillingItem[]; prescriptions?: BillingItem[];
  totalAmount?: number; total?: number;
  insuranceCovered?: number; patientCopay?: number; copay?: number; paidAmount?: number; discountAmount?: number | null;
  reviewedInsuranceAmount?: number; insuranceReducedAmount?: number; insuranceAdjustedAt?: string;
  copayCapExcess?: number;
  // 수납 처리 이력 — 응답에 이미 실려 오지만 화면에 없던 값
  cashierNote?: string | null; deferredReason?: string | null;
  refundedAt?: string | null; refundAmount?: number | null; refundReason?: string | null;
  billingId?: string;
  copayCategory?: string | null; eligibilityStatus?: string | null; specialExemption?: string | null;
}

// 법정 13개 항목 (의료법 시행규칙 별지 제11호) — 정본 shared `RECEIPT_CLASSES`(영수증 인쇄와 같은 표).
// 🔴 (P2-1) 칸은 서버가 라인마다 정한 `receiptClass` 로 고른다 — 진찰료·입원료 라인은 PROCEDURE 로 저장돼
//    codeType 만 보면 ⑨ 처치·수술료로 갔다. 어느 칸에도 맞지 않는 라인은 '분류 미등재'로 밝힌다.
const CATEGORIES: { no: string; name: string; key: ReceiptClassKey | null }[] = [
  ...RECEIPT_CLASSES.map(c => ({ no: c.no, name: c.name, key: c.key as ReceiptClassKey | null })),
  { no: '', name: '분류 미등재', key: null },
];
const classOfItem = (it: BillingItem): ReceiptClassKey | null =>
  it.receiptClass !== undefined ? it.receiptClass : receiptClassOf({ codeType: it.type ?? it.category ?? null });

// 🔴 InsuranceType enum 실제 값은 NHI·MEDICAID·INDUSTRIAL·AUTO·SELF_PAY 5종이다.
//    종전 표는 MA1/MA2/VETERAN/SELF 라는 없는 키를 갖고 있어 의료급여·자비 환자가
//    "계산 근거: undefined …" 로 렌더됐다(2026-08-13 W6). shared 정본을 쓴다.
const INSURANCE_LABEL: Record<string, string> = { NHI: '건강보험', MEDICAID: '의료급여', INDUSTRIAL: '산재보험', AUTO: '자동차보험', SELF_PAY: '비급여(자비)' };
const CARD_COMPANIES = ['삼성카드','현대카드','KB국민카드','신한카드','롯데카드','하나카드','우리카드','BC카드','NH카드'];

export default function BillingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const tAttr = useTAttr();
  const tf = useTfAttr();
  const { id } = use(params);
  const qc = useQueryClient();
  const [paymentMethod, setPaymentMethod] = useState('CARD');
  const [cardCompany, setCardCompany] = useState('');
  const [cardApprovalNo, setCardApprovalNo] = useState('');
  const [installment, setInstallment] = useState('0');
  const [cashReceiptType, setCashReceiptType] = useState('NONE');
  const [cashReceiptNo, setCashReceiptNo] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [discount, setDiscount] = useState('NONE');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [showCalcDetail, setShowCalcDetail] = useState(false);
  const [isPartialPay, setIsPartialPay] = useState(false);
  const [voucherSerial, setVoucherSerial] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['billing-detail', id],
    queryFn: () => apiClient.get<R>(`/api/v1/billings/${id}`),
  });

  // 검진권 결제 옵션(잔여 부담·보유 검진권)
  const { data: payOpts, isError: payOptsIsError, error: payOptsError, refetch: refetchPayOpts } = useQuery({
    queryKey: ['billing-payment-options', id],
    queryFn: () => apiClient.get<R>(`/api/v1/billings/${id}/payment-options`),
  });
  interface PVoucher { serial: string; form: string; balance: number; applicable: number; expiresAt: string | null }
  const myVouchers = (((payOpts?.data as R)?.vouchers ?? []) as PVoucher[]);
  const depositBalance = Number((payOpts?.data as R)?.depositBalance ?? 0);
  const depositApplicable = Number((payOpts?.data as R)?.depositApplicable ?? 0);

  // 수가 설정 조회
  const { data: configData, isError: configIsError, error: configError, refetch: refetchConfig } = useQuery({
    queryKey: ['billing-config'],
    queryFn: () => apiClient.get<R>('/api/v1/config?category=billing'),
  });

  const isVoucher = paymentMethod === 'VOUCHER';
  const [cardAmount, setCardAmount] = useState(''); // 복합결제 카드 분할액
  const payMutation = useMutation({
    mutationFn: async () => {
      // 🔴 본인부담을 산출하지 못한 상태로 결제하지 않는다 — 화면이 만든 금액을 청구하는 자리였다
      if (finalCopay == null) throw new Error('본인부담금이 아직 계산되지 않았습니다 — 수납 계산을 먼저 확정하세요');
      if (finalCopay <= 0) throw new Error(tAttr('남은 납부 금액이 없습니다'));
      // 복합결제(MIXED) — 카드/현금을 각각 pay 호출로 기록(BillingPayment 라인 분리·두 번째 호출서 라벨 MIXED)
      // 🔴 (P1-3) 종전엔 감면을 어느 줄에도 보내지 않으면서 현금은 감면 후 금액으로 계산해 서버엔 PARTIAL 이 남았고,
      //    화면은 `{status:'PAID'}` 를 **직접 지어내** "완료"라 했다. 감면은 첫 줄에 싣고, 결과는 서버 응답 그대로 말한다.
      if (paymentMethod === 'MIXED') {
        const card = Math.max(0, Math.min(Number(cardAmount) || 0, finalCopay));
        const cash = finalCopay - card;
        const disc = serverDiscount > 0 || discountAmount <= 0 ? {} : { discountAmount, discountReason: discountReasonText };
        let last: unknown = null;
        if (card > 0) last = await apiClient.patch(`/api/v1/billings/${id}/pay`, { amount: card, paymentMethod: 'CARD', cardCompany: cardCompany || undefined, cardApprovalNo: cardApprovalNo || undefined, installment: Number(installment) || undefined, ...disc });
        if (cash > 0) last = await apiClient.patch(`/api/v1/billings/${id}/pay`, { amount: cash, paymentMethod: 'CASH', cashReceiptType: cashReceiptType !== 'NONE' ? cashReceiptType : undefined, cashReceiptNo: cashReceiptNo || undefined, ...(card > 0 ? {} : disc) });
        return last;
      }
      return apiClient.patch(`/api/v1/billings/${id}/pay`, isVoucher ? {
      amount: 0,
      paymentMethod: 'VOUCHER',
      voucherSerial,
    } : {
      amount: Number(payAmount) || finalCopay, // 미입력 시 **남은** 납부 금액(본인부담 − 감면 − 이미 낸 돈 · P1-1)
      paymentMethod,
      cardCompany: paymentMethod === 'CARD' ? (cardCompany || undefined) : undefined,
      cardApprovalNo: paymentMethod === 'CARD' ? (cardApprovalNo || undefined) : undefined,
      installment: paymentMethod === 'CARD' ? Number(installment) : undefined,
      cashReceiptType: paymentMethod === 'CASH' ? cashReceiptType : undefined,
      cashReceiptNo: paymentMethod === 'CASH' ? cashReceiptNo : undefined,
      // 🔴 `discountType` 은 DTO 에도 컬럼에도 없다(서버가 읽지 않는다) — 감면의 정본은
      //    아래 `discountReason` 문구다. 보내지 않는 편이 정직하다(보내면 지워질 뿐이다).
      // 이미 감면된 청구면 서버가 첫 감면을 유지한다 — 새 감면을 보내지 않는다
      discountAmount: serverDiscount <= 0 && discountAmount > 0 ? discountAmount : undefined,
      discountReason: serverDiscount <= 0 && discountAmount > 0 ? discountReasonText : undefined,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['billing-detail', id] });
      qc.invalidateQueries({ queryKey: ['billing-payment-options', id] });
      const st = ((res as R)?.data as R)?.status ?? ((res as R)?.status);
      if (isVoucher) { setVoucherSerial(''); setPaymentMethod('CARD'); }
      toast.success(st === 'PARTIAL' ? '검진권 충당 완료 — 잔여 부담액을 추가 결제하세요.' : '수납이 완료되었습니다.');
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '수납에 실패했습니다.'),
  });

  // 환불(과오납·중복결제) — PAID 청구 대상. 부분/전액 환불(전액 시 REFUNDED).
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const refundMutation = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/billings/${id}/refund`, { amount: Number(refundAmount), reason: refundReason.trim() }),
    onSuccess: (res: unknown) => {
      qc.invalidateQueries({ queryKey: ['billing-detail', id] });
      qc.invalidateQueries({ queryKey: ['cashier-stats'] });
      setShowRefund(false); setRefundAmount(''); setRefundReason('');
      toast.success('환불이 처리되었습니다.');
      // 🔴 (2026-10-14 P5-5·선수금) 서버가 밝힌 후속 확인을 말한다 — 보험 청구 정정 검토·선수금으로 낸 몫(예치금 복원은 사람 결정)
      const r = ((res as { data?: unknown })?.data ?? res) as { claimReview?: { needed?: boolean; claims?: unknown[] } | null; depositPortion?: number } | null;
      if (r?.claimReview?.needed) toast.warning(tf('이 수납에 보험 청구 {건수}건이 있습니다 — 청구 정정 검토가 필요합니다.', { 건수: r.claimReview.claims?.length ?? 0 }));
      if (r?.depositPortion != null && r.depositPortion > 0) toast.warning(tf('환불 중 선수금으로 낸 몫 {금액}원 — 예치금으로 되돌릴지 현금으로 줄지 확인하세요(자동으로 되살리지 않았습니다).', { 금액: r.depositPortion.toLocaleString() }));
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '환불에 실패했습니다.'),
  });

  const _raw = data?.data as R;
  const billing = ((_raw?.data ?? _raw) as BillingData) ?? null;

  // 설정값 파싱
  const cfgItems: R[] = Array.isArray(configData?.data) ? (configData.data as R[]) : (((configData?.data as R)?.data ?? []) as R[]);
  const cfgMap: Record<string, unknown> = {};
  cfgItems.forEach((c: R) => { cfgMap[String(c.key)] = c.value; });
  // 🔴 (2026-10-20) 종별은 저장된 값만 — 목록이 싣는 카탈로그 기본값('CLINIC')을 "의원급"이라 말하지 않는다
  const gradeSet = cfgItems.some((c: R) => c.key === 'billing.institution.grade' && c.source !== 'default');
  const copayRate = Number(cfgMap['billing.copay.nhi.outpatient'] ?? 30) / 100;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="max-w-4xl mx-auto space-y-4">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>;
  if (!billing) return <div className="max-w-4xl mx-auto text-center py-20"><p className="text-gray-500"><T k="수납 정보를 찾을 수 없습니다." /></p><Link href="/billing" className="text-blue-600 text-sm mt-2 block"><T k="목록으로" /></Link></div>;

  const patient = billing.patient ?? billing.encounter?.patient;
  const patientName = patient ? `${patient.familyName ?? ''}${patient.givenName ?? ''}` : '-';
  const encounter = billing.encounter;
  const items = billing.items ?? billing.prescriptions ?? encounter?.prescriptions ?? [];
  const insuranceType = patient?.insuranceType ?? 'NHI';
  const totalAmount = billing.totalAmount ?? billing.total ?? 0;
  /**
   * 🔴 **본인부담을 화면이 계산하지 않는다**(2026-09-02).
   *    종전엔 서버가 값을 안 주면 `Math.round(totalAmount * copayRate)` 로 **평률 30%** 를 적용해
   *    그 결과가 곧 **결제 요청 금액**이 됐다. 본인부담 우선순위(비급여 > 감면 자격 > 코드별 특례 >
   *    자격 기본율)는 서버 정본(`EligibilityService.resolveCopayRate` · `GET /billing/calculate/:encounterId`)이
   *    갖는다 — 같은 사실에 정본이 둘이면 갈라지고, 약한 쪽이 **돈을 받는 경로**에 있었다(P12).
   *    저장된 금액이 없으면 지어내지 않고 `null`(산출 불가)로 두고 결제를 막는다.
   */
  const insuranceCovered: number | null = billing.insuranceCovered ?? null;
  const copay: number | null = billing.patientCopay ?? billing.copay ?? null;
  const copayUnavailable = copay == null;
  // 🔴 실제 본인부담률은 자격·보험유형마다 다르다(실측: 산재 0%·의료급여 15%·자비 100%).
  //    종전엔 건강보험 외래 30% 설정값을 **모든 환자에게** 라벨·행목 계산·법정 근거로 붙였다.
  //    저장된 금액이 정본이므로 **거기서 역산**한다(추정 금지·copay_rate_canonical 규약).
  const actualCopayRate = totalAmount > 0 && copay != null ? copay / totalAmount : null;
  const ratePct = actualCopayRate == null ? null : Math.round(actualCopayRate * 1000) / 10;
  const isPaid = billing.status === 'PAID';

  // 법정 항목 분류
  const categoryAmounts = CATEGORIES.map(cat => {
    const matched = items.filter((item: BillingItem) => classOfItem(item) === cat.key);
    const amount = matched.reduce((s: number, i: BillingItem) => s + ((i.totalPrice ?? i.amount ?? (Number(i.dosage ?? 0) * Number(i.quantity ?? i.duration ?? 1))) || 0), 0);
    return { ...cat, amount, items: matched };
  });

  /**
   * 🔴 **청구 항목에 없는 금액을 명세서에 만들어 넣지 않는다**(2026-09-02).
   *    종전엔 진찰료 칸이 0 이면 설정값(기본 11,690원)을 **①진찰료 행에 채워 넣고 '급여' 배지까지 달았다.**
   *    그 금액은 `totalAmount` 에 없으므로 **항목 합과 합계행이 어긋나고**, 출처 표시도 캐비아트도 없었다.
   *    의료법 시행규칙 별지 제11호 명세서에 근거 없는 금액이 들어가는 자리다 — 지어내지 않고 0 으로 둔다.
   *    (청구 라인이 비어 있는 것이 사실이면 그 사실이 명세서에 드러나야 한다.)
   */

  // 비급여 합계
  const NON_COVERED_TYPES = ['NON_COVERED', 'ROOM_UPGRADE', 'CERTIFICATE', 'COSMETIC'];
  // 🔴 (P2-1) 서버 라인의 급여 구분은 `insuranceType`(insuranceCategory) 이다 — 종전엔 이 칸을 보지 않아 비급여 소계가 늘 0 이었다
  const nonCoveredItems = items.filter((item: BillingItem) => NON_COVERED_TYPES.includes(item.type ?? '') || item.category === 'NON_COVERED' || item.insuranceType === 'NON_COVERED');
  const nonCoveredTotal = nonCoveredItems.reduce((s: number, i: BillingItem) => s + ((i.totalPrice ?? i.amount ?? 0) || 0), 0);
  const coveredTotal = totalAmount - nonCoveredTotal;


  // 할인 계산
  /**
   * 🔴 차상위(`SUBSIDY: 0.5`)를 화면에 박아 두지 않는다 — 감면 **자격**은 서버가 판정한다.
   *    원내 할인(경로우대·직원)은 설정값이 있는 것만 남기고, 미설정이면 할인하지 않는다.
   */
  const discountReasonText = ({ SENIOR: '경로우대 감면', STAFF: '직원가족 감면', SUBSIDY: '의료급여 보조', MEDICAL: '진료비 감면' } as Record<string, string>)[discount] ?? '감면';
  const discountRates: Record<string, number> = {
    SENIOR: Number(cfgMap['billing.discount.senior.rate'] ?? 10) / 100,
    STAFF: Number(cfgMap['billing.discount.staff.rate'] ?? 50) / 100,
  };
  /**
   * 🔴 (2026-10-14 결함 발굴 수납 P1-1·P1-3) 화면의 '이번에 받을 금액'은 서버 `pay()` 와 같은 식이어야 한다:
   *    본인부담 − 감면 − 이미 낸 돈. 종전엔 ① 본인부담 **전액**에서 출발해 부분 납부·검진권 뒤에도 전액을 기본값으로 보냈고
   *    ② 원 단위 절사(서버는 절사하지 않는다)로 1~9원이 미수로 남았다. 감면은 서버가 **처음 적용한 값**을 유지하므로
   *    이미 감면된 청구면 그 값을 쓰고 새 감면은 보내지 않는다.
   */
  const serverDiscount = Number(billing.discountAmount ?? 0);
  const discountInEffect = serverDiscount > 0 ? serverDiscount : discountAmount;
  const finalCopay = copay == null ? null : billingRemaining({ patientCopay: copay, discountAmount: discountInEffect, paidAmount: billing.paidAmount ?? 0 });

  // payAmount 기본값
  if (!payAmount && !isPaid) {
    // 첫 렌더 시 설정 — setTimeout 사용하지 않고 초기값으로
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/billing" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        <T k="수납 목록" />
      </Link>

      {encounter?.id && <ErpInvoicePanel encounterId={encounter.id} chartNo={patient?.mrn} interim={!isPaid} />}

      {eligibilityWarning(billing.eligibilityStatus) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
          <span>⚠️</span><span>{eligibilityWarning(billing.eligibilityStatus)}</span>
        </div>
      )}

      {/* 환자 정보 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900"><T k="수납 처리" /></h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900">{patientName}</span>
              <span className="text-xs text-gray-400">{patient?.mrn ?? '-'}</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">{copayLabel(insuranceType, billing.copayCategory, billing.specialExemption)}</span>
              <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">{copayKind(billing.copayCategory, billing.eligibilityStatus)}</span>
            </div>
            {encounter && (
              <div className="text-xs text-gray-500 mt-1 space-x-2">
                <span><T k="진료과" />: {encounter.doctor?.department ?? '-'}</span>
                <span><T k="담당의" />: {encounter.doctor?.familyName}{encounter.doctor?.givenName}</span>
                <span><T k="진료일" />: {billing.createdAt ? format(new Date(billing.createdAt), 'yyyy.MM.dd') : '-'}</span>
              </div>
            )}
            {(encounter?.diagnoses?.length ?? 0) > 0 && (
              <p className="text-xs text-blue-600 mt-1">
                <T k="진단" />: {encounter!.diagnoses!.map((d) => d.diagnosisCode?.nameKo ?? d.diagnosisCode?.code ?? '').filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isPaid ? 'bg-emerald-100 text-emerald-700' : billing.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
            <T k={isPaid ? '수납완료' : billing.status === 'CANCELLED' ? '취소' : '미수납'} />
          </span>
        </div>

        {/* 수납 처리 이력 — API 는 반환하지만 화면에 없던 값(취소·환불 사유가 여기 저장된다) */}
        {(billing.cashierNote || billing.deferredReason || billing.refundedAt) && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {billing.cashierNote && (
              <p className="text-xs text-gray-600">
                <span className="font-medium text-gray-500"><T k="수납 메모" /></span> · {billing.cashierNote}
              </p>
            )}
            {billing.deferredReason && (
              <p className="text-xs text-amber-700">
                <span className="font-medium"><T k="수납 유예 사유" /></span> · {billing.deferredReason}
              </p>
            )}
            {billing.refundedAt && (
              <p className="text-xs text-rose-700">
                <span className="font-medium"><T k="환불" /></span> · {kdate(new Date(billing.refundedAt))}
                {billing.refundAmount != null && ` · ${money(billing.refundAmount)}`}
                {billing.refundReason && ` · ${billing.refundReason}`}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 법정 10개 항목 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900"><T k="진료비 세부 내역" /></h3>
          <button onClick={() => setShowCalcDetail(!showCalcDetail)} className="text-xs text-blue-600 hover:underline">
            <T k={showCalcDetail ? '계산 내역 숨기기' : '계산 내역 보기'} />
          </button>
        </div>
        {/* 🔴 수가 설정 조회가 실패하면 본인부담률·절사단위가 하드코딩 기본값(30%·10원)으로 계산된다 — 밝힌다 */}
        {configIsError && (
          <div className="mb-3">
            <QueryErrorFallback error={configError} onRetry={() => refetchConfig()} size="compact" />
            <p className="text-[10px] text-amber-700 mt-1"><T k="수가 설정을 불러오지 못해 아래 계산 내역의 본인부담률·절사단위는 확인되지 않은 기본값입니다." /></p>
          </div>
        )}
        {/* 🔴 (2026-10-14 P5-1) 약가·수가 미등재 처방은 실청구에 0원 라인으로 들어간다 — 조용히 넘기지 않는다(처리 방식은 사람 결정 billing.unpricedLinePolicy) */}
        {items.some((i: BillingItem) => i.unitPrice === 0) && (
          <p className="mb-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-unpriced-lines>
            <T k="단가 0원 항목이 있습니다 — 약가·수가 미등재일 수 있어 금액이 빠졌을 수 있습니다(수가 마스터 확인 필요)." />
          </p>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="py-2 text-left w-8"><T k="구분" /></th>
              <th className="py-2 text-left"><T k="항목" /></th>
              <th className="py-2 text-left w-12"><T k="구분" /></th>
              <th className="py-2 text-right w-16"><T k="단가" /></th>
              <th className="py-2 text-right w-12"><T k="수량" /></th>
              <th className="py-2 text-right w-20"><T k="금액" /></th>
              {showCalcDetail && <>
                <th className="py-2 text-right w-20 text-blue-600"><T k="보험부담" /></th>
                <th className="py-2 text-right w-20 text-amber-600"><T k="본인부담" /></th>
              </>}
            </tr>
          </thead>
          <tbody>
            {categoryAmounts.filter(c => c.amount > 0 || c.items.length > 0).map(cat => (
              <CategoryRows key={cat.no} cat={cat} showCalcDetail={showCalcDetail} copayRate={actualCopayRate ?? copayRate} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-bold">
              <td className="py-2" colSpan={5}><T k="[급여] 소계" /></td>
              <td className="py-2 text-right font-mono">{coveredTotal.toLocaleString()}</td>
              {showCalcDetail && <>
                <td className="py-2 text-right font-mono text-blue-600">{insuranceCovered == null ? <Unknown kind="PENDING" /> : insuranceCovered.toLocaleString()}</td>
                {/* 본인부담(patientCopay)에는 비급여가 들어 있다 — 급여 소계에서는 뺀다(아래 비급여 소계와 이중 방지) */}
                <td className="py-2 text-right font-mono text-amber-600">{copay == null ? <Unknown kind="PENDING" /> : Math.max(0, copay - nonCoveredTotal).toLocaleString()}</td>
              </>}
            </tr>
            {nonCoveredTotal > 0 && (
              <tr className="font-bold text-red-600">
                <td className="py-2" colSpan={5}><T k="[비급여] 소계" /></td>
                <td className="py-2 text-right font-mono">{nonCoveredTotal.toLocaleString()}</td>
                {showCalcDetail && <>
                  <td className="py-2 text-right font-mono">-</td>
                  <td className="py-2 text-right font-mono">{nonCoveredTotal.toLocaleString()}</td>
                </>}
              </tr>
            )}
            <tr className="border-t font-bold text-gray-900">
              <td className="py-2" colSpan={5}><T k="합계" /></td>
              <td className="py-2 text-right font-mono">{totalAmount.toLocaleString()}</td>
              {showCalcDetail && <>
                <td className="py-2 text-right font-mono text-blue-600">{insuranceCovered == null ? <Unknown kind="PENDING" /> : insuranceCovered.toLocaleString()}</td>
                <td className="py-2 text-right font-mono text-amber-600">{copay == null ? <Unknown kind="PENDING" /> : (copay + nonCoveredTotal).toLocaleString()}</td>
              </>}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 부담금 요약 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="부담금 계산" /></h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500"><T k="총 진료비" /></span><span className="font-mono"><Money value={totalAmount} /></span></div>
          <div className="flex justify-between"><span className="text-blue-600"><T k="보험자 부담" />{ratePct != null && <> ({Math.round((100 - ratePct) * 10) / 10}<Unit>%</Unit>)</>}</span><span className="font-mono text-blue-600">-<Money value={insuranceCovered} /></span></div>
          <div className="border-t pt-2 flex justify-between"><span className="text-gray-700"><T k="본인부담금" />{ratePct != null && <> ({ratePct}<Unit>%</Unit>)</>}</span><span className="font-mono font-bold"><Money value={copay} /></span></div>
          {(billing.insuranceReducedAmount ?? 0) > 0 && (
            <div className="flex justify-between text-rose-600"><span><T k="심사 삭감" />{billing.insuranceAdjustedAt ? ` (${kdate(new Date(billing.insuranceAdjustedAt))})` : ''} · <T k="병원부담" /></span><span className="font-mono">-<Money value={(billing.insuranceReducedAmount ?? 0)} /></span></div>
          )}
          {(billing.copayCapExcess ?? 0) > 0 && (
            <div className="flex justify-between text-emerald-600"><span><T k="본인부담상한 사전급여 (초과분 공단부담)" /></span><span className="font-mono">-<Money value={(billing.copayCapExcess ?? 0)} /></span></div>
          )}

          {/* 할인/감면 */}
          {!isPaid && (
            <div className="border-t pt-2">
              <p className="text-xs text-gray-400 mb-1.5"><T k="할인/감면" /></p>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { key: 'NONE', label: '없음' },
                  { key: 'SENIOR', label: `경로우대 (${Number(cfgMap['billing.discount.senior.rate'] ?? 10)}%)` },
                  { key: 'STAFF', label: `직원가족 (${Number(cfgMap['billing.discount.staff.rate'] ?? 50)}%)` },
                  /* 🔴 차상위는 **감면 자격**이라 서버(자격 정본)가 판정한다 — 화면 선택지로 두면 수납원이 요율을 만든다 */
                ].map(d => (
                  <button key={d.key} onClick={() => { setDiscount(d.key); setDiscountAmount(d.key === 'NONE' || copay == null ? 0 : (roundBy(copay * (discountRates[d.key] ?? 0), 'money') ?? 0)); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium ${discount === d.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <T k={d.label} />
                  </button>
                ))}
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between mt-2"><span className="text-emerald-600"><T k="할인 감면" /></span><span className="font-mono text-emerald-600">-<Money value={discountAmount} /></span></div>
              )}
            </div>
          )}

          <div className="border-t-2 border-gray-800 pt-2 flex justify-between items-center">
            <span className="text-lg font-bold text-gray-900"><T k="최종 수납액" /></span>
            <span className="text-2xl font-bold text-blue-600"><Money value={finalCopay} /></span>
          </div>
          {showCalcDetail && (
            <p className="text-[10px] text-gray-400">
              {/* 🔴 법정 조문은 건강보험에만 해당한다 — 산재·자보·의료급여에 붙이면 근거를 날조하는 것 */}
              계산 근거: {INSURANCE_LABEL[insuranceType] ?? insuranceType} {gradeSet ? <>{{'CLINIC':'의원','HOSPITAL':'병원','GENERAL':'종합병원','TERTIARY':'상급종합'}[String(cfgMap['billing.institution.grade'])] ?? String(cfgMap['billing.institution.grade'])}급 외래</> : <T k="외래(요양기관 종별 미설정 — 의원으로 청구)" />}
              {ratePct != null ? ` · 실적용 본인부담률 ${ratePct}%` : ' · 본인부담률 산출 불가'}
              {insuranceType === 'NHI' ? ' (국민건강보험법 시행령 제19조)' : ''}
            </p>
          )}
        </div>
      </div>

      {/* 결제수단 + 수납 */}
      {!isPaid && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <h3 className="text-sm font-bold text-gray-900"><T k="결제" /></h3>

          {/* 🔴 조회 실패를 "예치금·검진권 없음"으로 접지 않는다 — 결제수단이 조용히 사라진다 */}
          {payOptsIsError && <QueryErrorFallback error={payOptsError} onRetry={() => refetchPayOpts()} size="compact" />}

          {/* 결제수단 선택 */}
          <div className="flex flex-wrap gap-2">
            {[{k:'CARD',l:tAttr('카드')},{k:'CASH',l:tAttr('현금')},{k:'TRANSFER',l:tAttr('계좌이체')},{k:'MIXED',l:tAttr('복합결제')},
              ...(depositBalance > 0 ? [{k:'DEPOSIT',l:`${tAttr('예치금')} ${money(depositBalance)}`}] : []),
              ...(myVouchers.length ? [{k:'VOUCHER',l:`${tAttr('검진권')} ${myVouchers.length}`}] : [])].map(m => (
              <button key={m.k} onClick={() => setPaymentMethod(m.k)}
                className={`px-4 py-2 rounded-xl text-sm font-medium ${paymentMethod === m.k ? (m.k === 'VOUCHER' ? 'bg-violet-600 text-white' : m.k === 'DEPOSIT' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white') : 'bg-gray-100 text-gray-600'}`}>
                {m.l}
              </button>
            ))}
          </div>

          {/* 예치금(선수금) 안내 */}
          {paymentMethod === 'DEPOSIT' && (
            <div className="bg-emerald-50/60 rounded-xl p-4 text-xs space-y-1">
              <p className="font-bold text-emerald-700"><T k="환자 예치금(선수금)으로 충당 — 부족분은 카드/현금 추가결제" /></p>
              {/* 🔴 아래 줄은 <b> 로 쪼개진 문장이라 조각으로 등재하지 않았다(카탈로그 헤더 §③) */}
              <p className="text-gray-600">보유 잔액 <b><Money value={depositBalance} /></b> · 이번 충당 가능 <b className="text-emerald-700"><Money value={depositApplicable} /></b> (결제 시 오래된 예치금부터 자동 차감)</p>
            </div>
          )}

          {/* 검진권 선택 */}
          {isVoucher && (
            <div className="bg-violet-50/60 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-violet-700"><T k="보유 검진권 — 잔액으로 충당(부족분은 카드/현금 추가결제)" /></p>
              {myVouchers.map(v => (
                <button key={v.serial} onClick={() => setVoucherSerial(v.serial)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm text-left ${voucherSerial === v.serial ? 'border-violet-400 bg-white' : 'border-gray-100 bg-white/70 hover:bg-white'}`}>
                  <span className="font-mono text-gray-700">{v.serial}</span>
                  <span className="text-gray-500"><T k={v.form === 'AMOUNT' ? '금액권' : '검진권'} /> · <T k="잔액" /> {v.balance.toLocaleString()} · <span className="text-violet-600 font-semibold"><T k="충당" /> <Money value={v.applicable} /></span></span>
                </button>
              ))}
              {!payOptsIsError && !myVouchers.length && <p className="text-xs text-gray-400 py-2 text-center"><T k="보유 검진권 없음" /></p>}
            </div>
          )}

          {/* 카드 상세 */}
          {paymentMethod === 'CARD' && (
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-500 mb-1 block"><T k="카드사" /></label>
                <select value={cardCompany} onChange={e => setCardCompany(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">{tAttr('선택')}</option>{CARD_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 mb-1 block"><T k="승인번호" /></label>
                <input value={cardApprovalNo} onChange={e => setCardApprovalNo(e.target.value)} placeholder="12345678" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="text-xs text-gray-500 mb-1 block"><T k="할부" /></label>
                <select value={installment} onChange={e => setInstallment(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="0">{tAttr('일시불')}</option>{[2,3,6,10,12].map(m => <option key={m} value={String(m)}>{m}<Unit>개월</Unit></option>)}</select></div>
            </div>
          )}

          {/* 현금 상세 */}
          {paymentMethod === 'CASH' && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 mb-1 block"><T k="현금영수증" /></label>
                <div className="flex gap-1.5">{[{k:'INCOME',l:tAttr('소득공제')},{k:'EXPENSE',l:tAttr('지출증빙')},{k:'NONE',l:tAttr('미발급')}].map(o => (
                  <button key={o.k} onClick={() => setCashReceiptType(o.k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${cashReceiptType === o.k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{o.l}</button>
                ))}</div></div>
              {cashReceiptType !== 'NONE' && (
                <div><label className="text-xs text-gray-500 mb-1 block"><T k="번호 (주민번호/사업자번호)" /></label>
                  <input value={cashReceiptNo} onChange={e => setCashReceiptNo(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              )}
            </div>
          )}

          {/* 복합결제 (카드+현금) */}
          {paymentMethod === 'MIXED' && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-700"><T k="복합결제 금액 분리" /></p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block"><T k="카드 금액" /></label>
                  <input type="number" placeholder="0" value={cardAmount} max={finalCopay ?? undefined} className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    onChange={e => setCardAmount(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block"><T k="현금 금액 (자동)" /></label>
                  <input type="number" placeholder="0" className="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-gray-100" readOnly
                    value={finalCopay == null ? 0 : Math.max(0, finalCopay - (Number(cardAmount) || 0))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block"><T k="카드사" /></label>
                  <select value={cardCompany} onChange={e => setCardCompany(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">{tAttr('선택')}</option>{CARD_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block"><T k="현금영수증" /></label>
                  <div className="flex gap-1">{[{k:'INCOME',l:tAttr('소득공제')},{k:'NONE',l:tAttr('미발급')}].map(o => (
                    <button key={o.k} onClick={() => setCashReceiptType(o.k)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium ${cashReceiptType === o.k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{o.l}</button>
                  ))}</div>
                </div>
              </div>
            </div>
          )}

          {/* 부분수납 (검진권 외) */}
          {!isVoucher && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={isPartialPay} onChange={e => setIsPartialPay(e.target.checked)} className="rounded" />
              <span className="text-gray-600"><T k="부분수납 (잔액은 미수납 처리)" /></span>
            </label>
          )}

          {/* 결제금액 + 버튼 */}
          <div className="flex gap-3 items-end">
            {!isVoucher && (
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block"><T k="결제금액" /></label>
                <input type="number" value={payAmount || (finalCopay == null ? '' : String(finalCopay))} onChange={e => setPayAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-lg" />
                {isPartialPay && finalCopay != null && Number(payAmount || finalCopay) < finalCopay && (
                  <p className="text-xs text-amber-600 mt-1">
                    <T k="잔액" />: <Money value={(finalCopay - Number(payAmount || finalCopay))} /> → <T k="미수납 처리" />
                  </p>
                )}
              </div>
            )}
            {isVoucher && <div className="flex-1 text-sm text-gray-500"><T k="선택한 검진권 잔액으로 충당합니다." /></div>}
            {/* 🔴 본인부담이 산출되지 않았으면 그 사실을 말하고 결제를 막는다 — 화면이 만든 금액을 청구하지 않는다 */}
            {copayUnavailable && (
              <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <T k="본인부담금이 아직 계산되지 않았습니다(자격 미확인 또는 계산 전). 수납 계산을 확정한 뒤 결제하세요." />
              </p>
            )}
            <button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || copayUnavailable || (isVoucher && !voucherSerial)}
              className={`px-6 py-2.5 text-white text-sm font-bold rounded-xl disabled:opacity-50 ${isVoucher ? 'bg-violet-600 hover:bg-violet-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
              <T k={payMutation.isPending ? '처리 중...' : isVoucher ? '검진권 충당' : isPartialPay ? '부분 수납' : '수납 완료'} />
            </button>
          </div>
        </div>
      )}

      {/* 영수증/서류 */}
      <div className="flex gap-3 flex-wrap">
        <Link href={`/print/receipt/${id}`} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50"><T k="계산서/영수증" /></Link>
        <Link href={`/print/receipt/${id}?tab=detail`} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50"><T k="세부산정내역" /></Link>
        <Link href={`/print/receipt/${id}?tab=noncovered`} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50"><T k="비급여 내역서" /></Link>
        {encounter?.id && (
          <Link href={`/print/prescription/${encounter.id}`} className="px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium rounded-xl hover:bg-emerald-100"><T k="원외처방전" /></Link>
        )}
        {isPaid && (billing.paidAmount ?? 0) > 0 && (
          <button onClick={() => { setRefundAmount(String(billing.paidAmount ?? 0)); setShowRefund(true); }}
            className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100 ml-auto"><T k="환불" /></button>
        )}
      </div>

      {showRefund && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowRefund(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-1"><T k="환불 처리" /></h3>
            <p className="text-xs text-gray-400 mb-4"><T k="수납액" /> <Money value={(billing.paidAmount ?? 0)} /> · <T k="전액/부분 환불(전액 시 환불완료 처리)" /></p>
            <label className="text-xs text-gray-500 mb-1 block"><T k="환불 금액" /></label>
            <input type="number" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} max={billing.paidAmount ?? 0}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" />
            <label className="text-xs text-gray-500 mb-1 block"><T k="환불 사유" /> <span className="text-red-400">*</span></label>
            <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder={tAttr('예: 과오납·중복결제·진료취소')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4" />
            <div className="flex gap-2">
              <button onClick={() => refundMutation.mutate()} disabled={refundMutation.isPending || !refundReason.trim() || Number(refundAmount) <= 0 || Number(refundAmount) > (billing.paidAmount ?? 0)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"><T k={refundMutation.isPending ? '처리 중…' : '환불 확정'} /></button>
              <button onClick={() => setShowRefund(false)} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600"><T k="닫기" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 카테고리 행 서브 컴포넌트 — Fragment 키 문제 해결 */
// copayRate = **이 청구의 실적용 부담률**(합계 금액에서 역산). 설정값 30% 고정이 아니다 — 열 합이
// 합계행과 어긋나던 원인(2026-08-13 W6).
function CategoryRows({ cat, showCalcDetail, copayRate }: { cat: { no: string; name: string; amount: number; items: BillingItem[] }; showCalcDetail: boolean; copayRate: number }) {
  return (
    <>
      <tr className="border-b border-gray-100 bg-gray-50/50">
        <td className="py-1.5 font-bold text-gray-500">{cat.no}</td>
        <td className="py-1.5 font-bold text-gray-700" colSpan={showCalcDetail ? 7 : 5}><T k={cat.name} /></td>
      </tr>
      {cat.items.length > 0 ? cat.items.map((item: BillingItem, idx: number) => {
        const price = item.unitPrice ?? item.amount ?? (Number(item.dosage) || 0);
        const qty = Number(item.quantity ?? item.duration ?? 1);
        const amt = item.totalPrice ?? price * qty;
        const ins = Math.round(amt * (1 - copayRate));
        const cop = amt - ins;
        return (
          <tr key={`${cat.no}-${idx}`} className="border-b border-gray-50">
            <td className="py-1.5"></td>
            <td className="py-1.5 text-gray-800">{item.medicationCode?.nameKo ?? item.procedureCode?.nameKo ?? item.name ?? item.description ?? '-'}</td>
            <td className="py-1.5"><span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="급여" /></span></td>
            <td className="py-1.5 text-right font-mono">{price.toLocaleString()}</td>
            <td className="py-1.5 text-right font-mono">{qty}</td>
            <td className="py-1.5 text-right font-mono font-medium">{amt.toLocaleString()}</td>
            {showCalcDetail && <>
              <td className="py-1.5 text-right font-mono text-blue-600">{ins.toLocaleString()}</td>
              <td className="py-1.5 text-right font-mono text-amber-600">{cop.toLocaleString()}</td>
            </>}
          </tr>
        );
      }) : (
        <tr className="border-b border-gray-50">
          <td className="py-1.5"></td>
          <td className="py-1.5 text-gray-500 italic">{cat.no === '①' ? <T k="진찰료" /> : '-'}</td>
          <td className="py-1.5"><span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="급여" /></span></td>
          <td className="py-1.5 text-right font-mono">{cat.amount.toLocaleString()}</td>
          <td className="py-1.5 text-right font-mono">1</td>
          <td className="py-1.5 text-right font-mono font-medium">{cat.amount.toLocaleString()}</td>
          {showCalcDetail && <>
            <td className="py-1.5 text-right font-mono text-blue-600">{Math.round(cat.amount * (1-copayRate)).toLocaleString()}</td>
            <td className="py-1.5 text-right font-mono text-amber-600">{Math.round(cat.amount * copayRate).toLocaleString()}</td>
          </>}
        </tr>
      )}
    </>
  );
}

// ERP 진료비 계산결과(D-6 요청2) — HIS가 ERP invoice 프록시 조회. ERP 미가동 시 표시 안 함.
function ErpInvoicePanel({ encounterId, chartNo, interim }: { encounterId: string; chartNo?: string; interim: boolean }) {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['erp-invoice', encounterId, chartNo, interim],
    queryFn: () => apiClient.get<R>(`/api/v1/billing/erp-invoice?encounterId=${encounterId}${chartNo ? `&chartNo=${encodeURIComponent(chartNo)}` : ''}&interim=${interim}`),
    staleTime: 30_000,
  });
  const res = (data?.data as { available?: boolean; invoice?: Record<string, unknown> }) ?? {};
  // 🔴 조회 실패는 "ERP 미가동"과 다르다 — 조용히 숨기면 ERP 금액이 없는 것처럼 보인다
  if (isError) {
    return (
      <div className="rounded-2xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-2"><T k="ERP 진료비" /> {interim ? <T k="(중간계산)" /> : ''}</h3>
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      </div>
    );
  }
  if (!res.available || !res.invoice) return null;
  const inv = res.invoice as Record<string, number | boolean | { blocked?: boolean; findings?: unknown[] }>;
  const blocked = (inv.preReview as { blocked?: boolean })?.blocked;
  const won = (n: unknown) => (typeof n === 'number' ? n.toLocaleString() + '원' : '-');
  return (
    <div className={`rounded-2xl border p-5 ${blocked ? 'border-rose-200 bg-rose-50/50' : 'border-blue-200 bg-blue-50/40'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-800"><T k="ERP 진료비" /> {interim ? <T k="(중간계산)" /> : ''}</h3>
        {blocked && <span className="text-xs font-medium text-rose-600"><T k="⚠ 사전심사 확인 필요" /></span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><div className="text-xs text-gray-400"><T k="총액" /></div><div className="font-mono">{won(inv.total)}</div></div>
        <div><div className="text-xs text-gray-400"><T k="본인부담" /></div><div className="font-mono text-amber-700">{won(inv.patientShare)}</div></div>
        <div><div className="text-xs text-gray-400"><T k="기수납" /></div><div className="font-mono text-gray-500">{won(inv.prepaid)}</div></div>
        <div><div className="text-xs text-gray-400"><T k="미수납" /></div><div className="font-mono font-semibold text-blue-700">{won(inv.balanceDue)}</div></div>
      </div>
      {blocked && <p className="text-xs text-rose-600 mt-2"><T k="사전심사 BLOCK 룰에 걸린 항목이 있습니다. 수납 전 심사팀 확인을 권장합니다." /></p>}
    </div>
  );
}
