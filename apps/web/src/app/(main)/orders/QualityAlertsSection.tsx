'use client';

/**
 * 경고 부담(alert burden · 2026-10-07) — DUR 경고 유형별·잦은 약·CDSS 수준별.
 * 🔴 무시율이 높다고 "경고가 쓸모없다"고 말하지 않는다 — 규칙 정비(약사위원회)의 근거 자료일 뿐이다.
 * 🔴 유형을 모르는 옛 형식 경고는 따로 센다('유형 미기록') · 표본 0 은 "산출 불가".
 */
import { useQuery } from '@tanstack/react-query';
import { DUR_WARNING_TYPE_LABEL } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Ratio } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

interface AlertBurden {
  truncated: Record<string, boolean>;
  dur: { warnedPrescriptions: number; overridden: number; overriddenNoReason: number;
    byType: { type: string; prescriptions: number; alerts: number; overridden: number; overriddenNoReason: number }[];
    topDrugs: { name: string | null; prescriptions: number; overridden: number; types: string[] }[] };
  cdss: { logs: number; byLevel: { level: string; logs: number; overridden: number; overriddenNoReason: number }[] };
}
const typeLabel = (t: string) => (t === 'UNTYPED' ? '유형 미기록' : DUR_WARNING_TYPE_LABEL[t] ?? t);

export function QualityAlertsSection({ query }: { query: string }) {
  // 서버 @Roles(ADMIN·DOCTOR) 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canView = useHasRole('DOCTOR');
  const q = useQuery({
    queryKey: ['cpoe-quality-alerts', query],
    queryFn: () => apiClient.get<{ data: AlertBurden }>(`/api/v1/orders/quality/alerts?${query}`).then((r) => r.data),
    enabled: canView,
  });
  if (!canView) return null;
  const d = q.data;
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" data-qi-alerts>
      <p className="mb-2 text-xs font-bold text-gray-700"><T k="경고 부담 — DUR 경고 유형별 무시" /></p>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !d ? <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
          : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] text-gray-500">
                  <Tf k="경고가 난 처방 {수}건 · 무시 {무시}건 · 사유 없는 무시 {사유없음}건" params={{ 수: d.dur.warnedPrescriptions, 무시: d.dur.overridden, 사유없음: d.dur.overriddenNoReason }} />
                </p>
                {d.dur.byType.length === 0
                  ? <p className="text-xs text-gray-400" data-qi-alerts-empty><T k="이 기간 DUR 경고가 기록된 처방이 없습니다." /></p>
                  : (
                    <table className="w-full text-xs">
                      <thead className="text-gray-400"><tr>
                        <th className="text-left font-medium"><T k="유형" /></th>
                        <th className="text-right font-medium"><T k="처방" /></th>
                        <th className="text-right font-medium"><T k="경고 수" /></th>
                        <th className="text-right font-medium"><T k="무시" /></th>
                        <th className="text-right font-medium"><T k="사유 없음" /></th>
                      </tr></thead>
                      <tbody>
                        {d.dur.byType.map((r) => (
                          <tr key={r.type} className="border-t border-gray-50" data-qi-alert-type={r.type}>
                            <td className={`py-1 ${r.type === 'UNTYPED' ? 'text-amber-700' : 'text-gray-700'}`}><T k={typeLabel(r.type)} /></td>
                            <td className="text-right tabular-nums">{r.prescriptions}</td>
                            <td className="text-right tabular-nums text-gray-500">{r.alerts}</td>
                            <td className="text-right tabular-nums"><Ratio numerator={r.overridden} denominator={r.prescriptions} /></td>
                            <td className={`text-right tabular-nums ${r.overriddenNoReason ? 'font-semibold text-rose-700' : 'text-gray-300'}`}>{r.overriddenNoReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </div>
              <div className="space-y-3">
                {d.dur.topDrugs.length > 0 && (
                  <div data-qi-alert-drugs>
                    <p className="mb-1 text-[11px] font-semibold text-gray-600"><T k="경고가 잦은 약" /></p>
                    <ul className="space-y-0.5 text-xs">
                      {d.dur.topDrugs.map((g, i) => (
                        <li key={`${g.name}-${i}`} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-gray-800">{g.name ?? <T k="이름 없음" />}</span>
                          <span className="text-[10px] text-gray-400">{g.types.map((t) => DUR_WARNING_TYPE_LABEL[t] ?? t).join(' · ')}</span>
                          <span className="tabular-nums text-gray-600">{g.prescriptions}</span>
                          <span className="tabular-nums text-gray-400"><T k="무시" /> {g.overridden}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div data-qi-alert-cdss>
                  <p className="mb-1 text-[11px] font-semibold text-gray-600"><T k="CDSS 경고 수준별" /></p>
                  {d.cdss.logs === 0
                    ? <p className="text-xs text-gray-400"><T k="이 기간 CDSS 점검 기록이 없습니다." /></p>
                    : (
                      <ul className="space-y-0.5 text-xs">
                        {d.cdss.byLevel.map((l) => (
                          <li key={l.level} className="flex items-center gap-2">
                            <span className="flex-1 text-gray-700">{l.level}</span>
                            <span className="tabular-nums text-gray-600">{l.logs}</span>
                            <span className="tabular-nums"><T k="무시" /> <Ratio numerator={l.overridden} denominator={l.logs} pctOnly /></span>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </div>
            </div>
          )}
      <p className="mt-2 text-[10px] text-gray-400"><T k="무시가 많은 유형은 규칙 정비(약사위원회)의 근거 자료입니다 — 경고가 쓸모없다는 판정이 아닙니다." /></p>
    </section>
  );
}
