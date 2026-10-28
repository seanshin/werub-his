'use client';

import type React from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Ratio } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

/**
 * 🔴 이 화면의 수치는 인증 심사 자료로 나갈 수 있다(2026-08-14 W8·P15).
 *    종전엔 서버가 지표 10건을 'PASS' 상수로, 총계를 `59` 리터럴로 돌려줬고 화면은
 *    "달성률 90%"를 그렸다 — 아무것도 측정하지 않은 채로. 지금은 서버가 실집계로 판정하고
 *    못 세는 지표는 '미측정'이라 말한다. **화면은 미측정을 통과로 반올림하지 않는다.**
 */

const STATUS_COLOR: Record<string, string> = {
  PASS: 'bg-emerald-50 text-emerald-700', PARTIAL: 'bg-amber-50 text-amber-700', FAIL: 'bg-red-50 text-red-700',
  NOT_MEASURED: 'bg-gray-100 text-gray-500',
};
const STATUS_LABEL: Record<string, string> = {
  PASS: '충족', PARTIAL: '부분충족', FAIL: '미충족', NOT_MEASURED: '미측정',
};

interface EmrCertIndicator {
  id: string;
  name: string;
  category?: string;
  basis?: string;
  measured?: boolean;
  status: string;
}

interface EmrCertSummary {
  registered?: number;
  measured?: number;
  notMeasured?: number;
  passRate?: number | null;
  passRateBasis?: string;
  passed?: number;
  partial?: number;
  failed?: number;
  standardIndicatorCount?: number | null;
  standardCountKey?: string;
  coverage?: number | null;
  evaluatedAt?: string;
  indicators?: EmrCertIndicator[];
}

export default function EmrCertPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['emr-cert'],
    queryFn: () => apiClient.get<{ data: EmrCertSummary }>('/api/v1/emr-cert/checklist'),
  });

  const summary = data?.data;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="EMR 인증 체크리스트" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="전자의무기록 시스템 인증 기준 충족 현황" /></p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="h-8 w-16 bg-gray-100 rounded-lg animate-pulse mx-auto mb-2" />
              <div className="h-3 w-12 bg-gray-50 rounded-lg animate-pulse mx-auto" />
            </div>
          ))}
        </div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : summary && (
        <>
          <div className="grid grid-cols-5 gap-4 mb-3">
            {([
              // 🔴 달성률의 분모는 '자동 집계로 판정한 지표'(measured)다 — 정본 `<Ratio>` 로 분모를 함께 낸다.
              //    측정 0건이면 0% 가 아니라 '산출 불가'이며, 그 판정은 `<Ratio>` 가 한다(자체 삼항 없음).
              { label: '달성률', value: <Ratio numerator={summary.passed} denominator={summary.measured} unavailableHint="자동 집계로 판정한 지표 없음" />, color: 'text-blue-600' },
              { label: '충족', value: summary.passed ?? 0, color: 'text-emerald-600' },
              { label: '부분충족', value: summary.partial ?? 0, color: 'text-amber-600' },
              { label: '미충족', value: summary.failed ?? 0, color: 'text-red-600' },
              { label: '미측정', value: summary.notMeasured ?? 0, color: 'text-gray-500' },
            ] as { label: string; value: React.ReactNode; color: string }[]).map((s) => (
              // 🔴 5열에 text-2xl <Ratio> — 값이 접히면 그 칸만 높아져 나머지 4칸이 위로 쏠린다
              <div key={s.label} className="flex flex-col justify-center bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
                <p className={`overflow-x-auto whitespace-nowrap text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs font-medium text-gray-500 mt-1"><T k={s.label} /></p>
              </div>
            ))}
          </div>

          {/* 분모를 화면이 스스로 밝힌다 — "몇 개 중 몇 개"를 숨기면 90% 가 전체 달성률로 읽힌다 */}
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-900 space-y-1">
            <p>
              <b>{summary.passRateBasis ?? '판정 근거 없음'}</b>
              {' · '}자가점검에 등재된 지표 {summary.registered ?? 0}개 중 자동 집계 {summary.measured ?? 0}개 · 미측정 {summary.notMeasured ?? 0}개
            </p>
            <p>
              {summary.standardIndicatorCount == null ? (
                <>인증 기준의 전체 지표 수가 <b>등록되어 있지 않습니다</b> — 등재율(커버리지)을 산출할 수 없습니다.
                  시스템 설정 <code className="font-mono">{summary.standardCountKey ?? 'emrCert.standardIndicatorCount'}</code> 에 기준 지표 수를 등록하세요.</>
              ) : (
                <>인증 기준 {summary.standardIndicatorCount}개 지표 중 <b>{summary.registered ?? 0}개만 자가점검에 등재</b>(등재율 {summary.coverage ?? 0}%) —
                  나머지는 이 화면에서 판정되지 않습니다.</>
              )}
            </p>
            <p className="text-amber-700">
              이 화면의 수치는 <b>심사 제출 자료가 아닙니다</b>. 미측정 지표는 담당자 점검 결과를 별도로 확보해야 합니다.
              {summary.evaluatedAt && <> (집계 시각 {kdate(summary.evaluatedAt, 'datetimeSec')})</>}
            </p>
          </div>
        </>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="인증항목" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="카테고리" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="판정 근거(실집계)" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 w-24 bg-gray-100 rounded-lg animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !summary?.indicators?.length ? (
              <tr>
                <td colSpan={4} className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                  </svg>
                  <p className="text-sm text-gray-400"><T k="인증 체크리스트가 없습니다" /></p>
                </td>
              </tr>
            ) : (
              summary.indicators.map((i: EmrCertIndicator) => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="px-5 py-4 font-medium text-gray-900">{i.name}</td>
                  <td className="px-5 py-4 text-gray-600 text-xs">{i.category ?? '-'}</td>
                  <td className={`px-5 py-4 text-xs max-w-[320px] ${i.measured ? 'text-gray-600' : 'text-gray-400 italic'}`}>{i.basis ?? <T k="근거 없음" />}</td>
                  <td className="px-5 py-4">
                    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[i.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      <T k={STATUS_LABEL[i.status] ?? i.status} />
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
