'use client';
import Link from 'next/link';
import ApiWidget from '../ApiWidget';
import { T } from '@/components/ui/i18n-text';
import { Money, Ratio, Unit } from '@/components/ui/display';

/**
 * 경영 요약 — `GET /api/v1/executive/overview`(경영 화면 `/executive` 와 **같은 응답**).
 *
 * 🔴 (2026-10-02 역할별 대시보드 재검토) 경영진 기본 배치의 '오늘 수익'·'청구 현황'·'일일 정산'·'병원 현황'이
 *    수납·청구·예약 EP 를 불러 **경영진 계정에 전부 403**이었다(12칸 중 4칸 "권한 없음").
 *    그 EP 들을 경영진에게 여는 대신, 경영진이 이미 쓰는 경영 정본(`/executive/*`)을 읽는다 — 같은 사실에 정본 하나.
 *    값이 없으면(표본 0) 0원으로 그리지 않고 그 사실을 말한다.
 */
interface Metric { value: number | null; n: number }
interface Overview {
  revenue?: { accrued?: Metric; collected?: Metric };
  unpaid?: { amount?: number | null; count?: number | null };
  todayPatients?: number | null;
  bedOccupancyPct?: { numerator?: number; denominator?: number };
  icuOccupancyPct?: { numerator?: number; denominator?: number };
}

function MoneyMetric({ m }: { m?: Metric }) {
  if (!m) return <span className="text-gray-400">-</span>;
  // 표본 0 = 오늘 해당 건이 없다(0원과 같은 모양으로 그리지 않고 건수로 말한다)
  if (m.n === 0) return <span className="text-gray-500"><T k="해당 건 없음" /></span>;
  return <><Money value={m.value} className="font-semibold text-gray-900" /> <span className="text-[11px] text-gray-400">({m.n}<Unit>건</Unit>)</span></>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-50 py-1.5 last:border-0">
      <span className="text-gray-500"><T k={label} /></span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

export default function ExecutiveSummaryWidget() {
  return <ApiWidget widgetId="executive-summary" endpoint="/api/v1/executive/overview" refetchInterval={120000} render={(raw) => {
    const d = (raw ?? {}) as Overview;
    return (
      <div className="flex h-full flex-col text-xs" data-executive-summary>
        <Row label="오늘 청구 발생"><MoneyMetric m={d.revenue?.accrued} /></Row>
        <Row label="오늘 수납 확정"><MoneyMetric m={d.revenue?.collected} /></Row>
        <Row label="미수납(전 기간)">
          {d.unpaid?.amount == null ? <span className="text-gray-400">-</span> : <><Money value={d.unpaid.amount} className="font-semibold text-amber-700" /> <span className="text-[11px] text-gray-400">({d.unpaid.count ?? '-'}<Unit>건</Unit>)</span></>}
        </Row>
        <Row label="오늘 외래 환자">{d.todayPatients ?? '-'}<Unit>명</Unit></Row>
        <Row label="병상 가동률"><Ratio numerator={d.bedOccupancyPct?.numerator} denominator={d.bedOccupancyPct?.denominator} unavailableHint="등록 병상 0" /></Row>
        <Row label="중환자실 가동률"><Ratio numerator={d.icuOccupancyPct?.numerator} denominator={d.icuOccupancyPct?.denominator} unavailableHint="등록 병상 0" /></Row>
        <div className="mt-auto pt-2 text-[11px]"><Link href="/executive" className="text-blue-600 hover:underline"><T k="경영 화면" /></Link></div>
      </div>
    );
  }} />;
}
