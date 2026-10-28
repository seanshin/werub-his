'use client';
import { useState, useEffect } from 'react';
import { portalDateText } from '../_shared/portal-date';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import type { PatientInfo, PortalData, ServicesSegment, PortalItem } from '../_types';
import { fmt, fmtTime, currency } from '../_helpers';
import { Icon, StatusBadge, EmptyState, SkeletonCard, SegmentControl, Row } from '../_shared';
import PortalSheet from '../_shared/PortalSheet';
import { ICONS } from '../_icons';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kstToday } from '@/lib/kst-today';
import { PT, usePortalTAttr } from '../_shared/PT';

/**
 * 화상 진료실 입장 — **포털(환자) 스코프 토큰**으로만 연다.
 *
 * 🔴 2026-09-02 실측: 종전엔 직원 가드가 걸린 `/api/v1/telehealth/sessions/:id/patient-token` 을 불러
 *    환자 토큰으로 **항상 401** 이었고, `catch` 가 그 실패를 삼켜 **JWT 없이** `/meet/<room>` 을 열었다.
 *    운영 Jitsi 는 `JITSI_JWT_SECRET` 이 설정돼 있어 토큰 없는 입장은 사실상 실패한다 —
 *    즉 화면은 "입장했다"고 보이게 하고 실제로는 못 들어가는 상태였다.
 *    실패는 실패라고 말하고, 토큰 없이 조용히 열지 않는다.
 */
