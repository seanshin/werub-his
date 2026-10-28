'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';

import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

type Latest = { HBA1C: number | null; FBS: number | null; SBP: number | null; DBP: number | null; WEIGHT: number | null; BMI: number | null };
type Row = { patientId: string; name: string; mrn: string; conditions: string[]; latest: Latest; alerts: string[]; controlled: boolean; lastMeasured: string | null };
type Resp = { patients: Row[]; summary: { total: number; dm: number; htn: number; uncontrolled: number } };

// 서버 가이드라인 4조건 전량(P3) — 2종만 두면 DYSLIPID 가 영문 그대로·고혈압 색으로 뜬다(실측 홍길동)
const COND_LABEL: Record<string, string> = { DM: '당뇨', HTN: '고혈압', DYSLIPID: '이상지질', CKD: '만성콩팥병' };
const COND_COLOR: Record<string, string> = { DM: 'bg-amber-50 text-amber-700', HTN: 'bg-sky-50 text-sky-700', DYSLIPID: 'bg-violet-50 text-violet-700', CKD: 'bg-rose-50 text-rose-700' };
const COND_TABS: [string, string][] = [['', '전체'], ['DM', '당뇨'], ['HTN', '고혈압'], ['DYSLIPID', '이상지질'], ['CKD', '만성콩팥병']];
const STATUS_TABS: [string, string][] = [['', '전체'], ['UNCONTROLLED', '조절 불량'], ['CONTROLLED', '조절 양호']];

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone ?? 'border-gray-100 bg-white'}`}>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5"><T k={label} /></div>
    </div>
  );
}

/** 값 + 목표 초과 시 적색 강조 */
function Cell({ v, high, unit }: { v: number | null; high?: boolean; unit?: string }) {
  if (v == null) return <span className="text-gray-300">-</span>;
  return <span className={high ? 'text-rose-600 font-semibold' : 'text-gray-700'}>{v}{unit ? <span className="text-[10px] text-gray-400 ml-0.5">{unit}</span> : null}</span>;
}

export default function ChronicDashboardPage() {
  const [view, setView] = useState<'dashboard' | 'caregaps'>('dashboard');
  const [condition, setCondition] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['chronic-dashboard', condition, status],
    queryFn: () => apiClient.get<{ data: Resp }>(`/api/v1/chronic/dashboard${condition || status ? `?${new URLSearchParams({ ...(condition ? { condition } : {}), ...(status ? { status } : {}) })}` : ''}`),
  });
  const resp = data?.data;
  const rows = resp?.patients ?? [];
  const s = resp?.summary;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="만성질환 관리" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="당뇨·고혈압 코호트 최신값과 조절 상태(목표 미달)를 한눈에 관리합니다." /></p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setView('dashboard')} className={`px-3 py-1.5 text-sm rounded-md ${view === 'dashboard' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}><T k="코호트 현황" /></button>
          <button onClick={() => setView('caregaps')} className={`px-3 py-1.5 text-sm rounded-md ${view === 'caregaps' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}><T k="추적관리" /></button>
        </div>
      </div>

      {view === 'caregaps' ? <CareGapsView /> : (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="관리 대상" value={s?.total ?? 0} />
        <Stat label="당뇨" value={s?.dm ?? 0} />
        <Stat label="고혈압" value={s?.htn ?? 0} />
        <Stat label="조절 불량" value={s?.uncontrolled ?? 0} tone="border-rose-200 bg-rose-50" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {COND_TABS.map(([v, l]) => <button key={l} onClick={() => setCondition(v)} className={`px-3 py-1.5 text-xs rounded-lg border ${condition === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}`}><T k={l} /></button>)}
        </div>
        <span className="text-gray-300">|</span>
        <div className="flex gap-1">
          {STATUS_TABS.map(([v, l]) => <button key={l} onClick={() => setStatus(v)} className={`px-3 py-1.5 text-xs rounded-lg border ${status === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}`}><T k={l} /></button>)}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        : !rows.length ? <EmptyState icon="👤" title="대상 환자가 없습니다." />
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
                <th className="px-4 py-2 font-medium"><T k="환자" /></th>
                <th className="px-3 py-2 font-medium"><T k="질환" /></th>
                <th className="px-3 py-2 font-medium">HbA1c</th>
                <th className="px-3 py-2 font-medium"><T k="공복혈당" /></th>
                <th className="px-3 py-2 font-medium"><T k="혈압" /></th>
                <th className="px-3 py-2 font-medium"><T k="체중/BMI" /></th>
                <th className="px-3 py-2 font-medium"><T k="상태" /></th>
                <th className="px-3 py-2 font-medium"><T k="최근측정" /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patientId} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/patients/${r.patientId}?tab=chronic`} className="font-medium text-blue-700 hover:underline">{r.name}</Link>
                    <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{r.mrn}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex gap-1">{r.conditions.map((c) => <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded-full ${COND_COLOR[c] ?? 'bg-gray-100 text-gray-600'}`}><T k={COND_LABEL[c] ?? c} /></span>)}</span>
                  </td>
                  <td className="px-3 py-2.5"><Cell v={r.latest.HBA1C} high={r.latest.HBA1C != null && r.latest.HBA1C >= 7} unit="%" /></td>
                  <td className="px-3 py-2.5"><Cell v={r.latest.FBS} high={r.latest.FBS != null && r.latest.FBS >= 130} /></td>
                  <td className="px-3 py-2.5">
                    {r.latest.SBP != null ? <span className={(r.latest.SBP >= 140 || (r.latest.DBP ?? 0) >= 90) ? 'text-rose-600 font-semibold' : 'text-gray-700'}>{r.latest.SBP}/{r.latest.DBP ?? '-'}</span> : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{r.latest.WEIGHT ?? '-'}{r.latest.BMI != null ? <span className="text-[11px] text-gray-400 ml-1">BMI {r.latest.BMI}</span> : null}</td>
                  <td className="px-3 py-2.5">
                    {r.controlled
                      ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><T k="양호" /></span>
                      : <Tf className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700" k="불량 · {건수}" params={{ 건수: r.alerts.length }} />}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-400">{r.lastMeasured ? kdate(r.lastMeasured) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>)}
    </div>
  );
}

