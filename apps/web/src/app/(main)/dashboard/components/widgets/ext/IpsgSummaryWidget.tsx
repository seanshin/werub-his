'use client';

import ApiStatsWidget from '../ApiStatsWidget';
import { Ratio } from '@/components/ui/display';

/**
 * IPSG 환자안전 요약(국제환자안전목표) — BE `GET /api/v1/safety/ipsg-summary`(최근 30일).
 * IPSG.2 위기값 보고 · IPSG.5 감염관리/손위생 · IPSG.6 낙상예방 통합 카드.
 * (IPSG.1 환자확인·3 고위험약물·4 수술부위는 전용 화면 참조)
 *
 * 🔴 2026-08-20 — 손위생 준수율이 **분모 없는 퍼센트**였다(관찰 2건 중 1건도 50%).
 *    준수율이 낮게 나와도 "관찰 4건 중 2건"이면 개선 대상이 손위생이 아니라 **관찰 표본**이다.
 *    서버가 `handHygieneNumerator`/`handHygieneDenominator` 를 함께 내고, 여기서 정본 `<Ratio>` 로 그린다.
 */
const n = (v: unknown) => (typeof v === 'number' ? v : null);

export default function IpsgSummaryWidget() {
  return (
    <ApiStatsWidget
      widgetId="ipsg-summary"
      endpoint="/api/v1/safety/ipsg-summary"
      stats={[
        { key: 'ipsg2_criticalValue.pending', label: '위기값 미확인', color: 'text-red-600' },
        { key: 'ipsg5_infectionControl.activeInfections', label: '활성 감염', color: 'text-amber-600' },
        {
          key: 'ipsg5_infectionControl.handHygieneCompliancePct',
          label: '손위생 준수(수행/관찰·30일)',
          color: 'text-emerald-600',
          format: (_v, row) => {
            const hh = (row?.ipsg5_infectionControl ?? {}) as Record<string, unknown>;
            return (
              <Ratio
                className="text-sm"
                numerator={n(hh.handHygieneNumerator)}
                denominator={n(hh.handHygieneDenominator)}
                unavailableHint="30일 관찰 0건"
              />
            );
          },
        },
        { key: 'ipsg6_fallPrevention.highRiskPatients', label: '낙상 고위험', color: 'text-amber-600' },
      ]}
    />
  );
}
