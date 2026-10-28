'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Unit, InsuranceBadge, Money } from '@/components/ui/display';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useBillings,
  useBilling,
  useCashierQueue,
  useCashierStats,
  useDailySummary,
  useDeferredBillings,
  usePayBilling,
  useCancelBilling,
  useDeferBilling,
} from '@/hooks/useBilling';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { paymentMethodLabel, paymentMethodColor, billingRemaining, billingOutstanding } from '@hospital-run/shared';
import { money, useUiSettings, kdate } from '@/lib/ui-settings';
import { callWerub } from '@/lib/werub';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useHotkeys, comboLabel, ariaKeyshortcuts } from '@/components/hotkeys/HotkeyProvider';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

const depositSchema = z.object({
  patientId: z.string().min(1, '환자 ID를 입력하세요'),
  amount: z.string().min(1, '금액을 입력하세요'),
  depositType: z.string().min(1),
  paymentMethod: z.string().min(1),
  note: z.string().optional(),
});
type DepositForm = z.infer<typeof depositSchema>;

interface BillingQueueItem {
  id: string;
  queueNumber?: number;
  patientCopay?: number;
  departmentName?: string;
  createdAt: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  encounter?: { department?: string };
}

interface BillingListItem {
  id: string;
  patientCopay?: number;
  createdAt: string;
  deferReason?: string;
  note?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
}

interface DepositRecord {
  id: string;
  amount?: number;
  balance?: number; // 잔여액 — 수납(DEPOSIT) 차감 반영. 잔액 표시는 amount(적립액)가 아닌 이 값
  depositType: string;
  paymentMethod?: string;
  note?: string;
  createdAt: string;
}

interface CashierStatsData {
  pendingCount?: number;
  completedCount?: number;
  deferredCount?: number;
  /** 🔴 미수납 정본(전 기간 PENDING+PARTIAL+DEFERRED) — /executive overview.unpaid 와 같은 집합 */
  unpaidCount?: number;
  unpaidBasis?: string;
  todayRevenue?: number;
  totalRevenue?: number;
}

interface DailySummaryData {
  totalCount?: number;
  totalRevenue?: number;
  byPaymentMethod?: Record<string, number>;
  ledger?: {
    ledgerSum: number; ledgerCount: number;
    unledgeredCount: number; unledgeredAmount: number;
    billingSum: number; difference: number;
  };
  byInsurance?: Record<string, { count: number; amount: number }>;
  refundCount?: number;
  refundAmount?: number;
  cancelCount?: number;
  deferredCount?: number;
  deferredAmount?: number;
  /** 입원 중간정산 수납(2026-10-22) — 총계에 섞지 않는다(전표는 billing.interim_paid) · 옛 서버면 없음 */
  interimPayments?: { settledExcluded: true; count: number; amount: number; byMethod: Record<string, number>; unledgeredCount: number; unledgeredAmount: number; refundCount?: number; refundAmount?: number; refundByMethod?: Record<string, number> };
}

type TabKey = 'queue' | 'deferred' | 'outstanding' | 'daily' | 'deposit';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'queue', label: '수납 대기열' },
  { key: 'deferred', label: '미수납 관리' },
  { key: 'outstanding', label: '미수금 현황' },
  { key: 'daily', label: '일일 정산' },
  { key: 'deposit', label: '예치금' },
];

/**
 * 🔴 라벨은 shared 정본(`paymentMethodLabel`)에서 온다 — 로컬 재정의 금지(2026-08-25 수렴).
 *    값 목록은 이 화면의 성격(원무 수납 입력)에 맞춘 부분집합이다: 검진권(VOUCHER)은
 *    전용 흐름이 따로 있어 여기서 고르지 않는다.
 */
const PAYMENT_METHODS = (['CARD', 'CASH', 'TRANSFER', 'DEPOSIT'] as const).map((value) => ({
  value, label: paymentMethodLabel(value),
}));

const CASH_RECEIPT_OPTIONS = [
  { value: 'INCOME_DEDUCTION', label: '소득공제' },
  { value: 'EXPENSE_PROOF', label: '지출증빙' },
  { value: 'NONE', label: '미발행' },
];