type Indicator = { code: string; label: string; value: number | null; target: number; met: boolean | null; daysSince: number | null };
type Gap = { patientId: string; name: string; mrn: string; conditions: string[]; gaps: string[]; overdueDays: number | null; indicators: Indicator[] };
type GapResp = { gaps: Gap[]; summary: { total: number; recall: number; uncontrolled: number } };

function CareGapsView() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const { data, isLoading } = useQuery({
    queryKey: ['chronic-care-gaps'],
    queryFn: () => apiClient.get<{ data: GapResp }>('/api/v1/chronic/care-gaps'),
  });
  const resp = data?.data;
  const rows = resp?.gaps ?? [];
  const s = resp?.summary;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="케어갭 대상" value={s?.total ?? 0} />
        <Stat label="모니터링 미수행(리콜)" value={s?.recall ?? 0} tone="border-amber-200 bg-amber-50" />
        <Stat label="목표 미달" value={s?.uncontrolled ?? 0} tone="border-rose-200 bg-rose-50" />
      </div>
      <Tf className="text-xs text-gray-500" k="최근 핵심지표 측정이 {일수}일을 초과(리콜)했거나 가이드라인 목표를 달성하지 못한 환자입니다. 심각도 순." params={{ 일수: 90 }} />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        : !rows.length ? <EmptyState icon="👤" title="추적관리가 필요한 환자가 없습니다." />
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
                <th className="px-4 py-2 font-medium"><T k="환자" /></th>
                <th className="px-3 py-2 font-medium"><T k="질환" /></th>
                <th className="px-3 py-2 font-medium"><T k="케어갭" /></th>
                <th className="px-3 py-2 font-medium"><T k="핵심지표(최신/목표)" /></th>
                <th className="px-3 py-2 font-medium"><T k="경과" /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patientId} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/patients/${r.patientId}?tab=chronic`} className="font-medium text-blue-700 hover:underline">{r.name}</Link>
                    <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{r.mrn}</span>
                  </td>
                  <td className="px-3 py-2.5"><span className="flex gap-1">{r.conditions.map((c) => <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded-full ${COND_COLOR[c] ?? 'bg-gray-100 text-gray-600'}`}><T k={COND_LABEL[c] ?? c} /></span>)}</span></td>
                  <td className="px-3 py-2.5">
                    <span className="flex gap-1 flex-wrap">
                      {r.gaps.includes('RECALL') && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"><T k="리콜 필요" /></span>}
                      {r.gaps.includes('UNCONTROLLED') && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700"><T k="목표 미달" /></span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex gap-2 flex-wrap text-[11px]">
                      {r.indicators.map((i) => (
                        <span key={i.code} className={i.met === false ? 'text-rose-600 font-semibold' : i.met === true ? 'text-emerald-600' : 'text-gray-300'} title={i.daysSince != null ? tfAttr('{일수}일 전', { 일수: i.daysSince }) : tAttr('측정 없음')}>
                          {i.label} {i.value ?? '—'}/{i.target}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500">{r.overdueDays == null ? <span className="text-rose-500"><T k="측정 없음" /></span> : <Tf k="{일수}일 전" params={{ 일수: r.overdueDays }} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
