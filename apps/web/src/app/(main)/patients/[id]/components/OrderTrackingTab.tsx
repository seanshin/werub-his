'use client';

import { useState, useMemo } from 'react';
import { Unknown } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { safeFormat as format } from '@/lib/safe-date';
import { pollMs } from '@/lib/ui-settings';
import { dispensingStage, DISPENSING_STAGE_LABEL } from '@hospital-run/shared';

interface DispensingInfo {
  id: string;
  status: 'PENDING' | 'DISPENSED' | 'VERIFIED' | 'ISSUED' | 'CANCELLED';
  careType?: string;
  dispensedAt?: string | null;
  secondCheckAt?: string | null;
  verifiedAt?: string | null;
  issuedAt?: string | null;
  /** 수령자 — 외래: 환자/보호자명, 입원: 병동/인수자 */
  issuedTo?: string | null;
}

interface OrderInfo {
  id: string;
  department: 'PHARMACY' | 'LAB' | 'IMAGING';
  status: 'ORDERED' | 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  pharmacyType?: string;
  receivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  priority: string;
  createdAt: string;
  /** 🔴 약국 오더의 진짜 진행 단계는 여기 있다 — `order.status` 는 조제 완료에서 이미 닫힌다. */
  dispensing?: DispensingInfo | null;
}

interface PrescriptionWithOrders {
  id: string;
  type: 'MEDICATION' | 'LAB' | 'IMAGING';
  status: 'ACTIVE' | 'CANCELLED' | 'DISCONTINUED';
  dosage?: string;
  frequency?: string;
  duration?: number;
  quantity?: number;
  priority: string;
  createdAt: string;
  medicationCode?: { code: string; nameKo: string; nameEn?: string };
  procedureCode?: { code: string; nameKo: string; nameEn?: string; category?: string };
  drugName?: string;
  name?: string;
  instructions?: string | null;
  code?: string;
  orders?: OrderInfo[];
  encounter?: {
    createdAt: string;
    doctor?: { familyName: string; givenName: string };
  };
}

type FilterType = 'in-progress' | 'completed' | 'all';

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  IMAGING:    { icon: '\uD83D\uDCF7', label: '영상', color: 'bg-indigo-100 text-indigo-700' },
  LAB:        { icon: '\uD83E\uDE78', label: '검사', color: 'bg-teal-100 text-teal-700' },
  MEDICATION: { icon: '\uD83D\uDC8A', label: '약국', color: 'bg-amber-100 text-amber-700' },
};

const STEP_LABELS: Record<string, string[]> = {
  IMAGING:    ['처방', '접수@상태', '촬영', '판독'],
  LAB:        ['처방', '접수@상태', '검사중', '완료'],
  // 🔴 약은 **다섯 단계**다. 종전 4단계(`['처방','접수','조제','불출']`)는 **검수를 통째로 빼먹었고**,
  //    `order.status === 'COMPLETED'` 를 4단계 전부 채운 것으로 그려서
  //    **조제만 끝난 건이 '불출 완료'로 보였다**(실측 5건이 그 상태로 차트에 '완료').
  MEDICATION: ['처방', '접수@상태', '조제', '검수', '불출'],
};

