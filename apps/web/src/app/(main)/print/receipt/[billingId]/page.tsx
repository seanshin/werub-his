'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { safeFormat as format } from '@/lib/safe-date';
import { copayLabel, copayKind } from '@/lib/billing/copay-category';
import { money } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { paymentMethodLabel, RECEIPT_CLASSES, receiptClassOf, type ReceiptClassKey } from '@hospital-run/shared';

type ReceiptTab = 'receipt' | 'detail' | 'annual' | 'noncovered';

interface BillingItem {
  id?: string;
  type?: string;
  category?: string;
  code?: string;
  ediCode?: string;
  name?: string;
  description?: string;
  unitPrice?: number;
  price?: number;
  quantity?: number;
  totalPrice?: number;
  amount?: number;
  insuranceType?: string;
  coverageType?: string;
  consentSigned?: boolean;
  copayRate?: number | string; // 라인별 본인부담률
  fullCopay?: boolean; // 급여 100/100 전액본인부담 라인
  receiptClass?: ReceiptClassKey | null; // 서버가 정한 법정 항목(P2-1) · null = 분류 미등재
}

interface BillingData {
  id?: string;
  items?: BillingItem[];
  prescriptions?: BillingItem[];
  patient?: { familyName?: string; givenName?: string; mrn?: string; insuranceType?: string };
  encounter?: { patient?: { familyName?: string; givenName?: string; mrn?: string; insuranceType?: string }; signedAt?: string; createdAt?: string };
  copayCategory?: string | null; eligibilityStatus?: string | null; specialExemption?: string | null;
  totalAmount?: number;
  total?: number;
  insuranceCovered?: number;
  patientCopay?: number;
  copay?: number;
  paidAmount?: number;
  receiptNo?: string;
  createdAt?: string;
  encounterType?: string;
  paymentMethod?: string;
  payments?: { method: string; amount: number; cardApprovalNo?: string | null; cashReceiptNo?: string | null }[];
  cardApprovalNo?: string;
  cashReceiptNo?: string;
  cashReceiptType?: string;
  discountAmount?: number;
  discountReason?: string;
  status?: string;
}

interface MonthlyData {
  month: number;
  outpatientCount?: number;
  outpatientAmount?: number;
  /** 입원 일수 — 수납 원장으로 알 수 없어 서버가 null 로 준다(P4-5 · 지어내지 않는다) */
  inpatientDays?: number | null;
  inpatientAmount?: number;
}

interface HospitalInfo { name: string; code: string; bizNo: string; ceo: string; license: string; phone: string; address: string; grade: string; ceoSignature: string; }

