'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { differenceInDays } from 'date-fns';
import { safeFormat as format } from '@/lib/safe-date';
import { PrescriptionSafetyBadges } from './PrescriptionSafetyBadges';

import { EmptyState, drugNameOf, DrugName } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useHasRole } from '@/hooks/use-admin-write';
import { useAuthStore } from '@/stores/auth-store';
import { canRequestDrugInteractionAi } from '@/lib/drug-interaction-screen';
import { DiscontinueDialog } from '@/components/prescription/DiscontinueDialog';
import { RenewDialog } from '@/components/prescription/RenewDialog';
import {
  AI_ORIGIN_TEXT,
  dosingWindow,
  DOSING_STATE_LABEL,
  isKnownDosing,
  isScreenedForInteraction,
  dispensingStage,
  DISPENSING_STAGE_LABEL,
  type DosingState,
  type DosingWindow,
} from '@hospital-run/shared';

/**
 * 🔴 `PrescriptionStatus` 는 **{ACTIVE, CANCELLED} 두 값뿐이다**(prisma enum·운영 pg_enum 동일).
 *    처방을 COMPLETED/SUSPENDED 로 바꾸는 코드 경로가 전역에 **0건**이다.
 *    종전 이 파일은 네 값을 선언하고 **'완료' 필터 탭**과 '보류' 라벨을 그렸다 —
 *    완료 탭은 구조적으로 영원히 0건이었고, "약을 다 먹었는지"는 어디에도 표시되지 않았다.
 *    → 없는 상태를 지어내지 않는다. 끝났는지는 **투여기간**으로 말한다(아래 `dosing`).
 */
// 2026-09-30 DISCONTINUED(중단 — 그 시각 이후 멈춤) 추가. 중단은 '종료' 쪽이고, 취소(무효)와는 다른 사실이다.
type RxStatus = 'ACTIVE' | 'CANCELLED' | 'DISCONTINUED';

interface DispensingInfo {
  id: string;
  status: 'PENDING' | 'DISPENSED' | 'VERIFIED' | 'ISSUED' | 'CANCELLED';
  careType?: string;
  dispensedAt?: string | null;
  secondCheckAt?: string | null;
  verifiedAt?: string | null;
  issuedAt?: string | null;
  issuedTo?: string | null;
}

interface OrderInfo {
  id: string;
  department?: string;
  status?: string;
  pharmacyType?: string;
  dispensing?: DispensingInfo | null;
}

interface Prescription {
  id: string;
  status: RxStatus;
  prescribedAt: string;
  createdAt?: string;
  duration?: number | null;
  /** 서버가 함께 주는 투여기간 판정(shared `dosingWindow` 정본). 구형 응답 대비 optional. */
  dosing?: DosingWindow;
  items?: PrescriptionItem[];
  orders?: OrderInfo[];
  doctor?: { familyName?: string; givenName?: string };
  doctorName?: string;
  reason?: string;
  discontinuedAt?: string | null;
  discontinueReason?: string | null;
}

interface PrescriptionItem {
  id: string;
  drugName: string;
  /** 표시 전용 용어 쌍(용어 토글) — 약품 행에만 있고, 처치/지시 폴백 행은 문자열 그대로 */
  nameKo?: string | null;
  nameEn?: string | null;
  ingredient?: string | null;
  dosage: string;
  frequency: string;
  duration?: string;
  route?: string;
}

interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  description: string;
}

/**
 * 🔴 탭은 **원장에 있는 사실**로만 나눈다.
 *  - `dosing`: 투여 중 / 기간 종료 / 기간 미상 — `createdAt + duration` 으로 계산(정본 shared).
 *  - `cancelled`: 처방 취소.
 * 종전의 '완료' 탭은 존재하지 않는 상태를 세던 것이라 영원히 0건이었다.
 */
type FilterType = 'dosing' | 'ended' | 'cancelled' | 'all';

/**
 * 처방 한 건의 조제 진행 — 차트에서 "약이 실제로 나갔는가"를 답하는 유일한 자리.
 *
 * 🔴 종전 투약 이력 탭은 `orders` 를 **읽지도 않았다**(파일 내 grep 0건). 그래서
 *    조제·검수·불출·수령자가 차트 어디에도 없었다. 여정 탭의 `DISPENSED` 하나가
 *    유일한 회귀 경로였고 그것도 조제 완료 한 단계뿐이었다.
 *
 * 🔴 단계 판정은 `order.status` 가 아니라 `dispensing.status` 다 —
 *    오더는 **조제 완료 시점에 이미 COMPLETED** 로 닫히기 때문이다.
 */