async function openTelehealthRoom(sessionId: string, roomId: string) {
  try {
    const res = await apiClient.get<{ data: { token: string } }>(`/api/v1/portal/telehealth/${sessionId}/patient-token`);
    const tk = (res?.data as { data?: { token?: string } })?.data?.token ?? (res?.data as { token?: string })?.token;
    if (!tk) throw new Error('입장 토큰을 받지 못했습니다.');
    window.open(`/meet/${roomId}?jwt=${encodeURIComponent(tk)}`, 'telehealth-video', 'width=800,height=600');
  } catch (e) {
    toast.error(e instanceof Error && e.message ? e.message : '화상 진료실 입장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }
}


interface ServicesTabProps {
  patient: PatientInfo;
  data: PortalData;
  initialSegment?: ServicesSegment;
}

const SEGMENTS: { key: ServicesSegment; label: string }[] = [
  { key: 'billing', label: '수납' },
  { key: 'documents', label: '서류발급' },
  { key: 'telehealth', label: '원격진료' },
  { key: 'pre-auth', label: '사전승인' },
  { key: 'voc', label: '나의 문의' },
  { key: 'hospital-info', label: '병원안내' },
];

export default function ServicesTab({ patient, data, initialSegment }: ServicesTabProps) {
  const [segment, setSegment] = useState<ServicesSegment>(initialSegment ?? 'billing');
  useEffect(() => { if (initialSegment) setSegment(initialSegment); }, [initialSegment]);

  return (
    <div className="space-y-4">
      <SegmentControl segments={SEGMENTS} active={segment} onChange={setSegment} />

      {segment === 'billing' && <BillingSegment billings={data.billings} />}
      {segment === 'documents' && <DocumentsSegment />}
      {segment === 'telehealth' && <TelehealthSegment />}
      {segment === 'pre-auth' && <PreAuthSegment />}
      {segment === 'voc' && <VocSegment />}
      {segment === 'hospital-info' && <HospitalInfoSegment />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   세그먼트 1: 수납 (billing)
   ═══════════════════════════════════════════════════════════════ */

function BillingSegment({ billings }: { billings: PortalData['billings'] }) {
  const tAttr = usePortalTAttr();
  return (
    <div className="space-y-3">
      <AnnualBillingSummarySection />
      <MedicalExpensesCard />
      <InsuranceGuideCard />
      <h3 className="text-sm font-semibold text-gray-900 mb-1"><PT k="진료비 내역" /></h3>
      {billings.length === 0 ? (
        <EmptyState icon="💳" title="진료비 내역이 없습니다." />
      ) : (
        billings.map(b => (
          <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-xs text-gray-500">{fmt(b.billedAt)}</p>
              <StatusBadge status={b.status} domain="billing" />
            </div>
            <div className="p-4 space-y-2 text-xs">
              <Row label={tAttr('총 진료비')} value={currency(b.total)} bold />
              <Row label={tAttr('보험 급여')} value={currency(b.insuranceCovered)} />
              <Row label={tAttr('본인 부담')} value={currency(b.copay)} />
              {b.discount > 0 && <Row label={tAttr('감면')} value={`-${currency(b.discount)}`} />}
              <div className="border-t border-gray-100 pt-2 mt-2">
                <Row label={tAttr('납부 금액')} value={currency(b.paidAmount)} bold />
                {b.refundAmount != null && b.refundAmount > 0 && <Row label={tAttr('환불')} value={`-${currency(b.refundAmount)}`} />}
                {/* 🔴 (2026-10-14 P4-1) 남은 금액 = 본인부담 − 감면 − 낸 돈 — 종전 버튼은 감면을 빼지 않았다 */}
                {(b.status === 'PENDING' || b.status === 'PARTIAL' || b.status === 'DEFERRED') && b.outstanding != null && b.outstanding > 0 && (
                  <Row label={tAttr('남은 금액')} value={currency(b.outstanding)} bold />
                )}
              </div>
            </div>
            <div className="px-4 pb-3 space-y-2">
              {b.status === 'PAID' && (
                <button
                  onClick={async () => {
                    try {
                      const res = await apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/portal/billings/${b.id}/receipt`);
                      const r = (res as unknown as PortalItem).data as PortalItem;
                      const receiptData = (r?.data ?? r) as PortalItem;
                      const rr = receiptData;
                      const pt = rr.patient as PortalItem | undefined;
                      const bl = rr.billing as PortalItem | undefined;
                      // 🔴 날짜만 옮기지 않는다 — 이 영수증 텍스트는 머리·항목명이 전부 한국어 템플릿이라, 날짜만 환자 언어로 바꾸면
                      //    한 문서 안에서 언어가 섞인다. 영수증 텍스트 번역은 별도 결정(법정 서식·금액 표기 축)이다.
                      const text = `[영수증 ${rr.receiptNo}]\n${rr.hospitalName}\n발행일: ${new Date(rr.issuedAt as string).toLocaleDateString('ko')}\n\n환자: ${pt?.name} (${pt?.mrn})\n총액: ${(bl?.totalAmount as number)?.toLocaleString()}원\n보험: ${(bl?.insuranceCovered as number)?.toLocaleString()}원\n본인부담: ${(bl?.patientCopay as number)?.toLocaleString()}원\n납부: ${(bl?.paidAmount as number)?.toLocaleString()}원`;
                      alert(text);
                    } catch {
                      alert('영수증 조회에 실패했습니다.');
                    }
                  }}
                  className="w-full text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg py-2 font-medium transition-colors"
                >
                  <PT k="영수증 보기" />
                </button>
              )}
              {/* 🔴 (2026-10-14 P4-1) 종전 '온라인 결제' 버튼은 서버에 없는 EP(`/portal/billings/:id/pay-link`)를 불러 늘 "결제 링크를
                  불러오지 못했습니다"였다. 온라인 결제 연동이 없다(P3-1과 같은 사실) — 버튼 대신 사실과 남은 금액을 말한다. */}
              {(b.status === 'PENDING' || b.status === 'PARTIAL' || b.status === 'DEFERRED') && b.outstanding != null && b.outstanding > 0 && (
                <p className="text-[11px] text-gray-600 bg-gray-50 rounded-lg px-3 py-2" data-portal-pay-unavailable>
                  <PT k="온라인 결제는 아직 연결되지 않았습니다 — 다음 방문 때 병원 창구에서 수납해 주세요." />
                </p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function AnnualBillingSummarySection() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-billing-annual', year],
    queryFn: () =>
      apiClient
        .get<{ data: Record<string, unknown> }>(`/api/v1/portal/billing/annual-summary?year=${year}`),
  });

  const rawOuter = data?.data as PortalItem | null;
  const raw = (rawOuter?.data as PortalItem | undefined) ?? rawOuter;

  // 🔴 에러 분기가 로딩보다 먼저 — 실패로 카드가 사라지면 "의료비 없음"으로 읽힌다
  if (isError) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <p className="text-sm font-semibold text-gray-900 mb-2"><PT k="연간 의료비 요약" /></p>
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      </div>
    );
  }
  if (isLoading) return <SkeletonCard lines={4} />;
  if (!raw) return null;

  const totalVisits = (raw.totalVisits ?? raw.visitCount ?? 0) as number;
  const totalAmount = (raw.totalAmount ?? 0) as number;
  // 🔴 W9(2026-08-14): 서버(/portal/billing/annual-summary)가 내는 이름은 `totalInsurance`·`totalCopay` 인데
  //    화면은 `insuranceCovered`·`copay` 를 읽고 `?? 0` 으로 받아, 실제 수납이 있는 환자에게도
  //    **"보험부담 0원 · 본인부담 0원"** 을 총 진료비 옆에 나란히 띄웠다(P11 계약 불일치 + P1 모르는 것을 0으로).
  //    운영 실측 P2026-0002/2026년: 서버 totalInsurance=99,015 totalCopay=25,335 → 화면 0원/0원.
  //    (형태가 다른 `/portal/medical-expenses` 는 summary.insuranceCovered·copay 라 그대로 둔다 — 두 EP 는 별개 계약)
  const insuranceCovered = (raw.totalInsurance ?? raw.insuranceCovered ?? 0) as number;
  const copay = (raw.totalCopay ?? raw.copay ?? raw.patientCopay ?? 0) as number;
  const monthly = (raw.monthly ?? raw.monthlyBreakdown ?? []) as PortalItem[];
  const maxMonthly = Math.max(...monthly.map((m: PortalItem) => (m.amount ?? m.total ?? 0) as number), 1);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 flex items-center justify-between">
        <p className="text-white text-sm font-semibold"><PT k="연간 의료비 요약" /></p>
        <select
          value={year}
          onChange={e => setYear(parseInt(e.target.value))}
          className="bg-white/20 text-white text-xs rounded-lg px-2 py-1 border border-white/30 focus:outline-none"
        >
          {[currentYear, currentYear - 1, currentYear - 2].map(y => (
            <option key={y} value={y} className="text-gray-900">
              {y}년
            </option>
          ))}
        </select>
      </div>
      <div className="p-5">
        {/* 요약 수치 */}
        <div className="flex items-center justify-center gap-4 mb-4 text-center">
          <div>
            <p className="text-[10px] text-gray-400"><PT k="총 방문" /></p>
            <p className="text-lg font-bold text-gray-900">
              {totalVisits}
              <span className="text-xs font-normal text-gray-500">회</span>
            </p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div>
            <p className="text-[10px] text-gray-400"><PT k="총 진료비" /></p>
            <p className="text-lg font-bold text-indigo-700">
              {totalAmount.toLocaleString()}
              <span className="text-xs font-normal text-gray-500">원</span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center mb-4">
          <div className="bg-blue-50 rounded-xl py-2.5">
            <p className="text-[10px] text-gray-400"><PT k="보험부담" /></p>
            <p className="text-sm font-semibold text-blue-700">
              {insuranceCovered.toLocaleString()}
              <span className="text-[10px] font-normal text-gray-400">원</span>
            </p>
          </div>
          <div className="bg-amber-50 rounded-xl py-2.5">
            {/* 🔴 (2026-10-19 포털 R1) 이 값은 서버 totalCopay = **낸 돈(환불 차감)** 이다 — '본인부담'(청구액)이라 부르면
                아래 연말정산 카드의 청구액과 1,000원 어긋나 보였다(부분 환불 환자). 같은 사실은 같은 이름으로. */}
            <p className="text-[10px] text-gray-400"><PT k="낸 금액(환불 차감)" /></p>
            <p className="text-sm font-semibold text-amber-700">
              {copay.toLocaleString()}
              <span className="text-[10px] font-normal text-gray-400">원</span>
            </p>
          </div>
        </div>

        {/* 월별 내역 바 차트 */}
        {monthly.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2"><PT k="월별 내역" /></p>
            <div className="flex items-end gap-1 h-20">
              {Array.from({ length: 12 }, (_, i) => {
                const m = monthly.find((mo: PortalItem) => (mo.month as number) === i + 1);
                const amt = (m?.amount ?? m?.total ?? 0) as number;
                const h = maxMonthly > 0 ? Math.max(2, (amt / maxMonthly) * 72) : 2;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className={`w-full rounded-t-sm transition-all ${amt > 0 ? 'bg-indigo-400' : 'bg-gray-100'}`}
                      style={{ height: `${h}px` }}
                      title={`${i + 1}월: ${amt.toLocaleString()}원`}
                    />
                    <span className="text-[8px] text-gray-400">{i + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/**
          * 🔴 **연간 합산 영수증·연말정산 증빙은 이 시스템이 발급하지 않는다.**
          *    두 버튼은 서버에 없는 `/portal/billing/{annual-receipt,tax-proof}` 를 불러
          *    누를 때마다 "다운로드에 실패했습니다"만 띄웠다(운영 실측 404 · 개통 이래 무동작).
          *    **없는 기능을 있는 것처럼 보이는 버튼으로 두지 않는다.** 건별 영수증은 실제로
          *    동작하므로(`/portal/billings/:id/receipt`) 그쪽으로 안내한다.
          */}
        <p className="mt-4 text-[11px] leading-relaxed text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
          연간 합산 영수증·연말정산 증빙은 아직 발급되지 않습니다. 아래 <b><PT k="진료비 내역" /></b>에서
          건별 영수증을 받으실 수 있고, 국세청 연말정산 간소화 자료로도 조회됩니다.
        </p>
      </div>
    </div>
  );
}

function MedicalExpensesCard() {
  const year = new Date().getFullYear();
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['portal-expenses', year],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/portal/medical-expenses?year=${year}`),
  });
  // 🔴 조회 실패로 카드가 사라지면 "연말정산 의료비 없음"으로 읽힌다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  const expOuter = data?.data as PortalItem | null;
  const exp = ((expOuter?.data as PortalItem | undefined) ?? expOuter) as PortalItem | null;
  if (!exp?.summary) return null;
  const s = exp.summary as PortalItem;
  // 🔴 (2026-10-19 포털 R1) 연말정산 의료비는 **낸 돈**(부분 납부·분납 포함 · 환불 차감 · 낸 날 기준)이다 — 서버 summary.paid.
  //    종전 머리 숫자는 summary.copay(청구된 본인부담 합)라, 부분 환불 1,000원이 있는 환자에게 위 연간 요약(87,203)과 다른
  //    88,203원을 "본인 부담 총액"으로 보였다. 청구액은 다를 때만 작게 따로 적는다.
  const paid = typeof s.paid === 'number' ? s.paid : null;
  const billedCopay = typeof s.copay === 'number' ? s.copay : null;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-3">
        <p className="text-white text-sm font-semibold">{year}<Unit>년</Unit> <PT k="연말정산 의료비" /></p>
      </div>
      <div className="p-5">
        <div className="text-center mb-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider"><PT k="낸 의료비(환불 차감)" /></p>
          <p className="text-2xl font-bold text-indigo-700" data-portal-tax-paid>
            {paid == null ? '—' : paid.toLocaleString()}
            {paid != null && <span className="text-sm font-normal text-gray-500">원</span>}
          </p>
          {billedCopay != null && paid != null && billedCopay !== paid && (
            <p className="text-[11px] text-gray-500 mt-1" data-portal-tax-billed>
              <PT k="청구된 본인부담" /> {billedCopay.toLocaleString()}원 · <PT k="부분 납부·환불은 돈이 오간 날에 셉니다." />
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="flex flex-col justify-center bg-gray-50 rounded-xl py-2.5 px-1">
            <p className="text-[10px] text-gray-400 mb-0.5"><PT k="총 진료비" /></p>
            {/* 🔴 숫자와 '원' 이 별도 span 이라 그 사이에서 줄이 끊겼다 — 한 덩어리로 묶는다 */}
            <p className="overflow-x-auto whitespace-nowrap text-sm font-semibold text-gray-800">
              {((s.totalAmount as number) ?? 0).toLocaleString()}
              <span className="text-[10px] font-normal text-gray-400">원</span>
            </p>
          </div>
          <div className="flex flex-col justify-center bg-gray-50 rounded-xl py-2.5 px-1">
            <p className="text-[10px] text-gray-400 mb-0.5"><PT k="보험 급여" /></p>
            {/* 🔴 숫자와 '원' 이 별도 span 이라 그 사이에서 줄이 끊겼다 — 한 덩어리로 묶는다 */}
            <p className="overflow-x-auto whitespace-nowrap text-sm font-semibold text-gray-800">
              {((s.insuranceCovered as number) ?? 0).toLocaleString()}
              <span className="text-[10px] font-normal text-gray-400">원</span>
            </p>
          </div>
          <div className="flex flex-col justify-center bg-gray-50 rounded-xl py-2.5 px-1">
            <p className="text-[10px] text-gray-400 mb-0.5"><PT k="방문" /></p>
            {/* 🔴 숫자와 '원' 이 별도 span 이라 그 사이에서 줄이 끊겼다 — 한 덩어리로 묶는다 */}
            <p className="overflow-x-auto whitespace-nowrap text-sm font-semibold text-gray-800">
              {(exp?.visitCount as number) ?? 0}
              <span className="text-[10px] font-normal text-gray-400">회</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsuranceGuideCard() {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['portal-insurance-guide'],
    queryFn: () =>
      apiClient.get<{ data: Record<string, unknown> }>('/api/v1/portal/insurance-guide'),
  });
  const guideOuter = data?.data as PortalItem | null;
  const guide = ((guideOuter?.data as PortalItem | undefined) ?? guideOuter) as PortalItem | null;
  if (isError) {
    return (
      <div className="bg-white rounded-xl border p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2"><PT k="보험 청구 안내" /></h3>
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      </div>
    );
  }
  if (!guide) return null;
  const guideTitle = String(guide.title ?? '');
  const guideSteps = (guide.steps as PortalItem[] | undefined) ?? [];
  const guideReqDocs = (guide.requiredDocuments as PortalItem[] | undefined) ?? [];
  const guideTips = (guide.tips as string[] | undefined) ?? [];
  return (
    <div className="bg-white rounded-xl border p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{guideTitle}</h3>
      <div className="space-y-2 mb-3">
        {guideSteps.map((s: PortalItem) => (
          <div key={String(s.step ?? '')} className="flex gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center shrink-0 mt-0.5">
              {String(s.step ?? '')}
            </span>
            <div>
              <p className="text-xs font-medium text-gray-800">{String(s.title ?? '')}</p>
              <p className="text-[10px] text-gray-500">{String(s.description ?? '')}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-amber-50 rounded-lg p-3">
        <p className="text-[10px] font-medium text-amber-800 mb-1"><PT k="필요 서류" /></p>
        {guideReqDocs.map((d: PortalItem, i: number) => (
          <p key={i} className="text-[10px] text-gray-600">
            {String(d.name ?? '')} -- {String(d.where ?? '')} {d.note ? `(${String(d.note)})` : ''}
          </p>
        ))}
      </div>
      {guideTips.length > 0 && (
        <div className="mt-2 text-[10px] text-gray-500">
          {guideTips.map((t: string, i: number) => (
            <p key={i}>TIP: {t}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   세그먼트 2: 서류발급 (documents)
   ═══════════════════════════════════════════════════════════════ */

const REC_TYPE_OPTS: [string, string][] = [
  ['ENCOUNTER', '진료기록'], ['PROGRESS', '경과기록'], ['NURSING', '간호기록'], ['DISCHARGE', '퇴원요약'], ['PRESCRIPTION', '처방내역'],
];
// 진단서 등 의사 작성 증명서 — 관련 진료(방문) 선택 필요
const CERT_TYPES = ['DIAGNOSIS_CERT', 'OPINION', 'BIRTH_CERT'];

// F-4 실손보험 청구 세트 — BE bundle-sets 응답 형태(구성·수수료 고지)
type BundleSetComponent = { type: string; label: string; mode: 'AUTO' | 'STAFF' | 'RECEIPT_ATTACH'; fee: number };
type BundleSet = { setType: string; label: string; components: BundleSetComponent[]; totalFee: number; notice: string };

function DocumentsSegment() {
  const tAttr = usePortalTAttr();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{ type: string; purpose: string; deliveryMethod: string; copies: number; note: string; recordTypes: string[]; encounterId: string }>({ type: 'MEDICAL_RECORD', purpose: '', deliveryMethod: 'PORTAL', copies: 1, note: '', recordTypes: ['ENCOUNTER'], encounterId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // ── F-4 실손보험 청구 세트 ──
  // 보호자 위임 세션은 서류 신청·다운로드 차단(설계 §6.6) — 카드 자체 미렌더(BE 가드·403 이중 방어)
  const [isGuardian, setIsGuardian] = useState(false);
  useEffect(() => { setIsGuardian(!!localStorage.getItem('guardian-mode')); }, []);
  const [showBundleSheet, setShowBundleSheet] = useState(false);
  const [bundleForm, setBundleForm] = useState({ setType: 'INSURANCE_OUTPATIENT', periodFrom: '', periodTo: '' });
  const [bundleSubmitting, setBundleSubmitting] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState<string | null>(null);

  // config portal.insuranceDocBundle OFF → 404 → null → 카드 미렌더(F-3 선례)
  const { data: bundleSetsRes, isError: bundleIsError, error: bundleError, refetch: refetchBundle } = useQuery({
    queryKey: ['portal-doc-bundle-sets'],
    queryFn: () => apiClient.get<{ data: { sets: BundleSet[] } }>('/api/v1/portal/documents/bundle-sets'),
  });
  const bundleSets = bundleSetsRes?.data?.sets ?? null;
  const selectedSet = bundleSets?.find(s => s.setType === bundleForm.setType) ?? null;

  const submitBundle = async () => {
    if (!bundleForm.periodFrom || !bundleForm.periodTo) { toast.error('대상 기간을 선택해 주세요.'); return; }
    setBundleSubmitting(true);
    try {
      await apiClient.post('/api/v1/portal/documents/request-bundle', bundleForm);
      toast.success('실손보험 청구 세트를 신청했습니다.');
      setShowBundleSheet(false);
      setBundleForm({ setType: 'INSURANCE_OUTPATIENT', periodFrom: '', periodTo: '' });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '신청에 실패했습니다.');
    }
    setBundleSubmitting(false);
  };

  const downloadBundleZip = async (bundleId: string) => {
    setDownloadingZip(bundleId);
    try {
      const res = await fetch(`/api/v1/portal/documents/bundles/${bundleId}/download`, {
        headers: { Authorization: `Bearer ${apiClient.getToken()}` }, credentials: 'include',
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `보험청구서류_${bundleId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error('다운로드에 실패했습니다.'); }
    finally { setDownloadingZip(null); }
  };

  // 진단서/소견서 신청 시 관련 진료(방문) 선택용
  const { data: encData, isError: encIsError, error: encError, refetch: refetchEnc } = useQuery({
    queryKey: ['portal-encounters-for-cert'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/encounters'),
    enabled: showForm,
  });
  const encs = (Array.isArray(encData?.data) ? encData!.data : []) as Array<Record<string, unknown>>;

  const downloadDoc = async (id: string) => {
    setDownloading(id);
    try {
      const res = await fetch(`/api/v1/portal/documents/${id}/download`, {
        headers: { Authorization: `Bearer ${apiClient.getToken()}` }, credentials: 'include',
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error('다운로드에 실패했습니다.'); }
    finally { setDownloading(null); }
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-documents'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/documents/requests'),
  });
  const raw = data?.data;
  const docs = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const TYPE_LABEL: Record<string, string> = {
    MEDICAL_RECORD: '진료기록 사본',
    DIAGNOSIS_CERT: '진단서',
    OPINION: '소견서',
    RECEIPT: '영수증',
    TAX_INVOICE: '세금계산서',
    ADMISSION_CERT: '입퇴원확인서',
    // F-4 실손보험 세트 자동발급 2종
    DETAILED_BILL: '진료비 세부산정내역서',
    ATTENDANCE_CERT: '통원확인서',
    // N-W1 — 출생증명서(산모 본인 신청 가능)·사망진단서(창구 접수 전용 — 목록 렌더용 라벨만)
  BIRTH_CERT: '출생증명서',
  DEATH_CERT: '사망진단서',
};
  const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    REQUESTED: { label: '접수', cls: 'bg-blue-100 text-blue-700' },
    PROCESSING: { label: '처리중', cls: 'bg-yellow-100 text-yellow-700' },
    // 🔴 (2026-10-10) 발급 업무가 실제로 쓰는 상태(동결·작성 후 검토 중) — 표에 없어 환자에게 'IN_REVIEW' 영문이 그대로 보였다
    IN_REVIEW: { label: '처리중', cls: 'bg-yellow-100 text-yellow-700' },
    READY: { label: '발급완료', cls: 'bg-green-100 text-green-700' },
    DELIVERED: { label: '수령완료', cls: 'bg-gray-100 text-gray-600' },
    REJECTED: { label: '반려', cls: 'bg-red-100 text-red-600' },
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = form.type === 'MEDICAL_RECORD'
        ? { ...form, encounterId: undefined }
        : { ...form, recordTypes: undefined, encounterId: form.encounterId || undefined };
      await apiClient.post('/api/v1/portal/documents/request', payload);
      setShowForm(false);
      setForm({ type: 'MEDICAL_RECORD', purpose: '', deliveryMethod: 'PORTAL', copies: 1, note: '', recordTypes: ['ENCOUNTER'], encounterId: '' });
      refetch();
    } catch {
      alert('신청에 실패했습니다.');
    }
    setSubmitting(false);
  };

  // F-4 번들 그룹핑 — bundleId 있는 요청은 세트 카드로 묶어 렌더(설계 §4.4)
  const bundleEntries: [string, PortalItem[]][] = [];
  const singleDocs: PortalItem[] = [];
  {
    const map = new Map<string, PortalItem[]>();
    for (const d of docs) {
      const bId = d.bundleId ? String(d.bundleId) : '';
      if (bId) {
        const arr = map.get(bId) ?? [];
        arr.push(d);
        map.set(bId, arr);
      } else {
        singleDocs.push(d);
      }
    }
    bundleEntries.push(...map.entries());
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="서류 발급" /></h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {showForm ? '닫기' : '+ 신청'}
        </button>
      </div>

      {/* 🔴 세트 목록 조회 실패로 카드가 사라지면 "신청할 수 없는 것"으로 읽힌다 */}
      {bundleIsError && !isGuardian && (
        <div className="bg-white rounded-xl border border-blue-200 p-4">
          <p className="text-sm font-semibold text-gray-900 mb-2"><PT k="🛡️ 실손보험 청구 세트" /></p>
          <QueryErrorFallback error={bundleError} onRetry={refetchBundle} size="compact" />
        </div>
      )}

      {/* F-4 실손보험 청구 세트 카드 — config OFF(404)·보호자 위임 세션이면 미렌더 */}
      {bundleSets && !isGuardian && (
        <div className="bg-white rounded-xl border border-blue-200 p-4">
          <div className="flex justify-between items-start gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900"><PT k="🛡️ 실손보험 청구 세트" /></p>
              <p className="text-xs text-gray-500 mt-0.5">
                <PT k="세부산정내역서·영수증·통원(입퇴원)확인서를 한 번에 신청하고 zip으로 내려받으세요." />
              </p>
            </div>
            <button
              onClick={() => setShowBundleSheet(true)}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <PT k="세트 신청" />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">진단서는 의사 작성·유료 서류로 세트에 포함되지 않습니다(별도 신청).</p>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><PT k="서류 종류" /></label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              {/* DEATH_CERT 는 신청 불가(사망자 본인 계정 성립 불가 — 창구 접수) — 라벨은 목록 렌더용으로만 둔다 */}
              {Object.entries(TYPE_LABEL).filter(([k]) => k !== 'DEATH_CERT').map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {CERT_TYPES.includes(form.type) && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">관련 진료(방문) {form.type === 'DIAGNOSIS_CERT' && <span className="text-red-500">*</span>}</label>
              {/* 🔴 진료 목록 조회 실패를 "진료 없음"(빈 선택지)으로 말하지 않는다 */}
              {encIsError && <QueryErrorFallback error={encError} onRetry={refetchEnc} size="compact" className="mb-1" />}
              <select value={form.encounterId} onChange={e => setForm(f => ({ ...f, encounterId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">진료 선택{form.type === 'DIAGNOSIS_CERT' ? ' (진단서는 필수)' : ' (선택)'}</option>
                {encs.map((e) => {
                  const id = String(e.id ?? '');
                  const date = portalDateText(e.createdAt, 'date', { fallback: '' });
                  const dept = (e.department ?? (e as Record<string, unknown>).doctorName ?? '') as string;
                  return <option key={id} value={id}>{date}{dept ? ` · ${dept}` : ''}</option>;
                })}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">진단서는 해당 진료를 직접 본 담당의가 작성·서명합니다(의료법 §17).</p>
            </div>
          )}
          {form.type === 'MEDICAL_RECORD' && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><PT k="포함할 기록" /></label>
              <div className="flex flex-wrap gap-1.5">
                {REC_TYPE_OPTS.map(([k, lbl]) => {
                  const on = form.recordTypes.includes(k);
                  return (
                    <button key={k} type="button"
                      onClick={() => setForm(f => ({ ...f, recordTypes: on ? f.recordTypes.filter(x => x !== k) : [...f.recordTypes, k] }))}
                      className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><PT k="용도" /></label>
            <input
              value={form.purpose}
              onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
              placeholder={tAttr('보험사 제출, 직장 제출 등')}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><PT k="수령 방법" /></label>
              <select
                value={form.deliveryMethod}
                onChange={e => setForm(f => ({ ...f, deliveryMethod: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="PORTAL"><PT k="포털 다운로드" /></option>
                <option value="VISIT"><PT k="방문 수령" /></option>
                <option value="FAX"><PT k="팩스" /></option>
                <option value="MAIL"><PT k="우편" /></option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><PT k="부수" /></label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.copies}
                onChange={e => setForm(f => ({ ...f, copies: parseInt(e.target.value) || 1 }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block"><PT k="요청 사항" /></label>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder={tAttr('특별 요청 사항')}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? '신청 중...' : '발급 신청'}
          </button>
        </div>
      )}

      {isLoading ? (
        <SkeletonCard lines={3} />
      ) : isError ? (
        // 🔴 (포털 A6) 조회 실패를 "서류 신청 내역이 없습니다"로 말하지 않는다
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      ) : !docs.length ? (
        <EmptyState icon="📄" title="서류 신청 내역이 없습니다." />
      ) : (
        <>
        {/* F-4 번들 그룹 카드 — 전체/부분 다운로드(zip, 영수증 동봉) */}
        {bundleEntries.map(([bId, items]) => {
          const readyCount = items.filter(i => i.status === 'READY' || i.status === 'DELIVERED').length;
          const allReady = readyCount === items.length;
          const totalFee = items.reduce((s, i) => s + ((i.fee as number) ?? 0), 0);
          const firstDate = portalDateText(items[0]?.createdAt, 'date', { fallback: '' });
          return (
            <div key={bId} className="bg-white rounded-xl border border-blue-200 p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-900"><PT k="🛡️ 실손보험 청구 세트" /></p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {firstDate}{items[0]?.purpose ? ` · ${String(items[0].purpose)}` : ''}
                    {totalFee > 0 ? ` · 수수료 ${totalFee.toLocaleString()}원` : ''}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${allReady ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {allReady ? '전체 준비 완료' : `${readyCount}/${items.length} 준비`}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                {items.map(i => {
                  const iSt = STATUS_MAP[String(i.status ?? '')] ?? { label: String(i.status ?? ''), cls: 'bg-gray-100 text-gray-600' };
                  return (
                    <div key={String(i.id)} className="flex justify-between items-center">
                      <span className="text-xs text-gray-700">{TYPE_LABEL[String(i.type ?? '')] ?? String(i.type ?? '')}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${iSt.cls}`}>{iSt.label}</span>
                    </div>
                  );
                })}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-700"><PT k="진료비 영수증" /></span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600"><PT k="zip 동봉" /></span>
                </div>
              </div>
              {readyCount > 0 && !isGuardian && (
                <button
                  onClick={() => downloadBundleZip(bId)}
                  disabled={downloadingZip === bId}
                  className="mt-3 w-full text-xs px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {downloadingZip === bId ? '내려받는 중…' : allReady ? '전체 다운로드 (zip)' : `준비된 서류 먼저 다운로드 (${readyCount}/${items.length})`}
                </button>
              )}
              {!allReady && (
                <p className="text-[10px] text-gray-400 mt-1.5"><PT k="의료진 확인이 필요한 서류는 발급 완료 알림 후 다시 내려받을 수 있습니다." /></p>
              )}
            </div>
          );
        })}
        {singleDocs.map(d => {
          const dStatus = String(d.status ?? '');
          const dType = String(d.type ?? '');
          const dId = String(d.id ?? '');
          const dFee = (d.fee as number) ?? 0;
          const st = STATUS_MAP[dStatus] ?? { label: dStatus, cls: 'bg-gray-100 text-gray-600' };
          return (
            <div key={dId} className="bg-white rounded-xl border p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-900">{TYPE_LABEL[dType] ?? dType}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {/* 🔴 종전엔 createdAt 이 없으면 `new Date('')` → `Invalid Date` 를 그렸다 — 정본은 `-` */}
                    {portalDateText(d.createdAt, 'date')}
                    {d.purpose ? ` · ${String(d.purpose)}` : ''}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${st.cls}`}>{st.label}</span>
              </div>
              {dFee > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  수수료: {dFee.toLocaleString()}원 · {String(d.copies ?? '')}부
                </p>
              )}
              {/* 진행 단계(2026-10-10) — 신청 → 처리 중 → 발급 완료 → 수령 · 반려면 멈춘 자리를 말한다 */}
              <PortalDocSteps status={dStatus} />
              {dStatus !== 'REJECTED' && dStatus !== 'READY' && dStatus !== 'DELIVERED' && d.slaDueAt != null && (
                <p className="text-[11px] text-gray-500 mt-1" data-portal-doc-due><PT k="처리 예정일" />: {portalDateText(d.slaDueAt, 'date')} <span className="text-gray-400">(<PT k="예정이며 늦어질 수 있습니다" />)</span></p>
              )}
              {d.rejectReason != null && <p className="text-xs text-red-500 mt-1">반려 사유: {String(d.rejectReason)}</p>}
              {(dStatus === 'READY' || dStatus === 'DELIVERED') && d.issuedDocumentId != null && (
                <button onClick={() => downloadDoc(dId)} disabled={downloading === dId}
                  className="mt-2 text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                  {downloading === dId ? '내려받는 중…' : 'PDF 다운로드'}
                </button>
              )}
            </div>
          );
        })}
        </>
      )}

      {/* F-4 세트 신청 시트 — 외래/입원 → 기간 → 구성 미리보기+수수료 → 신청 (PortalSheet §6.3) */}
      <PortalSheet
        open={showBundleSheet}
        onClose={() => setShowBundleSheet(false)}
        title={tAttr('실손보험 청구 세트 신청')}
        footer={
          <button
            onClick={submitBundle}
            disabled={bundleSubmitting || !bundleForm.periodFrom || !bundleForm.periodTo}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {bundleSubmitting
              ? '신청 중…'
              : `신청하기${selectedSet && selectedSet.totalFee > 0 ? ` (수수료 ${selectedSet.totalFee.toLocaleString()}원)` : ''}`}
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="text-xs text-gray-500 mb-1.5"><PT k="진료 구분" /></p>
            <div className="grid grid-cols-2 gap-2">
              {(bundleSets ?? []).map(s => {
                const on = bundleForm.setType === s.setType;
                return (
                  <button
                    key={s.setType}
                    type="button"
                    onClick={() => setBundleForm(f => ({ ...f, setType: s.setType }))}
                    className={`text-sm py-2 rounded-lg border font-medium ${on ? 'bg-blue-50 text-blue-600 border-blue-300' : 'bg-white text-gray-500 border-gray-200'}`}
                  >
                    {s.setType === 'INSURANCE_INPATIENT' ? '입원' : '외래'}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><PT k="시작일" /></label>
              <input
                type="date"
                value={bundleForm.periodFrom}
                onChange={e => setBundleForm(f => ({ ...f, periodFrom: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><PT k="종료일" /></label>
              <input
                type="date"
                value={bundleForm.periodTo}
                onChange={e => setBundleForm(f => ({ ...f, periodTo: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          {selectedSet && (
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-3">
              <p className="text-xs font-medium text-gray-700 mb-2"><PT k="구성 서류 · 수수료" /></p>
              <div className="space-y-1.5">
                {selectedSet.components.map(c => (
                  <div key={c.type} className="flex justify-between items-center">
                    <span className="text-xs text-gray-700">
                      {c.label}
                      {c.mode === 'AUTO' && <span className="text-[10px] text-green-600 ml-1"><PT k="즉시 발급" /></span>}
                      {c.mode === 'STAFF' && <span className="text-[10px] text-amber-600 ml-1"><PT k="의료진 확인 후" /></span>}
                      {c.mode === 'RECEIPT_ATTACH' && <span className="text-[10px] text-gray-400 ml-1"><PT k="zip 동봉" /></span>}
                    </span>
                    <span className="text-xs text-gray-500">{c.fee > 0 ? `${c.fee.toLocaleString()}원` : '무료'}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center border-t border-gray-200 mt-2 pt-2">
                <span className="text-xs font-semibold text-gray-900"><PT k="수수료 합계" /></span>
                <span className="text-sm font-bold text-gray-900">{selectedSet.totalFee.toLocaleString()}<Unit>원</Unit></span>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">{selectedSet.notice}</p>
            </div>
          )}
        </div>
      </PortalSheet>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   세그먼트 3: 원격진료 (telehealth)
   ═══════════════════════════════════════════════════════════════ */

function TelehealthSegment() {
  const tAttr = usePortalTAttr();
  const qc = useQueryClient();
  const [showBooking, setShowBooking] = useState(false);

  const { data, isLoading, refetch, isError, error } = useQuery({
    queryKey: ['portal-telehealth'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/telehealth'),
  });
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');

  const joinMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/portal/telehealth/${id}/join`),
    onSuccess: () => {
      refetch();
      alert('대기실에 입장했습니다. 의사가 진료를 시작하면 연결됩니다.');
    },
    onError: () => alert('입장에 실패했습니다.'),
  });

  const rateMut = useMutation({
    mutationFn: ({ id, r, f }: { id: string; r: number; f: string }) =>
      apiClient.post(`/api/v1/portal/telehealth/${id}/rate`, { rating: r, feedback: f }),
    onSuccess: () => {
      setRatingId(null);
      alert('평가해 주셔서 감사합니다.');
    },
  });

  const raw = data?.data;
  const sessions = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const statusLabel: Record<string, { text: string; cls: string }> = {
    SCHEDULED: { text: '예약됨', cls: 'bg-blue-100 text-blue-700' },
    WAITING: { text: '대기중', cls: 'bg-amber-100 text-amber-700' },
    IN_PROGRESS: { text: '진료중', cls: 'bg-emerald-100 text-emerald-700' },
    COMPLETED: { text: '완료', cls: 'bg-gray-200 text-gray-600' },
    CANCELLED: { text: '취소', cls: 'bg-red-100 text-red-600' },
  };

  const typeLabel: Record<string, string> = { VIDEO: '화상', AUDIO: '음성', ASYNC: '비동기' };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="원격진료" /></h3>
        <button onClick={() => setShowBooking(true)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <PT k="+ 예약" />
        </button>
      </div>
      {showBooking && (
        <TelehealthBookingForm
          onClose={() => setShowBooking(false)}
          onSuccess={() => {
            setShowBooking(false);
            refetch();
          }}
        />
      )}

      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : isLoading ? (
        <SkeletonCard lines={4} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon="📱"
          title="예약된 원격진료가 없습니다"
          description="화상, 음성, 비동기 상담을 예약하세요"
          actionLabel="원격진료 예약하기"
          onAction={() => setShowBooking(true)}
        />
      ) : (
        <div className="space-y-2">
          {sessions.map((s: PortalItem) => {
            const sStatus = String(s.status ?? '');
            const sId = String(s.id ?? '');
            const sSessionType = String(s.sessionType ?? '');
            const sScheduledAt = s.scheduledAt as string | undefined;
            const sChiefComplaint = s.chiefComplaint as string | undefined;
            const sRoomId = s.roomId as string | undefined;
            const sPatientRating = s.patientRating;
            const st = statusLabel[sStatus] ?? { text: sStatus, cls: 'bg-gray-100 text-gray-600' };
            const doctor = s.doctor as { familyName?: string; givenName?: string; department?: string } | undefined;
            return (
              <div key={sId} className="bg-white rounded-xl border p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">{typeLabel[sSessionType] ?? sSessionType}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.text}</span>
                    </div>
                    {doctor && (
                      <p className="text-xs text-gray-600 mt-0.5">
                        {doctor.familyName}
                        {doctor.givenName} ({doctor.department ?? ''})
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400">{sScheduledAt ? fmt(sScheduledAt) : ''}</span>
                </div>
                {sChiefComplaint && <p className="text-xs text-gray-500 mb-2">{sChiefComplaint}</p>}

                {/* 액션 */}
                {sStatus === 'SCHEDULED' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => joinMut.mutate(sId)}
                      disabled={joinMut.isPending}
                      className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {joinMut.isPending ? '입장 중...' : '대기실 입장'}
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await apiClient.patch(`/api/v1/portal/telehealth/${sId}/cancel`);
                          refetch();
                        } catch {
                          alert('취소 실패');
                        }
                      }}
                      className="px-3 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-red-50 hover:text-red-600"
                    >
                      취소
                    </button>
                  </div>
                )}
                {sStatus === 'WAITING' && !sRoomId && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
                    <p className="text-xs text-amber-700 font-medium"><PT k="대기 중입니다" /></p>
                    <p className="text-[10px] text-amber-600"><PT k="의사가 진료를 시작하면 자동으로 연결됩니다." /></p>
                  </div>
                )}
                {sStatus === 'IN_PROGRESS' && sRoomId && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center space-y-2">
                    <p className="text-xs text-emerald-700 font-bold flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <PT k="진료 진행 중" />
                    </p>
                    <button
                      onClick={() => openTelehealthRoom(sId, sRoomId)}
                      className="w-full py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 flex items-center justify-center gap-1.5"
                    >
                      <PT k="📹 화상 진료실 입장" />
                    </button>
                  </div>
                )}
                {sStatus === 'WAITING' && sRoomId && (
                  <button
                    onClick={() => openTelehealthRoom(sId, sRoomId)}
                    className="w-full py-2 mt-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                  >
                    <PT k="📹 화상 대기실 입장" />
                  </button>
                )}
                {sStatus === 'COMPLETED' &&
                  !sPatientRating &&
                  (ratingId === sId ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-1 justify-center">
                        {[1, 2, 3, 4, 5].map(v => (
                          <button key={v} onClick={() => setRating(v)} className={`text-lg ${v <= rating ? 'text-amber-400' : 'text-gray-300'}`}>
                            *
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
                        placeholder={tAttr('의견을 남겨주세요 (선택)')}
                        rows={2}
                        className="w-full px-3 py-2 border rounded-lg text-xs"
                      />
                      <button
                        onClick={() => rateMut.mutate({ id: sId, r: rating, f: feedback })}
                        className="w-full py-2 bg-amber-500 text-white text-xs rounded-lg"
                      >
                        <PT k="평가 제출" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setRatingId(sId)} className="w-full py-2 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 mt-2">
                      <PT k="진료 평가하기" />
                    </button>
                  ))}
                {!!sPatientRating && (
                  <p className="text-[10px] text-amber-500 mt-1">{'*'.repeat(sPatientRating as number)} 평가 완료</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TelehealthBookingForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const tAttr = usePortalTAttr();
  const [step, setStep] = useState(1);
  const [sessionType, setSessionType] = useState('VIDEO');
  const [department, setDepartment] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');

  const { data: deptData, isError: deptIsError, error: deptError, refetch: refetchDept } = useQuery({
    queryKey: ['portal-th-depts'],
    queryFn: () => apiClient.get<{ data: string[] }>('/api/v1/portal/telehealth-departments'),
  });
  const departments = (Array.isArray(deptData?.data) ? deptData.data : []) as string[];

  const { data: doctorData, isError: doctorIsError, error: doctorError, refetch: refetchDoctors } = useQuery({
    queryKey: ['portal-th-doctors', department],
    queryFn: () =>
      apiClient.get<{ data: { id: string; familyName?: string; givenName?: string; specialty?: string }[] }>(
        `/api/v1/portal/telehealth-doctors?department=${department}`,
      ),
    enabled: !!department,
  });
  const doctors = (Array.isArray(doctorData?.data) ? doctorData.data : []) as {
    id: string;
    familyName?: string;
    givenName?: string;
    specialty?: string;
  }[];

  const { data: slotData, isError: slotIsError, error: slotError, refetch: refetchSlots } = useQuery({
    queryKey: ['portal-th-slots', doctorId, selectedDate],
    queryFn: () =>
      apiClient.get<{ data: { time: string; available: boolean }[] }>(
        `/api/v1/portal/telehealth-slots?doctorId=${doctorId}&date=${selectedDate}`,
      ),
    enabled: !!doctorId && !!selectedDate,
  });
  const slots = (Array.isArray(slotData?.data) ? slotData.data : []) as { time: string; available: boolean }[];

  const bookMut = useMutation({
    mutationFn: () =>
      apiClient.post('/api/v1/portal/telehealth-book', {
        doctorId,
        scheduledAt: selectedSlot,
        sessionType,
        chiefComplaint: chiefComplaint || undefined,
      }),
    onSuccess: () => {
      toast.success('원격진료가 예약되었습니다!');
      onSuccess();
    },
    onError: () => toast.error('예약에 실패했습니다.'),
  });

  const typeOpts = [
    { key: 'VIDEO', label: '화상진료', desc: '실시간 영상 통화' },
    { key: 'AUDIO', label: '음성진료', desc: '전화 상담' },
    { key: 'ASYNC', label: '비동기 상담', desc: '메시지 + 사진 전송' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-blue-200 p-5 mb-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-gray-900"><PT k="원격진료 예약" /></h4>
        <button onClick={onClose} className="text-gray-400 text-lg">
          <span aria-hidden="true">&times;</span><span className="sr-only"><PT k="닫기" /></span>
        </button>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className={`flex-1 h-1 rounded-full ${step >= s ? 'bg-blue-500' : 'bg-gray-200'}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500"><PT k="1. 진료 유형 선택" /></p>
          {typeOpts.map(t => (
            <button
              key={t.key}
              onClick={() => {
                setSessionType(t.key);
                setStep(2);
              }}
              className={`w-full text-left p-3 rounded-xl border ${
                sessionType === t.key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-medium">{t.label}</p>
              <p className="text-[10px] text-gray-500">{t.desc}</p>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500"><PT k="2. 진료과 / 의사 선택" /></p>
          <select
            value={department}
            onChange={e => {
              setDepartment(e.target.value);
              setDoctorId('');
            }}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          >
            <option value=""><PT k="진료과 선택" /></option>
            {departments.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {/* 🔴 진료과 목록 조회 실패를 "진료과 없음"으로 말하지 않는다 */}
          {deptIsError && <QueryErrorFallback error={deptError} onRetry={refetchDept} size="compact" />}
          {/* 🔴 (포털 A6) 의료진 조회 실패를 빈 목록(고를 의사가 없음)으로 그리지 않는다 */}
          {department && doctorIsError && <QueryErrorFallback error={doctorError} onRetry={() => refetchDoctors()} size="compact" />}
          {department &&
            doctors.map(d => (
              <button
                key={d.id}
                onClick={() => {
                  setDoctorId(d.id);
                  setStep(3);
                }}
                className={`w-full text-left p-3 rounded-xl border ${
                  doctorId === d.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <p className="text-sm font-medium">
                  {d.familyName}
                  {d.givenName}
                </p>
                {d.specialty && <p className="text-[10px] text-gray-500">{d.specialty}</p>}
              </button>
            ))}
          <button onClick={() => setStep(1)} className="text-xs text-gray-400">
            <PT k="← 이전" />
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500"><PT k="3. 날짜 / 시간 선택" /></p>
          <input
            type="date"
            value={selectedDate}
            onChange={e => {
              setSelectedDate(e.target.value);
              setSelectedSlot('');
            }}
            min={kstToday()}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          {selectedDate && slotIsError && <QueryErrorFallback error={slotError} onRetry={() => refetchSlots()} size="compact" />}
          {selectedDate && slots.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {slots.map(s => (
                <button
                  key={s.time}
                  onClick={() => {
                    if (s.available) setSelectedSlot(s.time);
                  }}
                  disabled={!s.available}
                  className={`py-2 rounded-lg text-xs font-medium ${
                    selectedSlot === s.time
                      ? 'bg-blue-600 text-white'
                      : s.available
                        ? 'bg-gray-100 text-gray-700 hover:bg-blue-50'
                        : 'bg-gray-50 text-gray-300'
                  }`}
                >
                  {portalDateText(s.time, 'time')}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="text-xs text-gray-400">
              <PT k="← 이전" />
            </button>
            {selectedSlot && (
              <button onClick={() => setStep(4)} className="ml-auto px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg">
                <PT k="다음 →" />
              </button>
            )}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500"><PT k="4. 증상 입력 / 예약 확정" /></p>
          <div className="bg-blue-50 rounded-xl p-3 text-xs space-y-1">
            <p>
              <span className="text-gray-500"><PT k="유형:" /></span> {typeOpts.find(t => t.key === sessionType)?.label}
            </p>
            <p>
              <span className="text-gray-500"><PT k="의사:" /></span> {doctors.find(d => d.id === doctorId)?.familyName}
              {doctors.find(d => d.id === doctorId)?.givenName}
            </p>
            <p>
              <span className="text-gray-500"><PT k="일시:" /></span>{' '}
              {portalDateText(selectedSlot, 'monthDayTime')}
            </p>
          </div>
          <textarea
            value={chiefComplaint}
            onChange={e => setChiefComplaint(e.target.value)}
            rows={3}
            placeholder={tAttr('증상, 문의사항 (선택)')}
            className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
          />
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="text-xs text-gray-400">
              <PT k="← 이전" />
            </button>
            <button
              onClick={() => bookMut.mutate()}
              disabled={bookMut.isPending}
              className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50"
            >
              {bookMut.isPending ? '예약 중...' : '원격진료 예약 확정'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   세그먼트 4: 병원안내 (hospital-info)
   ═══════════════════════════════════════════════════════════════ */

interface HospitalInfoItem {
  id: string;
  category: string;
  slug: string;
  title: string;
  content: string;
  tags: string[];
  isPinned: boolean;
  updatedAt: string;
  metadata?: {
    contactInfo?: { address?: string; phone?: string; fax?: string; emergencyPhone?: string };
    mapCoords?: { lat: number; lng: number };
    [k: string]: unknown;
  };
}

// 환자 포털에 노출할 카테고리만 큐레이션 (홈페이지 전용 BANNER/STRIP/GALLERY/CSR/RECRUIT 제외)
const PORTAL_CATEGORIES: { value: string; label: string; icon: string }[] = [
  { value: 'GENERAL', label: '일반안내', icon: 'ℹ️' },
  { value: 'DEPARTMENT', label: '진료과', icon: '🩺' },
  { value: 'CENTER', label: '전문센터', icon: '🏥' },
  { value: 'NEWS', label: '소식/공지', icon: '📢' },
  { value: 'HEALTH_INFO', label: '건강정보', icon: '💡' },
  { value: 'CHECKUP_INFO', label: '검진안내', icon: '📋' },
  { value: 'FACILITY', label: '시설', icon: '🏛️' },
  { value: 'PARKING', label: '주차', icon: '🅿️' },
  { value: 'DINING', label: '식당/카페', icon: '🍴' },
  { value: 'FAQ', label: 'FAQ', icon: '❓' },
  { value: 'NON_COVERED', label: '비급여', icon: '💳' },
  { value: 'FUNERAL', label: '장례식장', icon: '🕯️' },
];
const PORTAL_CAT_SET = new Set(PORTAL_CATEGORIES.map(c => c.value));
const CAT_META: Record<string, { label: string; icon: string }> = Object.fromEntries(
  PORTAL_CATEGORIES.map(c => [c.value, { label: c.label, icon: c.icon }]),
);

function HospitalInfoSegment() {
  const tAttr = usePortalTAttr();
  const [infoFilter, setInfoFilter] = useState('');
  const { data: infoRes, isLoading, isError: infoIsError, error: infoError, refetch: refetchInfo } = useQuery({
    queryKey: ['public-hospital-info'],
    queryFn: () => apiClient.get<{ data: HospitalInfoItem[] }>(`/api/v1/public/hospital-info`),
  });

  // 환자 관련 카테고리만 + directions(핵심카드로 분리)는 목록에서 제외
  const allItems = (infoRes?.data ?? []).filter(i => PORTAL_CAT_SET.has(i.category));
  const directions = (infoRes?.data ?? []).find(i => i.category === 'GENERAL' && i.slug === 'directions');
  const contact = directions?.metadata?.contactInfo;

  // 실제 콘텐츠가 있는 카테고리만 필터 칩으로 노출
  const availableCats = PORTAL_CATEGORIES.filter(c => allItems.some(i => i.category === c.value));
  const listItems = allItems
    .filter(i => !(i.category === 'GENERAL' && i.slug === 'directions'))
    .filter(i => !infoFilter || i.category === infoFilter);

  // 🔴 (포털 A6) 주소를 모르면 지도 링크를 내지 않는다 — 종전엔 상수 주소로 지도를 열었다(화면이 값을 지어내지 않는다)
  const mapQuery = contact?.address ? encodeURIComponent(contact.address) : null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-gray-900"><PT k="병원 안내" /></h3>

      {/* 핵심 정보 카드 */}
      {contact && (
        <div className="bg-gradient-to-br from-blue-600 to-blue-500 rounded-2xl p-4 text-white shadow-sm">
          <div className="flex items-start gap-2.5">
            <span className="text-lg leading-none mt-0.5">📍</span>
            <div className="min-w-0">
              <p className="text-[11px] text-blue-100 font-medium"><PT k="주소" /></p>
              <p className="text-sm font-semibold leading-snug">{contact.address}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            {contact.phone && (
              <a
                href={`tel:${contact.phone.replace(/[^0-9]/g, '')}`}
                className="flex items-center justify-center gap-1.5 bg-white/15 hover:bg-white/25 rounded-xl py-2 text-xs font-semibold transition"
              >
                <span>📞</span>
                <span className="whitespace-nowrap"><PT k="대표전화" /></span>
              </a>
            )}
            {contact.emergencyPhone && (
              <a
                href={`tel:${contact.emergencyPhone.replace(/[^0-9]/g, '')}`}
                className="flex items-center justify-center gap-1.5 bg-red-500/90 hover:bg-red-500 rounded-xl py-2 text-xs font-semibold transition"
              >
                <span>🚑</span>
                <span className="whitespace-nowrap"><PT k="응급실" /></span>
              </a>
            )}
          </div>
          {contact.phone && <p className="text-[11px] text-blue-100 mt-2 text-center">{contact.phone}</p>}

          {/* 지도 바로가기 */}
          {mapQuery && <div className="grid grid-cols-3 gap-2 mt-3">
            <a
              href={`https://map.naver.com/v5/search/${mapQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center bg-white/15 hover:bg-white/25 rounded-xl py-1.5 text-[11px] font-medium transition"
            >
              <PT k="네이버지도" />
            </a>
            <a
              href={`https://map.kakao.com/link/search/${mapQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center bg-white/15 hover:bg-white/25 rounded-xl py-1.5 text-[11px] font-medium transition"
            >
              <PT k="카카오맵" />
            </a>
            <a
              href={`https://www.google.com/maps/search/${mapQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center bg-white/15 hover:bg-white/25 rounded-xl py-1.5 text-[11px] font-medium transition"
            >
              <PT k="구글지도" />
            </a>
          </div>}

          {/* 교통편 안내 */}
          {directions?.content && (
            <details className="mt-3 group">
              <summary className="flex items-center justify-center gap-1 cursor-pointer text-[11px] text-blue-100 hover:text-white transition">
                <span><PT k="🚍 교통편 안내" /></span>
                <svg className="w-3 h-3 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="text-[11px] text-blue-50 whitespace-pre-wrap leading-relaxed mt-2 bg-white/10 rounded-xl p-3">
                {directions.content}
              </div>
            </details>
          )}
        </div>
      )}

      {/* 카테고리 필터 */}
      {availableCats.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setInfoFilter('')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
              infoFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            <PT k="전체" />
          </button>
          {availableCats.map(c => (
            <button
              key={c.value}
              onClick={() => setInfoFilter(c.value)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                infoFilter === c.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <SkeletonCard lines={5} />
      ) : infoIsError ? (
        <QueryErrorFallback error={infoError} onRetry={() => refetchInfo()} size="compact" />
      ) : listItems.length === 0 ? (
        <EmptyState icon="ℹ️" title="등록된 정보가 없습니다" />
      ) : (
        <div className="space-y-2">
          {listItems.map(item => (
            <details key={item.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden group">
              <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition">
                <span className="text-base flex-shrink-0">{CAT_META[item.category]?.icon ?? 'ℹ️'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {item.isPinned && (
                      <span className="text-[9px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold whitespace-nowrap"><PT k="공지" /></span>
                    )}
                    <span className="text-sm font-semibold text-gray-900 truncate">{item.title}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{CAT_META[item.category]?.label ?? item.category}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-4 pb-4 pt-1 border-t border-gray-50">
                <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{item.content}</div>
                <div className="text-[10px] text-gray-300 mt-2">최종 수정: {portalDateText(item.updatedAt, 'date')}</div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   세그먼트: 사전승인 신청 (pre-auth) — 환자 신청 → 원무 접수 → 주치의 승인
   ═══════════════════════════════════════════════════════════════ */

function PreAuthSegment() {
  const tAttr = usePortalTAttr();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{ type: string; note: string }>({ type: 'PORTAL_REFILL', note: '' });
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-preauth'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/pre-auth'),
  });
  const raw = data?.data;
  const items = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const TYPE_LABEL: Record<string, string> = {
    PORTAL_REFILL: '재처방(리필)',
    PORTAL_TEST: '검사 신청',
    PORTAL_REFERRAL: '진료의뢰·소견',
    PORTAL_CONSULT: '시술·수술 상담',
  };
  const STATUS_MAP: Record<string, { label: string; cls: string }> = {
    PENDING: { label: '검토 중(원무·주치의)', cls: 'bg-blue-100 text-blue-700' },
    APPROVED: { label: '승인', cls: 'bg-green-100 text-green-700' },
    FULFILLED: { label: '처리완료', cls: 'bg-green-100 text-green-700' },
    REJECTED: { label: '반려', cls: 'bg-red-100 text-red-600' },
    CANCELLED: { label: '취소', cls: 'bg-gray-100 text-gray-600' },
  };

  const handleSubmit = async () => {
    if (!form.note.trim()) { toast.error('요청 내용을 입력하세요.'); return; }
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/portal/pre-auth', { type: form.type, note: form.note.trim() });
      toast.success('사전승인 신청이 접수되었습니다. 원무 접수 후 주치의 승인을 거칩니다.');
      setShowForm(false);
      setForm({ type: 'PORTAL_REFILL', note: '' });
      refetch();
    } catch (e) {
      toast.error((e as { message?: string })?.message || '신청에 실패했습니다. 최근 진료 기록이 필요할 수 있습니다.');
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm"><PT k="사전승인 신청" /></h3>
          <p className="text-xs text-gray-500 mt-0.5"><PT k="재처방·검사·진료의뢰·시술상담을 신청하면 원무 접수 → 주치의 승인을 거칩니다." /></p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">
          {showForm ? '닫기' : '+ 신청'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div>
            <label className="text-sm font-medium"><PT k="신청 종류" /></label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium"><PT k="요청 내용" /></label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} maxLength={500}
              placeholder="예: 고혈압약(암로디핀) 재처방 요청합니다 / 공복혈당 검사 희망"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <p className="text-[11px] text-gray-400">※ 신청은 진료를 대체하지 않으며, 주치의 판단에 따라 승인·반려될 수 있습니다.</p>
          <button onClick={handleSubmit} disabled={submitting} className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm disabled:opacity-50">
            {submitting ? '접수 중…' : '신청하기'}
          </button>
        </div>
      )}

      {isLoading ? <SkeletonCard /> : isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /> : items.length === 0 ? (
        <EmptyState icon="🩺" title="사전승인 신청 내역이 없습니다." />
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const item = it as unknown as { id: string; type: string; status: string; payload?: { note?: string }; createdAt?: string; decidedAt?: string };
            const st = STATUS_MAP[item.status] ?? { label: item.status, cls: 'bg-gray-100 text-gray-600' };
            return (
              <div key={item.id} className="bg-white rounded-xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{TYPE_LABEL[item.type] ?? item.type}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs ${st.cls}`}>{st.label}</span>
                </div>
                {item.payload?.note && <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{item.payload.note}</p>}
                <p className="text-[11px] text-gray-400 mt-2">신청 {fmt(item.createdAt)}{item.decidedAt ? ` · 처리 ${fmt(item.decidedAt)}` : ''}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   세그먼트: 나의 문의 (VoC — 고객의 소리)
   ═══════════════════════════════════════════════════════════════ */

interface VocTicketItem {
  id: string; ticketNo: string; type: string; status: string; severity: string;
  title: string; department?: string | null; dueAt?: string | null;
  firstResponseAt?: string | null; closedAt?: string | null; createdAt: string; messageCount?: number;
  ratingScore?: number | null;
}
interface VocMessageItem { id: string; authorType: string; authorName?: string | null; body: string; createdAt: string; }

const VOC_TYPE_LABEL: Record<string, string> = { QUESTION: '질문', COMPLAINT: '불만', SUGGESTION: '건의', COMPLIMENT: '칭찬' };
const VOC_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  RECEIVED: { label: '접수', cls: 'bg-blue-100 text-blue-700' },
  TRIAGED: { label: '분류완료', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '처리중', cls: 'bg-amber-100 text-amber-700' },
  ANSWERED: { label: '답변완료', cls: 'bg-green-100 text-green-700' },
  ON_HOLD: { label: '보류', cls: 'bg-gray-100 text-gray-600' },
  CLOSED: { label: '종결', cls: 'bg-gray-100 text-gray-600' },
  REOPENED: { label: '재문의', cls: 'bg-amber-100 text-amber-700' },
};

function VocSegment() {
  const tAttr = usePortalTAttr();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{ type: string; title: string; body: string }>({ type: 'QUESTION', title: '', body: '' });
  const [submitting, setSubmitting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-voc'],
    queryFn: () => apiClient.get<{ data: VocTicketItem[] }>('/api/v1/portal/voc'),
  });
  const raw = data?.data;
  const items = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as unknown as VocTicketItem[];

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast.error('제목을 입력하세요.'); return; }
    if (!form.body.trim()) { toast.error('문의 내용을 입력하세요.'); return; }
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/portal/voc/tickets', { type: form.type, title: form.title.trim(), body: form.body.trim(), consent: true });
      toast.success('문의가 접수되었습니다. 답변은 이 화면과 알림으로 안내드립니다.');
      setShowForm(false);
      setForm({ type: 'QUESTION', title: '', body: '' });
      refetch();
    } catch (e) {
      toast.error((e as { message?: string })?.message || '접수에 실패했습니다.');
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900"><PT k="나의 문의" /></h3>
          <p className="text-xs text-gray-500"><PT k="병원에 질문·건의·불만·칭찬을 남기고 답변을 받아보세요." /></p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="shrink-0 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <PT k="+ 새 문의" />
        </button>
      </div>

      {isLoading ? <SkeletonCard /> : isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /> : items.length === 0 ? (
        <EmptyState icon="💬" title="접수한 문의가 없습니다." />
      ) : (
        <div className="space-y-2">
          {items.map((t) => {
            const st = VOC_STATUS_MAP[t.status] ?? { label: t.status, cls: 'bg-gray-100 text-gray-600' };
            return (
              <button key={t.id} onClick={() => setOpenId(t.id)}
                className="w-full text-left bg-white border border-gray-100 rounded-xl p-3 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">{VOC_TYPE_LABEL[t.type] ?? '문의'}</span>
                    <span className="text-sm font-medium text-gray-900 truncate">{t.title}</span>
                  </div>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${st.cls}`}>{st.label}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                  <span>{t.ticketNo}</span>
                  <span>·</span>
                  <span>{fmt(t.createdAt)}</span>
                  {t.dueAt && t.status !== 'CLOSED' && <><span>·</span><span>답변 예정 {fmt(t.dueAt)}</span></>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 새 문의 폼 */}
      <PortalSheet open={showForm} onClose={() => setShowForm(false)} title={tAttr('새 문의 남기기')}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><PT k="유형" /></label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['QUESTION', 'COMPLAINT', 'SUGGESTION', 'COMPLIMENT'] as const).map((k) => (
                <button key={k} onClick={() => setForm((f) => ({ ...f, type: k }))}
                  className={`py-2 text-xs rounded-lg border transition-colors ${form.type === k ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {VOC_TYPE_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><PT k="제목" /></label>
            <input value={form.title} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={tAttr('문의 제목')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><PT k="내용" /></label>
            <textarea value={form.body} rows={5} maxLength={5000} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder={tAttr('문의 내용을 자세히 적어주세요.')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" />
          </div>
          <p className="text-[10px] text-gray-400">접수 시 개인정보 수집·이용에 동의한 것으로 처리됩니다. 답변은 포털 알림으로 안내드립니다.</p>
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {submitting ? '접수 중...' : '문의 접수'}
          </button>
        </div>
      </PortalSheet>

      {/* 상세 스레드 */}
      <VocDetailSheet ticketId={openId} onClose={() => setOpenId(null)} onChanged={refetch} />
    </div>
  );
}

interface VocAttachmentItem { id: string; url: string; fileName: string }
const VOC_API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function VocDetailSheet({ ticketId, onClose, onChanged }: { ticketId: string | null; onClose: () => void; onChanged: () => void }) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-voc', ticketId],
    queryFn: () => apiClient.get<{ data: VocTicketItem & { messages: VocMessageItem[]; attachments?: VocAttachmentItem[] } }>(`/api/v1/portal/voc/${ticketId}`),
    enabled: !!ticketId,
  });
  const rawD = data?.data as unknown;
  const t = (rawD && typeof rawD === 'object' && 'data' in (rawD as object)
    ? (rawD as { data: VocTicketItem & { messages: VocMessageItem[]; attachments?: VocAttachmentItem[] } }).data
    : rawD) as (VocTicketItem & { messages: VocMessageItem[]; attachments?: VocAttachmentItem[] }) | undefined;

  const handleUpload = async (file: File) => {
    if (!file || !ticketId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${VOC_API_BASE}/api/v1/portal/voc/${ticketId}/attachment`, { method: 'POST', headers: { Authorization: `Bearer ${apiClient.getToken()}` }, body: fd });
      if (!res.ok) throw new Error('업로드 실패');
      toast.success('첨부가 추가되었습니다.');
      refetch();
    } catch { toast.error('첨부 업로드에 실패했습니다(이미지/PDF, 5MB).'); }
    setUploading(false);
  };

  const handleReply = async () => {
    if (!reply.trim() || !ticketId) return;
    setSending(true);
    try {
      await apiClient.post(`/api/v1/portal/voc/${ticketId}/messages`, { body: reply.trim() });
      setReply('');
      refetch();
      onChanged();
    } catch (e) {
      toast.error((e as { message?: string })?.message || '전송에 실패했습니다.');
    }
    setSending(false);
  };

  const st = t ? (VOC_STATUS_MAP[t.status] ?? { label: t.status, cls: 'bg-gray-100 text-gray-600' }) : null;

  return (
    <PortalSheet open={!!ticketId} onClose={onClose} title={t ? t.title : '문의 상세'}>
      {/* 🔴 (포털 A6) 실패를 영구 로딩으로 굳히지 않는다 */}
      {isError && !t ? <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /> : isLoading || !t ? <SkeletonCard /> : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
            <span>{t.ticketNo}</span>
            {st && <span className={`px-1.5 py-0.5 rounded font-medium ${st.cls}`}>{st.label}</span>}
          </div>
          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {(t.messages ?? []).map((m) => {
              const mine = m.authorType === 'PATIENT';
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-gray-100 text-gray-800 rounded-bl-md'}`}>
                    {!mine && <p className="text-[10px] font-semibold text-gray-500 mb-0.5">{m.authorType === 'AI' ? `${AI_ORIGIN_TEXT}` : (m.authorName || '담당자')}</p>}
                    <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    <p className={`text-[9px] mt-1 ${mine ? 'text-blue-200' : 'text-gray-400'}`}>{fmtTime(m.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {/* 첨부 */}
          {(t.attachments?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {t.attachments!.map((a) => (
                /\.(png|jpe?g|webp)$/i.test(a.url)
                  ? <a key={a.id} href={`${VOC_API_BASE}${a.url}`} target="_blank" rel="noopener">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`${VOC_API_BASE}${a.url}`} alt={a.fileName} className="w-16 h-16 object-cover rounded-lg border border-gray-200" /></a>
                  : <a key={a.id} href={`${VOC_API_BASE}${a.url}`} target="_blank" rel="noopener" className="text-xs text-blue-600 underline px-2 py-1 bg-blue-50 rounded-lg">📎 {a.fileName}</a>
              ))}
            </div>
          )}

          <div>
            <label className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg cursor-pointer ${uploading ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {uploading ? '업로드 중...' : '📎 파일 첨부'}
              <input type="file" accept="image/*,application/pdf" disabled={uploading} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
            </label>
          </div>

          {/* 답변 만족도 — ANSWERED/CLOSED일 때 */}
          {(t.status === 'ANSWERED' || t.status === 'CLOSED') && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-1">{t.ratingScore ? '평가해 주셔서 감사합니다' : '답변이 도움이 되었나요?'}</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} disabled={!!t.ratingScore}
                    onClick={async () => {
                      try { await apiClient.post(`/api/v1/portal/voc/${ticketId}/rating`, { score: n }); toast.success('평가가 등록되었습니다.'); refetch(); onChanged(); }
                      catch (e) { toast.error((e as { message?: string })?.message || '평가 등록 실패'); }
                    }}
                    className={`text-xl transition-colors ${(t.ratingScore ?? 0) >= n ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}>★</button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <input value={reply} onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleReply()}
              placeholder={t.status === 'CLOSED' ? '추가 문의 시 다시 열립니다' : '추가 문의 입력'}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            <button onClick={handleReply} disabled={sending || !reply.trim()}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"><PT k="전송" /></button>
          </div>
        </div>
      )}
    </PortalSheet>
  );
}

/** 포털 서류 진행 단계 — 상태만으로(환자 화면은 동결본·서명 세부를 모른다) · 반려는 멈춘 단계를 표시 */
export const PORTAL_DOC_STEPS: Array<[string, string[]]> = [
  ['신청', ['REQUESTED', 'IN_REVIEW', 'PROCESSING', 'READY', 'DELIVERED']],
  ['처리 중', ['IN_REVIEW', 'PROCESSING', 'READY', 'DELIVERED']],
  ['발급 완료', ['READY', 'DELIVERED']],
  ['수령', ['DELIVERED']],
];
function PortalDocSteps({ status }: { status: string }) {
  if (!status) return null;
  const rejected = status === 'REJECTED';
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-1 text-[10px]" data-portal-doc-steps={status}>
      {PORTAL_DOC_STEPS.map(([label, doneIn], i) => {
        const done = rejected ? i === 0 : doneIn.includes(status);
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-300">›</span>}
            <span className={`rounded-full px-1.5 py-0.5 ${done ? 'bg-emerald-100 text-emerald-800 font-semibold' : 'bg-gray-100 text-gray-400'}`}><PT k={label} /></span>
          </li>
        );
      })}
      {rejected && <li className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-700"><PT k="반려" /></li>}
    </ol>
  );
}