export default function ReceiptPrintPage({ params }: { params: Promise<{ billingId: string }> }) {
  const { billingId } = use(params);
  const [tab, setTab] = useState<ReceiptTab>('receipt');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['billing-receipt', billingId],
    queryFn: () => apiClient.get<Record<string, unknown>>(`/api/v1/billings/${billingId}/receipt`).catch(() =>
      apiClient.get<Record<string, unknown>>(`/api/v1/billings/${billingId}`)
    ),
  });

  // 🔴 (2026-10-14 수납·청구 결함 발굴 P4-5) 종전엔 환자 포털 EP(`/portal/medical-expenses`)를 직원 계정으로 불러 늘 401 이었고
  //    (환자도 지정하지 않았다) 응답 모양도 서식 칸과 달라 0 이었다. 원무 EP 로 이 청구의 환자를 지정해 받는다.
  const receiptPatientId = (() => {
    const raw = data?.data as { patient?: { id?: string }; patientId?: string; data?: { patient?: { id?: string }; patientId?: string } } | undefined;
    return raw?.patient?.id ?? raw?.patientId ?? raw?.data?.patient?.id ?? raw?.data?.patientId ?? null;
  })();
  const annualYear = new Date().getFullYear();
  const { data: annualData, isError: annualIsError, error: annualError, refetch: refetchAnnual } = useQuery({
    queryKey: ['billing-annual', receiptPatientId, annualYear],
    queryFn: () => apiClient.get<Record<string, unknown>>(`/api/v1/billing/patients/${receiptPatientId}/annual-payment?year=${annualYear}`),
    enabled: tab === 'annual' && !!receiptPatientId,
  });

  const { data: cfgData, isError: cfgIsError, error: cfgError, refetch: refetchCfg } = useQuery({
    queryKey: ['receipt-hospital-config'],
    queryFn: () => apiClient.get<Record<string, unknown>>('/api/v1/config'),
  });
  const cfgList = (Array.isArray(cfgData?.data) ? cfgData.data : ((cfgData?.data as Record<string, unknown>)?.data ?? [])) as { key: string; value: unknown }[];
  const cfg: Record<string, unknown> = {};
  cfgList.forEach((c) => { cfg[c.key] = c.value; });
  const GRADE_LABEL: Record<string, string> = { CLINIC: '의원', HOSPITAL: '병원', GENERAL: '종합병원', TERTIARY: '상급종합병원' };
  const hospital: HospitalInfo = {
    name: String(cfg['hospital.name'] ?? 'Hospital RUN 병원'),
    code: String(cfg['hospital.code'] ?? '-'),
    bizNo: String(cfg['hospital.bizNo'] ?? '-'),
    ceo: String(cfg['hospital.ceo'] ?? ''),
    license: String(cfg['hospital.license'] ?? ''),
    phone: String(cfg['hospital.phone'] ?? '-'),
    address: String(cfg['hospital.address'] ?? '-'),
    grade: GRADE_LABEL[String(cfg['billing.institution.grade'] ?? 'CLINIC')] ?? '의원',
    ceoSignature: String(cfg['hospital.ceoSignatureKey'] ?? ''),
  };

  const _raw = data?.data as Record<string, unknown>;
  const billing = (_raw?.data ?? _raw) as BillingData | undefined;

  // 진료일 공휴일 여부(holiday 캘린더) — 야간/공휴일 판정 정밀화
  const treatedDate = (billing?.encounter?.signedAt ?? billing?.encounter?.createdAt ?? billing?.createdAt)?.slice(0, 10);
  const { data: holidayData, isError: holidayIsError, error: holidayError, refetch: refetchHoliday } = useQuery({
    queryKey: ['receipt-holiday', treatedDate],
    queryFn: () => apiClient.get<{ data: { isHoliday?: boolean } }>(`/api/v1/holidays/check?date=${treatedDate}`),
    enabled: !!treatedDate,
  });
  const isHolidayDate = !!holidayData?.data?.isHoliday;

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">영수증을 불러오는 중...</p></div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (!billing) return <div className="flex flex-col items-center justify-center min-h-screen gap-4"><p className="text-red-500">영수증 데이터를 불러올 수 없습니다.</p><Link href="/billing" className="text-blue-600 hover:underline text-sm">돌아가기</Link></div>;

  const patient = billing.patient ?? billing.encounter?.patient;
  const patientName = patient ? `${patient.familyName ?? ''}${patient.givenName ?? ''}` : '-';
  const totalAmount = billing.totalAmount ?? billing.total ?? 0;
  const insuranceCovered = billing.insuranceCovered ?? 0;
  const copay = billing.patientCopay ?? billing.copay ?? 0;
  const paidAmount = billing.paidAmount ?? 0;
  const receiptNo = billing.receiptNo ?? `RCP-${new Date().getFullYear()}-${billingId.slice(-6).toUpperCase()}`;

  return (
    <>
      <style jsx global>{`
        @media print {
          body { margin: 0; padding: 0; font-size: 10px; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 10mm; }
          .receipt-container { box-shadow: none !important; border: 1px solid #000 !important; padding: 12px !important; }
          .receipt-container h1 { font-size: 14px !important; margin-bottom: 2px !important; }
          .receipt-container table { font-size: 9px !important; }
          .receipt-container td, .receipt-container th { padding: 2px 4px !important; }
          .receipt-container .space-y-3 > * + * { margin-top: 4px !important; }
          .receipt-container .mb-4 { margin-bottom: 6px !important; }
          .receipt-container .mb-6 { margin-bottom: 8px !important; }
          .receipt-container .p-3 { padding: 6px !important; }
        }
      `}</style>

      {/* 인쇄 버튼 */}
      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-lg">인쇄</button>
        <Link href="/billing" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 shadow-lg">돌아가기</Link>
      </div>

      {/* 영수증 종류 탭 */}
      <div className="no-print max-w-3xl mx-auto mt-4 mb-2 flex gap-1 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'receipt' as ReceiptTab, label: '계산서\u00B7영수증' },
          { key: 'detail' as ReceiptTab, label: '세부산정내역서' },
          { key: 'annual' as ReceiptTab, label: '납입확인서' },
          { key: 'noncovered' as ReceiptTab, label: '비급여 내역서' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-3xl mx-auto p-4">
        {/* 🔴 병원 정보·공휴일 판정을 못 읽은 채로 영수증을 "정상 발행분"처럼 찍지 않는다 */}
        {cfgIsError && <div className="no-print mb-3"><QueryErrorFallback error={cfgError} onRetry={refetchCfg} size="compact" /></div>}
        {holidayIsError && <div className="no-print mb-3"><QueryErrorFallback error={holidayError} onRetry={refetchHoliday} size="compact" /></div>}
        {tab === 'receipt' && <ReceiptMain billing={billing} patientName={patientName} totalAmount={totalAmount} insuranceCovered={insuranceCovered} copay={copay} paidAmount={paidAmount} receiptNo={receiptNo} hospital={hospital} isHolidayDate={isHolidayDate} />}
        {tab === 'detail' && <DetailStatement billing={billing} patientName={patientName} receiptNo={receiptNo} hospital={hospital} />}
        {/* 🔴 조회 실패로 12개월 0원짜리 납입확인서를 찍지 않는다 */}
        {tab === 'annual' && (annualIsError
          ? <QueryErrorFallback error={annualError} onRetry={refetchAnnual} />
          : <AnnualStatement patientName={patientName} annualData={annualData?.data as { monthly?: MonthlyData[]; data?: { monthly?: MonthlyData[] } } | undefined} hospital={hospital} />)}
        {tab === 'noncovered' && <NonCoveredStatement billing={billing} patientName={patientName} hospital={hospital} />}
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 1. ReceiptMain — 진료비 계산서·영수증 (의료법 시행규칙 별지 제11호)
 * ───────────────────────────────────────────────────────────── */
function ReceiptMain({ billing, patientName, totalAmount, insuranceCovered, copay, paidAmount, receiptNo, hospital, isHolidayDate }: { billing: BillingData; patientName: string; totalAmount: number; insuranceCovered: number; copay: number; paidAmount: number; receiptNo: string; hospital: HospitalInfo; isHolidayDate?: boolean }) {
  const items = billing.items ?? billing.prescriptions ?? [];
  const isFullCopay = billing.eligibilityStatus === 'EXPIRED' || billing.eligibilityStatus === 'NOT_FOUND' || billing.copayCategory === 'SELF_PAY';

  // 진위확인 발급(IssuedDocument RECEIPT) — 멱등. QR/발급번호 표시용
  const { data: issuedRes, isError: issuedIsError, error: issuedError, refetch: refetchIssued } = useQuery({
    queryKey: ['receipt-issue', billing.id],
    queryFn: () => apiClient.post<{ data: { issueNo: string; qrUrl?: string; qrDataUrl?: string } }>(`/api/v1/billings/${billing.id}/issue-receipt`, {}),
    enabled: !!billing.id,
    staleTime: Infinity,
  });
  const issued = (issuedRes?.data ?? (issuedRes as { issueNo?: string } | null)) as { issueNo?: string; qrUrl?: string; qrDataUrl?: string } | null | undefined;
  // 야간(공휴일) 진료 판정 — 진료시각(서명) 기준 18:00~익일 09:00, 주말, 또는 법정공휴일(캘린더)
  const encTime = billing.encounter?.signedAt ?? billing.encounter?.createdAt ?? billing.createdAt;
  const treatedAt = encTime ? new Date(encTime) : null;
  const hr = treatedAt?.getHours() ?? 12;
  const dow = treatedAt?.getDay() ?? 1;
  const isNightHoliday = hr >= 18 || hr < 9 || dow === 0 || dow === 6 || !!isHolidayDate;

  // 법정 13개 항목 분류 (의료법 시행규칙 별지 제11호) — 정본 shared `RECEIPT_CLASSES`.
  // 🔴 (P2-1) 칸은 서버가 라인마다 정한 `receiptClass` 로 고른다(진찰료·입원료는 PROCEDURE 로 저장돼
  //    codeType 만 보면 ⑨ 로 갔다). 옛 응답이면 같은 정본 함수로 codeType 에서 유도한다.
  const classOfItem = (it: BillingItem): ReceiptClassKey | null =>
    it.receiptClass !== undefined ? it.receiptClass : receiptClassOf({ codeType: it.type ?? it.category ?? null });
  // 어느 칸에도 맞지 않는 라인은 칸을 짐작하지 않고 '분류 미등재' 한 줄로 밝힌다(있을 때만)
  const categories = [
    ...RECEIPT_CLASSES.map(c => ({ no: c.no, name: c.name, key: c.key as ReceiptClassKey | null })),
    { no: '', name: '분류 미등재', key: null as ReceiptClassKey | null },
  ];

  // 보험자 부담 비율을 API 응답에서 동적 계산
  const computedTotal = items.reduce((s: number, i: BillingItem) => s + (i.totalPrice ?? i.amount ?? 0), 0);
  const insurerRate = computedTotal > 0 ? (insuranceCovered / (totalAmount || computedTotal)) : 0.7;

  // 급여 일부본인부담 / 급여 전액본인부담(100/100) / 비급여 — 라인별 분리(별지 제11호의2)
  const categoryAmounts = categories.map(cat => {
    const matched = items.filter((item: BillingItem) => classOfItem(item) === cat.key);
    let amount = 0, insurance = 0, copayPartial = 0, copayFull = 0, nonCov = 0;
    for (const it of matched) {
      const amt = it.totalPrice ?? it.amount ?? 0;
      amount += amt;
      const isNonCov = it.insuranceType === 'NON_COVERED' || it.category === 'NON_COVERED';
      if (isNonCov) { nonCov += amt; continue; }
      if (it.fullCopay) { copayFull += amt; continue; } // 급여 전액본인부담
      const rate = it.copayRate != null ? Number(it.copayRate) : (1 - insurerRate);
      const c = Math.round(amt * rate);
      copayPartial += c;
      insurance += amt - c;
    }
    return { ...cat, amount, insurance, copayPartial, copayFull, copayNonInsured: nonCov };
  }).filter(c => c.key !== null || c.amount > 0);

  // 🔴 (P2-1) 종전엔 ① 진찰료 칸이 0 이면 15,000원을 지어 넣고 공단·본인부담까지 비율로 지어냈다.
  //    청구 라인에 없는 금액은 영수증에 만들지 않는다.

  const insuredTotal = categoryAmounts.reduce((s, c) => s + c.amount, 0);
  const insuredInsurance = categoryAmounts.reduce((s, c) => s + c.insurance, 0);
  const copayFullTotal = categoryAmounts.reduce((s, c) => s + c.copayFull, 0);
  const nonCovTotal = categoryAmounts.reduce((s, c) => s + c.copayNonInsured, 0);
  // 일부본인부담 합계 = 권위값(billing.patientCopay) − 전액본인부담(라인 합) − 비급여(라인 합)
  // 🔴 (P2-1) 본인부담(patientCopay)에는 비급여(본인부담률 100%)가 들어 있다 — 종전엔 비급여를 빼지 않아
  //    같은 금액이 '일부본인부담'과 '비급여' 두 칸에 이중으로 찍혔다.
  const copayPartialTotal = copay
    ? Math.max(0, copay - copayFullTotal - nonCovTotal)
    : categoryAmounts.reduce((s, c) => s + c.copayPartial, 0);
  const discountAmount = billing.discountAmount ?? 0;

  const fmt = (n: number) => n > 0 ? n.toLocaleString() : '-';

  return (
    <div className="receipt-container bg-white border-2 border-gray-800 p-5 font-[serif]">
      <h1 className="text-center text-lg font-bold tracking-[0.3em] mb-0.5">진 료 비  계 산 서 · 영 수 증</h1>
      <p className="text-center text-[9px] text-gray-500 mb-0.5">(의료법 시행규칙 별지 제11호 서식)</p>
      <div className="border-b-2 border-gray-800 mb-3" />

      {/* 병원 정보 (설정 연동) */}
      <div className="flex justify-between text-[11px] mb-2">
        <div>
          <p>의료기관명: <strong>{hospital.name}</strong> ({hospital.grade})</p>
          <p>요양기관기호: {hospital.code}{hospital.license ? ` · 허가번호 ${hospital.license}` : ''}</p>
        </div>
        <div className="text-right">
          <p>사업자번호: {hospital.bizNo}{hospital.ceo ? ` · 대표자 ${hospital.ceo}` : ''}</p>
          <p>소재지: {hospital.address} · {hospital.phone}</p>
        </div>
      </div>

      {/* 환자 정보 */}
      <table className="w-full border border-gray-800 text-[11px] mb-3">
        <tbody>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1 font-bold w-20">환자 성명</td>
            <td className="border border-gray-600 px-2 py-1">{patientName}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1 font-bold w-20">등록번호</td>
            <td className="border border-gray-600 px-2 py-1">{billing.patient?.mrn ?? '-'}</td>
          </tr>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1 font-bold">진료기간</td>
            <td className="border border-gray-600 px-2 py-1">{billing.createdAt ? format(new Date(billing.createdAt), 'yyyy.MM.dd') : '-'}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1 font-bold">입원/외래</td>
            <td className="border border-gray-600 px-2 py-1">{billing.encounterType === 'INPATIENT' ? '입원' : '외래'} · 야간(공휴일)진료 {isNightHoliday ? '☑해당' : '☑해당없음'}</td>
          </tr>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1 font-bold">보험 구분</td>
            <td className="border border-gray-600 px-2 py-1">{copayLabel(billing.patient?.insuranceType, billing.copayCategory, billing.specialExemption)}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1 font-bold">본인부담 구분</td>
            <td className="border border-gray-600 px-2 py-1">{copayKind(billing.copayCategory, billing.eligibilityStatus)}{billing.eligibilityStatus === 'EXPIRED' ? ' (자격상실)' : ''}</td>
          </tr>
        </tbody>
      </table>

      {/* 법정 13개 항목 테이블 (별지 제11호) */}
      <table className="w-full border-collapse border-2 border-gray-800 text-[10px] mb-3">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-600 px-1 py-1 text-left" colSpan={2} rowSpan={2}>항목</th>
            <th className="border border-gray-600 px-1 py-1 text-right w-16" rowSpan={2}>금액</th>
            <th className="border border-gray-600 px-1 py-0.5 text-center" colSpan={3}>급여</th>
            <th className="border border-gray-600 px-1 py-0.5 text-center" colSpan={2}>비급여</th>
          </tr>
          <tr className="bg-gray-50">
            <th className="border border-gray-600 px-1 py-0.5 text-right w-[64px] text-[9px]">보험자부담</th>
            <th className="border border-gray-600 px-1 py-0.5 text-right w-[64px] text-[9px]">일부본인부담</th>
            <th className="border border-gray-600 px-1 py-0.5 text-right w-[64px] text-[9px]">전액본인부담</th>
            <th className="border border-gray-600 px-1 py-0.5 text-right w-[60px] text-[9px]">비급여</th>
            <th className="border border-gray-600 px-1 py-0.5 text-right w-[52px] text-[9px]">선택진료</th>
          </tr>
        </thead>
        <tbody>
          {categoryAmounts.map(cat => (
            <tr key={cat.no}>
              <td className="border border-gray-600 px-1 py-0.5 text-center w-8">{cat.no}</td>
              <td className="border border-gray-600 px-1 py-0.5">{cat.name}</td>
              <td className="border border-gray-600 px-1 py-0.5 text-right font-mono">{fmt(cat.amount)}</td>
              <td className="border border-gray-600 px-1 py-0.5 text-right font-mono">{fmt(cat.insurance)}</td>
              <td className="border border-gray-600 px-1 py-0.5 text-right font-mono">{fmt(cat.copayPartial)}</td>
              <td className="border border-gray-600 px-1 py-0.5 text-right font-mono">{fmt(cat.copayFull)}</td>
              <td className="border border-gray-600 px-1 py-0.5 text-right font-mono">{fmt(cat.copayNonInsured)}</td>
              <td className="border border-gray-600 px-1 py-0.5 text-right font-mono text-gray-300">-</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-bold">
            <td className="border border-gray-600 px-1 py-1" colSpan={2}>급여 소계</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">{((totalAmount || insuredTotal) - nonCovTotal).toLocaleString()}</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">{(insuranceCovered || insuredInsurance).toLocaleString()}</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">{copayPartialTotal.toLocaleString()}</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">{copayFullTotal.toLocaleString()}</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">-</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">-</td>
          </tr>
          <tr className="bg-gray-50 font-bold">
            <td className="border border-gray-600 px-1 py-1" colSpan={2}>비급여 소계</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">{nonCovTotal.toLocaleString()}</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">-</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">-</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">-</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">{nonCovTotal.toLocaleString()}</td>
            <td className="border border-gray-600 px-1 py-1 text-right font-mono">-</td>
          </tr>
          <tr className="bg-gray-200 font-bold text-sm">
            <td className="border-2 border-gray-800 px-1.5 py-2" colSpan={2}>합 계</td>
            <td className="border-2 border-gray-800 px-1.5 py-2 text-right font-mono">{(totalAmount || insuredTotal).toLocaleString()}</td>
            <td className="border-2 border-gray-800 px-1.5 py-2 text-right font-mono">{(insuranceCovered || insuredInsurance).toLocaleString()}</td>
            <td className="border-2 border-gray-800 px-1.5 py-2 text-right font-mono">{copayPartialTotal.toLocaleString()}</td>
            <td className="border-2 border-gray-800 px-1.5 py-2 text-right font-mono">{copayFullTotal.toLocaleString()}</td>
            <td className="border-2 border-gray-800 px-1.5 py-2 text-right font-mono">{nonCovTotal.toLocaleString()}</td>
            <td className="border-2 border-gray-800 px-1.5 py-2 text-right font-mono">-</td>
          </tr>
        </tbody>
      </table>

      {isFullCopay && (
        <div className="text-[10px] text-red-600 font-bold mb-1">
          ※ {billing.eligibilityStatus === 'EXPIRED' ? '건강보험 자격상실' : billing.copayCategory === 'SELF_PAY' ? '자비(비급여)' : '자격 미확인'}으로 전액 본인부담 처리되었습니다.
        </div>
      )}

      {/* 결제 정보 */}
      <div className="border border-gray-800 p-2 text-[11px] mb-2">
        <div className="grid grid-cols-2 gap-2">
          <p>본인부담금: <strong><Money value={copay} /></strong></p>
          {discountAmount > 0 && (
            <p>감면액: <strong className="text-blue-700">-<Money value={discountAmount} /></strong>{billing.discountReason ? ` (${billing.discountReason})` : ''}</p>
          )}
          <p>납부할금액: <strong><Money value={Math.max(0, copay - discountAmount)} /></strong></p>
          <p>납부액: <strong><Money value={paidAmount} /></strong></p>
          <p>미납액: <strong className={paidAmount < (copay - discountAmount) ? 'text-red-600' : ''}><Money value={Math.max(0, copay - discountAmount - paidAmount)} /></strong></p>
          {/* 🔴 결제수단은 shared 정본 표기. 종전 인라인 삼항은 CARD·CASH 만 한글이라
              복합결제 영수증에 `MIXED` 가 그대로 인쇄됐다(운영 실재 1건).
              복합결제는 요약 라벨이므로 수단별 금액을 수납 원장에서 함께 적는다 — 그것이 대사 근거다. */}
          <p>
            결제수단: {paymentMethodLabel(billing.paymentMethod)}
            {(billing.payments?.length ?? 0) > 1 && (
              <span className="ml-1">
                ({billing.payments!.map((pl) => `${paymentMethodLabel(pl.method)} ${money(pl.amount)}`).join(' · ')})
              </span>
            )}
          </p>
          {billing.cardApprovalNo && <p>승인번호: {billing.cardApprovalNo}</p>}
          {billing.cashReceiptNo && <p>현금영수증: {billing.cashReceiptNo}{billing.cashReceiptType ? ` (${billing.cashReceiptType})` : ''}</p>}
        </div>
      </div>

      {/* 발행 정보 + 진위확인 QR */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="text-[11px] space-y-0.5 flex-1">
          <p>영수증번호: {receiptNo}　　발행일: {format(new Date(), 'yyyy년 M월 d일')}</p>
          {issued?.issueNo && <p>발급번호: <span className="font-mono">{issued.issueNo}</span></p>}
          {/* 🔴 발급번호·진위확인 QR 을 못 받은 것을 조용히 넘기지 않는다(발행 안 된 영수증이 된다) */}
          {issuedIsError && <div className="no-print"><QueryErrorFallback error={issuedError} onRetry={refetchIssued} size="compact" /></div>}
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs font-bold">{hospital.name} {hospital.ceo ? `${hospital.ceo} ` : ''}병원장</p>
            {/^(https?:|\/)/.test(hospital.ceoSignature)
              ? <img src={hospital.ceoSignature} alt="직인" className="h-10 w-10 object-contain" />
              : <span className="text-xs">(직인)</span>}
          </div>
        </div>
        {issued?.qrDataUrl && (
          <div className="text-center shrink-0">
            <img src={issued.qrDataUrl} alt="진위확인 QR" className="h-16 w-16 object-contain border border-gray-300" />
            <p className="text-[8px] text-gray-500 mt-0.5">진위확인</p>
          </div>
        )}
      </div>

      {/* 안내문 */}
      <div className="text-[9px] text-gray-500 border-t pt-1.5 space-y-0">
        <p>※ 이 영수증은 소득세법 제52조에 따라 의료비 세액공제 증빙으로 사용할 수 있습니다.</p>
        <p>※ 세부 산정 내역은 별도 요청 시 발급합니다.</p>
        <p>※ 비급여 항목은 별도 내역서를 참조하시기 바랍니다.</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 2. DetailStatement — 세부산정내역서
 * ───────────────────────────────────────────────────────────── */
function DetailStatement({ billing, patientName, receiptNo, hospital }: { billing: BillingData; patientName: string; receiptNo: string; hospital: HospitalInfo }) {
  const items = billing.items ?? billing.prescriptions ?? [];
  const patient = billing.patient ?? billing.encounter?.patient;
  const fullCopay = billing.eligibilityStatus === 'EXPIRED' || billing.eligibilityStatus === 'NOT_FOUND';

  return (
    <div className="receipt-container bg-white border-2 border-gray-800 p-5 font-[serif]">
      <h1 className="text-center text-xl font-bold tracking-[0.3em] mb-1">세 부 산 정 내 역 서</h1>
      <div className="border-b-2 border-gray-800 mb-4" />

      {/* 환자/영수증 정보 */}
      <table className="w-full border border-gray-800 text-xs mb-4">
        <tbody>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold w-24">환자 성명</td>
            <td className="border border-gray-600 px-2 py-1.5">{patientName}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold w-24">등록번호</td>
            <td className="border border-gray-600 px-2 py-1.5">{patient?.mrn ?? '-'}</td>
          </tr>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold">영수증번호</td>
            <td className="border border-gray-600 px-2 py-1.5">{receiptNo}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold">진료일</td>
            <td className="border border-gray-600 px-2 py-1.5">{billing.createdAt ? format(new Date(billing.createdAt), 'yyyy.MM.dd') : '-'}</td>
          </tr>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold">보험 구분</td>
            <td className="border border-gray-600 px-2 py-1.5">{copayLabel(patient?.insuranceType, billing.copayCategory, billing.specialExemption)}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold">요양기관</td>
            <td className="border border-gray-600 px-2 py-1.5">{hospital.name} ({hospital.code})</td>
          </tr>
        </tbody>
      </table>

      {/* 처방 상세 테이블 (별지 제11호의2) */}
      <table className="w-full border-collapse border-2 border-gray-800 text-xs mb-4">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-600 px-1 py-1 text-center w-16">항목구분</th>
            <th className="border border-gray-600 px-1 py-1 text-left w-20">코드</th>
            <th className="border border-gray-600 px-1 py-1 text-left">명칭</th>
            <th className="border border-gray-600 px-1 py-1 text-right w-16">단가</th>
            <th className="border border-gray-600 px-1 py-1 text-center w-12">횟수(일)</th>
            <th className="border border-gray-600 px-1 py-1 text-right w-18">총액</th>
            <th className="border border-gray-600 px-1 py-1 text-center w-14">급여/비급여</th>
            <th className="border border-gray-600 px-1 py-1 text-center w-16">본인부담구분</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={8} className="border border-gray-600 px-2 py-4 text-center text-gray-400">산정 내역이 없습니다.</td>
            </tr>
          ) : (
            items.map((item: BillingItem, idx: number) => {
              const unitPrice = item.unitPrice ?? item.price ?? 0;
              const qty = item.quantity ?? 1;
              const amount = item.totalPrice ?? item.amount ?? unitPrice * qty;
              const isInsured = item.insuranceType !== 'NON_COVERED' && item.category !== 'NON_COVERED';
              const categoryMap: Record<string, string> = {
                'CONSULTATION': '진찰', 'ADMISSION': '입원', 'MEAL': '식대', 'DIET': '식대',
                'MEDICATION': '투약', 'INJECTION': '주사', 'ANESTHESIA': '마취',
                'PHYSICAL_THERAPY': '이학요법', 'REHAB': '이학요법', 'PSYCHIATRIC_THERAPY': '정신요법',
                'THERAPY': '처치·수술', 'SURGERY': '처치·수술', 'PROCEDURE': '처치·수술',
                'LAB': '검사', 'IMAGING': '영상진단', 'MATERIAL': '재료',
                'BLOOD': '전혈·혈액', 'TRANSFUSION': '전혈·혈액',
              };
              const categoryLabel = categoryMap[item.type ?? item.category ?? ''] ?? '기타';
              return (
                <tr key={item.id ?? idx}>
                  <td className="border border-gray-600 px-1 py-0.5 text-center text-[10px]">{categoryLabel}</td>
                  <td className="border border-gray-600 px-1 py-0.5 font-mono text-[10px]">{item.code ?? item.ediCode ?? '-'}</td>
                  <td className="border border-gray-600 px-1 py-0.5">{item.name ?? item.description ?? '-'}</td>
                  <td className="border border-gray-600 px-1 py-0.5 text-right font-mono">{unitPrice.toLocaleString()}</td>
                  <td className="border border-gray-600 px-1 py-0.5 text-center">{qty}</td>
                  <td className="border border-gray-600 px-1 py-0.5 text-right font-mono">{amount.toLocaleString()}</td>
                  <td className="border border-gray-600 px-1 py-0.5 text-center">{isInsured ? '급여' : '비급여'}</td>
                  <td className="border border-gray-600 px-1 py-0.5 text-center text-[10px]">{!isInsured || fullCopay ? '전액부담' : billing.copayCategory === 'SPECIAL_EXEMPTION' ? '산정특례' : '일부부담'}</td>
                </tr>
              );
            })
          )}
        </tbody>
        {items.length > 0 && (
          <tfoot>
            <tr className="bg-gray-200 font-bold">
              <td className="border-2 border-gray-800 px-2 py-1.5" colSpan={5}>합 계</td>
              <td className="border-2 border-gray-800 px-2 py-1.5 text-right font-mono">
                {items.reduce((s: number, i: BillingItem) => s + (i.totalPrice ?? i.amount ?? 0), 0).toLocaleString()}
              </td>
              <td className="border-2 border-gray-800 px-2 py-1.5" colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>

      {/* 발행 정보 */}
      <div className="text-xs space-y-1">
        <p>발행일: {format(new Date(), 'yyyy년 M월 d일')}</p>
        <p className="text-sm font-bold mt-2">{hospital.name} {hospital.ceo ? `${hospital.ceo} ` : ''}병원장 (직인)</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 3. AnnualStatement — 납입확인서 (연말정산)
 * ───────────────────────────────────────────────────────────── */
function AnnualStatement({ patientName, annualData, hospital }: { patientName: string; annualData?: { monthly?: MonthlyData[]; data?: { monthly?: MonthlyData[] } }; hospital: HospitalInfo }) {
  const year = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const monthlyData = annualData?.monthly ?? annualData?.data?.monthly ?? [];

  const getMonthData = (m: number): MonthlyData => monthlyData.find((d: MonthlyData) => d.month === m) ?? { month: m, outpatientCount: 0, outpatientAmount: 0, inpatientDays: null, inpatientAmount: 0 };

  const totals = months.reduce((acc, m) => {
    const d = getMonthData(m);
    return {
      outpatientCount: acc.outpatientCount + (d.outpatientCount ?? 0),
      outpatientAmount: acc.outpatientAmount + (d.outpatientAmount ?? 0),
      inpatientDays: d.inpatientDays == null ? acc.inpatientDays : (acc.inpatientDays ?? 0) + d.inpatientDays,
      inpatientAmount: acc.inpatientAmount + (d.inpatientAmount ?? 0),
    };
  }, { outpatientCount: 0, outpatientAmount: 0, inpatientDays: null as number | null, inpatientAmount: 0 });

  return (
    <div className="receipt-container bg-white border-2 border-gray-800 p-5 font-[serif]">
      <h1 className="text-center text-xl font-bold tracking-[0.3em] mb-1">의 료 비 납 입 확 인 서</h1>
      <p className="text-center text-xs text-gray-500 mb-1">(소득세법 제52조 의료비 세액공제 증빙용)</p>
      <div className="border-b-2 border-gray-800 mb-4" />

      {/* 기본 정보 */}
      <table className="w-full border border-gray-800 text-xs mb-4">
        <tbody>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold w-24">환자 성명</td>
            <td className="border border-gray-600 px-2 py-1.5">{patientName}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold w-24">귀속연도</td>
            <td className="border border-gray-600 px-2 py-1.5">{year}<Unit>년</Unit></td>
          </tr>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold">의료기관명</td>
            <td className="border border-gray-600 px-2 py-1.5" colSpan={3}>{hospital.name}</td>
          </tr>
        </tbody>
      </table>

      {/* 월별 내역 테이블 */}
      <table className="w-full border-collapse border-2 border-gray-800 text-xs mb-4">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-600 px-2 py-1.5 text-center" rowSpan={2}>월</th>
            <th className="border border-gray-600 px-2 py-1.5 text-center" colSpan={2}>외래</th>
            <th className="border border-gray-600 px-2 py-1.5 text-center" colSpan={2}>입원</th>
          </tr>
          <tr className="bg-gray-50">
            <th className="border border-gray-600 px-2 py-1 text-center w-16">횟수</th>
            <th className="border border-gray-600 px-2 py-1 text-right w-28">금액</th>
            <th className="border border-gray-600 px-2 py-1 text-center w-16">일수</th>
            <th className="border border-gray-600 px-2 py-1 text-right w-28">금액</th>
          </tr>
        </thead>
        <tbody>
          {months.map(m => {
            const d = getMonthData(m);
            const hasData = (d.outpatientCount ?? 0) > 0 || (d.inpatientAmount ?? 0) !== 0;
            return (
              <tr key={m} className={hasData ? '' : 'text-gray-300'}>
                <td className="border border-gray-600 px-2 py-1 text-center">{m}월</td>
                <td className="border border-gray-600 px-2 py-1 text-center font-mono">{d.outpatientCount ?? 0}</td>
                <td className="border border-gray-600 px-2 py-1 text-right font-mono">{(d.outpatientAmount ?? 0).toLocaleString()}</td>
                <td className="border border-gray-600 px-2 py-1 text-center font-mono">{d.inpatientDays ?? '-'}</td>
                <td className="border border-gray-600 px-2 py-1 text-right font-mono">{(d.inpatientAmount ?? 0).toLocaleString()}</td>
              </tr>
            );
          })}
          <tr className="bg-gray-200 font-bold">
            <td className="border-2 border-gray-800 px-2 py-1.5 text-center">합계</td>
            <td className="border-2 border-gray-800 px-2 py-1.5 text-center font-mono">{totals.outpatientCount}</td>
            <td className="border-2 border-gray-800 px-2 py-1.5 text-right font-mono">{totals.outpatientAmount.toLocaleString()}</td>
            <td className="border-2 border-gray-800 px-2 py-1.5 text-center font-mono">{totals.inpatientDays ?? '-'}</td>
            <td className="border-2 border-gray-800 px-2 py-1.5 text-right font-mono">{totals.inpatientAmount.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      {/* 총 납입액 */}
      <div className="border-2 border-gray-800 p-3 text-center mb-4">
        <p className="text-sm font-bold">총 납입 의료비: <span className="text-lg"><Money value={(totals.outpatientAmount + totals.inpatientAmount)} /></span></p>
      </div>

      {/* 발행 정보 */}
      <div className="text-xs space-y-1">
        <p>위 금액을 의료비로 납입하였음을 확인합니다.</p>
        <p className="mt-2">발행일: {format(new Date(), 'yyyy년 M월 d일')}</p>
        <p className="text-sm font-bold mt-2">{hospital.name} {hospital.ceo ? `${hospital.ceo} ` : ''}병원장 (직인)</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 4. NonCoveredStatement — 비급여 내역서
 * ───────────────────────────────────────────────────────────── */
function NonCoveredStatement({ billing, patientName, hospital }: { billing: BillingData; patientName: string; hospital: HospitalInfo }) {
  const items = billing.items ?? billing.prescriptions ?? [];
  const patient = billing.patient ?? billing.encounter?.patient;

  const nonCoveredItems = items.filter((item: BillingItem) =>
    item.insuranceType === 'NON_COVERED' || item.category === 'NON_COVERED' || item.coverageType === 'NON_COVERED'
  );

  return (
    <div className="receipt-container bg-white border-2 border-gray-800 p-5 font-[serif]">
      <h1 className="text-center text-xl font-bold tracking-[0.3em] mb-1">비 급 여 진 료 비 내 역 서</h1>
      <div className="border-b-2 border-gray-800 mb-4" />

      {/* 환자 정보 */}
      <table className="w-full border border-gray-800 text-xs mb-4">
        <tbody>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold w-24">환자 성명</td>
            <td className="border border-gray-600 px-2 py-1.5">{patientName}</td>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold w-24">등록번호</td>
            <td className="border border-gray-600 px-2 py-1.5">{patient?.mrn ?? '-'}</td>
          </tr>
          <tr>
            <td className="border border-gray-600 bg-gray-100 px-2 py-1.5 font-bold">진료일</td>
            <td className="border border-gray-600 px-2 py-1.5" colSpan={3}>{billing.createdAt ? format(new Date(billing.createdAt), 'yyyy.MM.dd') : '-'}</td>
          </tr>
        </tbody>
      </table>

      {nonCoveredItems.length === 0 ? (
        <div className="border border-gray-400 rounded p-8 text-center text-gray-400 text-sm mb-4">
          비급여 진료 내역이 없습니다.
        </div>
      ) : (
        <table className="w-full border-collapse border-2 border-gray-800 text-xs mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-600 px-2 py-1.5 text-center w-10">번호</th>
              <th className="border border-gray-600 px-2 py-1.5 text-center w-20">코드</th>
              <th className="border border-gray-600 px-2 py-1.5 text-left">항목명</th>
              <th className="border border-gray-600 px-2 py-1.5 text-right w-16">단가</th>
              <th className="border border-gray-600 px-2 py-1.5 text-center w-10">수량</th>
              <th className="border border-gray-600 px-2 py-1.5 text-right w-20">금액</th>
              <th className="border border-gray-600 px-2 py-1.5 text-center w-14">동의서</th>
            </tr>
          </thead>
          <tbody>
            {nonCoveredItems.map((item: BillingItem, idx: number) => (
              <tr key={item.id ?? idx}>
                <td className="border border-gray-600 px-2 py-1 text-center">{idx + 1}</td>
                <td className="border border-gray-600 px-2 py-1 text-center font-mono text-[10px]">{item.code ?? '-'}</td>
                <td className="border border-gray-600 px-2 py-1">{item.name ?? item.description ?? '-'}</td>
                <td className="border border-gray-600 px-2 py-1 text-right font-mono">{(item.unitPrice ?? 0).toLocaleString()}</td>
                <td className="border border-gray-600 px-2 py-1 text-center">{item.quantity ?? 1}</td>
                <td className="border border-gray-600 px-2 py-1 text-right font-mono">{(item.totalPrice ?? item.amount ?? 0).toLocaleString()}</td>
                <td className="border border-gray-600 px-2 py-1 text-center">{item.consentSigned ? 'Y' : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-200 font-bold">
              <td className="border-2 border-gray-800 px-2 py-1.5" colSpan={5}>합 계</td>
              <td className="border-2 border-gray-800 px-2 py-1.5 text-right font-mono">
                {nonCoveredItems.reduce((s: number, i: BillingItem) => s + (i.totalPrice ?? i.amount ?? 0), 0).toLocaleString()}
              </td>
              <td className="border-2 border-gray-800 px-2 py-1.5" />
            </tr>
          </tfoot>
        </table>
      )}

      {/* 안내문 */}
      <div className="text-[10px] text-gray-500 border-t pt-2 space-y-0.5 mb-4">
        <p>※ 비급여 항목은 국민건강보험이 적용되지 않는 진료 항목입니다. (의료법 제45조)</p>
        <p>※ 비급여 진료 전 사전 설명 및 동의를 받은 경우 동의서 항목에 Y로 표시됩니다.</p>
        <p>※ 비급여 진료비용 고지 의무에 따라 단가, 수량, 금액을 구분 표시합니다. (의료법 시행규칙 제42조의2)</p>
      </div>

      {/* 발행 정보 */}
      <div className="text-xs space-y-1">
        <p>발행일: {format(new Date(), 'yyyy년 M월 d일')}</p>
        <p className="text-sm font-bold mt-2">{hospital.name} {hospital.ceo ? `${hospital.ceo} ` : ''}병원장 (직인)</p>
      </div>
    </div>
  );
}
