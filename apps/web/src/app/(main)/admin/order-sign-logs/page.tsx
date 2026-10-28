'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, Ratio, Unit } from '@/components/ui/display';
import StatCard from '@/components/ui/StatCard';
import { SEAL_UI, type SignLogRow } from '../../orders/OrderSignLogPanel';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 오더 서명 로그 관제 — "오더 행위가 빠짐없이 봉인되고 있는가"를 본다.
 *
 * 봉인률만 크게 띄우면 **애초에 기록되지 않은 것**은 영원히 안 보인다. 그래서 두 숫자를 나란히 세운다:
 *  - 봉인률(기록된 것 중 sign 원장에 들어간 비율)
 *  - 복원 불가 취소(취소 시각이 없어 소급 복원조차 못 하는 오더) — 0 으로 수렴해야 하는 값
 */
interface Stats {
  total: number;
  sealed: number;
  /** 🔴 분모는 '이미 원장에 기록된 항목' — 봉인해야 할 CPOE 행위 전체가 아니다.
   *  기록 0건이면 서버가 `null`(산출 불가)을 준다 — `?? 0` 으로 접지 않는다. */
  sealRateOfRecorded: number | null;
  /** null = 집계 실패(확인 불가) — 0 건과 다른 사실 */
  recordingGaps?: { cancelledWithoutLog: number | null };
  lastSealedAt?: string | null;
  byStatus: Record<string, number>;
  byAction: Record<string, number>;
  unrecoverableCancel: number;
  oldestUnsealedAt: string | null;
  stream: string;
}

const ACTION_LABEL: Record<string, string> = {
  ORDER_CREATED: '발행',
  ORDER_RECEIVED: '접수@오더',
  ORDER_IN_PROGRESS: '시행',
  ORDER_COMPLETED: '완료',
  ORDER_CANCELLED: '취소@오더',
};

