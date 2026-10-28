'use client';

/**
 * 예약 진료 예상 본인부담(2026-10-20 포털 P3 B6 · 결정 `portal.costEstimate` = SHOW_AS_ESTIMATE).
 *  · 🔴 늘 "예측 자료 — 실제와 다를 수 있음"을 먼저 말한다 · 펼칠 때만 부른다
 *  · 진찰료는 수납 계산 정본 · 모르면 금액 대신 이유(0원·미등재를 0원이라 말하지 않는다)
 *  · 최근 같은 진료과 범위는 표본 수와 함께 · 표본 0 이면 "알 수 없음"
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { currency } from '../_helpers';
import { PT } from '../_shared/PT';
import { Unit } from '@/components/ui/display';

export interface CostEstimate {
  appointmentId: string;
  estimate: true;
  consultation: {
    code: string | null; name: string | null; visitKind: 'INITIAL' | 'FOLLOW_UP';
    totalAmount: number | null; patientCopay: number | null;
    basis: 'ELIGIBILITY' | 'INSURANCE_TYPE_FALLBACK' | 'UNKNOWN';
    unknownReason: 'INSTITUTION_GRADE_UNKNOWN' | 'CONSULT_CODE_UNREGISTERED' | 'CONSULT_PRICE_UNKNOWN' | 'COPAY_RATE_UNKNOWN' | null;
  };
  recent: { department: string | null; sampleSize: number; min: number | null; max: number | null };
}

const UNKNOWN_REASON: Record<NonNullable<CostEstimate['consultation']['unknownReason']>, string> = {
  INSTITUTION_GRADE_UNKNOWN: '병원 종별 설정을 확인할 수 없어 계산할 수 없습니다',
  CONSULT_CODE_UNREGISTERED: '진찰료 수가가 등록되어 있지 않아 계산할 수 없습니다',
  CONSULT_PRICE_UNKNOWN: '진찰료 단가를 알 수 없어 계산할 수 없습니다',
  COPAY_RATE_UNKNOWN: '보험 자격 확인 전이라 본인부담률을 알 수 없습니다',
};

export function CostEstimatePanel({ appointmentId }: { appointmentId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['portal-cost-estimate', appointmentId],
    queryFn: () => apiClient.get<{ data: CostEstimate }>(`/api/v1/portal/appointments/${appointmentId}/cost-estimate`),
    enabled: open,
    retry: false,
  });
  const est = q.data?.data;

  return (
    <div className="mt-2 pt-2 border-t">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-portal-cost-estimate-toggle
        className="text-xs font-medium text-amber-700 hover:text-amber-900">
        <PT k="예상 진료비 보기" /> {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-1.5 text-xs" data-portal-cost-estimate>
          <p className="font-semibold text-amber-800" data-portal-cost-estimate-disclaimer>
            <PT k="예측 자료입니다 — 실제 진료비와 다를 수 있습니다." />
          </p>
          {q.isLoading && <p className="text-gray-500"><PT k="불러오는 중…" /></p>}
          {q.isError && <p className="text-rose-600"><PT k="예상 진료비를 불러오지 못했습니다." /></p>}
          {est && (
            <>
              <div className="flex justify-between gap-2">
                <span className="text-gray-600">
                  {est.consultation.visitKind === 'INITIAL' ? <PT k="초진 진찰료 본인부담" /> : <PT k="재진 진찰료 본인부담" />}
                </span>
                {est.consultation.patientCopay != null
                  ? <span className="font-semibold text-gray-900" data-portal-cost-consult>{currency(est.consultation.patientCopay)}</span>
                  // 금액을 모르면 금액 대신 이유만 — 0원이라 말하지 않는다
                  : <span className="text-gray-500 text-right" data-portal-cost-consult-unknown>
                      {est.consultation.unknownReason ? <PT k={UNKNOWN_REASON[est.consultation.unknownReason]} /> : <PT k="계산할 수 없습니다" />}
                    </span>}
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-600"><PT k="최근 같은 진료과 본인부담" /></span>
                {est.recent.sampleSize > 0 && est.recent.min != null && est.recent.max != null
                  ? <span className="text-gray-900" data-portal-cost-recent>
                      {est.recent.min === est.recent.max ? currency(est.recent.min) : `${currency(est.recent.min)} ~ ${currency(est.recent.max)}`}
                      <span className="text-gray-400"> (<PT k="최근" /> {est.recent.sampleSize}<Unit>회</Unit>)</span>
                    </span>
                  : <span className="text-gray-500" data-portal-cost-recent-none><PT k="기록이 없어 알 수 없음" /></span>}
              </div>
              <p className="text-[11px] text-gray-500">
                <PT k="검사·처방·비급여 항목은 진료 뒤에 정해져 포함하지 않았습니다." />
                {est.consultation.basis === 'INSURANCE_TYPE_FALLBACK' && <> <PT k="보험 자격 확인 전이라 보험 유형 기준으로 계산했습니다." /></>}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
