'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import type { ErpReadFailure } from '@hospital-run/shared';
import { ErpFailureNote } from './ErpFailureNote';

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR') + '원';

/** 🔴 R59 — 서버가 ERP 조회 실패 사유(`failure` · shared 어휘)를 실어 보낸다. `available:false` 를 '대상 아님'·'해당 없음'으로 읽지 않는다. */
interface ErpUnavailable { available?: boolean; failure?: ErpReadFailure; upstreamStatus?: number | null }
interface Severance extends ErpUnavailable { 지급대상?: boolean; 퇴직금?: number; 근속일수?: number; avgMonthlyWage?: number }
interface Performance extends ErpUnavailable { period?: string; revenue?: number | null; incentive?: number | null }

export function PayExtrasSection() {
  const tAttr = useTAttr();
  const sev = useQuery({ queryKey: ['ess-severance'], queryFn: () => apiClient.get<{ data: Severance }>('/api/v1/ess/severance').then((r) => r.data) });
  const perf = useQuery({ queryKey: ['ess-performance'], queryFn: () => apiClient.get<{ data: Performance }>('/api/v1/ess/performance').then((r) => r.data) });
  const s = sev.data;
  const p = perf.data;
  const hasIncentive = !!p && (p.incentive != null || p.revenue != null);
  // 🔴 ERP 를 **못 물어본 것**과 **대상이 아닌 것**은 다른 사실이다 — 종전에는 조회 실패가 침묵·"해당 없음"으로 그려져
  //    사람이 "나는 성과급 대상이 아니구나"로 읽었다.
  const sevDown = !sev.isLoading && !sev.isError && s?.available === false;
  const perfDown = !perf.isLoading && !perf.isError && p?.available === false;

  return (
    <section className="rounded-xl border p-4 space-y-2">
      <h2 className="font-semibold text-sm"><T k="퇴직금 · 성과급" /> <span className="font-normal text-slate-400 text-xs"><T k="(ERP 추정)" /></span></h2>
      {/* 🔴 조회 실패를 '대상 아님'·'해당 없음'으로 말하지 않는다 — 금액을 못 받은 것이지 없는 것이 아니다 */}
      {sev.isError && <QueryErrorFallback error={sev.error} onRetry={() => sev.refetch()} size="compact" />}
      {sevDown && (
        <ErpFailureNote failure={s?.failure} upstreamStatus={s?.upstreamStatus} onRetry={() => sev.refetch()}><T k="퇴직금 추정" /></ErpFailureNote>
      )}
      {!sev.isError && !sevDown && s && s.지급대상 != null && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500"><T k="퇴직금 추정" />{s.근속일수 ? <span className="text-slate-400 text-xs"> · 근속 {Math.floor(s.근속일수 / 365)}<Unit>년</Unit></span> : null}</span>
          <span className="font-semibold text-gray-800">{s.지급대상 ? won(s.퇴직금 ?? 0) : tAttr('대상 아님')}</span>
        </div>
      )}
      {perf.isError ? (
        <QueryErrorFallback error={perf.error} onRetry={() => perf.refetch()} size="compact" />
      ) : perfDown ? (
        <ErpFailureNote failure={p?.failure} upstreamStatus={p?.upstreamStatus} onRetry={() => perf.refetch()}><T k="성과급 실적" /></ErpFailureNote>
      ) : (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500"><T k="성과급 실적" />{p?.period ? <span className="text-slate-400 text-xs"> · {p.period}</span> : null}</span>
          <span className="font-semibold text-gray-800">{hasIncentive ? won(p!.incentive ?? p!.revenue ?? 0) : tAttr('해당 없음')}</span>
        </div>
      )}
      <p className="text-[10px] text-slate-400"><T k="※ 추정치 · ERP 확정 기준. 문의는 인사팀." /></p>
    </section>
  );
}
