'use client';

/**
 * 언어팩 사람 검수 `/admin/ui-locale/review` (3411) — 정본 `docs/01-plan/features/i18n-human-review.plan.md` §2.3.
 *
 * 🔴 이 화면은 **워크리스트**다 — 사라지는 알림이 아니라 **줄어드는 목록**이다.
 * 🔴 **정본은 코드다**(`packages/shared/src/i18n/messages/*.ts`). 여기서 승인한 값은 DB 오버레이이고,
 *    내보내기 → 사람이 커밋해야 코드로 수렴한다. 그 사실을 화면이 계속 말한다(정본이 둘이면 갈라진다).
 * 🔴 규칙(전부 이 저장소 실측에서 나온 것):
 *    · `queryFn` 안에서 `.catch(() => 기본값)` 을 쓰지 않는다 — 쓰면 `isError` 가 영원히 false 가 되어
 *      `QueryErrorFallback` 이 도달 불가 코드가 되고, 서버가 죽어도 "검수할 것 없음"이라 말하게 된다.
 *    · 로딩 / 실패 / 없음을 셋으로 가른다(아직 안 온 것 ≠ 모르는 것 ≠ 없는 것).
 *    · 비율은 `<Ratio>` 하나로 — 분모 0 이면 '산출 불가'(100% 를 지어내지 않는다).
 *    · 폴링 주기는 `pollMs()`(SystemConfig `ui.*`) — 숫자 리터럴을 박지 않는다.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CATALOG_LOCALES, CATALOG_LOCALE_LABEL, DEFERRED_LOCALES, type CatalogLocale } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { reasonFilled } from '@/lib/reason-presets';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import {
  I18N_REVIEW_EP,
  REVIEW_FILTERS,
  REVIEW_FILTER_LABEL,
  type DecisionResult,
  type ExportResult,
  type MergedResult,
  type ProposeResult,
  type RejectKeyResult,
  type ReviewFilter,
  type ReviewListResponse,
  type ReviewRow,
  type ReviewStatsResponse,
} from './contract';
import { ListFooter, OverlayRuntimeNotice, PermissionNotice, ReviewRowItem, StatsPanel } from './parts';

const PAGE = 50;
const DEFERRED = new Set<string>(DEFERRED_LOCALES);

export default function I18nReviewPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [locale, setLocale] = useState<CatalogLocale>('en');
  const [area, setArea] = useState<string>('');
  const [filter, setFilter] = useState<ReviewFilter>('unreviewed');
  const [term, setTerm] = useState<string>('');
  const [applied, setApplied] = useState<string>('');
  const [limit, setLimit] = useState<number>(PAGE);
  const [exported, setExported] = useState<ExportResult | null>(null);

  const listQ = useQuery({
    queryKey: ['i18n-review', 'list', locale, area, filter, applied, limit],
    // 🔴 `.catch` 없음 — 실패는 그대로 던져 `isError` 가 되어야 한다
    queryFn: () =>
      apiClient.get<ReviewListResponse>(I18N_REVIEW_EP.review, {
        locale,
        ...(area ? { area } : {}),
        filter,
        ...(applied ? { q: applied } : {}),
        limit,
        offset: 0,
      }),
    refetchInterval: pollMs('slow'),
  });

  const statsQ = useQuery({
    queryKey: ['i18n-review', 'stats', locale],
    queryFn: () => apiClient.get<ReviewStatsResponse>(I18N_REVIEW_EP.stats, { locale }),
    refetchInterval: pollMs('slow'),
  });

  const rows = listQ.data?.data;
  const meta = listQ.data?.meta;
  const stats = statsQ.data?.data;
  // 권한은 목록·통계 둘 다 실어 보낸다 — 먼저 도착한 쪽을 쓴다(둘은 같은 판정이다)
  const permission = meta?.permission ?? statsQ.data?.meta?.permission;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['i18n-review'] });
  };

  const proposeM = useMutation({
    mutationFn: (v: { key: string; value: string; note: string }) =>
      apiClient.post<{ data: ProposeResult }>(I18N_REVIEW_EP.review, {
        locale,
        key: v.key,
        value: v.value,
        ...(v.note.trim() ? { note: v.note.trim() } : {}),
      }),
    onSuccess: (r) => {
      // 🔴 기록 ≠ 적용 — 서버가 보낸 사실을 그대로 전한다(FE 가 "반영되었습니다"라 지어내지 않는다)
      toast.success(r.data.appliedNote);
      refresh();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? tAttr('저장하지 못했습니다')),
  });

  const decideM = useMutation({
    mutationFn: (v: { id: string; to: 'approve' | 'reject'; reason: string }) =>
      apiClient.post<{ data: DecisionResult }>(
        v.to === 'approve' ? I18N_REVIEW_EP.approve(v.id) : I18N_REVIEW_EP.reject(v.id),
        v.reason.trim() ? { reason: v.reason.trim() } : {},
      ),
    onSuccess: (r) => {
      // 🔴 4-eyes 미충족을 조용히 넘기지 않는다 — 막지 않았다는 사실과 함께 말한다
      if (r.data.fourEyes.selfApproved) toast.warning(r.data.fourEyes.message);
      toast.success(r.data.appliedNote);
      refresh();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? tAttr('판정을 남기지 못했습니다')),
  });

  /**
   * 🔴 키만으로 "번역하지 않음"(§2.4) — 사유 필수. 화면이 사유 없이 부르지 않는다(버튼이 먼저 막고
   *    이유를 말한다). 응답의 `codeStillShows` 는 **기록 ≠ 적용**을 그 자리에서 말해 준다 —
   *    반려해도 코드 초안이 남아 있으면 화면에는 그 초안이 계속 나간다.
   */
  const rejectKeyM = useMutation({
    mutationFn: (v: { key: string; reason: string }) =>
      apiClient.post<{ data: RejectKeyResult }>(I18N_REVIEW_EP.rejectKey, {
        locale,
        key: v.key,
        reason: v.reason.trim(),
      }),
    onSuccess: (r) => {
      // 코드 초안이 남아 있으면 성공이라 말하지 않는다(경고로 말한다 — 아직 화면은 안 바뀌었다)
      if (r.data.codeStillShows) toast.warning(r.data.appliedNote);
      else toast.success(r.data.appliedNote);
      if (r.data.fourEyes?.selfApproved) toast.warning(r.data.fourEyes.message);
      refresh();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? tAttr('판정을 남기지 못했습니다')),
  });

  const mergedM = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      apiClient.post<{ data: MergedResult }>(I18N_REVIEW_EP.merged(v.id), v.reason.trim() ? { reason: v.reason.trim() } : {}),
    onSuccess: (r) => {
      // 표시는 사람의 주장이고, 코드가 실제로 같은지는 서버가 답한다
      if (r.data.codeMatches) toast.success(r.data.appliedNote);
      else toast.warning(r.data.appliedNote);
      refresh();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? tAttr('표시하지 못했습니다')),
  });

  const exportM = useMutation({
    mutationFn: () =>
      apiClient.get<{ data: ExportResult }>(I18N_REVIEW_EP.export, { locale, ...(area ? { area } : {}) }),
    onSuccess: (r) => setExported(r.data),
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? tAttr('내보내지 못했습니다')),
  });

  const busy = proposeM.isPending || decideM.isPending || mergedM.isPending || rejectKeyM.isPending;

  const actions = {
    onPropose: (row: ReviewRow, value: string, note: string) => proposeM.mutate({ key: row.key, value, note }),
    onApprove: (row: ReviewRow, reason: string) => row.id && decideM.mutate({ id: row.id, to: 'approve', reason }),
    onReject: (row: ReviewRow, reason: string) => row.id && decideM.mutate({ id: row.id, to: 'reject', reason }),
    // 🔴 사유가 비면 부르지 않는다 — 서버 400 을 눌러 보고 알게 하지 않는다(버튼이 먼저 막는다)
    onRejectKey: (row: ReviewRow, reason: string) =>
      reasonFilled(reason) && rejectKeyM.mutate({ key: row.key, reason }),
    onMarkMerged: (row: ReviewRow, reason: string) => row.id && mergedM.mutate({ id: row.id, reason }),
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">
            <T k="언어팩 사람 검수" />
          </h1>
          <Link href="/admin/ui-locale" className="text-xs text-blue-600 hover:underline">
            <T k="← 번역 검수 관제(현황)" />
          </Link>
        </div>
        <p className="mt-0.5 text-sm text-gray-500">
          <T k="코드에 들어 있는 AI 초안 번역을 언어 전문가가 읽고 고치고 '검수했다'를 남기는 화면입니다. 원문(한국어)은 키이자 정본이라 여기서 바꾸지 않습니다." />
        </p>
      </div>

      {/* 🔴 기록 ≠ 적용 · 정본은 코드 */}
      <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">
          <T k="저장(제안)은 화면에 반영되지 않습니다 — 승인된 것만 나갑니다." />
        </p>
        <p className="text-xs leading-relaxed">
          <T k="승인한 값은 DB 오버레이로 코드 초안 위에 얹힙니다. 정본은 여전히 카탈로그 파일(코드)이며, 아래 '내보내기' 텍스트를 사람이 파일에 반영·커밋해야 코드로 수렴합니다(자동 커밋 없음)." />
        </p>
        <p className="text-xs">
          <T k="일괄 승인은 없습니다 — 건별로만 판정합니다. 제안자와 승인자가 같으면 막지 않고 그 사실을 목록에 남깁니다." />
        </p>
      </div>

      <OverlayRuntimeNotice />

      <PermissionNotice permission={permission} />

      {/* ── 필터 ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">
            <T k="언어" />
          </span>
          {CATALOG_LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLocale(l);
                setLimit(PAGE);
                setExported(null);
              }}
              className={`min-h-[44px] rounded-lg px-3 text-sm font-medium ${
                locale === l ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {CATALOG_LOCALE_LABEL[l]} ({l}){DEFERRED.has(l) ? ' · ' : ''}
              {DEFERRED.has(l) && <T k="별도 트랙" />}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400">
            <T k="한국어는 검수 대상이 아닙니다(원문이 곧 키입니다)" />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500">
            <T k="상태·성격" />
          </span>
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                setLimit(PAGE);
              }}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <T k={REVIEW_FILTER_LABEL[f]} />
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              setLimit(PAGE);
            }}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            aria-label={tAttr('영역')}
          >
            <option value="">{tAttr('전체 영역')}</option>
            {(meta?.areas ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setApplied(term.trim());
                setLimit(PAGE);
              }
            }}
            placeholder={tAttr('원문·번역 부분 일치 검색 후 Enter')}
            className="min-w-[220px] flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => {
              setApplied(term.trim());
              setLimit(PAGE);
            }}
            className="min-h-[44px] rounded-lg bg-gray-100 px-3 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            <T k="검색" />
          </button>
        </div>

        {/* 🔴 못 세는 축을 0 으로 그리지 않는다 */}
        {meta && !meta.contextGapAvailable && (
          <p className="text-xs text-amber-700">{meta.contextGapUnavailableReason}</p>
        )}
        {meta && !meta.usage.available && (
          <p className="text-xs text-amber-700">
            <T k="사용처 색인을 만들지 못했습니다 — '쓰이는 곳'은 '없음'이 아니라 '확인 불가'입니다." />
            {meta.usage.unavailableReason ? ` ${meta.usage.unavailableReason}` : ''}
          </p>
        )}
      </div>

      {/* ── 통계 ─────────────────────────────────────────────────────────── */}
      {statsQ.isError ? (
        <QueryErrorFallback error={statsQ.error} onRetry={() => void statsQ.refetch()} size="compact" />
      ) : statsQ.isLoading ? (
        <p className="text-xs text-gray-400">
          <T k="통계를 불러오는 중입니다" />
        </p>
      ) : stats ? (
        <StatsPanel stats={stats} />
      ) : null}

      {/* ── 워크리스트 ───────────────────────────────────────────────────── */}
      {listQ.isError ? (
        <QueryErrorFallback error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <p className="py-10 text-center text-sm text-gray-400">
          <T k="검수 목록을 불러오는 중입니다" />
        </p>
      ) : rows && rows.length === 0 ? (
        <EmptyState
          icon="✓"
          title="이 필터에 해당하는 키가 없습니다"
          hint="필터를 바꾸거나 다른 언어를 선택하세요 — '없음'은 조회에 성공했다는 뜻입니다"
        />
      ) : rows ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <ReviewRowItem
              key={`${row.locale}:${row.key}`}
              row={row}
              permission={permission}
              usageAvailable={meta?.usage.available === true}
              actions={actions}
              busy={busy}
            />
          ))}
          {meta && <ListFooter meta={meta} onMore={() => setLimit((n) => n + PAGE)} />}
        </div>
      ) : null}

      {/* ── 내보내기(코드 수렴) ──────────────────────────────────────────── */}
      <div className="space-y-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-800">
            <T k="승인분 내보내기 — 코드로 수렴하는 경로" />
          </h2>
          <button
            type="button"
            onClick={() => exportM.mutate()}
            disabled={exportM.isPending}
            className="min-h-[44px] rounded-lg bg-gray-100 px-3 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            <T k="내보내기 텍스트 만들기" />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          <T k="이 텍스트는 코드가 아닙니다 — 사람이 카탈로그 파일에 반영·커밋해야 정본이 됩니다." />
        </p>
        {exportM.isError && <QueryErrorFallback error={exportM.error} size="compact" />}
        {exported && (
          <>
            <p className="text-xs text-gray-600">
              <T k="승인분" /> {exported.count} · <T k="이미 코드와 같은 것" /> {exported.alreadyInCode}
            </p>
            <textarea
              readOnly
              value={exported.text}
              rows={10}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2 font-mono text-[11px]"
            />
          </>
        )}
      </div>
    </div>
  );
}