const fmt = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export default function OrderSignLogsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [action, setAction] = useState('');
  const [sealStatus, setSealStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data: statsRes } = useQuery({
    queryKey: ['order-sign-log-stats'],
    queryFn: () => apiClient.get<{ data: Stats }>('/api/v1/order-sign-logs/stats'),
    refetchInterval: 60_000,
  });
  const stats = statsRes?.data as Stats | undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['order-sign-logs', action, sealStatus, page],
    queryFn: () =>
      apiClient.get<{ data: SignLogRow[]; meta: { total: number; totalPages: number } }>('/api/v1/order-sign-logs', {
        ...(action ? { action } : {}),
        ...(sealStatus ? { sealStatus } : {}),
        page,
        limit: 50,
      }),
  });
  const rows = (data?.data ?? []) as (SignLogRow & { orderId: string; patientId?: string | null })[];
  const meta = data?.meta;

  const verify = useMutation({
    mutationFn: () => apiClient.get<{ data: { available: boolean; reason?: string; result?: Record<string, unknown> } }>('/api/v1/order-sign-logs/verify'),
    onSuccess: (r) => {
      const d = r.data as { available: boolean; reason?: string; result?: Record<string, unknown> };
      if (!d.available) { toast.error(`${tAttr('검증 불가')}: ${d.reason ?? tAttr('원인 미상')}`); return; }
      const res = d.result as { valid?: boolean; count?: number; brokenAt?: number } | undefined;
      if (res?.valid === false) toast.error(`체인 불일치 — ${res.brokenAt !== undefined ? `${res.brokenAt}번째 항목` : '위치 미상'}`);
      else toast.success(`체인 무결 — 항목 ${res?.count ?? '?'}건 검증 통과`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tAttr('검증 요청 실패')),
  });

  const reconcile = useMutation({
    mutationFn: () => apiClient.post<{ data: { scanned: number; created: number; unrecoverableCancel: number } }>('/api/v1/order-sign-logs/reconcile?hours=720', {}),
    onSuccess: (r) => {
      const d = r.data as { scanned: number; created: number; unrecoverableCancel: number };
      toast.success(`소급 복원 완료 — 대상 ${d.scanned}건 중 신규 ${d.created}건 봉인`);
      qc.invalidateQueries({ queryKey: ['order-sign-logs'] });
      qc.invalidateQueries({ queryKey: ['order-sign-log-stats'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tAttr('복원 실패')),
  });

  const unsealed = useMemo(() => (stats ? stats.total - stats.sealed : 0), [stats]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900"><T k="오더 서명 로그" /></h2>
          <p className="mt-0.5 text-xs text-gray-500">
            <T k="CPOE 행위(발행·접수·시행·완료·취소)를 sign 해시체인 원장" />(<code className="font-mono">{stats?.stream ?? 'his-orders'}</code>)<T k="에 봉인하고, 그 영수증을 원내에 보관합니다." />
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <T k={verify.isPending ? '검증 중…' : '체인 검증'} />
          </button>
          <button
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending}
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <T k={reconcile.isPending ? '복원 중…' : '누락 소급 복원'} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <StatCard title={tAttr('봉인 로그')} value={`${stats?.sealed ?? 0}건`} icon="🔏" color="emerald" subtitle={`전체 ${stats?.total ?? 0}건 중`} />
        {/* 🔴 종전 제목이 "봉인률" 이라 커버리지로 읽혔다 — 분모는 '기록된 것'뿐이다 */}
        <StatCard
          title={tAttr('기록분 봉인률')}
          // 🔴 `?? 0` 은 원장이 비어 있는 것을 "봉인률 0%"(=전건 미봉인)로 단정했다.
          //    서버도 total=0 이면 null 을 준다 — 정본 `<Ratio>` 로 분모(기록분)와 함께 낸다.
          value={<Ratio numerator={stats?.sealed} denominator={stats?.total} unavailableHint="원장에 기록된 항목 없음" />}
          color="blue"
          subtitle={stats?.lastSealedAt ? `${tAttr('마지막 봉인')} ${fmt(stats.lastSealedAt)}` : tAttr('봉인 이력 없음')}
        />
        <StatCard title={tAttr('미봉인')} value={`${unsealed}건`} color={unsealed > 0 ? 'amber' : 'slate'} subtitle={stats?.oldestUnsealedAt ? `${tAttr('가장 오래된 건')} ${fmt(stats.oldestUnsealedAt)}` : tAttr('없음')} />
        {/*
          🔴 취소 스탬프는 있는데 원장에 취소 항목이 없는 오더(실측 10건).
          그 10건은 `cancelled_at` 이 마이크로초까지 같고 행위자가 전부 NULL 이라 **일괄 백필**로 보인다.
          그 시각으로 봉인하면 틀린 시각을 위변조 방지 원장에 영구히 박게 되므로 **봉인하지 않고 드러낸다**.
        */}
        <StatCard
          title={tAttr('미기록 취소')}
          value={stats?.recordingGaps && stats.recordingGaps.cancelledWithoutLog == null ? tAttr('확인 불가') : `${stats?.recordingGaps?.cancelledWithoutLog ?? 0}건`}
          color={stats?.recordingGaps && stats.recordingGaps.cancelledWithoutLog == null ? 'slate' : (stats?.recordingGaps?.cancelledWithoutLog ?? 0) > 0 ? 'amber' : 'slate'}
          subtitle={tAttr('취소 스탬프는 있으나 원장에 없음(시각 신뢰 불가 — 추정 봉인 금지)')}
        />
        <StatCard
          title={tAttr('복원 불가 취소')}
          value={`${stats?.unrecoverableCancel ?? 0}건`}
          color={(stats?.unrecoverableCancel ?? 0) > 0 ? 'red' : 'slate'}
          subtitle={tAttr('취소 시각이 없어 소급 불가')}
        />
      </div>

      {(stats?.unrecoverableCancel ?? 0) > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          <T k="취소 시각이 없는 오더가" /> {stats?.unrecoverableCancel}<Unit>건</Unit> <T k="있습니다 — 취소 스탬프 도입 이전에 취소된 건이라" />
          <span className="font-medium"> <T k="소급 복원이 불가능" /></span><T k="합니다(추정 시각을 원장에 박지 않습니다). 이후 취소분부터는 자동으로 남습니다." />
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2">
        <div className="flex gap-1">
          {[{ id: '', label: '전체' }, ...Object.entries(ACTION_LABEL).map(([id, label]) => ({ id, label }))].map((t) => (
            <button
              key={t.id}
              onClick={() => { setAction(t.id); setPage(1); }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${action === t.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <T k={t.label} />
              {t.id && stats?.byAction?.[t.id] !== undefined && (
                <span className="ml-1 text-[10px] opacity-70">{stats.byAction[t.id]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          {[{ id: '', label: '봉인상태 전체' }, ...Object.keys(SEAL_UI).map((id) => ({ id, label: SEAL_UI[id].label }))].map((t) => (
            <button
              key={t.id}
              onClick={() => { setSealStatus(t.id); setPage(1); }}
              title={t.id ? SEAL_UI[t.id]?.hint : undefined}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${sealStatus === t.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <T k={t.label} />
              {t.id && stats?.byStatus?.[t.id] !== undefined && (
                <span className="ml-1 text-[10px] opacity-70">{stats.byStatus[t.id]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400"><T k="로그를 불러오는 중…" /></div>
        ) : !rows.length ? (
          <EmptyState icon="🔏" title="조건에 맞는 로그가 없습니다" hint="필터를 바꾸거나 소급 복원을 실행해 보세요" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium"><T k="시각" /></th>
                  <th className="px-3 py-2 font-medium"><T k="행위" /></th>
                  <th className="px-3 py-2 font-medium"><T k="행위자" /></th>
                  <th className="px-3 py-2 font-medium"><T k="내용" /></th>
                  <th className="px-3 py-2 font-medium"><T k="봉인" /></th>
                  <th className="px-3 py-2 font-medium"><T k="해시" /></th>
                  <th className="px-3 py-2 font-medium"><T k="오더" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const seal = SEAL_UI[r.sealStatus] ?? SEAL_UI.PENDING;
                  return (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/40">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{fmt(r.occurredAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                        <T k={ACTION_LABEL[r.action] ?? r.action} />
                        {r.origin === 'RECONCILED' && <span className="ml-1 text-[9px] text-gray-400" title={tAttr('스탬프에서 소급 복원')}><T k="소급" /></span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                        {r.actorName ?? <T k={r.actorId ? '이름 미상' : '시스템'} />}
                        {r.authMethod === 'SSO' && <span className="ml-1 text-[9px] text-blue-600" title={tAttr('sign 이 의료진 토큰을 검증한 신원')}><T k="본인@신원" /></span>}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-gray-500" title={r.summary ?? ''}>{r.summary || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold ${seal.cls}`} title={seal.hint}><T k={seal.label} /></span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <code className="font-mono text-[10px] text-gray-400" title={r.entryHash ?? ''}>{r.entryHash ? `${r.entryHash.slice(0, 12)}…` : '-'}</code>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={`/orders?orderId=${r.orderId}`} className="text-blue-600 hover:underline"><T k="보기" /></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-gray-200 px-2.5 py-1 disabled:opacity-40"><T k="이전" /></button>
          <span className="tabular-nums text-gray-500">{page} / {meta.totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))} disabled={page >= meta.totalPages} className="rounded-lg border border-gray-200 px-2.5 py-1 disabled:opacity-40"><T k="다음" /></button>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-gray-400">
        <T k="봉인은" /> <span className="font-medium text-gray-500"><T k="기록 다음" /></span><T k="에 일어납니다 — sign 이 내려가 있어도 로그는 원내에 남고, 재시도 크론이 나중에 봉인합니다. 상태 변경 경로가 흩어져 있어 실시간 배선만으로는 새기 때문에, 오더 스탬프와 로그를 대조해" /> <span className="font-medium text-gray-500"><T k="빠진 전이를 소급 복원" /></span><T k="합니다(5분 주기)." />
      </p>
    </div>
  );
}