function getOrderProgress(prescription: PrescriptionWithOrders): {
  currentStep: number;
  statusLabel: string;
  statusColor: string;
  timestamps: (string | null)[];
} {
  const order = prescription.orders?.[0];
  const isMed = prescription.type === 'MEDICATION';
  const stepCount = isMed ? 5 : 4;
  const blanks = (n: number) => Array<string | null>(n).fill(null);

  // 중단(2026-09-30) — 진행 단계는 그대로 두고(이미 된 것은 됐다) 상태만 '중단'으로 말한다
  if (prescription.status === 'DISCONTINUED' && (!order || order.status === 'CANCELLED')) {
    return {
      currentStep: 0,
      statusLabel: '중단',
      statusColor: 'bg-gray-200 text-gray-700',
      timestamps: [format(new Date(prescription.createdAt), 'MM/dd'), ...blanks(stepCount - 1)],
    };
  }
  if (prescription.status === 'CANCELLED') {
    return {
      currentStep: 0,
      statusLabel: '취소',
      statusColor: 'bg-red-100 text-red-700',
      timestamps: [format(new Date(prescription.createdAt), 'MM/dd'), ...blanks(stepCount - 1)],
    };
  }

  if (!order) {
    return {
      currentStep: 1,
      statusLabel: '처방됨',
      statusColor: 'bg-blue-100 text-blue-700',
      timestamps: [format(new Date(prescription.createdAt), 'MM/dd'), ...blanks(stepCount - 1)],
    };
  }

  const fmtDate = (d?: string | null) => d ? format(new Date(d), 'MM/dd') : null;
  const prescribedDate = format(new Date(prescription.createdAt), 'MM/dd');

  // ── 약국 오더: 조제 체인이 정본 ──
  // 🔴 `order.status` 는 **조제 완료 시점에 이미 COMPLETED** 로 닫힌다(`completeDispensing`).
  //    검수(VERIFIED)·불출(ISSUED)은 그 뒤에 온다. 그래서 오더 상태만 읽으면
  //    **검수 전·불출 전인데 차트가 '완료'** 라고 말한다. 조제가 있으면 조제가 정본이다.
  //    상태 전이는 바꾸지 않는다(소비처가 여럿) — 화면이 사실을 말하게 한다.
  if (isMed) {
    const d = order.dispensing;
    const stage = dispensingStage({ orderStatus: order.status, dispensingStatus: d?.status });
    const ts: (string | null)[] = [
      prescribedDate,
      fmtDate(order.receivedAt),
      fmtDate(d?.dispensedAt),
      fmtDate(d?.verifiedAt),
      fmtDate(d?.issuedAt),
    ];
    switch (stage) {
      case 'CANCELLED':
        return { currentStep: 0, statusLabel: '조제 취소', statusColor: 'bg-red-100 text-red-700', timestamps: ts };
      case 'NOT_STARTED':
        return {
          currentStep: order.status === 'RECEIVED' ? 2 : 1,
          statusLabel: order.status === 'RECEIVED' ? '접수됨' : '처방됨',
          statusColor: order.status === 'RECEIVED' ? 'bg-sky-100 text-sky-700' : 'bg-blue-100 text-blue-700',
          timestamps: ts,
        };
      case 'PREPARING':
        return { currentStep: 2, statusLabel: DISPENSING_STAGE_LABEL.PREPARING, statusColor: 'bg-violet-100 text-violet-700', timestamps: ts };
      case 'DISPENSED':
        // 🔴 3단계까지만 찬다 — 검수·불출은 아직 일어나지 않았다.
        return { currentStep: 3, statusLabel: DISPENSING_STAGE_LABEL.DISPENSED, statusColor: 'bg-amber-100 text-amber-700', timestamps: ts };
      case 'VERIFIED':
        return { currentStep: 4, statusLabel: DISPENSING_STAGE_LABEL.VERIFIED, statusColor: 'bg-amber-100 text-amber-700', timestamps: ts };
      case 'ISSUED':
        return { currentStep: 5, statusLabel: DISPENSING_STAGE_LABEL.ISSUED, statusColor: 'bg-emerald-100 text-emerald-700', timestamps: ts };
    }
  }

  switch (order.status) {
    case 'ORDERED':
      return {
        currentStep: 1,
        statusLabel: '처방됨',
        statusColor: 'bg-blue-100 text-blue-700',
        timestamps: [prescribedDate, null, null, null],
      };
    case 'RECEIVED':
      return {
        currentStep: 2,
        statusLabel: '접수됨',
        statusColor: 'bg-sky-100 text-sky-700',
        timestamps: [prescribedDate, fmtDate(order.receivedAt), null, null],
      };
    case 'IN_PROGRESS':
      return {
        currentStep: 3,
        statusLabel: '진행중',
        statusColor: 'bg-violet-100 text-violet-700',
        timestamps: [prescribedDate, fmtDate(order.receivedAt), fmtDate(order.startedAt), null],
      };
    case 'COMPLETED':
      return {
        currentStep: 4,
        statusLabel: '완료',
        statusColor: 'bg-emerald-100 text-emerald-700',
        timestamps: [prescribedDate, fmtDate(order.receivedAt), fmtDate(order.startedAt), fmtDate(order.completedAt)],
      };
    case 'CANCELLED':
      return {
        currentStep: 0,
        statusLabel: '취소',
        statusColor: 'bg-red-100 text-red-700',
        timestamps: [prescribedDate, fmtDate(order.receivedAt), null, null],
      };
    default:
      return {
        currentStep: 1,
        statusLabel: '처방됨',
        statusColor: 'bg-blue-100 text-blue-700',
        timestamps: [prescribedDate, null, null, null],
      };
  }
}