const INSURANCE_LABEL: Record<string, string> = {
  NHI: '건강보험',
  MEDICAID: '의료급여',
  SELF_PAY: '자비',
};

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 ${minutes % 60}분`;
  return `${Math.floor(hours / 24)}일 전`;
}

// 금액 표기 — ui.currencyStyle 설정 반영(UX 일관성 검토 2026-07 파일럿·관리=시스템 설정 '화면 표시(UX)')
function formatCurrency(val?: number) {
  return money(val ?? 0);
}

function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-gray-50">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-5 py-3.5">
              <div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function StatCard({ label, value, sub, color = 'blue' }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex-1 min-w-[140px]">
      <p className="text-xs font-medium text-gray-500 mb-1"><T k={label} /></p>
      <p className={`text-2xl font-bold ${colorMap[color]?.split(' ')[1] ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   진료 기반 자동 계산 — GET /api/v1/billing/calculate/:encounterId

   🔴 W8 에서 본인부담률 정본(EligibilityService.resolveCopayRate — 의료급여 2종 외래 15%·
      산정특례 10%·차상위 14%·자격상실 100%)을 이 EP 에 수렴시켜 놓고 **부르는 화면이 0건**이었다.
      "EP 를 만들면 부르는 화면까지가 한 벌" — 수납 화면이 그 자리다.
      (`/admin/billing-calc` 은 수가 SystemConfig 설정 화면일 뿐 이름만 비슷하다.)

   🔴 이 EP 는 이미 정직하다 — 요율을 모르면 `copayRate:null`,
      약가 미등재는 `priceKnown:false`+`totalPrice:null`, 합계 불완전은 `summary.complete:false`.
      **화면이 그 필드를 소비해야** 정직해진다. `?? 0` 폴백 금지 — 0원은 "무료"라는 다른 사실이다.
   ═══════════════════════════════════════════════════════════════ */

interface CalcItem {
  category: string;
  code: string;
  name: string;
  unitPrice: number | null;
  quantity: number;
  totalPrice: number | null;
  insuranceType: 'COVERED' | 'NON_COVERED' | 'UNKNOWN';
  priceKnown: boolean;
  note?: string;
}

interface CalcResult {
  encounterId: string;
  insuranceType?: string;
  grade?: string;
  copayRate: number | null;
  copayCategory?: string | null;
  copayBasis?: 'ELIGIBILITY' | 'INSURANCE_TYPE_FALLBACK' | 'UNKNOWN';
  copayRateConfirmed?: boolean;
  items?: CalcItem[];
  summary?: {
    coveredTotal: number;
    nonCoveredTotal: number;
    totalAmount: number;
    insuranceCovered: number | null;
    patientCopay: number | null;
    complete: boolean;
    unpricedItemCount: number;
  };
  warnings?: string[];
}

const COPAY_BASIS_LABEL: Record<string, string> = {
  ELIGIBILITY: '수진자 자격조회 확인',
  INSURANCE_TYPE_FALLBACK: '보험유형 가정치(자격 미확인)',
  UNKNOWN: '산출 불가(자격 미확인)',
};

const CALC_CATEGORY_LABEL: Record<string, string> = {
  CONSULTATION: '진찰료', MEDICATION: '약제·조제', LAB: '검사', IMAGING: '영상',
  PROCEDURE: '처치·수술', INJECTION: '주사', ANESTHESIA: '마취',
  PHYSICAL_THERAPY: '물리치료', PSYCHIATRIC_THERAPY: '정신요법',
  BLOOD: '혈액', ADMISSION: '입원료', MATERIAL: '재료대',
};

/** 진료 기반 자동 계산 패널 — 저장된 청구와 대조해 수납 담당이 금액을 검증한다 */
function CalculatorPanel({ encounterId, storedCopay }: { encounterId: string; storedCopay?: number }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['billing-calculate', encounterId],
    queryFn: () => apiClient.get<{ data: CalcResult }>(`/api/v1/billing/calculate/${encounterId}`),
    staleTime: 30_000,
  });

  if (isError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-medium text-rose-700"><T k="진료 기반 자동 계산을 불러오지 못했습니다." /></p>
        {/* 🔴 조회 실패를 '0원'이나 '항목 없음'으로 접지 않는다 — 실패는 실패라고 말한다 */}
        <p className="mt-1 text-xs text-rose-600">{error instanceof Error ? error.message : <T k="알 수 없는 오류" />}</p>
        <button onClick={() => refetch()} className="mt-2 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-medium"><T k="다시 시도" /></button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
      </div>
    );
  }

  const calc = data?.data;
  if (!calc) return null;

  const s = calc.summary;
  const rateKnown = calc.copayRate != null;
  const confirmed = calc.copayRateConfirmed === true;
  // 저장된 청구와의 차액 — 둘 다 아는 경우에만 비교한다(모르는 값과는 비교하지 않는다)
  const diff = s?.patientCopay != null && storedCopay != null ? s.patientCopay - storedCopay : null;

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800"><T k="진료 기반 자동 계산" /></p>
        <span className="text-[10px] text-gray-400">/billing/calculate</span>
      </div>

      <div className="p-4 space-y-3">
        {/* 본인부담률 — 근거와 확정 여부를 함께 말한다 */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600"><T k="본인부담률" /></span>
          <span className="text-right">
            {/* 🔴 요율을 모르면 0% 가 아니라 '산출 불가' */}
            <b className={rateKnown ? 'text-gray-900' : 'text-gray-400'}>
              {rateKnown ? `${Math.round((calc.copayRate as number) * 100)}%` : <T k="산출 불가" />}
            </b>
            <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${confirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {COPAY_BASIS_LABEL[calc.copayBasis ?? 'UNKNOWN'] ?? calc.copayBasis}
            </span>
          </span>
        </div>

        {/* 항목 — priceKnown:false 는 0원이 아니라 '미등재' */}
        {calc.items && calc.items.length > 0 && (
          <div className="rounded-lg bg-gray-50 overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                {calc.items.map((it, i) => (
                  <tr key={`${it.code}-${i}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5">
                      <span className="text-gray-400 mr-1.5">{CALC_CATEGORY_LABEL[it.category] ?? it.category}</span>
                      {it.name}
                      {it.insuranceType === 'NON_COVERED' && <span className="ml-1.5 text-[10px] text-amber-700"><T k="비급여@청구" /></span>}
                      {it.insuranceType === 'UNKNOWN' && <span className="ml-1.5 text-[10px] text-gray-500"><T k="급여여부 미상" /></span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500 w-10">×{it.quantity}</td>
                    <td className="px-3 py-1.5 text-right w-28">
                      {it.priceKnown
                        ? <span className="font-medium text-gray-900">{formatCurrency(it.totalPrice ?? 0)}</span>
                        /* 🔴 약가·수가 미등재는 0원이 아니다 — 모르는 값이라고 적는다 */
                        : <span className="text-gray-400" title={it.note}><T k="미등재" /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 합계 — 불완전하면 불완전하다고 말한다 */}
        {s && (
          <div className="space-y-1.5 border-t border-gray-100 pt-3 text-sm">
            <div className="flex justify-between text-gray-600"><span><T k="급여 합계" /></span><span>{formatCurrency(s.coveredTotal)}</span></div>
            <div className="flex justify-between text-gray-600"><span><T k="비급여 합계" /></span><span>{formatCurrency(s.nonCoveredTotal)}</span></div>
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-100 pt-1.5">
              <span><T k="계산 본인부담금" /></span>
              {/* 🔴 산출 불가는 0원이 아니다 */}
              <span className={s.patientCopay == null ? 'text-gray-400' : ''}>
                {s.patientCopay == null ? <T k="산출 불가" /> : formatCurrency(s.patientCopay)}
              </span>
            </div>
            {!s.complete && (
              <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                이 합계는 <b>불완전</b>합니다{s.unpricedItemCount > 0 ? ` — 약가·수가 미등재 ${s.unpricedItemCount}건이 합계에서 빠졌습니다(0원 아님)` : ''}
                {!rateKnown ? ' — 본인부담률 미확정' : ''}
              </p>
            )}
            {diff != null && (
              <p className={`text-[11px] rounded-lg px-2.5 py-1.5 ${diff === 0 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>
                {diff === 0
                  ? <T k="저장된 청구 금액과 일치합니다." />
                  : `저장된 청구와 ${formatCurrency(Math.abs(diff))} 차이 (계산 ${formatCurrency(s.patientCopay ?? 0)} · 청구 ${formatCurrency(storedCopay ?? 0)})`}
              </p>
            )}
            {diff == null && s.patientCopay != null && storedCopay == null && (
              <p className="text-[11px] text-gray-500"><T k="저장된 청구에 본인부담금이 없어 대조하지 않았습니다." /></p>
            )}
          </div>
        )}

        {calc.warnings && calc.warnings.length > 0 && (
          <ul className="space-y-1 border-t border-gray-100 pt-2">
            {calc.warnings.map((w, i) => (
              <li key={i} className="text-[11px] text-amber-800 flex gap-1.5"><span aria-hidden>⚠</span><span>{w}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─── Payment Slide-over Panel ─── */
function PaymentPanel({
  billingId,
  onClose,
}: {
  billingId: string;
  onClose: () => void;
}) {
  const tAttr = useTAttr();
  const { data, isLoading } = useBilling(billingId);
  const payBilling = usePayBilling();
  const cancelBilling = useCancelBilling();
  const deferBilling = useDeferBilling();

  const [paymentMethod, setPaymentMethod] = useState('CARD');
  const [cardApprovalNo, setCardApprovalNo] = useState('');
  const [cashReceiptType, setCashReceiptType] = useState('NONE');
  const [payAmount, setPayAmount] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [deferReason, setDeferReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showDefer, setShowDefer] = useState(false);

  // WeRU.B 청구 검증
  const [aiResult, setAiResult] = useState<Record<string, unknown> | string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // WeRU.B 진료비 자동 계산
  const [aiCalcResult, setAiCalcResult] = useState<Record<string, unknown> | string | null>(null);
  const [aiCalcLoading, setAiCalcLoading] = useState(false);

  const runAiClaimCheck = async () => {
    if (!billing) return;
    setAiLoading(true);
    try {
      const items = billing.items?.map((it) => it.codeName ?? it.name ?? '').join(', ') ?? '';
      const encounter = billing.encounter as Record<string, unknown> | undefined;
      const diagnoses = encounter?.diagnoses as Array<Record<string, unknown>> | undefined;
      const diagnosis = diagnoses?.map((d) => {
        const dc = d.diagnosisCode as Record<string, unknown> | undefined;
        return dc?.name ?? dc?.code ?? '';
      }).join(', ') ?? '';
      const r = await callWerub<Record<string, unknown>>('cli/execute', {
        role: 'claims',
        command: `${diagnosis} 진료항목: ${items} 청구 검증`,
      }, { silent: true });
      setAiResult(r ?? { error: `${AI_ORIGIN_TEXT} 검증 실패` });
    } catch { setAiResult({ error: `${AI_ORIGIN_TEXT} 검증 실패` }); }
    setAiLoading(false);
  };

  const runAiBillingCalc = async () => {
    if (!billing) return;
    setAiCalcLoading(true);
    try {
      const encounter = billing.encounter as Record<string, unknown> | undefined;
      const diagnoses = encounter?.diagnoses as Array<Record<string, unknown>> | undefined;
      const diagnosis = diagnoses?.map((d) => {
        const dc = d.diagnosisCode as Record<string, unknown> | undefined;
        return `${dc?.name ?? ''}(${dc?.code ?? ''})`;
      }).join(', ') ?? '';
      const dept = encounter?.department ?? '';
      const r = await callWerub<Record<string, unknown>>('cli/execute', {
        role: 'billing',
        command: `진단: ${diagnosis}, 진료과: ${dept} — 진료비 자동 계산 (KCD→EDI 매핑, 수가 산출, 본인부담금 계산)`,
      }, { silent: true });
      setAiCalcResult(r ?? { error: `${AI_ORIGIN_TEXT} 진료비 계산 실패` });
    } catch { setAiCalcResult({ error: `${AI_ORIGIN_TEXT} 진료비 계산 실패` }); }
    setAiCalcLoading(false);
  };

  const billing = data?.data;

  const handlePay = async () => {
    if (!billing) return;
    // 🔴 (2026-10-14 결함 발굴 수납 P1-1) 빈 칸 기본값은 **남은 납부 금액**(본인부담 − 감면 − 이미 낸 돈) — 종전엔 본인부담 전액이라
    //    부분 납부·감면 뒤 빈 칸 수납이 전액을 또 받았다. 남은 금액을 모르면 직접 입력하게 한다(지어 채우지 않는다).
    const remaining = billingRemaining(billing);
    const amount = Number(payAmount) || (remaining != null && remaining > 0 ? remaining : 0);
    if (amount <= 0) { toast.error(tAttr('결제 금액을 입력하세요 — 남은 납부 금액을 확인할 수 없거나 남은 금액이 없습니다.')); return; }
    try {
      await payBilling.mutateAsync({
        id: billingId,
        amount,
        paymentMethod,
        cardApprovalNo: paymentMethod === 'CARD' ? cardApprovalNo : undefined,
        cashReceiptType: paymentMethod === 'CASH' ? cashReceiptType : undefined,
      });
      toast.success('수납이 완료되었습니다.');
      onClose();
    } catch {
      toast.error('수납 처리에 실패했습니다.');
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) { toast.error('취소 사유를 입력해주세요.'); return; }
    try {
      await cancelBilling.mutateAsync({ id: billingId, reason: cancelReason });
      toast.success('수납이 취소되었습니다.');
      onClose();
    } catch {
      toast.error('취소 처리에 실패했습니다.');
    }
  };

  const handleDefer = async () => {
    if (!deferReason.trim()) { toast.error('보류 사유를 입력해주세요.'); return; }
    try {
      await deferBilling.mutateAsync({ id: billingId, reason: deferReason });
      toast.success('수납이 보류되었습니다.');
      onClose();
    } catch {
      toast.error('보류 처리에 실패했습니다.');
    }
  };

  // 수납 모달 핫키 (모달 마운트 중에만 등록). 하위 모달(취소/보류) 중엔 비활성.
  useHotkeys([
    { combo: 'mod+Enter', label: '수납 완료', group: '수납 처리', allowInInput: true, when: () => !!billing && !payBilling.isPending && !showCancel && !showDefer && billing.status !== 'PAID', onTrigger: () => handlePay() },
    { combo: 'esc', label: '닫기', group: '수납 처리', when: () => !showCancel && !showDefer, onTrigger: onClose },
  ]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-gray-900"><T k="수납 처리" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {isLoading || !billing ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-5 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Patient info */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900 text-lg">
                  {billing.patient?.familyName}{billing.patient?.givenName}
                </p>
                <p className="text-sm text-gray-500">{billing.patient?.mrn}</p>
              </div>
              <InsuranceBadge type={billing.patient?.insuranceType ?? ''}
                label={INSURANCE_LABEL[billing.patient?.insuranceType ?? ''] ?? billing.patient?.insuranceType ?? '-'}
                tone="bg-blue-50 text-blue-700" />
            </div>

            {/* Billing items */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2"><T k="진료 내역" /></p>
              <div className="bg-gray-50 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500"><T k="항목" /></th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500"><T k="단가" /></th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500"><T k="수량" /></th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500"><T k="금액" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.items?.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100">
                        <td className="px-3 py-2">{item.codeName}</td>
                        <td className="px-3 py-2 text-right">{item.unitPrice?.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{item.quantity}</td>
                        <td className="px-3 py-2 text-right">{item.amount?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 진료 기반 자동 계산(서버 정본) — 진료가 연결된 청구에만 */}
            {billing.encounterId
              ? <CalculatorPanel encounterId={billing.encounterId} storedCopay={billing.patientCopay} />
              : (
                /* 🔴 계산 불가를 '0원'으로 그리지 않는다 — 왜 못 하는지 적는다 */
                <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
                  <T k="이 청구에는 진료(encounter)가 연결돼 있지 않아 진료 기반 자동 계산을 할 수 없습니다." />
                </p>
              )}

            {/* WeRU.B 진료비 자동 계산 */}
            <div>
              <button onClick={runAiBillingCalc} disabled={aiCalcLoading}
                className="w-full px-4 py-2.5 bg-violet-50 text-violet-700 rounded-xl text-sm font-medium hover:bg-violet-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {aiCalcLoading ? (
                  <><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> {AI_ORIGIN_TEXT} <T k="계산 중..." /></>
                ) : (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg> {AI_ORIGIN_TEXT} <T k="진료비 자동 계산" /></>
                )}
              </button>
              {aiCalcResult && !(aiCalcResult as Record<string, unknown>).error && (
                <div className="mt-2 bg-violet-50 rounded-xl p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-violet-700">{AI_ORIGIN_TEXT} <T k="진료비 산출 결과" /></p>
                  <div className="text-xs text-violet-900 whitespace-pre-wrap">
                    {typeof aiCalcResult === 'string' ? aiCalcResult : (aiCalcResult as Record<string, unknown>).result as string ?? (aiCalcResult as Record<string, unknown>).response as string ?? JSON.stringify(aiCalcResult, null, 2)}
                  </div>
                </div>
              )}
              {typeof aiCalcResult === 'object' && aiCalcResult !== null && 'error' in aiCalcResult && (
                <p className="mt-2 text-xs text-rose-600">{String(aiCalcResult.error)}</p>
              )}
            </div>

            {/* Amount summary */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600"><T k="총 진료비" /></span>
                <span>{formatCurrency(billing.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm text-blue-600">
                <span><T k="보험 부담" /></span>
                <span>-{formatCurrency(billing.insuranceCovered)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t border-gray-200 pt-2">
                <span><T k="본인부담금" /></span>
                <span>{formatCurrency(billing.patientCopay)}</span>
              </div>
            </div>

            {/* WeRU.B 청구 검증 */}
            <div>
              <button onClick={runAiClaimCheck} disabled={aiLoading}
                className="w-full px-4 py-2.5 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-medium hover:bg-indigo-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {aiLoading ? (
                  <><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> {AI_ORIGIN_TEXT} <T k="검증 중..." /></>
                ) : <>{AI_ORIGIN_TEXT} <T k="청구 검증" /></>}
              </button>
              {aiResult && !(aiResult as Record<string, unknown>).error && (
                <div className="mt-2 bg-indigo-50 rounded-xl p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-indigo-700">{AI_ORIGIN_TEXT} <T k="검증 결과" /></p>
                  <div className="text-xs text-indigo-900 whitespace-pre-wrap">
                    {typeof aiResult === 'string' ? aiResult : (aiResult as Record<string, unknown>).result as string ?? (aiResult as Record<string, unknown>).response as string ?? JSON.stringify(aiResult, null, 2)}
                  </div>
                </div>
              )}
              {typeof aiResult === 'object' && aiResult !== null && 'error' in aiResult && (
                <p className="mt-2 text-xs text-rose-600">{String(aiResult.error)}</p>
              )}
            </div>

            {/* Payment form */}
            {(billing.status === 'PENDING' || billing.status === 'DEFERRED') && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2"><T k="결제수단" /></label>
                  <div className="flex gap-2 flex-wrap">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setPaymentMethod(m.value)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                          paymentMethod === m.value
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {paymentMethod === 'CARD' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1"><T k="카드 승인번호" /></label>
                    <input
                      type="text"
                      value={cardApprovalNo}
                      onChange={(e) => setCardApprovalNo(e.target.value)}
                      placeholder={tAttr('승인번호 입력')}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                {paymentMethod === 'CASH' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2"><T k="현금영수증" /></label>
                    <div className="flex gap-2 flex-wrap">
                      {CASH_RECEIPT_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => setCashReceiptType(o.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            cashReceiptType === o.value
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <T k={o.label} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"><T k="결제금액" /></label>
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder={(() => { const r = billingRemaining(billing); return r != null && r > 0 ? String(r) : ''; })()}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={handlePay}
                    disabled={payBilling.isPending}
                    aria-keyshortcuts={ariaKeyshortcuts('mod+Enter')}
                    className="flex-1 min-w-[120px] px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {payBilling.isPending ? <T k="처리 중..." /> : <T k="수납 완료" />}
                    {!payBilling.isPending && <kbd className="ml-2 text-[10px] font-semibold bg-white/20 rounded px-1.5 py-0.5">{comboLabel('mod+Enter')}</kbd>}
                  </button>
                  <button
                    onClick={() => setShowDefer(true)}
                    className="px-4 py-2.5 bg-amber-50 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 transition-colors"
                  >
                    <T k="수납 보류" />
                  </button>
                  <button
                    onClick={() => setShowCancel(true)}
                    className="px-4 py-2.5 bg-rose-50 text-rose-700 rounded-xl text-sm font-medium hover:bg-rose-100 transition-colors"
                  >
                    <T k="수납 취소" />
                  </button>
                  <Link
                    href={`/print/receipt/${billingId}`}
                    className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors text-center"
                  >
                    <T k="영수증 출력" />
                  </Link>
                </div>

                {/* Cancel reason */}
                {showCancel && (
                  <div className="bg-rose-50 rounded-xl p-4 space-y-2">
                    <label className="block text-sm font-medium text-rose-700"><T k="취소 사유" /></label>
                    <ReasonInput domain="billingCancel" required
                      value={cancelReason}
                      onChange={setCancelReason}
                      placeholder={tAttr('취소 사유를 입력하세요')}
                      className="w-full px-3 py-2 border border-rose-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleCancel} disabled={cancelBilling.isPending}
                        className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-50">
                        {cancelBilling.isPending ? <T k="처리 중..." /> : <T k="취소 확인" />}
                      </button>
                      <button onClick={() => { setShowCancel(false); setCancelReason(''); }}
                        className="px-4 py-2 text-gray-600 text-sm"><T k="닫기" /></button>
                    </div>
                  </div>
                )}

                {/* Defer reason */}
                {showDefer && (
                  <div className="bg-amber-50 rounded-xl p-4 space-y-2">
                    <label className="block text-sm font-medium text-amber-700"><T k="보류 사유" /></label>
                    <ReasonInput domain="billingHold" required
                      value={deferReason}
                      onChange={setDeferReason}
                      placeholder={tAttr('보류 사유를 입력하세요')}
                      className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleDefer} disabled={deferBilling.isPending}
                        className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                        {deferBilling.isPending ? <T k="처리 중..." /> : <T k="보류 확인" />}
                      </button>
                      <button onClick={() => { setShowDefer(false); setDeferReason(''); }}
                        className="px-4 py-2 text-gray-600 text-sm"><T k="닫기" /></button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {billing.status === 'PAID' && (
              <div className="bg-emerald-50 rounded-xl p-4 text-center">
                <p className="text-emerald-700 font-medium"><T k="수납 완료" /></p>
                <p className="text-sm text-emerald-600 mt-1">
                  {billing.paidAt ? kdate(billing.paidAt, 'datetimeSec') : ''}
                </p>
                <Link
                  href={`/print/receipt/${billingId}`}
                  className="inline-block mt-3 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
                >
                  <T k="영수증 출력" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Tab 1: 수납 대기열 ─── */
function QueueTab() {
  const { data: queueData, isLoading: queueLoading, isError: queueError, error: queueErrorData, refetch: refetchQueue } = useCashierQueue();
  const { data: statsData, isLoading: statsLoading } = useCashierStats();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 대시보드 '수납 대기열'에서 고른 건을 바로 연다(`/billing?billingId=` · 2026-10-02) — 목록에 없어도 수납 창이 서버에서 다시 읽는다
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('billingId');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setSelectedId(id);
  }, []);

  const queue: BillingQueueItem[] = Array.isArray(queueData?.data) ? queueData.data as unknown as BillingQueueItem[] : (queueData?.data as Record<string, unknown> | undefined)?.data as BillingQueueItem[] ?? [];
  const stats: CashierStatsData = (statsData?.data ?? {}) as CashierStatsData;

  if (queueError) return <QueryErrorFallback error={queueErrorData} onRetry={refetchQueue} />;

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="h-3 w-16 bg-gray-100 rounded animate-pulse mb-2" />
              <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
            </div>
          ))
        ) : (
          <>
            {/* 🔴 종전 "미수납" 칸이 `deferredCount`(DEFERRED 만)였다 — 경영 정본
                (/executive overview.unpaid = PENDING+PARTIAL+DEFERRED)와 다른 수를 같은 라벨로
                말했다(P12). 이제 서버 정본 `unpaidCount` 를 쓰고, 라벨에 집합을 적는다.
                서버가 아직 이 키를 주지 않으면 0 이 아니라 '-'(산출 불가) 다. */}
            <StatCard label="수납 대기" value={stats.pendingCount ?? '-'} sub="PENDING" color="amber" />
            <StatCard label="오늘 완료" value={stats.completedCount ?? '-'} color="green" />
            <StatCard
              label="미수납"
              value={stats.unpaidCount ?? '-'}
              sub={`전 기간 PENDING·PARTIAL·DEFERRED${stats.deferredCount != null ? ` (후불 ${stats.deferredCount}건)` : ''}`}
              color="rose"
            />
            <StatCard label="오늘 매출" value={formatCurrency(stats.totalRevenue ?? stats.todayRevenue)} color="blue" />
          </>
        )}
      </div>

      {/* Queue table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700"><T k="수납 대기 목록" /></p>
          <span className="text-xs text-gray-400"><T k="10초마다 자동 새로고침" /></span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="대기번호" /></th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="환자명(MRN)" /></th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="진료과" /></th>
                <th className="px-5 py-3.5 text-right text-xs font-medium text-gray-500"><T k="본인부담금" /></th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="대기시간" /></th>
                <th className="px-5 py-3.5"></th>
              </tr>
            </thead>
            <tbody>
              {queueLoading ? (
                <SkeletonRows cols={6} />
              ) : !queue.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-gray-400"><T k="대기 중인 수납이 없습니다." /></p>
                  </td>
                </tr>
              ) : (
                queue.map((item: BillingQueueItem, idx: number) => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="whitespace-nowrap inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-700 text-sm font-bold">
                        {item.queueNumber ?? idx + 1}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-gray-900">{item.patient?.familyName}{item.patient?.givenName}</span>
                      <span className="text-gray-400 ml-1.5 text-xs">({item.patient?.mrn})</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="whitespace-nowrap text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{item.departmentName ?? item.encounter?.department ?? '-'}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900">{formatCurrency(item.patientCopay)}</td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{formatRelativeTime(item.createdAt)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setSelectedId(item.id)}
                          className="px-3.5 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors"
                        >
                          <T k="수납" />
                        </button>
                        <Link
                          href={`/billing/${item.id}`}
                          className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-xl text-xs font-medium hover:bg-gray-200 transition-colors"
                        >
                          <T k="상세" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment panel slide-over */}
      {selectedId && (
        <PaymentPanel billingId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

/* ─── Tab 2: 미수납 관리 ─── */
function DeferredTab() {
  const { data, isLoading } = useDeferredBillings();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list: BillingListItem[] = Array.isArray(data?.data) ? data.data as unknown as BillingListItem[] : (data?.data as Record<string, unknown> | undefined)?.data as BillingListItem[] ?? [];
  const totalDeferred = list.reduce((acc: number, b: BillingListItem) => acc + (b.patientCopay ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700"><T k="미수납 목록" /></p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="환자명(MRN)" /></th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="진료일" /></th>
                <th className="px-5 py-3.5 text-right text-xs font-medium text-gray-500"><T k="본인부담금" /></th>
                <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="보류 사유" /></th>
                <th className="px-5 py-3.5"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows cols={5} />
              ) : !list.length ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center">
                    <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-gray-400"><T k="미수납 내역이 없습니다." /></p>
                  </td>
                </tr>
              ) : (
                list.map((b: BillingListItem) => (
                  <tr key={b.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-gray-900">{b.patient?.familyName}{b.patient?.givenName}</span>
                      <span className="text-gray-400 ml-1.5 text-xs">({b.patient?.mrn})</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{kdate(new Date(b.createdAt))}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900">{formatCurrency(b.patientCopay)}</td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{b.deferReason ?? b.note ?? '-'}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setSelectedId(b.id)}
                        className="px-3.5 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors"
                      >
                        <T k="수납" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {list.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
            <div className="text-sm">
              <span className="text-gray-500 mr-2"><T k="미수금 합계" /></span>
              <span className="font-bold text-rose-700 text-lg">{formatCurrency(totalDeferred)}</span>
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <PaymentPanel billingId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

/* ─── Tab 3: 일일 정산 ─── */
function DailyTab() {
  // 🔴 toISOString 은 UTC — KST 00:00~09:00 에 '오늘'이 어제가 된다(서버 집계도 KST 자정 기준으로 정정)
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const { data, isLoading } = useDailySummary(date);

  const summary: DailySummaryData = (data?.data ?? {}) as DailySummaryData;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700"><T k="정산일" /></label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="h-3 w-20 bg-gray-100 rounded animate-pulse mb-2" />
              <div className="h-7 w-28 bg-gray-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="총 건수" value={summary.totalCount ?? 0} color="blue" />
            <StatCard label="총 매출" value={formatCurrency(summary.totalRevenue)} color="green" />
          </div>

          {/* By payment method */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-medium text-gray-700 mb-3"><T k="결제수단별" /></p>
            <div className="space-y-2">
              {/* 🔴 고정 4키만 조회해 서버가 준 다른 값(unknown·MIXED 등)이 통째로 사라졌다 —
                  실측 6/09 은 `{"unknown": 366,441}` 이라 4개 바가 전부 0원인데 총 매출은 366,441원이었다.
                  서버가 준 키를 그대로 순회하고, 아는 것만 한글 라벨을 붙인다. */}
              {(() => {
                // 🔴 라벨·색은 shared 정본(`PAYMENT_METHOD_LABEL`) — 로컬 Record 재정의 금지.
                //    서버가 준 키를 그대로 순회하고, 아는 것만 한글 라벨을 붙인다.
                const ORDER = ['card', 'cash', 'transfer', 'deposit', 'voucher', 'mixed', 'unknown'];
                const present = Object.keys(summary.byPaymentMethod ?? {});
                const keys = [...ORDER.filter((k) => present.includes(k)), ...present.filter((k) => !ORDER.includes(k))];
                return keys.map((k) => ({ key: k, label: paymentMethodLabel(k), color: paymentMethodColor(k) }));
              })().map((m) => {
                const amount = summary.byPaymentMethod?.[m.key] ?? 0;
                const total = summary.totalRevenue || 1;
                const pct = Math.round((amount / total) * 100) || 0;
                return (
                  <div key={m.key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-16">{m.label}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${m.color} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-medium text-gray-700 w-28 text-right">{formatCurrency(amount)}</span>
                  </div>
                );
              })}
            </div>
            {/* 🔴 수단별 막대는 수납 원장(billing_payments) 기준이다. 원장에 라인이 없는 수납은
                수단을 모르는 것이라 '수단 미기록'으로 들어간다 — 그 사실을 건수와 함께 밝힌다.
                숨기면 "카드/현금이 이만큼"으로만 읽혀 대사에서 어긋난 이유를 알 수 없다. */}
            {summary.ledger && (summary.ledger.unledgeredCount > 0 || summary.ledger.difference !== 0) && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1 text-[11px] text-gray-500">
                {summary.ledger.unledgeredCount > 0 && (
                  <p>
                    수단 미기록 {summary.ledger.unledgeredCount}건 · {money(summary.ledger.unledgeredAmount)} —
                    수납 원장에 결제수단 라인이 없어 <strong>카드사 대사·현금 시재로 나눌 수 없다</strong>
                  </p>
                )}
                {summary.ledger.difference !== 0 && (
                  <p>
                    {/* 🔴 원인을 단정하지 않는다 — 분할수납일 수도, 원장 라인이 없는 과거 수납일 수도 있다 */}
                    수납 기준 합계와 {money(Math.abs(summary.ledger.difference))} 차이가 있다 —
                    원장은 <strong>돈이 들어온 날</strong>로, 수납 합계는 <strong>마지막 결제일</strong>로 세기 때문이다
                    (분할수납이 날짜를 걸치면 생긴다). 어느 쪽도 틀린 값은 아니다
                  </p>
                )}
              </div>
            )}
            {/* 🔴 (2026-10-22) 입원 중간정산 수납 — 별도 원장이라 종전엔 이 화면 어디에도 없었다(창구에 들어온 돈인데 시재가 안 맞았다).
                위 총계에 더하지 않는다 — ERP 전표는 중간정산 수납 이벤트로 따로 나간다(더하면 두 번 잡힌다). */}
            {summary.interimPayments && (summary.interimPayments.count > 0 || (summary.interimPayments.refundCount != null && summary.interimPayments.refundCount > 0)) && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-600 space-y-1" data-daily-interim={summary.interimPayments.count}>
                <p className="font-medium text-gray-700"><T k="입원 중간정산 수납(위 합계와 별도)" /> · {summary.interimPayments.count}<T k="건" /> · <Money value={summary.interimPayments.amount} /></p>
                <p className="flex flex-wrap gap-x-3">
                  {Object.entries(summary.interimPayments.byMethod).map(([m, amt]) => (
                    <span key={m} data-daily-interim-method={m}><T k={paymentMethodLabel(m)} /> <Money value={amt} /></span>
                  ))}
                  {summary.interimPayments.unledgeredCount > 0 && (
                    <span data-daily-interim-method="unknown"><T k="수단 미기록" /> {summary.interimPayments.unledgeredCount}<T k="건" /> <Money value={summary.interimPayments.unledgeredAmount} /></span>
                  )}
                </p>
                {(summary.interimPayments.refundCount != null && summary.interimPayments.refundCount > 0) && (
                  // 2026-10-22 중간정산 환불(ERP R5) — 수납 합에서 빼지 않고 따로(전표도 따로 — 중간정산 환불 이벤트)
                  <p className="flex flex-wrap gap-x-3" data-daily-interim-refund={summary.interimPayments.refundCount}>
                    <span className="font-medium text-gray-700"><T k="중간정산 환불" /> · {summary.interimPayments.refundCount}<T k="건" /> · <Money value={summary.interimPayments.refundAmount ?? 0} /></span>
                    {Object.entries(summary.interimPayments.refundByMethod ?? {}).map(([m, amt]) => (
                      <span key={m} data-daily-interim-refund-method={m}><T k={paymentMethodLabel(m)} /> <Money value={amt} /></span>
                    ))}
                  </p>
                )}
                <p className="text-gray-400"><T k="시재·카드 대사에는 이 금액을 함께 맞춥니다 — 일마감 전표에는 들어가지 않고 중간정산 수납 이벤트로 ERP 에 따로 갑니다." /></p>
              </div>
            )}
          </div>

          {/* By insurance type */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-medium text-gray-700 mb-3"><T k="보험유형별" /></p>
            {/* 🔴 3칸만 있어 산재·자동차보험 수납이 화면에서 사라졌다 — 실측 6/09 총 366,441원 중
                197,844원(54%·3건)이 어디에도 안 뜸. InsuranceType enum 5종 전량 + 미등록 키도 보인다. */}
            <div className="grid grid-cols-3 gap-4">
              {(() => {
                const KNOWN: Record<string, string> = { NHI: '건강보험', MEDICAID: '의료급여', INDUSTRIAL: '산재보험', AUTO: '자동차보험', SELF_PAY: '자비' };
                const present = Object.keys(summary.byInsurance ?? {});
                const keys = [...Object.keys(KNOWN), ...present.filter((k) => !(k in KNOWN))];
                return keys.map((k) => ({ key: k, label: KNOWN[k] ?? k }));
              })().map((ins) => (
                <div key={ins.key} className="text-center">
                  <p className="text-xs text-gray-500 mb-1">{ins.label}</p>
                  <p className="text-lg font-bold text-gray-900">{summary.byInsurance?.[ins.key]?.count ?? 0}<Unit>건</Unit></p>
                  <p className="text-xs text-gray-500">{formatCurrency(summary.byInsurance?.[ins.key]?.amount)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Refund / Cancel / Deferred */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
              <p className="text-xs text-gray-500 mb-1"><T k="환불" /></p>
              <p className="text-xl font-bold text-rose-600">{summary.refundCount ?? 0}<Unit>건</Unit></p>
              <p className="text-xs text-gray-400 mt-0.5">{formatCurrency(summary.refundAmount)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
              <p className="text-xs text-gray-500 mb-1"><T k="취소@상태" /></p>
              <p className="text-xl font-bold text-gray-600">{summary.cancelCount ?? 0}<Unit>건</Unit></p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
              <p className="text-xs text-gray-500 mb-1"><T k="미수 발생" /></p>
              <p className="text-xl font-bold text-amber-600">{summary.deferredCount ?? 0}<Unit>건</Unit></p>
              <p className="text-xs text-gray-400 mt-0.5">{formatCurrency(summary.deferredAmount)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Tab 4: 예치금 ─── */
function DepositTab() {
  /**
   * 🔴 예치금 등록은 원무 수납 업무다(서버 `@Roles(ADMIN, RECEPTIONIST, CHECKUP)`).
   *    간호사에게는 조회 화면이라 등록 버튼을 띄우면 누를 때마다 403 이었다.
   */
  const canDeposit = useHasRole('RECEPTIONIST', 'CHECKUP');
  const tAttr = useTAttr();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Deposit form (RHF+Zod)
  const { register: regDeposit, handleSubmit: handleDeposit, formState: { errors: depositErrors }, reset: resetDeposit } = useForm<DepositForm>({
    resolver: zodResolver(depositSchema),
    defaultValues: { patientId: '', amount: '', depositType: 'ADMISSION_DEPOSIT', paymentMethod: 'CARD', note: '' },
  });
  const [submitting, setSubmitting] = useState(false);

  // Patient search
  const { data: patientsData, isLoading: patientsLoading } = useBillings({ status: undefined, page: 1 });

  const searchPatient = useCallback(async (patientId: string) => {
    setSelectedPatientId(patientId);
    setDepositsLoading(true);
    try {
      const res = await apiClient.get<{ data: DepositRecord[] }>(`/api/v1/deposits/patient/${patientId}`);
      setDeposits(Array.isArray(res?.data) ? res.data : (res?.data as Record<string, unknown> | undefined)?.data as DepositRecord[] ?? []);
    } catch {
      setDeposits([]);
    } finally {
      setDepositsLoading(false);
    }
  }, []);

  const handleDepositSubmit = async (data: DepositForm) => {
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/deposits', {
        patientId: data.patientId,
        amount: Number(data.amount),
        depositType: data.depositType,
        paymentMethod: data.paymentMethod,
        note: data.note,
      });
      toast.success('예치금이 등록되었습니다.');
      setShowModal(false);
      resetDeposit();
      if (selectedPatientId) searchPatient(selectedPatientId);
    } catch {
      toast.error('예치금 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search + register */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex-1 w-full">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={tAttr('환자 ID 또는 MRN으로 검색...')}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchTerm.trim()) {
                searchPatient(searchTerm.trim());
              }
            }}
          />
        </div>
        <button
          onClick={() => { if (searchTerm.trim()) searchPatient(searchTerm.trim()); }}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <T k="조회" />
        </button>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <T k="예치금 등록" />
        </button>
      </div>

      {/* Deposit list */}
      {selectedPatientId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-700"><T k="환자 예치금 내역" /> — <span className="text-blue-600">{selectedPatientId}</span></p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="일시" /></th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                  <th className="px-5 py-3.5 text-right text-xs font-medium text-gray-500"><T k="금액" /></th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="결제수단" /></th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
                </tr>
              </thead>
              <tbody>
                {depositsLoading ? (
                  <SkeletonRows cols={5} rows={3} />
                ) : !deposits.length ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center">
                      <p className="text-sm text-gray-400"><T k="예치금 내역이 없습니다." /></p>
                    </td>
                  </tr>
                ) : (
                  deposits.map((d: DepositRecord) => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                      <td className="px-5 py-3.5 text-gray-500">{kdate(d.createdAt, 'datetimeSec')}</td>
                      <td className="px-5 py-3.5">
                        <span className="whitespace-nowrap text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">
                          {d.depositType === 'ADMISSION_DEPOSIT' ? <T k="입원예치금" /> : d.depositType === 'PREPAY' ? <T k="선납" /> : d.depositType}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-gray-900">{formatCurrency(d.amount)}</td>
                      <td className="px-5 py-3.5 text-gray-500">
                        {PAYMENT_METHODS.find((m) => m.value === d.paymentMethod)?.label ?? d.paymentMethod ?? '-'}
                      </td>
                      <td className="px-5 py-3.5 text-gray-400 text-xs">{d.note ?? '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {deposits.length > 0 && (
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
              <div className="text-sm">
                <span className="text-gray-500 mr-2"><T k="예치금 잔액" /></span>
                <span className="font-bold text-blue-700 text-lg">
                  {formatCurrency(deposits.reduce((acc: number, d: DepositRecord) => acc + (d.balance ?? d.amount ?? 0), 0))}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedPatientId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <p className="text-sm text-gray-400"><T k="환자 ID 또는 MRN을 입력하여 예치금을 조회하세요." /></p>
        </div>
      )}

      {/* Register modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-gray-900"><T k="예치금 등록" /></h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><T k="환자 ID" /></label>
              <input
                type="text" {...regDeposit('patientId')}
                placeholder={tAttr('환자 ID 입력')}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {depositErrors.patientId && <p className="text-xs text-red-500 mt-0.5">{depositErrors.patientId.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><T k="금액" /></label>
              <input
                type="number" {...regDeposit('amount')}
                placeholder={tAttr('금액 입력')}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {depositErrors.amount && <p className="text-xs text-red-500 mt-0.5">{depositErrors.amount.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2"><T k="유형" /></label>
              <select {...regDeposit('depositType')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
                <option value="ADMISSION_DEPOSIT">{tAttr('입원예치금')}</option>
                <option value="PREPAY">{tAttr('선납')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2"><T k="결제수단" /></label>
              <select {...regDeposit('paymentMethod')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><T k="비고" /></label>
              <input
                type="text" {...regDeposit('note')}
                placeholder={tAttr('비고 (선택사항)')}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleDeposit(handleDepositSubmit)}
              disabled={submitting || !canDeposit}
              title={canDeposit ? undefined : tAttr('예치금 등록은 원무·검진 데스크 권한입니다')}
              className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? <T k="등록 중..." /> : canDeposit ? <T k="예치금 등록" /> : <T k="예치금 등록 (원무 권한 필요)" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function BillingDashboardPage() {
  useUiSettings(); // ui.* 설정 하이드레이션 — money() 스냅샷 갱신
  const [activeTab, setActiveTab] = useState<TabKey>('queue');

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="수납 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="진료비 수납 및 정산 관리" /></p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <T k={tab.label} />
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'queue' && <QueueTab />}
      {activeTab === 'deferred' && <DeferredTab />}
      {activeTab === 'outstanding' && <OutstandingTab />}
      {activeTab === 'daily' && <DailyTab />}
      {activeTab === 'deposit' && <DepositTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Outstanding (미수금 현황) Tab
   ═══════════════════════════════════════════════════════════════ */

interface OutstandingItem {
  id: string;
  patient?: { id?: string; mrn?: string; familyName?: string; givenName?: string; phone?: string };
  status: string;
  totalAmount?: number;
  patientCopay?: number;
  discountAmount?: number | null;
  paidAmount?: number | null;
  /** 서버가 정본(shared billingOutstanding)으로 센 남은 본인부담 — P4-1 */
  outstanding?: number | null;
  createdAt: string;
  deferredAt?: string;
  deferReason?: string;
  hasInstallment?: boolean;
}

/**
 * 분할 납부 회차 조회·납부 (§6 이연 회수 · 2026-08-25)
 *
 * 🔴 종전엔 **계획을 세우는 화면만** 있었다 — 세운 뒤 회차를 보거나 납부할 자리가 없어
 *    EP(GET /billings/:id/installments · PATCH /billing/installments/:id/pay)가 고아였다.
 *    회차 납부 정본은 BillingService.payInstallment 하나다(7단계에서 구현 2벌을 통합했고,
 *    수납 원장 라인·결제수단을 그때 남기기 시작했다 — 그래서 여기서 수단을 받는다).
 */
function InstallmentPlanModal({ billingId, onClose, onPaid }: { billingId: string; onClose: () => void; onPaid: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [method, setMethod] = useState<string>('');
  const [payingId, setPayingId] = useState<string | null>(null);

  interface PaymentRow { id: string; seqNo: number; amount: number; dueDate?: string | null; status: string; paidAt?: string | null; dueDatePassed?: boolean }
  // 🔴 (2026-09-14) 잔액·회차 합계·예정일 경과는 서버 summary 를 그대로 쓴다 — 화면이 다시 더하거나 브라우저 시계로 비교하지 않는다
  interface PlanSummary { paidAmount: number; remainingAmount: number; scheduledTotal: number; scheduleMismatch: boolean; dueDatePassedCount: number; asOf: string }
  interface PlanRow { id: string; installments: number; paidCount: number; totalAmount: number; status: string; payments?: PaymentRow[]; summary?: PlanSummary }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['installment-plan', billingId],
    queryFn: () => apiClient.get<{ data: PlanRow | null }>(`/api/v1/billings/${billingId}/installments`),
  });
  const plan = (data as { data?: PlanRow | null } | undefined)?.data ?? null;

  const payMut = useMutation({
    // 🔴 수단은 선택 — 모르면 보내지 않는다(서버가 UNKNOWN 으로 남기고 화면이 '수단 미기록'이라 말한다)
    mutationFn: (paymentId: string) =>
      apiClient.patch(`/api/v1/billing/installments/${paymentId}/pay`, method ? { method } : {}),
    onSuccess: () => {
      toast.success('회차 납부가 기록되었습니다.');
      qc.invalidateQueries({ queryKey: ['installment-plan', billingId] });
      refetch(); onPaid();
    },
    onError: (e: { message?: string }) => toast.error(e?.message || '회차 납부에 실패했습니다.'),
    onSettled: () => setPayingId(null),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-lg mb-1"><T k="분할 납부 회차" /></h3>
        <p className="text-xs text-gray-500 mb-4"><T k="회차를 납부하면 수납 원장에 결제수단과 함께 기록된다." /></p>

        {isError && <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />}
        {isLoading && <p className="text-sm text-gray-400 py-6 text-center"><T k="불러오는 중…" /></p>}
        {!isLoading && !isError && !plan && (
          <p className="text-sm text-gray-500 py-6 text-center"><T k="분할 납부 계획이 없습니다." /></p>
        )}

        {plan && (
          <>
            <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
              <span><Tf k="총 {회차}회 · 납부 {납부}회" params={{ 회차: plan.installments, 납부: plan.paidCount }} /></span>
              <span className="font-semibold">{formatCurrency(plan.totalAmount)}</span>
            </div>
            {plan.summary ? (
              <div className="grid grid-cols-2 gap-2 text-xs mb-3" data-testid="installment-summary">
                <div className="rounded-lg bg-gray-50 px-3 py-2"><p className="text-gray-500"><T k="납부 완료액" /></p><p className="font-semibold text-gray-900">{formatCurrency(plan.summary.paidAmount)}</p></div>
                <div className="rounded-lg bg-gray-50 px-3 py-2"><p className="text-gray-500"><T k="잔액" /></p><p className="font-semibold text-gray-900">{formatCurrency(plan.summary.remainingAmount)}</p></div>
                {plan.summary.scheduleMismatch && (
                  <p className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800" data-testid="installment-mismatch">
                    <Tf k="회차 금액 합({합계})이 계획 총액과 다릅니다 — 금액은 서버 기록 그대로이며 조정은 원무 판단입니다" params={{ 합계: formatCurrency(plan.summary.scheduledTotal) }} />
                  </p>
                )}
                {plan.summary.dueDatePassedCount > 0 && (
                  <p className="col-span-2 text-amber-700"><Tf k="예정일이 지난 미납 회차 {건수}건 ({기준} 기준)" params={{ 건수: plan.summary.dueDatePassedCount, 기준: plan.summary.asOf }} /></p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 mb-3"><T k="잔액 정보를 받지 못했습니다 — 화면에서 계산하지 않습니다." /></p>
            )}
            <div className="mb-3">
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="결제수단(선택 — 모르면 비워 둔다)" /></label>
              <select value={method} onChange={e => setMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="">{tAttr('미지정')}</option>
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {(plan.payments ?? []).map(pmt => (
                <div key={pmt.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm text-gray-900"><Tf k="{회차}회차 · {금액}" params={{ 회차: pmt.seqNo, 금액: formatCurrency(pmt.amount) }} /></p>
                    <p className="text-[11px] text-gray-400">
                      {/* 🔴 paidAt 은 timestamptz — 종전 slice(0,10) 은 UTC 날짜라 KST 오전 9시 전 납부가 전날로 찍혔다. dueDate 는 @db.Date 라 날짜 문자열 그대로 */}
                      {pmt.status === 'PAID'
                        ? (pmt.paidAt ? <Tf k="납부 {일시}" params={{ 일시: kdate(pmt.paidAt) }} /> : <T k="납부(시각 미기록)" />)
                        : pmt.dueDate ? <Tf k="납부 예정 {날짜}" params={{ 날짜: pmt.dueDate.slice(0, 10) }} /> : <T k="납부 예정일 미정" />}
                      {pmt.dueDatePassed && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700" data-testid="due-date-passed"><T k="예정일 경과" /></span>}
                    </p>
                  </div>
                  {pmt.status === 'PAID' ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold whitespace-nowrap"><T k="납부 완료" /></span>
                  ) : (
                    <button
                      onClick={() => { setPayingId(pmt.id); payMut.mutate(pmt.id); }}
                      disabled={payMut.isPending}
                      className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
                      {payingId === pmt.id && payMut.isPending ? <T k="기록 중…" /> : <T k="납부 기록" />}
                    </button>
                  )}
                </div>
              ))}
              {(plan.payments ?? []).length === 0 && (
                <p className="text-sm text-gray-500 py-4 text-center"><T k="회차 정보가 없습니다." /></p>
              )}
            </div>
          </>
        )}

        <button onClick={onClose} className="w-full mt-4 px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"><T k="닫기" /></button>
      </div>
    </div>
  );
}

function OutstandingTab() {
  const [showInstallmentModal, setShowInstallmentModal] = useState<string | null>(null);
  const [installments, setInstallments] = useState(3);
  // 🔴 §6 이연 회수(2026-08-25): 계획을 세우는 화면만 있고 **회차를 조회·납부하는 화면이 없었다**
  //    ("EP 를 만들면 부르는 화면까지가 한 벌"). 정본 EP 는 GET /billings/:id/installments ·
  //    PATCH /billing/installments/:installmentId/pay (7단계에서 구현 2벌을 하나로 통합했다).
  const [payPlanFor, setPayPlanFor] = useState<string | null>(null);

  const { data, isLoading, refetch } = useBillings({ status: 'DEFERRED' });
  const rawItems: OutstandingItem[] = (() => {
    const d = data?.data;
    if (Array.isArray(d)) return d as unknown as OutstandingItem[];
    if (d && typeof d === 'object' && 'items' in d) return (d as { items: OutstandingItem[] }).items;
    return [];
  })();

  // 🔴 2026-08-25: 종전엔 `useState(() => { fetch… })` 로 초기화 훅처럼 썼고(초기화 함수는 렌더 중
  //    실행되는 자리다 — 부수효과를 넣는 곳이 아니다) 실패를 `.catch(() => {})` 로 삼켜
  //    **조회 장애가 "미수금 없음"으로 보였다.** useQuery 로 옮기고 실패는 화면이 말한다.
  const { data: outstandingRes, isLoading: loadingOutstanding, isError: outstandingIsError,
          error: outstandingError, refetch: refetchOutstanding } = useQuery({
    queryKey: ['billing-outstanding'],
    queryFn: () => apiClient.get<{ data: { items: OutstandingItem[]; totalOutstandingAmount: number } }>('/api/v1/billing/outstanding'),
  });
  const outstanding = (outstandingRes as { data?: { items: OutstandingItem[]; totalOutstandingAmount: number } } | undefined)?.data ?? null;

  const items = outstanding?.items ?? rawItems;
  // 🔴 (2026-10-14 P4-1) 미수 = 남은 본인부담(본인부담 − 감면 − 이미 낸 돈) — 종전엔 행·합계 모두 본인부담 전액이었다
  const outstandingOfItem = (i: OutstandingItem) => i.outstanding ?? billingOutstanding(i) ?? 0;
  const totalAmount = outstanding?.totalOutstandingAmount ?? items.reduce((s, i) => s + outstandingOfItem(i), 0);

  const createInstallment = async (billingId: string) => {
    try {
      await apiClient.post(`/api/v1/billings/${billingId}/installment`, { totalInstallments: installments });
      toast.success(`${installments}회 분할 납부 스케줄 생성 완료`);
      setShowInstallmentModal(null);
      refetch();
    } catch {
      toast.error('분할 납부 생성 실패');
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="미수금 총액" value={formatCurrency(totalAmount)} color="red" />
        <StatCard label="미수금 건수" value={items.length} sub="명" color="amber" />
        <StatCard label="분할납부 진행" value={items.filter(i => i.hasInstallment).length} sub="건" color="blue" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 font-semibold text-gray-600"><T k="환자" /></th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">MRN</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-600"><T k="미수금액" /></th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600"><T k="상태" /></th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600"><T k="보류 사유" /></th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600"><T k="발생일" /></th>
              <th className="text-center px-5 py-3 font-semibold text-gray-600"><T k="조치" /></th>
            </tr>
          </thead>
          <tbody>
            {(isLoading || loadingOutstanding) && <SkeletonRows cols={7} />}
            {outstandingIsError && (
              <tr><td colSpan={7} className="px-5 py-6"><QueryErrorFallback error={outstandingError} onRetry={() => refetchOutstanding()} size="compact" /></td></tr>
            )}
            {!isLoading && !loadingOutstanding && !outstandingIsError && items.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400"><T k="미수금 없음" /></td></tr>
            )}
            {items.map(item => (
              <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-3 font-medium text-gray-900">
                  {item.patient?.familyName}{item.patient?.givenName}
                </td>
                <td className="px-5 py-3 text-gray-500 font-mono text-xs">{item.patient?.mrn}</td>
                <td className="px-5 py-3 text-right font-semibold text-red-600">{formatCurrency(outstandingOfItem(item))}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                    item.hasInstallment ? 'bg-blue-100 text-blue-700' :
                    item.status === 'DEFERRED' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {item.hasInstallment ? <T k="분할 진행" /> : item.status === 'DEFERRED' ? <T k="보류" /> : item.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs">{item.deferReason || '-'}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{item.createdAt?.slice(0, 10)}</td>
                <td className="px-5 py-3 text-center">
                  <div className="flex gap-1 justify-center">
                    <Link href={`/billing/${item.id}`}
                      className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-medium hover:bg-blue-100"><T k="수납" /></Link>
                    {!item.hasInstallment ? (
                      <button onClick={() => setShowInstallmentModal(item.id)}
                        className="px-2 py-1 bg-violet-50 text-violet-600 rounded text-[10px] font-medium hover:bg-violet-100"><T k="분할" /></button>
                    ) : (
                      <button onClick={() => setPayPlanFor(item.id)}
                        className="px-2 py-1 bg-violet-50 text-violet-600 rounded text-[10px] font-medium hover:bg-violet-100"><T k="회차" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payPlanFor && (
        <InstallmentPlanModal billingId={payPlanFor} onClose={() => setPayPlanFor(null)} onPaid={() => refetchOutstanding()} />
      )}

      {/* Installment Modal */}
      {showInstallmentModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowInstallmentModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4"><T k="분할 납부 설정" /></h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="분할 횟수" /></label>
                <div className="flex gap-1.5">
                  {[2, 3, 4, 5, 6].map(n => (
                    <button key={n} onClick={() => setInstallments(n)}
                      className={`flex-1 py-2 text-sm rounded-lg border ${installments === n ? 'border-violet-400 bg-violet-50 text-violet-700 font-semibold' : 'border-gray-200 text-gray-500'}`}>
                      {n}회
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-400"><T k="30일 간격으로 자동 스케줄이 생성됩니다." /></p>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowInstallmentModal(null)} className="flex-1 py-2 bg-gray-100 rounded-xl text-sm"><T k="취소" /></button>
                <button onClick={() => createInstallment(showInstallmentModal)} className="flex-1 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium"><T k="생성" /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
