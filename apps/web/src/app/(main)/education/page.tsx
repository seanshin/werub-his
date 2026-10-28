'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, Unit, Unknown } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';

interface EducationProgram {
  id: string;
  name: string;
  category: string;
  validMonths: number;
  isMandatory: boolean;
}

/** 서버 응답 정본(2026-08 W7) — FE 가 읽던 `staffName`/`programName` 은 서버에 없던 키였다. */
interface ExpiryItem {
  id: string;
  staffId: string;
  /** null = 직원 원장에서 못 찾음(추정하지 않는다) */
  staffName: string | null;
  department: string | null;
  position: string | null;
  employmentStatus: string | null;
  programId: string;
  programName: string | null;
  programCategory: string | null;
  isMandatory: boolean;
  completedAt?: string;
  /** 🔴 null = 무기한(갱신 불요) — '만료됨'이 아니다 */
  expiresAt: string | null;
  indefinite?: boolean;
  score: number | null;
  /** 음수 = 실효 경과일, 0 이상 = 남은 일수. null = 무기한(산출 불가) */
  daysLeft: number | null;
}
interface ExpiryBucket { total: number; truncated: boolean; items: ExpiryItem[] }
interface ExpiryResponse {
  asOf: string;
  horizonDays: number;
  limit: number;
  expired: ExpiryBucket;
  dueSoon: ExpiryBucket;
}
interface CoverageResponse {
  asOf: string;
  activeStaffTotal: number;
  withAnyRecord: number;
  withoutAnyRecord: number;
  completionRate: number | null;
  completionRateUnavailableReason: string;
  staffWithoutAnyRecord: {
    total: number;
    truncated: boolean;
    items: { staffId: string; staffName: string; department: string; position: string }[];
  };
}

/** `{ data: X }` / `{ data: { data: X } }` 양쪽을 견디는 언랩(래핑 계층이 환경마다 다름) */
function unwrap<T>(res: unknown): T | undefined {
  const outer = (res as { data?: unknown } | undefined)?.data;
  if (outer && typeof outer === 'object' && 'data' in (outer as Record<string, unknown>)) {
    return (outer as { data: T }).data;
  }
  return outer as T | undefined;
}

const PREVIEW_ROWS = 10;

