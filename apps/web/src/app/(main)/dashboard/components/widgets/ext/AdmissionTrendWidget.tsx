'use client';
import ApiWidget from '../ApiWidget';
import { T, Tf } from '@/components/ui/i18n-text';
import { KDate, Unit } from '@/components/ui/display';

/**
 * 입원 추이 — operational-stats/admission-trends(기본 최근 30일)
 *   서버: { totalAdmissions, totalDischarges, avgStayDays|null, avgStayDaysSampleN, dailyTrends:[{date, admissions}] }
 * 🔴 (2026-10-02) 종전엔 응답을 배열로 읽어(`asArray(d)` — 응답은 객체) **개통 이래 "입원 데이터 없음"**이었다.
 *    일별 행은 입원이 있었던 날만 온다 — 없는 날을 0 행으로 지어내지 않고, 기간 합계를 함께 말한다.
 *    평균 재원일수는 표본(기간 안 퇴원)이 0 이면 산출하지 않는다.
 */
interface Trends { totalAdmissions?: number; totalDischarges?: number; avgStayDays?: number | null; avgStayDaysSampleN?: number; dailyTrends?: Array<{ date: string; admissions: number }> }

export default function AdmissionTrendWidget() {
  return <ApiWidget widgetId="admission-trend" endpoint="/api/v1/operational-stats/admission-trends" render={(raw) => {
    const d = (raw ?? {}) as Trends;
    const days = [...(d.dailyTrends ?? [])].reverse();
    return (
      <div className="flex h-full flex-col text-xs">
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-gray-600">
          <span><T k="최근 30일" /></span>
          <span><T k="입원" /> <b className="text-gray-900 tabular-nums">{d.totalAdmissions ?? '-'}</b><Unit>건</Unit></span>
          <span><T k="퇴원" /> <b className="text-gray-900 tabular-nums">{d.totalDischarges ?? '-'}</b><Unit>건</Unit></span>
          <span><T k="평균 재원일수" /> {d.avgStayDays == null
            ? <span className="text-gray-400"><T k="기간 안 퇴원 없음 — 계산하지 않음" /></span>
            : <b className="text-gray-900">{d.avgStayDays}<Unit>일</Unit> <span className="font-normal text-gray-400">(n={d.avgStayDaysSampleN ?? 0})</span></b>}</span>
        </div>
        {days.length === 0
          ? <p className="text-gray-400"><T k="이 기간 입원 없음" /></p>
          : days.slice(0, 7).map((t) => (
            <div key={t.date} className="flex justify-between border-b border-gray-50 py-1 last:border-0">
              <KDate value={t.date} mode="monthDayWeekday" className="text-gray-600" />
              <span className="tabular-nums text-gray-800"><Tf k="{수}건" params={{ 수: t.admissions }} /></span>
            </div>
          ))}
        {days.length > 7 && <p className="pt-1 text-[11px] text-gray-400"><Tf k="입원이 있었던 {전체}일 중 최근 {표시}일" params={{ 전체: days.length, 표시: 7 }} /></p>}
      </div>
    );
  }} />;
}
