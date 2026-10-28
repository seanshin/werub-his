'use client';

/**
 * 화면 3417 「임상 규칙 대장」(2026-10-21 임상 규칙·템플릿 P4 · `clinical-rules-templates-review-2026-10.plan.md` B1).
 *
 * 「임상 규칙·템플릿」 10개 화면의 카탈로그를 한 장에 — 몇 개가 사용 중이고, 승인 기록이 없는 것·코드 기본값으로 대체된 것은 무엇이고,
 * 언제 마지막으로 바뀌었는지. 지표 코드·라벨·이동 경로 정본 = shared `clinical-rules-ledger`(서버는 코드와 값만).
 *  · 🔴 값 null = 확인 불가(조회 실패·계측 전) — 0 이 아니다 · 카드 하나가 실패해도 나머지는 그대로
 *  · 소유 위원회는 결정 `catalog.ownership` 기록(개발 시드면 그렇다고) · 재검토 기한은 아직 없다(기획 P5)
 *  · 대장은 읽기 전용 — 고치는 것은 각 화면에서
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CLINICAL_RULES_LEDGER, type LedgerCardValue } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { CLINICAL_CHARTS } from '@/lib/clinical-charts';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

interface Ledger { cards: LedgerCardValue[]; ownership: { choice: string | null; seeded: boolean; known: boolean }; reviewDue: null }
const unwrap = (r: unknown): Ledger | undefined => ((r as { data?: { data?: Ledger } })?.data?.data ?? (r as { data?: Ledger })?.data);

function Value({ v, kind }: { v: number | boolean | null | undefined; kind?: 'count' | 'bool' }) {
  if (v === null || v === undefined) return <span className="text-gray-400" data-ledger-unknown><T k="확인 불가" /></span>;
  if (kind === 'bool' || typeof v === 'boolean') return <T k={v ? '예' : '아니오'} />;
  return <span className="tabular-nums">{v.toLocaleString()}</span>;
}

export default function ClinicalRulesLedgerPage() {
  const q = useQuery({ queryKey: ['clinical-rules-ledger'], queryFn: () => apiClient.get('/api/v1/admin/clinical-rules/ledger'), staleTime: 30_000 });
  const ledger = unwrap(q.data);
  const byKey = new Map((ledger?.cards ?? []).map((c) => [c.key, c]));
  const own = ledger?.ownership;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900"><T k="임상 규칙 대장" /></h2>
        <p className="mt-1 text-sm text-gray-500"><T k="진료가 따르는 처방 세트·규칙·서식을 한 장에 — 고치는 것은 각 화면에서 합니다." /></p>
      </div>

      {q.isError && <QueryErrorFallback error={q.error} onRetry={q.refetch} />}
      {!ledger && !q.isError && <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>}

      {ledger && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-700 space-y-1" data-ledger-ownership={own?.known ? own.choice ?? 'NONE' : 'UNKNOWN'}>
          <p>
            <span className="font-semibold"><T k="소유 위원회" /></span>{' '}
            {!own?.known ? <T k="확인 불가" />
              : own.choice === 'ASSIGN_BY_CATALOG' ? <T k="카탈로그별 배정(결정됨)" />
              : <T k="미배정" />}
            {own?.known && own.seeded && <span className="ml-1 text-violet-700">(<T k="개발 시드 — 실결정 아님" />)</span>}
            {' · '}<Link href="/admin/decisions/catalog.ownership" className="text-blue-700 underline"><T k="결정 화면" /></Link>
          </p>
          <p className="text-gray-500"><T k="재검토 기한: 아직 정하지 않았습니다(소유 위원회 결정 뒤)." /></p>
        </div>
      )}

      {ledger && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-ledger-cards>
          {CLINICAL_RULES_LEDGER.map((def) => {
            const card = byKey.get(def.key);
            const failed = !card || card.metrics === null;
            return (
              <section key={def.key} className="rounded-xl border border-gray-200 bg-white p-4 space-y-2" data-ledger-card={def.key} data-ledger-failed={failed || undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={def.href} className="text-sm font-bold text-gray-900 hover:text-blue-700"><T k={def.label} /></Link>
                  {card?.lastChangedAt && <span className="text-[11px] text-gray-400"><T k="마지막 변경" /> <KDate value={card.lastChangedAt} mode="date" /></span>}
                </div>
                {failed ? (
                  <p className="text-[12px] text-amber-800"><T k="이 카탈로그를 불러오지 못했습니다 — 0 이 아니라 확인 불가입니다." /></p>
                ) : (
                  <dl className="space-y-1 text-[12px]">
                    {def.metrics.map((m) => {
                      const v = card!.metrics![m.code];
                      const warn = m.warnWhenPositive && typeof v === 'number' && v > 0;
                      return (
                        <div key={m.code} className={`flex justify-between gap-2 ${warn ? 'text-amber-800 font-semibold' : 'text-gray-700'}`} data-ledger-metric={`${def.key}.${m.code}`} data-ledger-warn={warn || undefined}>
                          <dt><T k={m.label} /></dt>
                          <dd><Value v={v} kind={m.kind} /></dd>
                        </div>
                      );
                    })}
                    {def.key === 'CHART_VERIFY' && (
                      <div className="flex justify-between gap-2 text-gray-700" data-ledger-metric="CHART_VERIFY.total">
                        <dt><T k="전체 도구(정의)" /></dt><dd className="tabular-nums">{CLINICAL_CHARTS.length}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
