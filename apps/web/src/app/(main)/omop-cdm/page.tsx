'use client';

import { useState, type ReactNode } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { EmptyState, Unknown, CapabilityBadge } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Data } from '@/components/ui/i18n-text';

/**
 * OMOP CDM 현황 화면.
 *
 * 🔴 2026-08-14 화면 실사용 점검 W7 — 이 화면은 3개 탭 전부가 날조였다.
 *    "CDM 1,005만 건"(하드코딩) · "품질 91점"(새로고침마다 바뀌는 난수) ·
 *    5초 뒤 "완료 100%"(아무것도 변환하지 않음). 연구·규제 심사에 그대로 제시되면 허위가 된다.
 *    지금 이 화면은 **CDM 이 아직 구축되지 않았다는 사실**과 **변환 대상(소스 EMR) 실측 건수**만 말한다.
 */

// ── Types (서버 정본과 1:1) ──

interface CdmTableStatus {
  tableName: string;
  cdmTableExists: boolean;
  /** 테이블이 없으면 null — '없음'과 '0건'을 구분한다 */
  cdmRecordCount: number | null;
  lastUpdated: string | null;
  sourceTables: string[];
  /** CDM 변환 결과가 아니라 변환 대상(소스) 실측 */
  sourceRecordCount: number | null;
}

interface CdmTableStatusResponse {
  cdmVersion: string;
  cdmBuilt: boolean;
  pipeline: 'NOT_IMPLEMENTED';
  checkedAt: string;
  notice: string;
  tables: CdmTableStatus[];
  sourceTotal: number;
  cdmTotal: number | null;
}

interface QualityReport {
  cdmVersion: string;
  status: 'NOT_AVAILABLE';
  reason: string;
  generatedAt: string | null;
  overallScore: number | null;
  tables: unknown[];
  summary: {
    totalRecords: number | null;
    avgCompleteness: number | null;
    avgConformance: number | null;
    avgPlausibility: number | null;
    passRate: number | null;
  };
}

interface ApiResponse<T> {
  data: T;
}

// ── Constants ──

const TABS = [
  { key: 'convert', label: '변환 실행' },
  { key: 'tables', label: '테이블 현황' },
  { key: 'quality', label: '품질 리포트' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** 변환 파이프라인 미구현 사유 — 서버 notice 가 오기 전 기본 문구 */
const PIPELINE_NOTICE =
  'EMR → OMOP CDM 변환 파이프라인은 아직 구현되지 않았습니다. 이 화면의 건수는 CDM 산출물이 아니라 변환 대상(소스 EMR) 실측입니다.';

// ── Helpers ──

function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as ApiResponse<T>).data;
  }
  return raw as T;
}

function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

// ── Component ──

export default function OmopCdmPage() {
  const [tab, setTab] = useState<TabKey>('convert');

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">OMOP CDM 변환</h1>
          <CapabilityBadge
            mode="readonly"
            label="변환 미구현"
            reason={PIPELINE_NOTICE}
          />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          OHDSI OMOP Common Data Model v5.4 변환 계획과 변환 대상(소스 EMR) 현황을 보여줍니다.
        </p>
      </div>

      <NoticeBanner />

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {tab === 'convert' && <ConvertTab />}
      {tab === 'tables' && <TablesTab />}
      {tab === 'quality' && <QualityTab />}
    </div>
  );
}

/** 🔴 화면 어디에도 "실데이터가 아니다"라는 표기가 없던 것이 이 화면 최대 결함이었다 */
function NoticeBanner() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">CDM 미구축 — 연구·규제 제출 근거로 사용할 수 없습니다.</p>
      <p className="mt-1 text-xs leading-relaxed">
        {PIPELINE_NOTICE} CDM 테이블(person·visit_occurrence·condition_occurrence·drug_exposure 등)은
        현재 데이터베이스에 존재하지 않으며, 품질 지표(완전성·적합성·타당성)를 산출하는 검증 로직도 없습니다.
      </p>
    </div>
  );
}

// ── Tab 1: 변환 실행 (미구현) ──

function ConvertTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['cdm-tables'],
    queryFn: () => apiClient.fetch<ApiResponse<CdmTableStatusResponse>>('/api/v1/cdm/tables'),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">로딩 중...</div>;
  }
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const status = data ? unwrap<CdmTableStatusResponse>(data) : null;
  const tables = status?.tables ?? [];

  return (
    <div className="space-y-6">
      {/* Source → Target 매핑 (계획) */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Source → Target 매핑 (계획)</h2>
          <p className="mt-1 text-xs text-gray-500">
            HospitalRUN EMR 테이블 → OMOP CDM v5.4 매핑 설계안입니다. 아직 실행된 적이 없습니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">CDM 테이블</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">소스 테이블 (EMR)</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">CDM 테이블 생성 여부</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tables.map((t) => (
                <tr key={t.tableName} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-gray-800">
                    {t.tableName}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">
                    {t.sourceTables.join(', ')}
                  </td>
                  <td className="px-4 py-2">
                    <ExistsBadge exists={t.cdmTableExists} />
                  </td>
                </tr>
              ))}
              {tables.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <EmptyState icon="🗂️" title="매핑 정보를 불러오지 못했습니다." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 실행 (비활성) */}
      <div className="rounded-lg border bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-800">변환 실행</p>
            <p className="mt-1 text-xs text-gray-500">
              🔴 변환기(ETL)가 구현되어 있지 않습니다. 실행 버튼은 비활성이며, API 는 501 Not Implemented 로
              응답합니다 — 변환하지 않고 &lsquo;완료&rsquo;라고 적지 않기 위함입니다.
            </p>
          </div>
          <button
            type="button"
            disabled
            title={PIPELINE_NOTICE}
            className="cursor-not-allowed rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-500"
          >
            변환 실행 (미구현)
          </button>
        </div>
      </div>
    </div>
  );
}

