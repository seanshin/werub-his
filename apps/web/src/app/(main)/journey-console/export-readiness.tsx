'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { JOURNEY_EPISODE_LABEL, JOURNEY_EPISODE_OBJECT_TYPES, type JourneyObjectType } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Ratio } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface Readiness {
  caseType: string;
  period: { from: string; to: string; basis: 'RECORDED_AT' };
  events: { total: number; withOccurredAt: number; unknownTime: number; mappable: number; unmappable: number; byOrigin: Record<string, number> };
  flattening: { cases: number; relatedToCase: number; deficiency: number; convergence: number };
  export: { available: false; reason: 'NO_EXPORT_PATH'; decisionKey: string };
}

/**
 * (여정 P3-1 · 2026-10-01) 반출 준비도 — 운영자 전용·접힘 기본. **집계만** 보인다(사건·환자 데이터를 내보내지 않는다).
 * 🔴 반출 경로는 없다 — 허용 여부가 허가권자 결정(`journey.exportMode`)이라 그 자리에서 결정 화면으로 보낸다.
 *    평탄화 경고(결핍·수렴)는 표준 형식(XES)이 사례 하나를 고르게 할 때 잃는 것을 미리 잰다.
 */
export function ExportReadiness() {
  const tAttr = useTAttr();
  const [open, setOpen] = useState(false);
  const [caseType, setCaseType] = useState<string>('EmergencyVisit');
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['jc-export-readiness', caseType],
    queryFn: () => apiClient.get<{ data: Readiness }>('/api/v1/journey/export-readiness', { caseType }),
    enabled: open,
  });
  const r = data?.data;
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-700">
        <span><T k="여정 반출 준비도" /> <span className="ml-1 text-[11px] font-normal text-gray-400"><T k="운영자용 · 집계만" /></span></span>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
          <p className="rounded bg-gray-50 px-2 py-1 text-gray-600">
            <T k="반출 경로는 없습니다 — 반출 허용은 허가권자 결정 사항입니다" />{' '}
            <Link href="/admin/decisions" className="text-blue-600 hover:underline"><T k="결정 화면" /></Link>
          </p>
          <label className="flex items-center gap-2">
            <span><T k="사례 기준" /></span>
            <select value={caseType} onChange={(e) => setCaseType(e.target.value)} className="min-h-[32px] rounded border px-2 py-1">
              {JOURNEY_EPISODE_OBJECT_TYPES.map((t) => (
                <option key={t} value={t}>{tAttr(JOURNEY_EPISODE_LABEL[t as JourneyObjectType] ?? t)}</option>
              ))}
            </select>
          </label>
          {isError ? (
            <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
          ) : isLoading || !r ? (
            <div className="h-16 animate-pulse rounded bg-gray-100" />
          ) : (
            <>
              <p className="text-gray-400">
                <Tf k="기록 시각 기준 {시작} ~ {끝}" params={{ 시작: kdate(new Date(r.period.from), 'date'), 끝: kdate(new Date(r.period.to), 'date') }} />
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-4">
                <div><dt className="text-gray-400"><T k="사건" /></dt><dd className="tabular-nums text-gray-900">{r.events.total.toLocaleString()}</dd></div>
                <div><dt className="text-gray-400"><T k="발생 시각 있음" /></dt><dd className="tabular-nums">{r.events.withOccurredAt.toLocaleString()} <span className="text-gray-400">(<Ratio numerator={r.events.withOccurredAt} denominator={r.events.total} pctOnly />)</span></dd></div>
                <div><dt className="text-gray-400"><T k="반출 시 빠짐(시각 미상)" /></dt><dd className="tabular-nums text-amber-700">{r.events.unknownTime.toLocaleString()}</dd></div>
                <div><dt className="text-gray-400"><T k="활동 매핑 불가" /></dt><dd className="tabular-nums">{r.events.unmappable.toLocaleString()}</dd></div>
                <div><dt className="text-gray-400"><T k="사례 수" /></dt><dd className="tabular-nums">{r.flattening.cases.toLocaleString()}</dd></div>
                <div><dt className="text-gray-400"><T k="사례에 묶인 사건" /></dt><dd className="tabular-nums">{r.flattening.relatedToCase.toLocaleString()} <span className="text-gray-400">(<Ratio numerator={r.flattening.relatedToCase} denominator={r.events.total} pctOnly />)</span></dd></div>
                <div><dt className="text-gray-400"><T k="평탄화 결핍" /></dt><dd className="tabular-nums">{r.flattening.deficiency.toLocaleString()}</dd></div>
                <div><dt className="text-gray-400"><T k="평탄화 수렴" /></dt><dd className="tabular-nums">{r.flattening.convergence.toLocaleString()}</dd></div>
              </dl>
              <p className="text-gray-500">
                <T k="출처별" />{' '}
                {Object.entries(r.events.byOrigin).map(([k, v]) => <span key={k} className="mr-2 font-mono">{k} {v.toLocaleString()}</span>)}
              </p>
              <p className="text-[11px] text-gray-400"><T k="결핍 = 이 사례 기준에 묶이지 않는 사건 · 수렴 = 한 사건이 사례 여럿에 묶임 — 표준 형식은 사례 하나만 고르므로 이 사건들이 왜곡된다" /></p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
