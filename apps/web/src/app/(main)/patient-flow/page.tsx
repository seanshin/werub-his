'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit, useDurationText } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface ZoneStat { zoneId: string; name: string; floor?: number; department?: string; current: number; avgDwellMin: number | null; completedToday: number }
interface TimelineRow { id: string; zone?: { name: string; floor?: number } | null; enteredAt: string; leftAt?: string | null; duration?: number | null; eventType?: string | null }
interface PatientHit { id: string; familyName: string; givenName: string; mrn: string }

const EVENT_LABEL: Record<string, string> = { QR_CHECKIN: 'QR 체크인', ENCOUNTER_START: '진료 시작', ADMIT: '입원', DISCHARGE: '퇴원' };

export default function PatientFlowMonitorPage() {
  const fmtDur = useDurationText();
  const tAttr = useTAttr();
  const { data: statsData } = useQuery({
    queryKey: ['pf-zone-stats'],
    queryFn: () => apiClient.get<{ data: ZoneStat[] }>('/api/v1/patient-flow/zone-stats'),
    refetchInterval: pollMs('fast'),
  });
  const zoneStats = (statsData?.data ?? []) as ZoneStat[];

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [sel, setSel] = useState<PatientHit | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);

  const search = useCallback(async (term: string) => {
    if (term.trim().length < 1) { setHits([]); return; }
    try {
      const r = await apiClient.get<{ data: PatientHit[] }>('/api/v1/patients', { q: term, limit: 8 });
      const arr = Array.isArray(r.data) ? r.data : ((r.data as unknown as { data?: PatientHit[] })?.data ?? []);
      setHits(arr);
    } catch { setHits([]); }
  }, []);
  useEffect(() => { const t = setTimeout(() => search(q), 300); return () => clearTimeout(t); }, [q, search]);

  const loadTimeline = async (p: PatientHit) => {
    setSel(p); setHits([]); setQ(`${p.familyName}${p.givenName}`);
    try {
      const r = await apiClient.get<{ data: TimelineRow[] }>(`/api/v1/patient-flow/patient/${p.id}/timeline`);
      setTimeline(r.data ?? []);
    } catch { setTimeline([]); }
  };

  const totalActive = zoneStats.reduce((s, z) => s + z.current, 0);
  const fmtTime = (s: string) =>kdate(s, 'time');

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-900"><T k="동선 모니터" /></h2>
        <p className="text-sm text-gray-500 mt-1"><Tf k="QR 체크인 기반 실시간 구역 현황·체류시간과 환자별 동선 타임라인. 현재 원내 {수}." params={{ 수: <>{totalActive}<Unit>명</Unit></> }} /></p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* 구역 통계 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900"><T k="구역별 현황 (실시간)" /></h3>
            <span className="text-[11px] text-gray-400"><T k="10초 자동 갱신" /></span>
          </div>
          {zoneStats.length === 0 ? (
            <EmptyState icon="📊" title="체크인 데이터가 없습니다." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {zoneStats.map((z) => (
                <div key={z.zoneId} className={`rounded-xl border p-3 ${z.current > 0 ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50/40'}`}>
                  <p className="text-xs font-semibold text-gray-700 truncate">{z.floor != null ? `${z.floor}F · ` : ''}{z.name}</p>
                  <p className="text-2xl font-bold text-blue-700 mt-1">{z.current}<span className="text-xs font-normal text-gray-400"> <T k="명@단위" /></span></p>
                  <p className="text-[10px] text-gray-400 mt-0.5"><Tf k="평균 체류 {시간} · 오늘 {수}" params={{ 시간: z.avgDwellMin != null ? `${fmtDur(z.avgDwellMin)}` : '—', 수: <>{z.completedToday}<Unit>건</Unit></> }} /></p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 환자 동선 타임라인 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-2"><T k="환자 동선 조회" /></h3>
          <div className="relative">
            <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder={tAttr('환자명/MRN 검색')}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            {hits.length > 0 && !sel && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {hits.map((p) => (
                  <button key={p.id} onClick={() => loadTimeline(p)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm">
                    {p.familyName}{p.givenName} <span className="text-gray-400 text-xs">{p.mrn}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {sel && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">{sel.familyName}{sel.givenName} · {sel.mrn}</p>
              {timeline.length === 0 ? (
                <EmptyState icon="📝" title="동선 기록이 없습니다." />
              ) : (
                <ol className="relative border-l border-gray-200 ml-2 space-y-3">
                  {timeline.map((r) => (
                    <li key={r.id} className="ml-4">
                      <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-blue-500" />
                      <p className="text-xs font-medium text-gray-800">{r.zone?.name ?? <T k="구역" />}{!r.leftAt && <span className="ml-1 text-[10px] text-emerald-600"><T k="현재" /></span>}</p>
                      <p className="text-[10px] text-gray-400">
                        {fmtTime(r.enteredAt)}{r.leftAt ? ` ~ ${fmtTime(r.leftAt)}` : ''}
                        {r.duration != null ? <> · {r.duration}<T k="분@단위" /></> : ''}
                        {r.eventType ? <> · {EVENT_LABEL[r.eventType] ? <T k={EVENT_LABEL[r.eventType]} /> : r.eventType}</> : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
