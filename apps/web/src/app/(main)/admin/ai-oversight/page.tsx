'use client';

/**
 * AI 감독 관제 `/admin/ai-oversight` (3410) — 기획서 §2.3 P2.
 *
 * 🔴 **이 화면은 판정하지 않는다.** 세고, 세지 못한 것을 세지 못했다고 말한다.
 *    AI 제안 원장(`AiProposal`)은 방금 배선돼 행이 거의 없다 — 그래서 이 화면이 가장 자주 그리는 것은
 *    숫자가 아니라 **'산출 불가'와 그 사유**다. 표본 부재를 `0%` 로 그리면 "아무 문제 없음"으로 읽힌다.
 *
 * 🔴 규칙(전부 이 저장소 실측에서 나온 것):
 *    · `queryFn` 안에서 `.catch(() => 기본값)` 을 쓰지 않는다 — 쓰면 `isError` 가 영원히 false 가 되어
 *      아래 `QueryErrorFallback` 이 **도달 불가 코드**가 된다(서버가 죽어도 "제안 0건"이라 말하게 된다).
 *    · 로딩 / 실패 / 없음을 셋으로 가른다(아직 안 온 것과 모르는 것과 없는 것은 다른 사실이다).
 *    · 폴링 주기는 `pollMs()`(SystemConfig `ui.*`) — 숫자 리터럴을 박지 않는다.
 *    · 비율은 `<Ratio>` 하나로 — '산출 불가' 문구를 화면이 손으로 적지 않는다.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AI_ORIGIN_TEXT, AI_PROPOSAL_KINDS } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { kstToday } from '@/lib/kst-today';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import {
  AxisTable,
  CallsPanel,
  CountCard,
  QuickAcceptPanel,
  RateCard,
  ReviewTimingPanel,
  ScribeEditPanel,
  StatusBar,
  type CallsResult,
  type ScribeEditStats,
  type OversightSummary,
  type QuickAcceptPolicy,
} from './parts';

const BASE = '/api/v1/admin/ai-oversight';
const DAYS = [7, 30, 90] as const;

export default function AiOversightPage() {
  const [days, setDays] = useState<number>(7);
  const [kind, setKind] = useState<string>('');
  const [modelRef, setModelRef] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();

  const summaryQ = useQuery({
    queryKey: ['ai-oversight', 'summary', days, kind, modelRef],
    // 🔴 `.catch` 없음 — 실패는 그대로 던져 `isError` 가 되어야 한다
    queryFn: () =>
      apiClient.get<{ data: OversightSummary; meta: { quickAcceptPolicy: QuickAcceptPolicy } }>(BASE + '/summary', {
        days,
        ...(kind ? { kind } : {}),
        ...(modelRef ? { modelRef } : {}),
      }),
    refetchInterval: pollMs('slow'),
  });

  const callsQ = useQuery({
    queryKey: ['ai-oversight', 'calls', days],
    queryFn: () => apiClient.get<{ data: CallsResult }>(BASE + '/calls', { days }),
    refetchInterval: pollMs('slow'),
  });

  // 스크라이브 초안 ↔ 확정 수정량 — 🔴 `.catch` 없음(실패는 isError 로)
  const scribeQ = useQuery({
    queryKey: ['ai-oversight', 'scribe-edits', days],
    queryFn: () => apiClient.get<{ data: ScribeEditStats }>(BASE + '/scribe-edits', { days }),
    refetchInterval: pollMs('slow'),
  });

  const summary = summaryQ.data?.data;
  const policy = summaryQ.data?.meta?.quickAcceptPolicy;
  const calls = callsQ.data?.data;

  /** 모델 선택지는 **호출 원장**에서 온다 — 요약을 모델로 거른 결과에서 뽑으면 선택지가 자기 자신에 갇힌다 */
  const modelOptions = [
    ...new Set((calls?.distribution.rows ?? []).map((r) => r.modelRef).filter((m): m is string => !!m)),
  ];

  /**
   * CSV 내보내기 — 🔴 `apiClient` 는 JSON 을 파싱하므로 여기서는 raw fetch 를 쓴다.
   *    실패를 성공처럼 말하지 않는다(빈 파일을 내려주지 않고 오류를 그대로 알린다).
   */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const token = apiClient.getToken();
      const res = await fetch(`${BASE}/export.csv`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(tfAttr('내보내기 실패 (HTTP {상태})', { 상태: res.status }));
      const truncated = res.headers.get('X-Export-Truncated') === 'true';
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ai-oversight-${kstToday()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      // 🔴 잘렸으면 잘랐다고 말한다 — 파일만 보고 전건이라 믿지 않게
      toast.success(truncated ? tAttr('내려받았습니다 — 상한까지만 담겼습니다(전건 아님)') : tAttr('내려받았습니다 (PHI 없음 · 환자는 가명)'));
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? tAttr('내보내기에 실패했습니다'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><Tf k="{AI표기} 감독 관제" params={{ AI표기: AI_ORIGIN_TEXT }} /></h1>
        <p className="mt-0.5 text-sm text-gray-500">
          <T k="AI 제안이 사람에게 어떻게 처리됐는가 — 수용·수정·거부·만료, 검토 소요, 호출 분포." />{' '}
          <T k="비율에는 분모가 함께 붙고, 표본이 없으면 값 대신 그 사실을 말합니다." />
        </p>
      </div>

      {/* ── 필터 ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="flex gap-1">
          {DAYS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`min-h-[44px] rounded-lg px-3 text-xs font-bold transition-colors ${
                days === d ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Tf k="{일수}일" params={{ 일수: d }} />
            </button>
          ))}
        </div>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="min-h-[44px] rounded-lg border border-gray-200 px-2 text-xs text-gray-700"
          aria-label={tAttr('제안 종류')}
        >
          <option value="">{tAttr('전체 종류')}</option>
          {AI_PROPOSAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          value={modelRef}
          onChange={(e) => setModelRef(e.target.value)}
          className="min-h-[44px] rounded-lg border border-gray-200 px-2 text-xs text-gray-700"
          aria-label={tAttr('모델')}
        >
          <option value="">{tAttr('전체 모델')}</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {/* 🔴 모델 선택지는 호출 원장에서 온다 — 원장이 비면 "모델이 없다"가 아니라 "고를 것이 없다" */}
        {callsQ.isSuccess && modelOptions.length === 0 && (
          <span className="text-[10px] text-gray-400"><T k="기록된 호출이 없어 고를 모델이 없습니다" /></span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {summary && <span className="text-[10px] text-gray-400"><Tf k="기준 {시각} 이후" params={{ 시각: summary.since.slice(0, 16).replace('T', ' ') }} /></span>}
          {/* 🔴 반출은 ADMIN 만 — 못 누를 버튼을 보여 주면 눌러 보고 403 을 만난다 */}
          {isAdmin && (
            <button
              onClick={exportCsv}
              disabled={exporting}
              className="min-h-[44px] rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
              title={tAttr('제안·전이·호출 CSV — PHI 없음(환자는 HMAC 가명 · 초안 본문 미포함)')}
            >
              <T k={exporting ? '내보내는 중…' : 'CSV 내보내기'} />
            </button>
          )}
        </div>
      </div>

      {/* ── 요약 ─────────────────────────────────────────────────────────── */}
      {summaryQ.isError ? (
        <QueryErrorFallback error={summaryQ.error} onRetry={summaryQ.refetch} />
      ) : summaryQ.isLoading ? (
        // 🔴 로딩을 '확인 불가'로 말하지 않는다 — 아직 안 온 것과 모르는 것은 다른 사실이다
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : !summary ? (
        <EmptyState icon="—" title="요약을 받지 못했습니다" hint="서버가 빈 응답을 돌려주었습니다" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <CountCard title="제안(분모)" value={summary.total} subtitle={<Tf k="{일수}일 · 이 원장에 남은 것" params={{ 일수: summary.windowDays }} />} />
            <CountCard title="결정된 건" value={summary.decided} subtitle="ACCEPTED+EDITED+REJECTED" />
            <RateCard title="수용률" rate={summary.rates.accepted} hint="결정된 건 없음" />
            <RateCard title="수정률" rate={summary.rates.edited} hint="결정된 건 없음" />
            <RateCard title="거부율" rate={summary.rates.rejected} hint="결정된 건 없음" />
            <RateCard title="만료율" rate={summary.rates.expired} hint="결말이 난 건 없음" />
          </div>

          {/* 🔴 승인을 '무수정'과 같은 말로 쓰지 않는다 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CountCard title="승인 합계" value={summary.accepted.total} />
            <CountCard title="승인인데 수정 있음" value={summary.accepted.withEdits} subtitle="편집거리 > 0 — 승인=무수정이 아니다" tone="amber" />
            <CountCard title="승인·무수정" value={summary.accepted.unedited} subtitle="편집거리 = 0" />
            <CountCard title="승인·수정량 미측정" value={summary.accepted.editUnmeasured} subtitle="재지 않았다(0 이 아니다)" tone="amber" />
          </div>

          {summary.filters.deptNote && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{summary.filters.deptNote}</p>
          )}

          <StatusBar byStatus={summary.byStatus} total={summary.total} />

          <div className="grid gap-3 lg:grid-cols-2">
            <ReviewTimingPanel review={summary.review} />
            <QuickAcceptPanel review={summary.review} policy={policy} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <AxisTable title="종류별" rows={summary.byKind} emptyHint="신규 생성부터 이 원장에 남습니다" />
            <AxisTable title="모델별" rows={summary.byModelRef} emptyHint="상류가 모델 태그를 보고했을 때만 채워집니다" />
            <AxisTable title="결정자별" rows={summary.byDecider} emptyHint="결정된 제안이 있어야 채워집니다" />
          </div>

          <p className="text-[11px] leading-relaxed text-gray-400">{summary.note}</p>
        </>
      )}

      {/* ── 호출 분포 ────────────────────────────────────────────────────── */}
      {callsQ.isError ? (
        <QueryErrorFallback error={callsQ.error} onRetry={callsQ.refetch} size="compact" />
      ) : callsQ.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />
      ) : calls ? (
        <CallsPanel calls={calls} />
      ) : (
        <EmptyState icon="—" title="호출 분포를 받지 못했습니다" hint="서버가 빈 응답을 돌려주었습니다" />
      )}

      {/* ── 스크라이브 초안 ↔ 확정 수정량 ──────────────────────────────────── */}
      {scribeQ.isError ? (
        <QueryErrorFallback error={scribeQ.error} onRetry={scribeQ.refetch} size="compact" />
      ) : scribeQ.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />
      ) : scribeQ.data?.data ? (
        <ScribeEditPanel stats={scribeQ.data.data} />
      ) : (
        <EmptyState icon="—" title="수정량 분포를 받지 못했습니다" hint="서버가 빈 응답을 돌려주었습니다" />
      )}
    </div>
  );
}
