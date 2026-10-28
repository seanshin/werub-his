'use client';

import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { ratioText, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

type Incident = { type: string; severity: string; status: string; occurredAt: string };
type Resp = {
  summary: {
    incidents30d: number;
    /** 🔴 기간 무관 전체 미종결 — 종전엔 30일 창 안에서만 세어 방치될수록 사라졌다 */
    incidentsOpen: number;
    incidentsOpen30d?: number;
    oldestOpenAt?: string | null;
    infectionsActive: number;
    handHygieneRate: number | null;
    handHygieneObserved?: number;
    handHygienePerformed?: number;
    qiIndicators: number;
    /** 방향을 알아 판정한 지표 수 = 달성률 분모(미판정을 미달로 뭉개지 않는다) */
    qiJudged?: number;
    qiMet: number;
    qiRate: number | null;
  };
  incidentsBySeverity: Record<string, number>;
  recentIncidents: Incident[];
};

const SEV_TONE: Record<string, string> = { CRITICAL: 'bg-rose-100 text-rose-700', SEVERE: 'bg-rose-100 text-rose-700', MAJOR: 'bg-orange-100 text-orange-700', MODERATE: 'bg-amber-100 text-amber-700', MINOR: 'bg-yellow-50 text-yellow-700', LOW: 'bg-gray-100 text-gray-600' };

/** label 은 **원문 키**로 받아 여기서 번역한다(호출부가 번역해 넘기면 이중 번역) · value·hint 는 호출부가 번역한 문자열 */
function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    /* 🔴 `hint` 가 붙는 카드와 안 붙는 카드가 섞여 있다 — grid 가 행을 가장 높은 것에 맞추면
       나머지가 위로 쏠린다. 값은 한 줄 고정(`88% (22/25)`·`산출 불가`가 접히면 그 카드만 높아진다). */
    <div className={`flex flex-col justify-center rounded-2xl border p-4 ${tone ?? 'border-gray-100 bg-white'}`}>
      <div className="overflow-x-auto whitespace-nowrap text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5"><T k={label} /></div>
      {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function SafetyQualityBoard() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  /** 🔴 표본이 없으면 shared 정본이 `산출 불가` 를 돌려준다 — 그 **정직성 문구**만 번역한다(수치 문자열은 그대로) */
  const ratio = (n: number | null | undefined, d: number | null | undefined) => {
    const v = ratioText(n, d);
    return v === RATIO_UNAVAILABLE ? tAttr(RATIO_UNAVAILABLE) : v;
  };
  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['safety-quality-board'],
    queryFn: () => apiClient.get<{ data: Resp }>('/api/v1/safety-quality-board'),
    refetchInterval: pollMs('slow'),
  });
  const r = data?.data;
  const s = r?.summary;
  const incidents = r?.recentIncidents ?? [];
  const bySev = r?.incidentsBySeverity ?? {};

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="감염·질·안전 보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="환자안전 사건·활성 감염(격리)·손위생 준수율·QI 지표 달성 (최근 30일)" /></p>
        </div>
        <FreshnessBadge updatedAt={dataUpdatedAt} isFetching={isFetching} staleMs={65000} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat label="안전사건(30일)" value={tfAttr('{수}건', { 수: s?.incidents30d ?? 0 })} />
        {/* 🔴 실측 미종결 3건은 79~83일 방치라 30일 창 밖이었고 화면은 "0건"이라 말했다 */}
        <Stat
          label="미종결 사건"
          value={tfAttr('{수}건', { 수: s?.incidentsOpen ?? 0 })}
          tone={(s?.incidentsOpen ?? 0) > 0 ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-gray-50'}
          hint={s?.oldestOpenAt ? tfAttr('가장 오래된 건 {날짜}', { 날짜: kdate(new Date(s.oldestOpenAt)) }) : undefined}
        />
        <Stat label="활성 감염/격리" value={tfAttr('{수}건', { 수: s?.infectionsActive ?? 0 })} tone="border-orange-200 bg-orange-50" />
        {/* 🔴 관찰 0건은 `-` 가 아니라 산출 불가 · 비율은 분모와 함께(§2.1) */}
        <Stat label="손위생 준수율(30일)" value={ratio(s?.handHygienePerformed, s?.handHygieneObserved)} tone="border-emerald-200 bg-emerald-50"
          hint={s?.handHygieneObserved === 0 ? tAttr('이 기간 손위생 관찰 기록 없음') : undefined} />
        {/* 🔴 분모는 '방향을 알아 판정한 지표'뿐 — 판정 불가를 미달로 세지 않는다 */}
        <Stat
          label="QI 지표 달성"
          value={ratio(s?.qiMet, s?.qiJudged ?? s?.qiIndicators)}
          hint={
            s?.qiJudged != null && s.qiIndicators > s.qiJudged
              ? tfAttr('전체 {전체}개 중 {불가}개는 판정 불가', { 전체: s.qiIndicators, 불가: s.qiIndicators - s.qiJudged })
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-4">
        {/* 심각도 분포 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm font-bold text-gray-700 mb-3"><T k="사건 심각도 분포" /></div>
          {Object.keys(bySev).length === 0 ? <div className="text-sm text-gray-400 py-6 text-center"><T k="사건 없음" /></div>
          : Object.entries(bySev).sort((a, b) => b[1] - a[1]).map(([sev, n]) => (
            <div key={sev} className="flex items-center justify-between py-1.5">
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${SEV_TONE[sev] ?? 'bg-gray-100 text-gray-600'}`}>{sev}</span>
              <span className="text-sm font-semibold text-gray-800">{n}<Unit>건</Unit></span>
            </div>
          ))}
        </div>

        {/* 최근 안전사건 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-bold text-gray-700"><T k="최근 안전사건" /></div>
          {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
          : !incidents.length ? <EmptyState icon="📋" title="최근 30일 사건이 없습니다." />
          : (
            <table className="w-full text-sm">
              <tbody>
                {incidents.map((i, idx) => (
                  <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 text-gray-700">{i.type}</td>
                    <td className="px-3 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full ${SEV_TONE[i.severity] ?? 'bg-gray-100 text-gray-600'}`}>{i.severity}</span></td>
                    <td className="px-3 py-2.5 text-gray-500">{i.status}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-400 text-right">{kdate(new Date(i.occurredAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
