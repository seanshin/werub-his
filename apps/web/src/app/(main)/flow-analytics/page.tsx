'use client';
import { useState } from 'react';
import { Unit, Duration, Ratio } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/** 🔴 `breachCount` = 위반 **건수**(분자). 분모는 `count`. 목표가 없으면 판정 자체를 안 하므로 null(0 이 아니다). */
type Stat = { count: number; avg: number; p50: number; p90: number; max: number; breachRate: number | null; breachCount: number | null; target: number | null };
type Resp = {
  period: { from: string; to: string };
  opd: { count: number; waitToCall: Stat; waitToConsult: Stat; consult: Stat; total: Stat; byDept: { dept: string; count: number; avgWaitMin: number | null; avgConsultMin: number | null }[] };
  er: { count: number; doorToTriage: Stat; doorToTriageUnmeasurable?: number; triageActMissing?: number; triageToTreatment: Stat; totalLosMin: Stat; byKtas: { level: string; count: number; avgDoorToTriageMin: number; target: number; breachRate: number | null; breachCount: number | null }[] };
  ipd: { count: number; avgLosDays: number | null; p50Days: number; p90Days: number; byWard: { ward: string; count: number; avgLosDays: number | null }[] };
  bottlenecks: { track: string; stage: string; avg: number; breachRate: number | null; breachCount: number | null; count: number }[];
};

const KTAS_KO: Record<string, string> = { LEVEL_1: 'KTAS 1(소생)', LEVEL_2: 'KTAS 2(긴급)', LEVEL_3: 'KTAS 3(응급)', LEVEL_4: 'KTAS 4(준응급)', LEVEL_5: 'KTAS 5(비응급)' };
const RANGES: [string, number][] = [['오늘', 0], ['7일', 7], ['30일', 30], ['90일', 90]];

function isoDaysAgo(d: number) { const t = new Date(); t.setDate(t.getDate() - d); return t.toISOString().slice(0, 10); }
function breachTone(b: number | null) { return b == null ? 'text-gray-400' : b >= 30 ? 'text-rose-600 font-bold' : b >= 10 ? 'text-amber-600 font-semibold' : 'text-emerald-600'; }