function ExistsBadge({ exists }: { exists: boolean }) {
  return exists ? (
    <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      생성됨
    </span>
  ) : (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      미생성
    </span>
  );
}

// ── Tab 2: 테이블 현황 ──

function TablesTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['cdm-tables'],
    queryFn: () => apiClient.fetch<ApiResponse<CdmTableStatusResponse>>('/api/v1/cdm/tables'),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">로딩 중...</div>;
  }
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const status = data ? unwrap<CdmTableStatusResponse>(data) : null;
  const tables = status?.tables ?? [];
  const maxSource = tables.reduce((m, t) => Math.max(m, t.sourceRecordCount ?? 0), 1);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            변환 대상(소스 EMR) 현황 · CDM 테이블 실재 여부
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            막대는 <strong>변환 대상 소스 건수</strong>입니다. CDM 변환 결과가 아닙니다.
          </p>
          {/* 서버가 내려보내는 사실 고지를 화면이 그대로 말한다(FE 가 따로 지어내지 않는다) */}
          {status?.notice && (
            <p className="mt-1 text-xs text-amber-700">{status.notice}</p>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 border-b p-4 sm:grid-cols-4">
          <SummaryCard
            label="CDM 레코드"
            value={
              status?.cdmTotal == null ? (
                <span className="text-base text-gray-400">미구축</span>
              ) : (
                formatNumber(status.cdmTotal)
              )
            }
            hint={status?.cdmBuilt ? 'OMOP 테이블 실측' : 'OMOP 테이블 없음'}
          />
          <SummaryCard
            label="변환 대상(소스) 레코드"
            value={formatNumber(status?.sourceTotal ?? 0)}
            hint="EMR 실측 · 변환 결과 아님"
          />
          <SummaryCard label="CDM 테이블 수" value={String(tables.length)} hint="v5.4 매핑 대상" />
          <SummaryCard
            label="최종 변환"
            value={<Unknown kind="NA" className="text-base" />}
            hint="변환 이력 없음"
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">CDM 테이블</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">생성 여부</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">CDM 건수</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">
                  변환 대상(소스) 건수
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">최종 변환</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tables.map((t) => {
                const src = t.sourceRecordCount ?? 0;
                const pct = (src / maxSource) * 100;
                return (
                  <tr key={t.tableName} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-gray-800">
                      {t.tableName}
                      <div className="mt-0.5 font-sans text-[11px] font-normal text-gray-400">
                        ← {t.sourceTables.join(', ')}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <ExistsBadge exists={t.cdmTableExists} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                      {t.cdmRecordCount == null ? (
                        <Unknown kind="NA" />
                      ) : (
                        formatNumber(t.cdmRecordCount)
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <div className="h-4 w-40 overflow-hidden rounded bg-gray-100">
                          <div
                            className="h-full rounded bg-slate-400"
                            style={{ width: `${Math.max(pct, src > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                        <span className="w-20 text-right text-xs tabular-nums text-gray-600">
                          {formatNumber(src)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {t.lastUpdated ? (
                        kdate(t.lastUpdated, 'datetimeSec')
                      ) : (
                        <Unknown kind="NA" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {tables.length === 0 && (
          <EmptyState icon="🗂️" title="표시할 테이블이 없습니다." />
        )}
      </div>

      {status && (
        <p className="text-xs text-gray-400">
          조회 시각: {kdate(status.checkedAt, 'datetimeSec')} · CDM v{status.cdmVersion}
        </p>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-800">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

// ── Tab 3: 품질 리포트 (산출 불가) ──

function QualityTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['cdm-quality'],
    queryFn: () => apiClient.fetch<ApiResponse<QualityReport>>('/api/v1/cdm/quality'),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">로딩 중...</div>;
  }
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const report = data ? unwrap<QualityReport>(data) : null;

  return (
    <div className="space-y-6">
      {/* 지표 카드 — 값이 없으므로 '산출 불가'라고 말한다(난수·상수 금지) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {['종합 점수', '완전성', '적합성', '타당성', '통과율'].map((label) => (
          <div key={label} className="rounded-lg border bg-white p-4 text-center shadow-sm">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-2 text-sm font-semibold text-gray-400">산출 불가</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">테이블별 품질 상세</h2>
          <p className="mt-1 text-xs text-gray-500">
            CDM v{report?.cdmVersion ?? '5.4'} · 산출된 리포트 없음
          </p>
        </div>
        <EmptyState
          icon="📉"
          title="품질 지표를 산출할 수 없습니다."
          hint={
            // 🔴 서버 사유는 데이터다 — 키로 조회하면 "번역 미등록" 티가 거짓으로 붙는다
            report?.reason
              ? <Data>{report.reason}</Data>
              : 'CDM 데이터가 없고 품질 검증(Data Quality Dashboard) 로직도 구현되어 있지 않습니다.'
          }
        />
      </div>

      <p className="text-xs text-gray-400">
        🔴 종전 이 탭은 난수로 완전성·적합성·타당성을 만들어 새로고침할 때마다 종합점수가
        바뀌었습니다(90.7 → 92.0 → 91.4). 검증 로직이 생기기 전까지 점수를 표시하지 않습니다.
      </p>
    </div>
  );
}