function DispensingChain({ orders }: { orders?: OrderInfo[] }) {
  const pharmacyOrders = (orders ?? []).filter(o => o.department === 'PHARMACY' || o.dispensing);
  if (pharmacyOrders.length === 0) return null;

  return (
    <div className="px-4 py-2 border-t border-gray-50 bg-white flex flex-wrap gap-x-3 gap-y-1 items-center">
      {pharmacyOrders.map((o) => {
        const d = o.dispensing;
        const stage = dispensingStage({ orderStatus: o.status, dispensingStatus: d?.status });
        const tone =
          stage === 'ISSUED' ? 'bg-emerald-50 text-emerald-700'
            : stage === 'CANCELLED' ? 'bg-red-50 text-red-700'
            : stage === 'NOT_STARTED' ? 'bg-gray-100 text-gray-500'
            : 'bg-amber-50 text-amber-700';
        return (
          <span key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${tone}`}>
              {DISPENSING_STAGE_LABEL[stage]}
            </span>
            {o.pharmacyType === 'EXTERNAL' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-50 text-violet-700 whitespace-nowrap"><T k="원외" /></span>
            )}
            {/* 일어난 것만 — 없는 시각은 칸을 만들지 않는다 */}
            {d?.dispensedAt && <span className="text-[10px] text-gray-500"><T k="조제" /> {format(new Date(d.dispensedAt), 'MM/dd HH:mm')}</span>}
            {d?.verifiedAt && <span className="text-[10px] text-gray-500"><T k="검수" /> {format(new Date(d.verifiedAt), 'MM/dd HH:mm')}</span>}
            {d?.issuedAt && <span className="text-[10px] text-gray-500"><T k="불출" /> {format(new Date(d.issuedAt), 'MM/dd HH:mm')}</span>}
            {d?.issuedTo && <span className="text-[10px] text-gray-600"><T k="수령" /> {d.issuedTo}</span>}
            {d?.issuedAt && !d.issuedTo && <span className="text-[10px] text-amber-600"><T k="수령자 미기재" /></span>}
            {d?.secondCheckAt && <span className="text-[10px] text-gray-500"><T k="2인확인 완료" /></span>}
          </span>
        );
      })}
    </div>
  );
}

export function MedicationTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [filter, setFilter] = useState<FilterType>('dosing');
  const canStop = useHasRole('DOCTOR');
  const [stopTarget, setStopTarget] = useState<{ id: string; name: string } | null>(null);
  const [renewTarget, setRenewTarget] = useState<Prescription | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-prescriptions', patientId],
    queryFn: () => apiClient.get<{ data: Prescription[] }>(`/api/v1/prescriptions/patient/${patientId}`),
    enabled: !!patientId,
  });

  // API 응답 unwrap: apiClient가 { data: response } 반환, response가 { data: [...] } 또는 [...] 일 수 있음
  const _raw = data?.data;
  const _arr = Array.isArray(_raw) ? _raw : (_raw as Record<string, unknown> | undefined)?.data;
  // 투약 이력 탭은 **약(MEDICATION)만** — 물리치료·검사 처방이 섞여 "투약"이 아닌 행이 나오던 소음 제거
  // (다른 유형은 '오더 추적'·'처방/수납' 탭이 정본. type 없는 구형 행은 보존)
  const allPrescriptions: Prescription[] = (Array.isArray(_arr) ? _arr : [])
    .filter((p: any) => !p.type || p.type === 'MEDICATION')
    .map((p: any) => {
    const drugName = drugNameOf(p.medicationCode, '') || p.procedureCode?.nameKo || p.instructions || p.drugName || `${p.type ?? '처방'}`; // 한/영 병용 P2(D3): 약물명 폴백은 정본 drugNameOf
    return {
      ...p,
      // 🔴 운영 실측(2026-09-06): 이 EP 응답엔 items 배열이 없다 — 항목은 항상 여기서 합성된다.
      //    용어 토글용 쌍은 약품 행(medicationCode 실재)에만 싣는다(처치/지시 폴백은 문자열 유지).
      items: p.items?.length ? p.items : [{
        id: p.id,
        drugName,
        nameKo: p.medicationCode?.nameKo ?? null,
        nameEn: p.medicationCode?.nameEn ?? null,
        ingredient: p.medicationCode?.ingredient ?? null,
        dosage: p.dosage ?? '-',
        frequency: p.frequency ?? '-',
        duration: p.duration ? `${p.duration}일` : undefined,
        route: p.route ?? undefined,
      }],
      prescribedAt: p.prescribedAt ?? p.createdAt,
      // 🔴 투여기간 판정은 서버(shared `dosingWindow`)가 정본이다. 응답에 없으면 여기서
      //    같은 정본 함수로 계산한다 — **FE 가 자기 규칙을 새로 만들지 않는다**(만들면 갈라진다).
      dosing: p.dosing ?? dosingWindow({ createdAt: p.createdAt, duration: p.duration, discontinuedAt: p.discontinuedAt ?? null }),
      doctorName: p.encounter?.doctor ? `${p.encounter.doctor.familyName ?? ''}${p.encounter.doctor.givenName ?? ''}` : undefined,
    };
  });

  const stateOf = (p: Prescription): DosingState => p.dosing?.state ?? 'UNKNOWN';
  // 취소는 투여기간과 다른 축이다 — 취소된 처방은 기간이 남았어도 복용 중이 아니다.
  // 🔴 (2026-09-30) 중단(DISCONTINUED)도 복용 중이 아니다 — `!== 'CANCELLED'` 로 거르면 중단된 약이 '투여 중'·상호작용 점검에 남는다.
  //    중단은 '종료' 탭에 두고(이미 먹은 사실은 기록), 취소(무효)와 섞지 않는다.
  const current = useMemo(() => allPrescriptions.filter(p => p.status === 'ACTIVE' || !p.status), [allPrescriptions]);
  const discontinued = useMemo(() => allPrescriptions.filter(p => p.status === 'DISCONTINUED'), [allPrescriptions]);
  const dosingList = useMemo(() => current.filter(p => stateOf(p) !== 'ENDED'), [current]);
  const endedList = useMemo(() => [...current.filter(p => stateOf(p) === 'ENDED'), ...discontinued], [current, discontinued]);
  const cancelledList = useMemo(() => allPrescriptions.filter(p => p.status === 'CANCELLED'), [allPrescriptions]);
  const unknownCount = useMemo(() => dosingList.filter(p => stateOf(p) === 'UNKNOWN').length, [dosingList]);

  const filtered = useMemo(() => {
    if (filter === 'dosing') return dosingList;
    if (filter === 'ended') return endedList;
    if (filter === 'cancelled') return cancelledList;
    return allPrescriptions;
  }, [filter, dosingList, endedList, cancelledList, allPrescriptions]);

  /**
   * 상호작용 점검 대상 — 🔴 **표시와 다른 질문이다.**
   *
   * 종전엔 `status === 'ACTIVE'` 전량을 보냈다. 운영 실측 활성 594건 중 **306건(51.5%)이
   * 이미 투여기간이 끝난 약**이라, 끝난 약끼리의 상호작용 경고가 "현재 복용 중" 경고로 떴다.
   * 거짓 경보는 진짜 경보를 죽인다.
   *
   * 반대로 **기간 미상(`duration` 미기재 186건)은 뺄 수 없다** — 실제로 복용 중일 수 있고,
   * 빠뜨리면 진짜 상호작용을 놓친다. 판정은 shared `isScreenedForInteraction` 하나가 한다.
   */
  const screened = useMemo(
    () => current.filter(p => isScreenedForInteraction(stateOf(p))),
    [current],
  );
  const activeDrugNames = useMemo(() => {
    return screened.flatMap(p => p.items?.map(i => i.drugName) ?? []);
  }, [screened]);

  // 🔴 EP 는 의사·약사 전용 — 간호사·관리자는 늘 403 이었고 화면은 그것을 "AI 응답을 받지 못했습니다"로 말했다(2026-10-03).
  //    권한 밖은 부르지 않고 그 사실을 말한다(점검하지 않은 것 ≠ 이상 없음).
  const interactionAllowed = canRequestDrugInteractionAi(useAuthStore((s) => s.user?.role));
  const { data: interactionData, isError: interactionCheckFailed } = useQuery({
    queryKey: ['drug-interactions', activeDrugNames],
    queryFn: () => apiClient.post<{ data: { interactions?: Record<string, unknown>[] } }>('/api/v1/ai/drug-interactions', { drugs: activeDrugNames }),
    enabled: activeDrugNames.length >= 2 && interactionAllowed,
  });

  // 실응답 정본: { interactions: [{ drug_a, drug_b, severity, description }] } — 2026-07-07 운영 실측.
  // 종전엔 배열로 기대해 항상 빈 목록(성공·실패·무상호작용이 전부 '없음'으로 보이던 버그)
  const _interRaw = interactionData?.data as unknown;
  const _rawItems = (Array.isArray(_interRaw)
    ? _interRaw
    : ((_interRaw as { interactions?: unknown[] } | undefined)?.interactions ?? [])) as Record<string, unknown>[];
  const interactions: DrugInteraction[] = _rawItems.map((it) => ({
    drug1: String(it.drug1 ?? it.drug_a ?? ''),
    drug2: String(it.drug2 ?? it.drug_b ?? ''),
    severity: String(it.severity ?? 'MODERATE').toUpperCase() as DrugInteraction['severity'],
    description: String(it.description ?? ''),
  }));

  const getDoctorName = (p: Prescription) =>
    p.doctorName ?? (p.doctor ? `${p.doctor.familyName ?? ''}${p.doctor.givenName ?? ''}` : '-');

  /**
   * 투약 타임라인.
   *
   * 🔴 종전엔 `p.startDate`/`p.endDate` 를 읽었는데 **Prescription 모델에 그런 컬럼이 없다**
   *    (있는 것은 `createdAt` 과 `duration` 뿐). `startDate` 는 `?? createdAt` 폴백으로
   *    가려져 있었지만 `endDate` 는 **항상 undefined** 라, 모든 막대가 '오늘까지'로 그려지고
   *    끝난 약에도 '진행 중' 맥동 표시가 붙었다.
   *    → 종료는 계산된 투여기간(`dosing.endsAt`)으로만 그린다. 기간 미상이면 종료를 그리지 않는다.
   */
  const timelineItems = useMemo(() => {
    return allPrescriptions
      .flatMap(p => (p.items ?? []).map(item => ({
        drugName: item.drugName,
        nameKo: item.nameKo ?? null,
        nameEn: item.nameEn ?? null,
        ingredient: item.ingredient ?? null,
        startDate: new Date(p.prescribedAt),
        endDate: p.dosing?.endsAt ? new Date(p.dosing.endsAt) : null,
        // 막대의 '진행 중' 표시는 투여기간이 남아 있을 때만 — 취소·기간 종료·기간 미상은 아니다.
        isActive: p.status === 'ACTIVE' && isKnownDosing(stateOf(p)),
      })))
      .filter(t => !Number.isNaN(t.startDate.getTime()))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [allPrescriptions]);

  const timelineRange = useMemo(() => {
    if (timelineItems.length === 0) return { min: new Date(), max: new Date(), totalDays: 1 };
    const min = new Date(Math.min(...timelineItems.map(t => t.startDate.getTime())));
    const max = new Date(Math.max(...timelineItems.map(t => (t.endDate ?? new Date()).getTime())));
    const totalDays = Math.max(differenceInDays(max, min), 1);
    return { min, max, totalDays };
  }, [timelineItems]);

  const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
    { key: 'dosing', label: `투여 중 (${dosingList.length})` },
    { key: 'ended', label: `기간 종료·중단 (${endedList.length})` },
    { key: 'cancelled', label: `취소 (${cancelledList.length})` },
    { key: 'all', label: `전체 (${allPrescriptions.length})` },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      {stopTarget && (
        <DiscontinueDialog prescriptionId={stopTarget.id} name={stopTarget.name}
          onClose={() => setStopTarget(null)} onDone={() => { void refetch(); }} />
      )}
      {renewTarget && (
        <RenewDialog prescriptionId={renewTarget.id} name={renewTarget.items?.[0]?.drugName ?? ''}
          current={{ dosage: renewTarget.items?.[0]?.dosage, frequency: renewTarget.items?.[0]?.frequency, duration: renewTarget.duration ?? null, quantity: (renewTarget as unknown as { quantity?: number | null }).quantity ?? null }}
          onClose={() => setRenewTarget(null)} onDone={() => { void refetch(); }} />
      )}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900"><T k="투약 이력 (Medications)" /></h3>
        <div className="flex gap-1">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                filter === opt.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          {/* 점검 실패는 '이상 없음'과 구분(안전 정보) */}
          {!interactionAllowed && activeDrugNames.length >= 2 && (
            <div className="border border-gray-200 bg-gray-50 rounded-xl p-3 text-xs text-gray-500" data-interaction-gated>
              <T k="약물 상호작용 AI 점검은 의사·약사 권한입니다 — 이 계정에서는 점검하지 않았습니다(이상 없음이 아닙니다)." />
            </div>
          )}
          {interactionCheckFailed && activeDrugNames.length >= 2 && (
            <div className="border border-gray-200 bg-gray-50 rounded-xl p-3 text-xs text-gray-500">
              <T k="약물 상호작용 점검 불가 —" /> {AI_ORIGIN_TEXT} <T k="응답을 받지 못했습니다. 필요 시 수동으로 확인하세요." />
            </div>
          )}

          {/* 🔴 점검 대상의 **분모를 밝힌다** — 무엇을 보고 판정했는지 모르면 결과를 믿을 수 없다.
              끝난 약은 빼고(거짓 경보), 기간 미상은 넣는다(놓치면 진짜 상호작용). */}
          {activeDrugNames.length >= 2 && (
            <p className="text-[11px] text-gray-500">
              상호작용 점검 대상 {screened.length}건
              {unknownCount > 0 && <span className="text-amber-600">(투여기간 미기재 {unknownCount}건 포함)</span>}
              {endedList.length > 0 && ` · 기간 종료 ${endedList.length}건 제외`}
            </p>
          )}
          {/* 대상이 1건 이하면 점검 자체가 성립하지 않는다 — '이상 없음'이라 말하지 않는다 */}
          {activeDrugNames.length < 2 && screened.length > 0 && (
            <p className="text-[11px] text-gray-400">
              상호작용 점검 불가 — 대상 약이 {activeDrugNames.length}건입니다(2건 이상 필요).
            </p>
          )}

          {/* Drug Interaction Warnings */}
          {interactions.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <span className="text-sm font-semibold text-amber-800">{AI_ORIGIN_TEXT} <T k="약물 상호작용 경고" /></span>
              </div>
              <div className="space-y-2">
                {interactions.map((inter, idx) => (
                  <div key={idx} className="text-sm text-amber-700">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold mr-2 whitespace-nowrap ${
                      inter.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                      inter.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                      inter.severity === 'MODERATE' ? 'bg-amber-100 text-amber-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {inter.severity}
                    </span>
                    <strong>{inter.drug1}</strong> + <strong>{inter.drug2}</strong>: {inter.description}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prescriptions list */}
          {filtered.length === 0 ? (
            <EmptyState icon="💊" title="처방 기록이 없습니다" />
          ) : (
            <div className="space-y-4">
              {filtered.map((rx) => (
                <div key={rx.id} className="border border-gray-100 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                    <div className="flex items-center gap-2">
                      {/* 🔴 배지는 두 축을 **따로** 말한다 — 처방 상태(취소 여부)와 투여기간은 다른 사실이다.
                          종전엔 존재하지 않는 'COMPLETED'/'SUSPENDED' 를 '완료'·'보류'로 그렸다. */}
                      {rx.status === 'CANCELLED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap bg-red-100 text-red-700"><T k="취소" /></span>
                      ) : rx.status === 'DISCONTINUED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-gray-200 text-gray-700" title={rx.discontinueReason ?? undefined} data-rx-discontinued>
                          <T k="중단" />{rx.discontinuedAt ? ` ${format(new Date(rx.discontinuedAt), 'MM/dd HH:mm')}` : ''}
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
                          stateOf(rx) === 'DOSING' ? 'bg-blue-100 text-blue-700'
                            : stateOf(rx) === 'ENDED' ? 'bg-gray-100 text-gray-600'
                            : 'bg-amber-50 text-amber-700'
                        }`}>
                          {DOSING_STATE_LABEL[stateOf(rx)]}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        {format(new Date(rx.prescribedAt), 'yyyy-MM-dd')}
                      </span>
                      <span className="text-xs text-gray-400">| {getDoctorName(rx)}</span>
                      <PrescriptionSafetyBadges rx={rx as unknown as Record<string, unknown>} compact />
                      {rx.status === 'DISCONTINUED' && rx.discontinueReason && (
                        <span className="text-[11px] text-gray-500 truncate max-w-[16rem]">· <T k="중단 사유" />: {rx.discontinueReason}</span>
                      )}
                    </div>
                    {/* 활성 처방 중단 — 의사·관리(서버가 책임 처방의·담당 의료군으로 다시 가른다) */}
                    {/* 갱신 — 새 처방으로 잇고 원처방은 중단(2026-09-30) */}
                    {canStop && rx.status === 'ACTIVE' && (
                      <button type="button" onClick={() => setRenewTarget(rx)}
                        className="ml-2 min-h-[36px] rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700" data-rx-renew={rx.id}>
                        <T k="갱신" />
                      </button>
                    )}
                    {canStop && rx.status === 'ACTIVE' && (
                      <button type="button" onClick={() => setStopTarget({ id: rx.id, name: rx.items?.[0]?.drugName ?? '' })}
                        className="ml-2 min-h-[36px] rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 hover:bg-gray-100" data-rx-stop={rx.id}>
                        <T k="중단" />
                      </button>
                    )}
                    {/* 투여기간은 계산된 값이다 — 기간 미상이면 **아무것도 쓰지 않는다**(추정 금지) */}
                    {rx.dosing?.endsAt && (
                      <span className="text-[11px] text-gray-400">
                        {format(new Date(rx.prescribedAt), 'MM/dd')} ~ {format(new Date(rx.dosing.endsAt), 'MM/dd')}
                        {rx.dosing.state === 'ENDED' && rx.dosing.daysSinceEnd != null && (
                          <span className="ml-1 text-gray-400">({rx.dosing.daysSinceEnd}일 경과)</span>
                        )}
                      </span>
                    )}
                  </div>
                  {/* 🔴 조제·검수·불출 — 종전 이 탭은 처방 상태만 그렸고 조제 체인은 **없었다** */}
                  <DispensingChain orders={rx.orders} />
                  {rx.items && rx.items.length > 0 && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="약품명" /></th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="용량" /></th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="복용법" /></th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="기간" /></th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="투여경로" /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rx.items.map((item) => (
                          <tr key={item.id} className="border-b border-gray-50">
                            <td className="px-4 py-2 text-gray-900 font-medium">
                              {item.nameKo != null
                                ? <DrugName nameKo={item.nameKo} nameEn={item.nameEn} ingredient={item.ingredient} />
                                : item.drugName}
                            </td>
                            <td className="px-4 py-2 text-gray-700 font-mono text-xs">{item.dosage}</td>
                            <td className="px-4 py-2 text-gray-700 text-xs">{item.frequency}</td>
                            <td className="px-4 py-2 text-gray-500 text-xs">{item.duration ?? '-'}</td>
                            <td className="px-4 py-2 text-gray-500 text-xs">{item.route ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {rx.reason && (
                    <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-50">
                      <T k="사유" />: {rx.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Medication Timeline */}
          {timelineItems.length > 0 && (
            <div className="border border-gray-100 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-3"><T k="투약 타임라인" /></h4>
              <div className="space-y-2">
                {timelineItems.map((item, idx) => {
                  const startOffset = differenceInDays(item.startDate, timelineRange.min) / timelineRange.totalDays * 100;
                  const endOffset = item.endDate
                    ? differenceInDays(item.endDate, timelineRange.min) / timelineRange.totalDays * 100
                    : 100;
                  const width = Math.max(endOffset - startOffset, 2);
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-28 truncate flex-shrink-0">
                        {item.nameKo != null
                          ? <DrugName nameKo={item.nameKo} nameEn={item.nameEn} ingredient={item.ingredient} />
                          : item.drugName}
                      </span>
                      <div className="flex-1 h-5 bg-gray-50 rounded relative">
                        <div
                          className={`absolute top-0 h-full rounded ${item.isActive ? 'bg-blue-400' : 'bg-gray-300'}`}
                          style={{ left: `${startOffset}%`, width: `${width}%` }}
                        />
                        {item.isActive && (
                          <div
                            className="absolute top-0 h-full w-1 bg-blue-600 rounded-r animate-pulse"
                            style={{ left: `${endOffset}%` }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>{format(timelineRange.min, 'MM/dd')}</span>
                  <span>{format(timelineRange.max, 'MM/dd')}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