/** unit 은 단위어 i18n 키(`@단위` 문맥 키 — 맨 키 `분` 을 쓰지 않는다 · 표시 부품 Unit 과 같은 규칙) */
function StatRow({ label, s, unit = '분@단위' }: { label: string; s: Stat; unit?: string }) {
  return (
    <tr className="border-b border-gray-50">
      <td className="py-1.5 pr-3 text-gray-700"><T k={label} />{s.target != null && <span className="text-[10px] text-gray-400 ml-1"><Tf k="목표 {값}" params={{ 값: <>{s.target}<T k={unit} /></> }} /></span>}</td>
      {/* 🔴 건수 0 은 "0분"이 아니라 **표본이 없다**는 뜻이다. 0 으로 찍으면 "대기가 없었다"로 읽힌다. */}
      <td className="pr-3 text-right font-semibold text-gray-900">{s.count === 0 ? <span className="font-normal text-gray-300">—</span> : <>{s.avg}<T k={unit} /></>}</td>
      <td className="pr-3 text-right text-gray-500">{s.count === 0 ? <span className="text-gray-300">—</span> : s.p50}</td>
      <td className="pr-3 text-right text-gray-500">{s.count === 0 ? <span className="text-gray-300">—</span> : s.p90}</td>
      <td className="pr-3 text-right text-gray-400">{s.count === 0 ? <span className="text-gray-300">—</span> : s.max}</td>
      {/* 🔴 위반율은 분모와 함께 — "위반 50%"가 2건 중 1건인지 200건 중 100건인지 화면이 말한다(2026-08-20 서버가 분자 노출) */}
      <td className="pr-3 text-right"><Ratio className={breachTone(s.breachRate)} numerator={s.breachCount} denominator={s.count} unavailableHint={s.target == null ? '목표 미설정' : '표본 없음'} /></td>
      <td className="text-right text-gray-400">{s.count}</td>
    </tr>
  );
}
function StatTable({ rows }: { rows: { label: string; s: Stat; unit?: string }[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-[11px] text-gray-400 text-left border-b border-gray-100"><th className="py-1 pr-3 font-medium"><T k="단계" /></th><th className="pr-3 text-right font-medium"><T k="평균" /></th><th className="pr-3 text-right font-medium">p50</th><th className="pr-3 text-right font-medium">p90</th><th className="pr-3 text-right font-medium"><T k="최대" /></th><th className="pr-3 text-right font-medium"><T k="위반율" /></th><th className="text-right font-medium"><T k="건수" /></th></tr></thead>
      <tbody>{rows.map((r) => <StatRow key={r.label} {...r} />)}</tbody>
    </table>
  );
}
/** title 은 원문 키(여기서 `<T>`) · sub 는 이미 번역된 노드(`<Tf>` — 값이 든 문장이라 호출부가 조립한다) */
function Card({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h2 className="text-sm font-bold text-gray-800"><T k={title} />{sub && <span className="text-xs font-normal text-gray-400 ml-2">{sub}</span>}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function FlowAnalyticsPage() {
  const tAttr = useTAttr();
  const [days, setDays] = useState(7);
  const from = days === 0 ? isoDaysAgo(0) : isoDaysAgo(days);
  const to = isoDaysAgo(0);
  const { data, isLoading, isFetching, dataUpdatedAt, isError } = useQuery({
    queryKey: ['flow-analytics', from, to],
    queryFn: () => apiClient.get<{ data: Resp }>(`/api/v1/journey-console/analytics?from=${from}&to=${to}`).then((r) => r.data),
    refetchInterval: 120000,
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="환자 이탈·지연 분석" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="단계별 체류시간·병목·SLA 위반율(외래·응급·입원). 운영 개선 인사이트." /></p>
        </div>
        <div className="flex items-center gap-2">
          <FreshnessBadge updatedAt={dataUpdatedAt || undefined} isFetching={isFetching} isError={isError} staleMs={130000} />
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {RANGES.map(([l, d]) => <button key={l} onClick={() => setDays(d)} className={`px-3 py-1 text-xs rounded-md ${days === d ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}><T k={l} /></button>)}
          </div>
        </div>
      </div>

      {isLoading ? <div className="text-sm text-gray-400 py-10 text-center"><T k="집계 중…" /></div> : !data ? <div className="text-sm text-gray-400"><T k="데이터 없음" /></div> : (
        <>
          {/* 병목 요약 */}
          <Card title="병목 단계" sub={<T k="SLA 위반율 상위" />}>
            {data.bottlenecks.length === 0 ? <p className="text-sm text-gray-400"><T k="기간 내 분석 가능한 단계가 없습니다." /></p> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.bottlenecks.map((b, i) => (
                  <div key={i} className="rounded-xl border border-gray-100 p-3">
                    <div className="text-[11px] text-gray-400">{b.track}</div>
                    {/* 🔴 stage 는 서버가 보내는 **고정 라벨**(journey-analytics.service.ts) — 아래 표 라벨과 같은 어휘라 같은 키로 번역한다.
                        서버가 라벨을 바꾸면 미등록 티(EN×)가 뜬다(조용히 한국어로 남지 않는다). 서버가 코드를 주는 것이 정답(§12-G) */}
                    <div className="text-sm font-semibold text-gray-800"><T k={b.stage} /></div>
                    <div className="flex items-end justify-between mt-1">
                      <span className="text-lg font-bold text-gray-900">{b.avg}<span className="text-xs font-normal text-gray-400"><T k="분@단위" /></span></span>
                      {/* 🔴 분모와 함께 — "위반 50%"의 무게는 분모가 정한다 */}
                      <span className="text-sm"><Tf k="위반 {비율}" params={{ 비율: <Ratio className={breachTone(b.breachRate)} numerator={b.breachCount} denominator={b.count} unavailableHint="목표 미설정" /> }} /></span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{b.count}<Unit>건</Unit></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 외래 */}
          <Card title="외래(OPD) 단계 소요" sub={<Tf k="완료 {수}건" params={{ 수: data.opd.count }} />}>
            <StatTable rows={[
              { label: '접수→호출 대기', s: data.opd.waitToCall },
              { label: '접수→진료 대기', s: data.opd.waitToConsult },
              { label: '진료 소요', s: data.opd.consult },
              { label: '총 체류(접수→완료)', s: data.opd.total },
            ]} />
            {data.opd.byDept.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-gray-500 mb-2"><T k="진료과별 대기(평균, 상위)" /></h3>
                <div className="space-y-1">
                  {data.opd.byDept.map((d) => (
                    <div key={d.dept} className="flex items-center gap-2 text-xs">
                      <span className="w-28 truncate text-gray-600">{d.dept}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${Math.min(100, (d.avgWaitMin ?? 0) / Math.max(1, data.opd.byDept[0].avgWaitMin ?? 1) * 100)}%` }} /></div>
                      <span className="w-20 text-right text-gray-700"><Tf k="대기 {시간}" params={{ 시간: <Duration minutes={d.avgWaitMin} /> }} /></span>
                      <span className="w-16 text-right text-gray-400">{d.count}<Unit>건</Unit></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* 응급 */}
          <Card title="응급(ER) 흐름" sub={<Tf k="도착 {수}건" params={{ 수: data.er.count }} />}>
            <StatTable rows={[
              { label: '도착→트리아지', s: data.er.doorToTriage },
              { label: '트리아지→처치', s: data.er.triageToTreatment },
              { label: '총 체류(도착→결정)', s: data.er.totalLosMin },
            ]} />
            {/* 🔴 분모에서 무엇이 빠졌는지 밝힌다 — 조용히 빼면 남은 수가 전체인 척한다 */}
            {((data.er.doorToTriageUnmeasurable ?? 0) > 0 || (data.er.triageActMissing ?? 0) > 0) && (
              <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                <T k="도착→트리아지 분모에서 제외:" />
                {(data.er.doorToTriageUnmeasurable ?? 0) > 0 && (
                  <> <Tf k="도착 시각 미기록(도착=분류 동시 기록) {수}건 — {산출불가}(0분이 아니다)" params={{ 수: <b>{data.er.doorToTriageUnmeasurable}</b>, 산출불가: <b><T k={RATIO_UNAVAILABLE} /></b> }} /></>
                )}
                {(data.er.triageActMissing ?? 0) > 0 && (
                  <> · <Tf k="분류 기록 자체가 없음 {수}건" params={{ 수: <b>{data.er.triageActMissing}</b> }} /></>
                )}
              </p>
            )}
            {data.er.byKtas.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-gray-500 mb-2"><T k="KTAS별 도착→트리아지 (목표 대비)" /></h3>
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] text-gray-400 text-left border-b border-gray-100"><th className="py-1 pr-3 font-medium"><T k="등급" /></th><th className="pr-3 text-right font-medium"><T k="평균" /></th><th className="pr-3 text-right font-medium"><T k="목표" /></th><th className="pr-3 text-right font-medium"><T k="위반율" /></th><th className="text-right font-medium"><T k="건수" /></th></tr></thead>
                  <tbody>
                    {data.er.byKtas.map((k) => (
                      <tr key={k.level} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 text-gray-700">{KTAS_KO[k.level] ? <T k={KTAS_KO[k.level]} /> : k.level}</td>
                        <td className="pr-3 text-right font-semibold text-gray-900"><Duration minutes={k.avgDoorToTriageMin} /></td>
                        <td className="pr-3 text-right text-gray-400">{k.target}<Unit>분</Unit></td>
                        {/* 🔴 위반 **건수**(분자)를 서버가 함께 준다 — 분모 없는 퍼센트를 끝냈다(2026-08-20) */}
                        <td className="pr-3 text-right"><Ratio className={breachTone(k.breachRate)} numerator={k.breachCount} denominator={k.count} unavailableHint="표본 없음" /></td>
                        <td className="text-right text-gray-400">{k.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 입원 */}
          <Card title="입원(IPD) 재원일수(LOS)" sub={<Tf k="퇴원 {수}건" params={{ 수: data.ipd.count }} />}>
            {/* 🔴 기간 내 퇴원이 0건이면 LOS 는 **계산할 수 없다**. `0일`로 찍으면 "재원일이 0"으로 읽힌다
                — 표본 부재를 값으로 쓰지 않는다(2026-08 관제에서 같은 결함을 고쳤다). */}
            {data.ipd.count === 0 ? (
              <p className="text-sm text-gray-400 mb-3" title={tAttr('기간 내 퇴원 건이 없어 재원일수를 계산할 수 없습니다')}>
                <T k={RATIO_UNAVAILABLE} /> <span className="text-xs">— <T k="기간 내 퇴원 0건" /></span>
              </p>
            ) : (
              <div className="flex gap-6 mb-3">
                <div><div className="text-2xl font-bold text-gray-900">{data.ipd.avgLosDays}<span className="text-sm font-normal text-gray-400"><T k="일@단위" /></span></div><div className="text-xs text-gray-400"><T k="평균 LOS" /></div></div>
                <div><div className="text-2xl font-bold text-gray-700">{data.ipd.p50Days}</div><div className="text-xs text-gray-400"><T k="중앙값(p50)" /></div></div>
                <div><div className="text-2xl font-bold text-gray-700">{data.ipd.p90Days}</div><div className="text-xs text-gray-400">p90</div></div>
              </div>
            )}
            {data.ipd.byWard.length > 0 && (
              <div className="space-y-1">
                {data.ipd.byWard.map((w) => (
                  <div key={w.ward} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate text-gray-600">{w.ward}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden"><div className="h-full bg-teal-400" style={{ width: `${Math.min(100, (w.avgLosDays ?? 0) / Math.max(1, data.ipd.byWard[0].avgLosDays ?? 1) * 100)}%` }} /></div>
                    <span className="w-20 text-right text-gray-700">{w.avgLosDays != null ? <>{w.avgLosDays}<Unit>일</Unit></> : <T k={RATIO_UNAVAILABLE} />}</span>
                    <span className="w-16 text-right text-gray-400">{w.count}<Unit>건</Unit></span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