export default function EducationPage() {
  const programsQ = useQuery({
    queryKey: ['edu-programs'],
    queryFn: () => apiClient.get<{ data: EducationProgram[] | { data: EducationProgram[] } }>('/api/v1/education/programs'),
  });
  const expiryQ = useQuery({
    queryKey: ['edu-expiring'],
    queryFn: () => apiClient.get<{ data: ExpiryResponse | { data: ExpiryResponse } }>('/api/v1/education/expiring'),
  });
  const coverageQ = useQuery({
    queryKey: ['edu-coverage'],
    queryFn: () => apiClient.get<{ data: CoverageResponse | { data: CoverageResponse } }>('/api/v1/education/coverage'),
  });

  if (programsQ.isError) return <QueryErrorFallback error={programsQ.error} onRetry={programsQ.refetch} />;

  const eduList = unwrap<EducationProgram[]>(programsQ.data) ?? [];
  const expiry = unwrap<ExpiryResponse>(expiryQ.data);
  const coverage = unwrap<CoverageResponse>(coverageQ.data);

  const expiredTotal = expiry?.expired.total ?? 0;
  const dueSoonTotal = expiry?.dueSoon.total ?? 0;

  return (
    <div>
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">직원 교육</h2>
          <p className="text-sm text-gray-500 mt-1">교육 프로그램 및 자격 만료 관리</p>
        </div>
        {/*
          🔴 종전엔 배지가 하나였고 "만료 임박 261건" 이라고만 했다. 그 중 194건(74%)은
             이미 실효된 기록이었고 가장 오래된 것은 7.5개월 전이었다. 법정 의무교육에서
             **실효를 '임박'으로 완화 표기**하면 위반 사실이 화면에서 사라진다 → 두 배지로 분리.
        */}
        {expiry ? (
          <div className="flex items-center gap-2">
            {expiredTotal > 0 && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 rounded-xl border border-red-200">
                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span className="text-sm font-semibold text-red-700">만료(실효) {expiredTotal}<Unit>건</Unit></span>
              </div>
            )}
            {dueSoonTotal > 0 && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 rounded-xl border border-amber-100">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-semibold text-amber-700">{expiry.horizonDays}일 내 만료 {dueSoonTotal}<Unit>건</Unit></span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 만료/임박 — 조회 실패는 빈 목록으로 흡수하지 않는다 */}
      {expiryQ.isError ? (
        <div className="mb-6">
          <QueryErrorFallback error={expiryQ.error} onRetry={expiryQ.refetch} size="compact" />
        </div>
      ) : expiryQ.isLoading ? (
        <div className="mb-6 h-24 rounded-2xl bg-gray-50 animate-pulse" />
      ) : expiry ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <ExpiryPanel
            tone="red"
            title="만료(실효) — 재이수 기한 경과"
            emptyTitle="실효된 이수 기록이 없습니다"
            bucket={expiry.expired}
            limit={expiry.limit}
          />
          <ExpiryPanel
            tone="amber"
            title={`만료 임박 — ${expiry.horizonDays}일 내 도래`}
            emptyTitle={`${expiry.horizonDays}일 내 만료 예정이 없습니다`}
            bucket={expiry.dueSoon}
            limit={expiry.limit}
          />
        </div>
      ) : null}

      {/* 이수 기록 보유 현황 — 🔴 '이수율'이 아니다(대상자 모델 부재) */}
      <CoveragePanel query={coverageQ} coverage={coverage} />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">프로그램</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">카테고리</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">유효기간</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">구분</th>
            </tr>
          </thead>
          <tbody>
            {programsQ.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 w-24 bg-gray-100 rounded-lg animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !eduList.length ? (
              <tr>
                <td colSpan={4} className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                  </svg>
                  <p className="text-sm text-gray-400">등록된 교육 프로그램이 없습니다</p>
                </td>
              </tr>
            ) : (
              eduList.map((p: EducationProgram) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="px-5 py-4 font-medium text-gray-900">{p.name}</td>
                  <td className="px-5 py-4 text-gray-600 text-xs">{p.category}</td>
                  {/* 🔴 valid_months=0 은 '갱신 불요(무기한)' 이지 "0개월"이 아니다 */}
                  <td className="px-5 py-4 text-gray-500 text-xs">
                    {p.validMonths > 0
                      ? <>{p.validMonths}<Unit>개월</Unit></>
                      : <span className="text-gray-400" title="유효기간이 없어 재이수가 필요하지 않습니다">무기한 · 갱신 불요</span>}
                  </td>
                  <td className="px-5 py-4">
                    {p.isMandatory ? (
                      <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-700">필수</span>
                    ) : (
                      <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-50 text-gray-500">선택</span>
                    )}
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

function ExpiryPanel({ tone, title, emptyTitle, bucket, limit }: {
  tone: 'red' | 'amber';
  title: string;
  emptyTitle: string;
  bucket: ExpiryBucket;
  limit: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? bucket.items : bucket.items.slice(0, PREVIEW_ROWS);
  const styles = tone === 'red'
    ? { box: 'bg-red-50/60 border-red-200', head: 'text-red-800', day: 'text-red-700' }
    : { box: 'bg-amber-50/50 border-amber-100', head: 'text-amber-800', day: 'text-amber-700' };

  return (
    <div className={`rounded-2xl border p-5 ${styles.box}`}>
      <div className="flex items-baseline justify-between mb-3">
        <p className={`text-xs font-semibold ${styles.head}`}>{title}</p>
        <p className="text-xs text-gray-500">{bucket.total}<Unit>건</Unit></p>
      </div>

      {bucket.total === 0 ? (
        <EmptyState compact title={emptyTitle} />
      ) : (
        <>
          <div className="space-y-1.5">
            {shown.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 text-sm border-b border-black/5 pb-1.5 last:border-0">
                <span className="text-gray-800 truncate">
                  {e.staffName ?? <Unknown kind="UNRECORDED" />}
                  {e.department ? <span className="text-gray-400 text-xs"> ({e.department})</span> : null}
                  <span className="text-gray-400"> · </span>
                  {e.programName ?? <Unknown kind="UNRECORDED" />}
                  {e.isMandatory && <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">필수</span>}
                </span>
                {/* 🔴 무기한(null)은 만료 목록에 오지 않지만, 와도 '만료'로 말하지 않는다 */}
                <span className={`text-xs font-semibold whitespace-nowrap ${e.indefinite || e.expiresAt === null ? 'text-gray-500' : styles.day}`}>
                  {e.indefinite || e.expiresAt === null
                    ? '무기한(갱신 불요)'
                    : <>
                        {kdate(e.expiresAt)}
                        {e.daysLeft === null ? '' : e.daysLeft < 0 ? ` · ${Math.abs(e.daysLeft)}일 경과` : ` · D-${e.daysLeft}`}
                      </>}
                </span>
              </div>
            ))}
          </div>

          {/* 🔴 종전엔 5건만 그리고 나머지 256건을 화면 어디에도 말하지 않았다 — 잘렸으면 잘렸다고 말한다 */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              {bucket.total}건 중 {shown.length}건 표시
              {bucket.truncated && (
                <span className="text-gray-400"> · 서버 상한 {limit}건까지만 전송됩니다(전체 확인은 내보내기 필요)</span>
              )}
            </span>
            {bucket.items.length > PREVIEW_ROWS && (
              <button onClick={() => setExpanded((v) => !v)} className="font-medium text-blue-600 hover:underline">
                {expanded ? '접기' : `전체 ${bucket.items.length}건 보기`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 이수 기록 보유 현황 — 🔴 '이수율'을 만들지 않는다.
 * 교육 프로그램에 대상 직종·부서 필드가 없어 분모(수강 대상자)를 정의할 데이터 자체가 없다.
 * 지금 확실한 사실(재직자 / 기록 보유자 / 무기록자)만 말하고, 이수율은 '산출 불가'라고 적는다.
 */
function CoveragePanel({ query, coverage }: {
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  coverage?: CoverageResponse;
}) {
  const [showMissing, setShowMissing] = useState(false);

  if (query.isError) {
    return <div className="mb-6"><QueryErrorFallback error={query.error} onRetry={query.refetch} size="compact" /></div>;
  }
  if (query.isLoading || !coverage) {
    return <div className="mb-6 h-20 rounded-2xl bg-gray-50 animate-pulse" />;
  }

  return (
    <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p className="text-xs font-semibold text-gray-700">이수 기록 보유 현황</p>
        <p className="text-sm text-gray-800">
          재직 <span className="font-bold">{coverage.activeStaffTotal}</span><Unit>명</Unit>
          <span className="text-gray-300 mx-2">|</span>
          기록 보유 <span className="font-bold text-emerald-600">{coverage.withAnyRecord}</span><Unit>명</Unit>
          <span className="text-gray-300 mx-2">|</span>
          기록 없음 <span className="font-bold text-red-600">{coverage.withoutAnyRecord}</span><Unit>명</Unit>
        </p>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        <span className="font-medium text-gray-600">이수율 산출 불가</span> — {coverage.completionRateUnavailableReason}
      </p>

      {coverage.staffWithoutAnyRecord.total > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowMissing((v) => !v)} className="text-xs font-medium text-blue-600 hover:underline">
            {showMissing ? '무기록자 명단 접기' : `무기록자 ${coverage.staffWithoutAnyRecord.total}명 명단 보기`}
          </button>
          {showMissing && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {coverage.staffWithoutAnyRecord.items.map((s) => (
                <span key={s.staffId} className="text-[11px] px-2 py-1 rounded-lg bg-red-50 text-red-700">
                  {s.staffName}<span className="text-red-400"> · {s.department} {s.position}</span>
                </span>
              ))}
              {coverage.staffWithoutAnyRecord.truncated && (
                <span className="text-[11px] px-2 py-1 text-gray-500">
                  … {coverage.staffWithoutAnyRecord.total}명 중 {coverage.staffWithoutAnyRecord.items.length}명만 표시(서버 상한)
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
