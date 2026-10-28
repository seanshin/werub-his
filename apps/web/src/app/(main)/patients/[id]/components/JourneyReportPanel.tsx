'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Duration, EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { JOURNEY_EVENT_ALIASES, journeyEventDisplay } from '@hospital-run/shared';

/** 유형 라벨 — 표시 정본(원 코드를 그리지 않는다 · 어휘 밖은 '기록 종류 미등록') */
function TypeLabel({ eventType }: { eventType: string }) {
  const d = journeyEventDisplay(eventType) ?? journeyEventDisplay(JOURNEY_EVENT_ALIASES[eventType]);
  return d ? <span title={eventType}><T k={d.label} /></span> : <span title={eventType} className="text-gray-400"><T k="기록 종류 미등록" /></span>;
}

/**
 * 환자 여정 기간 보고서(기획 patient-journey-tracking §3.4) — 기간을 고르면 유형별 건수·간격을 보여 준다.
 *
 * 🔴 여정 이벤트는 발행이 배선된 행위만 남는다 — "0건"은 "그 일이 없었다"가 아니라 "기록되지 않았다"일 수 있다(화면이 말한다).
 * 🔴 간격은 양 끝 이벤트가 모두 있을 때만 — 없으면 "산출 불가"(0 으로 그리지 않는다).
 */
interface JourneyReport {
  period: { from: string | null; to: string | null; source: 'ADMISSION' | 'RANGE' };
  events: { total: number; truncated: boolean; byType: Array<{ eventType: string; count: number }>; firstAt: string | null; lastAt: string | null };
  intervals: { erStayMinutes: number | null; admitToSurgeryMinutes: number | null; surgeryMinutes: number | null; excludedUnknownTime?: number };
  /** (여정 P2) 이 기간 시작 뒤에야 기록되기 시작한 사건 · since=null 은 시작을 확인하지 못함 */
  observationScope?: Array<{ eventType: string; since: string | null }>;
  counts: { prescriptionAdded: number; labResult: number; imagingResult: number };
}

function IntervalCell({ label, minutes, needs }: { label: string; minutes: number | null; needs: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <div className="text-[11px] text-gray-400"><T k={label} /></div>
      <div className="text-sm font-semibold text-gray-800">
        {minutes == null ? <span className="text-gray-400" data-testid="interval-na"><T k="산출 불가" /></span> : <Duration minutes={minutes} />}
      </div>
      {/* 왜 비었는지 — 양 끝 기록(발생 시각 포함)이 모두 있어야 잰다 */}
      {minutes == null && <div className="mt-0.5 text-[10px] text-gray-400"><T k={needs} /></div>}
    </div>
  );
}

export function JourneyReportPanel({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // 시작일이 종료일보다 늦으면 부르지 않고 그 자리에서 말한다(서버 400 을 오류 화면으로 띄우지 않는다)
  const reversed = !!from && !!to && from > to;
  const ready = !!from && !!to && !reversed;
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['journey-report', patientId, from, to],
    queryFn: () => apiClient.get<{ data: JourneyReport }>(`/api/v1/journey/${patientId}/report?from=${from}&to=${to}`),
    enabled: ready,
  });
  const report = data?.data;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3" data-testid="journey-report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900"><T k="기간 보고서" /></h3>
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="min-h-[36px] rounded border px-2 py-1" aria-label={tAttr('시작일')} />
          <span aria-hidden>~</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="min-h-[36px] rounded border px-2 py-1" aria-label={tAttr('종료일')} />
        </div>
      </div>
      {reversed && <p role="alert" className="text-xs text-rose-600"><T k="시작일이 종료일보다 늦습니다" /></p>}
      <p className="text-[11px] text-gray-500">
        <T k="여정 이벤트는 기록이 배선된 행위만 남습니다 — 0건은 그 일이 없었다는 뜻이 아닐 수 있습니다" />
      </p>
      {!ready ? (
        <EmptyState compact title={<T k="시작일과 종료일을 고르면 보고서를 만듭니다" />} />
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : !report || isFetching ? (
        <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-gray-600">
            <Tf k="기록된 이벤트 {건수}건" params={{ 건수: report.events.total }} />
            {report.events.firstAt && report.events.lastAt && (
              <span className="ml-2 text-gray-400">{kdate(new Date(report.events.firstAt), 'datetimeShort')} ~ {kdate(new Date(report.events.lastAt), 'datetimeShort')}</span>
            )}
            {report.events.truncated && <span className="ml-2 text-amber-700"><T k="조회 상한에 걸려 일부만 집계했습니다" /></span>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <IntervalCell label="응급실 체류" minutes={report.intervals.erStayMinutes} needs="도착·퇴실 기록이 모두 있어야 잽니다" />
            <IntervalCell label="입원→수술 시작" minutes={report.intervals.admitToSurgeryMinutes} needs="입원·수술 시작 기록이 모두 있어야 잽니다" />
            <IntervalCell label="수술 시간" minutes={report.intervals.surgeryMinutes} needs="수술 시작·종료 기록이 모두 있어야 잽니다" />
          </div>
          {/* (여정 P1) 간격은 발생 시각으로만 잰다 — 발생 시각을 모르는 기록은 뺐다고 말한다(기록 시각으로 대신하지 않는다) */}
          {/* (여정 P2 · I7) 기록이 시작되기 전 기간의 부재는 "없었다"가 아니다 — 빈 간격을 이력 없음으로 읽지 않게 말한다 */}
          {(report.observationScope ?? []).length > 0 && (
            <ul className="space-y-0.5 text-xs text-gray-600">
              {(report.observationScope ?? []).map((o) => (
                <li key={o.eventType}>
                  <TypeLabel eventType={o.eventType} />{' '}
                  {o.since
                    ? <Tf k="— {날짜}부터 기록합니다(그 전 기간은 기록 범위 밖)" params={{ 날짜: kdate(new Date(o.since), 'date') }} />
                    : <T k="— 기록을 시작한 시점을 확인하지 못했습니다" />}
                </li>
              ))}
            </ul>
          )}
          {(report.intervals.excludedUnknownTime ?? 0) > 0 && (
            <p className="text-xs text-amber-700">
              <Tf k="발생 시각을 모르는 기록 {건수}건은 간격 계산에서 뺐습니다" params={{ 건수: report.intervals.excludedUnknownTime ?? 0 }} />
            </p>
          )}
          {report.events.byType.length === 0 ? (
            <EmptyState compact title={<T k="이 기간에 기록된 여정 이벤트가 없습니다" />} />
          ) : (
            <ul className="grid grid-cols-2 gap-1 text-xs md:grid-cols-4">
              {report.events.byType.map((b) => (
                <li key={b.eventType} className="flex justify-between rounded bg-gray-50 px-2 py-1">
                  <span className="text-gray-700"><TypeLabel eventType={b.eventType} /></span>
                  <span className="tabular-nums text-gray-900">{b.count}<Unit><T k="건" /></Unit></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