function ProgressBar({ currentStep, labels, timestamps }: {
  currentStep: number;
  labels: string[];
  timestamps: (string | null)[];
}) {
  return (
    <div className="mt-3 mb-1">
      {/* Progress line with dots */}
      <div className="flex items-center gap-0">
        {labels.map((label, idx) => {
          const isFilled = idx < currentStep;
          const isCurrent = idx === currentStep - 1;
          return (
            <div key={idx} className="flex items-center flex-1 last:flex-none">
              {/* Dot */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                    isFilled
                      ? isCurrent
                        ? 'bg-blue-600 border-blue-600 ring-2 ring-blue-200'
                        : 'bg-blue-500 border-blue-500'
                      : 'bg-white border-gray-300'
                  }`}
                />
                <span className={`text-[10px] mt-1.5 ${isFilled ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                  <T k={label} />
                </span>
                <span className="text-[9px] text-gray-400 mt-0.5">
                  {/* '모른다'와 '아직 아니다'를 구분 — 도달한 단계의 시각 부재는 기록 없음(추정 금지), 미도달은 공백 */}
                  {timestamps[idx] ?? (isFilled ? <Unknown kind="UNRECORDED" className="text-[9px]" /> : ' ')}
                </span>
              </div>
              {/* Line */}
              {idx < labels.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${idx < currentStep - 1 ? 'bg-blue-500' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 조제 원장이 실제로 담고 있는 사실 — 검수 시각·2인확인·불출 시각·**수령자**.
 *
 * 🔴 이 정보들은 개통 이래 **차트 어느 탭에도 없었다.** 서버 응답이 `dispensing` 을
 *    include 하지 않았고(봉합함), 화면도 부르지 않았다. 운영 `issuedTo` 325건·검수 시각
 *    전량이 약국 화면 밖에서는 보이지 않는 상태였다.
 *
 * 규약: **일어난 것만 적는다.** 미발생 시각은 칸 자체를 만들지 않는다(빈칸은 "모른다"로 읽힌다).
 */
function DispensingFacts({ prescription }: { prescription: PrescriptionWithOrders }) {
  const d = prescription.orders?.[0]?.dispensing;
  if (!d) return null;

  const rows: Array<{ label: string; value: string }> = [];
  if (d.dispensedAt) rows.push({ label: '조제', value: format(new Date(d.dispensedAt), 'MM/dd HH:mm') });
  if (d.secondCheckAt) rows.push({ label: '2인확인', value: format(new Date(d.secondCheckAt), 'MM/dd HH:mm') });
  if (d.verifiedAt) rows.push({ label: '검수', value: format(new Date(d.verifiedAt), 'MM/dd HH:mm') });
  if (d.issuedAt) rows.push({ label: '불출', value: format(new Date(d.issuedAt), 'MM/dd HH:mm') });
  // 🔴 수령자가 비어 있으면 **적지 않는다** — '-' 도 '환자'도 쓰지 않는다(누가 받았는지는 모른다).
  if (d.issuedTo) rows.push({ label: '수령', value: d.issuedTo });
  if (d.careType === 'INPATIENT') rows.push({ label: '구분', value: '입원 조제' });

  if (rows.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {rows.map((r) => (
        <span key={r.label} className="text-[11px] text-gray-500">
          <span className="text-gray-400"><T k={r.label} /></span> {r.value}
        </span>
      ))}
      {/* 불출됐는데 수령자가 비어 있다 — 일어난 일과 기록의 차이를 숨기지 않는다 */}
      {d.issuedAt && !d.issuedTo && (
        <span className="text-[11px] text-amber-600"><T k="수령자 미기재" /></span>
      )}
    </div>
  );
}

export function OrderTrackingTab({ patientId }: { patientId: string }) {
  const [filter, setFilter] = useState<FilterType>('in-progress');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-prescriptions-orders', patientId],
    queryFn: () =>
      apiClient.get<{ data: PrescriptionWithOrders[] }>(
        `/api/v1/prescriptions/patient/${patientId}`,
      ),
    enabled: !!patientId,
    refetchInterval: pollMs('fast'),
  });

  const _raw = data?.data;
  const allPrescriptions: PrescriptionWithOrders[] = Array.isArray(_raw)
    ? _raw
    : ((_raw as Record<string, unknown> | undefined)?.data as PrescriptionWithOrders[] ?? []);

  /**
   * 🔴 "끝났는가"를 `order.status === 'COMPLETED'` 로 판정하면 **약은 틀린다** —
   *    약국 오더는 조제 완료 시점에 이미 COMPLETED 라, 검수·불출 대기 건이 '완료' 탭으로
   *    빠져 진행 중 목록에서 사라졌다. 약은 **불출(ISSUED)까지 가야** 끝난 것이다.
   */
  const isDone = (p: PrescriptionWithOrders) => {
    const order = p.orders?.[0];
    if (!order) return false;
    if (p.type === 'MEDICATION') {
      return dispensingStage({ orderStatus: order.status, dispensingStatus: order.dispensing?.status }) === 'ISSUED';
    }
    return order.status === 'COMPLETED';
  };

  const inProgressList = useMemo(
    // 🔴 중단(2026-09-30)된 처방은 접수 전 오더가 취소돼 '진행 중'이 아니다 — 이미 시작된 오더만 진행 중으로 남긴다
    () => allPrescriptions.filter((p) => p.status !== 'CANCELLED' && !isDone(p)
      && !(p.status === 'DISCONTINUED' && (!p.orders?.[0] || p.orders[0].status === 'CANCELLED'))),
    [allPrescriptions],
  );

  const completedList = useMemo(() => allPrescriptions.filter(isDone), [allPrescriptions]);

  const filtered = useMemo(() => {
    if (filter === 'in-progress') return inProgressList;
    if (filter === 'completed') return completedList;
    return allPrescriptions;
  }, [filter, inProgressList, completedList, allPrescriptions]);

  const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
    { key: 'in-progress', label: `진행 중 (${inProgressList.length})` },
    { key: 'completed', label: `완료 (${completedList.length})` },
    { key: 'all', label: `전체 (${allPrescriptions.length})` },
  ];

  const getPrescriptionName = (p: PrescriptionWithOrders) =>
    p.medicationCode?.nameKo ?? p.procedureCode?.nameKo ?? p.drugName ?? p.name ?? p.instructions ?? p.medicationCode?.code ?? p.procedureCode?.code ?? p.code ?? (p.type === 'MEDICATION' ? '처방약' : p.type === 'LAB' ? '검사 오더' : p.type === 'IMAGING' ? '영상 오더' : '오더');

  const getDoctorName = (p: PrescriptionWithOrders) => {
    const doc = p.encounter?.doctor;
    return doc ? `${doc.familyName ?? ''}${doc.givenName ?? ''}` : null;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">
          <T k="오더 추적 (Order Tracking)" />
        </h3>
        <div className="flex gap-1">
          {FILTER_OPTIONS.map((opt) => (
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
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">
          {filter === 'in-progress'
            ? <T k="진행 중인 오더가 없습니다" />
            : filter === 'completed'
              ? <T k="완료된 오더가 없습니다" />
              : <T k="오더 기록이 없습니다" />}
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map((prescription) => {
            const tc = TYPE_CONFIG[prescription.type] ?? TYPE_CONFIG.MEDICATION;
            const progress = getOrderProgress(prescription);
            const steps = STEP_LABELS[prescription.type] ?? STEP_LABELS.MEDICATION;

            return (
              <div
                key={prescription.id}
                className="border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl flex-shrink-0">{tc.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {getPrescriptionName(prescription)}
                      </p>
                      {prescription.type === 'MEDICATION' && prescription.dosage && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {prescription.dosage}
                          {prescription.frequency ? ` / ${prescription.frequency}` : ''}
                          {prescription.duration ? ` / ${prescription.duration}일` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${tc.color}`}>
                      {tc.label}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${progress.statusColor}`}>
                      {progress.statusLabel}
                    </span>
                    {prescription.priority === 'STAT' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-red-100 text-red-700">
                        STAT
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar — 취소(0단계)는 진행선을 그리지 않는다 */}
                {progress.currentStep > 0 && (
                  <ProgressBar
                    currentStep={progress.currentStep}
                    labels={steps}
                    timestamps={progress.timestamps}
                  />
                )}

                {/* 🔴 조제 원장의 사실 — 종전에는 **차트 어느 탭에도 없었다**(운영 수령자 325건이
                    화면에서 보이지 않았다). 일어난 것만 적는다: 없는 시각은 칸을 만들지 않는다. */}
                <DispensingFacts prescription={prescription} />

                {/* Footer */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                  <span className="text-[11px] text-gray-400">
                    <T k="처방의" />: {getDoctorName(prescription) ?? <Unknown kind="UNRECORDED" />}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {format(new Date(prescription.createdAt), 'yyyy-MM-dd HH:mm')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
