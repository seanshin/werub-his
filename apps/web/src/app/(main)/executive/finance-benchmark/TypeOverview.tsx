'use client';

/**
 * 종별 개관 — 같은 회계연도의 공시 기관을 종별(상급종합·종합·병원·요양·정신 …)로 나눠 중앙값을 나란히 본다.
 *
 * 🔴 정직 표기:
 *   - 종별이 다르면 비용 구조가 다르다(요양병원은 인건비 비중이 크다) — 종별끼리 **합쳐 비교하지 않고** 줄을 나눈다.
 *   - 흑자 기관 비율은 **분모(의료이익을 산출할 수 있는 기관 수)** 를 함께 · 분모 0 이면 산출 불가.
 *   - 의원(개원가)은 회계정보공시 대상이 아니다 — 손익을 지어내거나 추정하지 않고 "공개된 손익 없음"을 그 자리에서 말한다.
 */
import { HOSPITAL_TYPES, peerStat, type FinanceRatio } from '@hospital-run/shared';
import { Num, Ratio } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

interface Row { name: string; hospitalType: string | null; beds: number | null; medicalProfit: number | null; ratios: Record<FinanceRatio, number | null> }

const pct = (v: number | null) => (v == null ? null : v * 100);
function P({ v }: { v: number | null }) {
  return v == null ? <span className="text-gray-400"><Ratio numerator={null} denominator={null} pctOnly /></span> : <Num value={pct(v)} domain="percent" />;
}

/** 종별 줄 순서 — 정본 순서 먼저, 그 밖의 종별은 이름순 뒤에 */
export function orderTypes(types: string[]): string[] {
  const known = HOSPITAL_TYPES.filter((t) => types.includes(t));
  return [...known, ...types.filter((t) => !(HOSPITAL_TYPES as readonly string[]).includes(t)).sort()];
}

export function TypeOverview({ rows, active, onPick }: { rows: Row[]; active: string; onPick: (type: string) => void }) {
  const types = orderTypes([...new Set(rows.map((r) => r.hospitalType).filter((t): t is string => !!t))]);
  const noType = rows.filter((r) => !r.hospitalType).length;
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <p className="font-semibold text-gray-800"><T k="종별 개관 — 이 회계연도 공시 기관" /></p>
      <p className="mb-2 text-[11px] text-gray-500"><T k="종별마다 비용 구조가 달라 합쳐 비교하지 않습니다 · 줄을 누르면 그 종별로 동급 비교·지도를 좁힙니다." /></p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[11px] text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left"><T k="종별" /></th>
              <th className="px-3 py-2 text-right"><T k="기관 수" /></th>
              <th className="px-3 py-2 text-right"><T k="병상 중앙값" /></th>
              <th className="px-3 py-2 text-right"><T k="흑자 기관(의료이익)" /></th>
              <th className="px-3 py-2 text-right"><T k="의료이익률 중앙값" /></th>
              <th className="px-3 py-2 text-right"><T k="경상이익률 중앙값" /></th>
              <th className="px-3 py-2 text-right"><T k="인건비율 중앙값" /></th>
              <th className="px-3 py-2 text-right"><T k="재료비율 중앙값" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {types.map((t) => {
              const rs = rows.filter((r) => r.hospitalType === t);
              const withProfit = rs.filter((r) => r.medicalProfit != null);
              const med = (k: FinanceRatio) => peerStat(rs.map((r) => r.ratios[k])).median;
              const beds = peerStat(rs.map((r) => r.beds)).median;
              return (
                <tr key={t} onClick={() => onPick(active === t ? '' : t)} className={`cursor-pointer hover:bg-slate-50 ${active === t ? 'bg-indigo-50' : ''}`}>
                  <td className="px-3 py-2 font-medium">{t}</td>
                  <td className="px-3 py-2 text-right">{rs.length}</td>
                  <td className="px-3 py-2 text-right">{beds == null ? '-' : <Num value={beds} domain="bedCount" unit={false} />}</td>
                  <td className="px-3 py-2 text-right"><Ratio numerator={withProfit.filter((r) => (r.medicalProfit as number) >= 0).length} denominator={withProfit.length} /></td>
                  <td className="px-3 py-2 text-right"><P v={med('medicalProfitMargin')} /></td>
                  <td className="px-3 py-2 text-right"><P v={med('ordinaryMargin')} /></td>
                  <td className="px-3 py-2 text-right"><P v={med('laborRatio')} /></td>
                  <td className="px-3 py-2 text-right"><P v={med('materialRatio')} /></td>
                </tr>
              );
            })}
            {/* 의원 — 공시 대상이 아니다(손익 없음) */}
            <tr className="bg-slate-50/60 text-gray-500">
              <td className="px-3 py-2 font-medium"><T k="의원(개원가)" /></td>
              <td className="px-3 py-2 text-right" colSpan={7}><T k="회계정보공시 대상이 아니어서 공개된 손익이 없습니다 — 추정해 채우지 않습니다." /></td>
            </tr>
          </tbody>
        </table>
      </div>
      {noType > 0 && <p className="mt-1 text-[11px] text-gray-500"><Tf k="종별이 비어 있는 기관 {수}곳은 줄에서 뺐습니다" params={{ 수: noType }} /></p>}
    </section>
  );
}

/** 의원·개원가 안내 — 무엇이 공개되고 무엇이 없는지 */
export function ClinicDisclosureNote() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-700">
      <p className="mb-1 font-semibold text-slate-800"><T k="의원·개원가 자료는 무엇이 공개되어 있나" /></p>
      <ul className="list-disc space-y-1 pl-5">
        <li><T k="손익(재무제표): 공개되지 않습니다 — 의료기관 회계정보공시는 일정 병상 이상의 병원급 의료기관이 대상이고 의원은 대상이 아닙니다." /></li>
        <li><T k="공개되는 것: 기관 목록·종별·주소·의사 수·병상 수 같은 개설 현황(건강보험심사평가원 「전국 병의원 및 약국 현황」 · 공공누리 제1유형)과 시군구별 종별 요양기관 수(KOSIS)." /></li>
        <li><T k="이 화면은 공시 손익만 다룹니다 — 개설 현황은 아직 가져오지 않았습니다(가져오면 지역별 의원 수·밀도를 손익 지도 옆에 함께 보일 수 있습니다)." /></li>
      </ul>
    </section>
  );
}
