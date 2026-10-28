'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Duration, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';
import { pollMs } from '@/lib/ui-settings';

/**
 * I/O 수지(2026-10-10) — 이번 근무조·직전 근무조·최근 24시간 합계(두 원장 정본 · 서버 계산) + 배설 기록 공백.
 *  · 🔴 배설 공백 강조는 원내 기준(`nursing.io.noOutputAlertHours`)이 있을 때만 — 미설정이면 경과 시간(사실)만 말한다
 *  · 0 mL 배설 기록(무뇨 측정)은 따로 센다 — '배설 있음'으로 섞지 않는다
 */
export interface IoBlock { from: string; to: string; rows: number; totalIntake: number; totalOutput: number; balance: number; byLedger: { IO: { intake: number; output: number; rows: number }; FLOWSHEET: { intake: number; output: number; rows: number } } }
export interface IoBalance {
  shift: IoBlock & { name: string };
  previousShift: IoBlock & { name: string };
  last24h: IoBlock;
  output: { lastOutputAt: string | null; hoursSinceLastOutput: number | null; zeroOutputRecords24h: number; alertHours: number | null; overdue: boolean | null };
}
const SHIFT_LABEL: Record<string, string> = { DAY: '주간', EVENING: '초번', NIGHT: '야간' };

export const ioBalanceKey = (admissionId: string) => ['io-balance', admissionId] as const;

export function IoBalancePanel({ admissionId }: { admissionId: string }) {
  const q = useQuery({
    queryKey: ioBalanceKey(admissionId),
    queryFn: async () => {
      const r = await apiClient.get<{ data: IoBalance }>(`/api/v1/admissions/${admissionId}/io-balance`);
      const d = (r as { data?: unknown })?.data as IoBalance | { data: IoBalance };
      return ('shift' in (d as object) ? d : (d as { data: IoBalance }).data) as IoBalance;
    },
    refetchInterval: pollMs('normal'),
  });
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-2xl bg-gray-50" aria-busy="true" />;
  if (q.isError || !q.data) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />;
  const b = q.data;
  const o = b.output;
  const card = (label: React.ReactNode, x: IoBlock, key: string) => (
    <div className="rounded-xl border border-gray-100 bg-white p-3" data-io-balance-block={key}>
      <p className="text-[11px] font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-sm tabular-nums">
        <span className="text-blue-700">{x.totalIntake.toLocaleString()}</span>
        <span className="mx-1 text-gray-400">/</span>
        <span className="text-amber-700">{x.totalOutput.toLocaleString()}</span>
        <span className="ml-1 text-[11px] text-gray-500">mL</span>
      </p>
      <p className={`text-xs font-bold tabular-nums ${x.balance >= 0 ? 'text-blue-800' : 'text-red-700'}`} data-io-balance-value={x.balance}>
        {x.balance >= 0 ? '+' : ''}{x.balance.toLocaleString()} mL
      </p>
      {x.rows === 0 && <p className="mt-0.5 text-[11px] text-gray-400"><T k="기록 없음" /></p>}
      {x.byLedger.FLOWSHEET.rows > 0 && <p className="mt-0.5 text-[10px] text-slate-500"><Tf k="플로시트 칸 {n}건 포함" params={{ n: x.byLedger.FLOWSHEET.rows }} /></p>}
    </div>
  );
  return (
    <section className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-3" data-io-balance>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-800"><T k="I/O 수지" /> <span className="text-[11px] font-normal text-gray-500"><T k="섭취 / 배설 · 수지" /></span></h2>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {card(<><T k="이번 근무조" /> · <T k={SHIFT_LABEL[b.shift.name] ?? b.shift.name} /></>, b.shift, 'shift')}
        {card(<><T k="직전 근무조" /> · <T k={SHIFT_LABEL[b.previousShift.name] ?? b.previousShift.name} /></>, b.previousShift, 'previous')}
        {card(<T k="최근 24시간" />, b.last24h, 'last24h')}
      </div>
      <div className={`rounded-xl px-3 py-2 text-xs ${o.overdue ? 'bg-red-50 text-red-800 ring-1 ring-red-200' : 'bg-white text-gray-700'}`} data-io-output-gap={o.overdue == null ? 'unjudged' : o.overdue ? 'overdue' : 'ok'}>
        {o.lastOutputAt
          ? <><T k="마지막 배설 기록" /> <KDate value={o.lastOutputAt} mode="datetime" /> · <Duration minutes={Math.round((o.hoursSinceLastOutput ?? 0) * 60)} dense /> <T k="경과" /></>
          : <T k="배설 기록이 없습니다" />}
        {o.zeroOutputRecords24h > 0 && <span className="ml-2 font-semibold text-red-700" data-io-zero-output={o.zeroOutputRecords24h}><Tf k="24시간 안 0 mL 배설 기록 {n}건" params={{ n: o.zeroOutputRecords24h }} /></span>}
        <p className="mt-0.5 text-[11px] text-gray-500">
          {o.alertHours == null
            ? <T k="배설 공백 기준이 원내에 설정되지 않아 강조하지 않습니다(시스템 설정 nursing.io.noOutputAlertHours)." />
            : <Tf k="원내 기준 {h}시간 — 넘으면 강조합니다." params={{ h: o.alertHours }} />}
        </p>
      </div>
    </section>
  );
}
