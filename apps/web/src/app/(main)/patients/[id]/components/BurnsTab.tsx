'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate } from '@/components/ui/display';
import BurnsChart, { BURN_REGIONS, type BurnRegion } from '@/components/specialty/BurnsChart';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 화상 평가 탭 — gap-remediation R1(2026-09-06).
 *
 * 🔴 모델·서비스·EP·SVG 부품까지 전부 있었는데 배선만 0 이던 반쪽 기능의 회수.
 *    TBSA 는 **서버 계산이 정본**(FE 합산은 차트 표시용) · Parkland 체중은 미측정을
 *    기본값으로 채우지 않는다(입력 또는 서버가 활력징후에서 조회 — 출처를 표시).
 */

const DEPTHS = [
  { v: 'SUPERFICIAL', label: '표재성(1도)' },
  { v: 'PARTIAL', label: '부분층(2도)' },
  { v: 'FULL', label: '전층(3도)' },
  { v: 'DEEP', label: '심부(4도)' },
] as const;

/** 침범 범위 — 부위 기준 면적에 곱한다(명시 선택 — 기본값으로 채우지 않음) */
const EXTENTS = [
  { v: 1, label: '부위 전체' },
  { v: 0.5, label: '약 1/2' },
  { v: 0.25, label: '약 1/4' },
] as const;

interface Assessment {
  id: string;
  tbsa: number;
  regions: BurnRegion[];
  mechanism?: string | null;
  isChild?: boolean;
  weightKg?: number | null;
  notes?: string | null;
  assessedAt: string;
}

interface ParklandResult {
  totalMl24h: number; first8hMl: number; next16hMl: number;
  weightKg: number; weightSource: 'INPUT' | 'PRE_VISIT_VITALS';
  urineTargetMlPerHr?: number | null;
  remainingFirstPhaseHours?: number | null;
  [k: string]: unknown;
}

export default function BurnsTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [regions, setRegions] = useState<BurnRegion[]>([]);
  const [isChild, setIsChild] = useState(false);
  const [mechanism, setMechanism] = useState('');
  const [notes, setNotes] = useState('');
  // 부위 편집기 — 클릭한 부위에 대해 깊이·범위를 명시 선택(초기 미선택)
  const [pickRegion, setPickRegion] = useState<string | null>(null);
  const [pickDepth, setPickDepth] = useState<BurnRegion['depth'] | null>(null);
  const [pickExtent, setPickExtent] = useState<number | null>(null);
  // Parkland
  const [weightKg, setWeightKg] = useState('');
  const [hoursSinceBurn, setHoursSinceBurn] = useState('');
  const [parkland, setParkland] = useState<ParklandResult | null>(null);

  const histQ = useQuery({
    queryKey: ['burn-assessments', patientId],
    queryFn: () => apiClient.get<{ data: Assessment[] }>(`/api/v1/burn-assessment/${patientId}`),
  });
  const history: Assessment[] = histQ.data?.data ?? [];

  // 🔴 TBSA 정본은 서버 — 부위가 바뀔 때마다 서버 계산을 받아 표시(실패는 실패라고)
  const [serverTbsa, setServerTbsa] = useState<number | null>(null);
  const tbsaMut = useMutation({
    mutationFn: (vars: { regions: BurnRegion[]; isChild: boolean }) =>
      apiClient.post<{ data: { tbsa: number } }>('/api/v1/burn-assessment/calculate-tbsa', vars),
    onSuccess: (r) => setServerTbsa(r.data?.tbsa ?? null),
    onError: () => setServerTbsa(null),
  });
  useEffect(() => {
    if (!editing) return;
    if (regions.length === 0) { setServerTbsa(null); return; }
    tbsaMut.mutate({ regions, isChild });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, isChild, editing]);

  const parklandMut = useMutation({
    mutationFn: () => apiClient.post<{ data: ParklandResult }>('/api/v1/burn-assessment/calculate-parkland', {
      patientId,
      tbsa: serverTbsa,
      isChild,
      ...(weightKg.trim() ? { weightKg: Number(weightKg) } : {}),
      ...(hoursSinceBurn.trim() ? { hoursSinceBurn: Number(hoursSinceBurn) } : {}),
    }),
    onSuccess: (r) => setParkland(r.data ?? null),
    onError: (e) => { setParkland(null); toast.error((e as { message?: string })?.message || '수액소생 계산 실패'); },
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/burn-assessment', {
      patientId,
      regions,
      isChild,
      ...(mechanism.trim() ? { mechanism: mechanism.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(weightKg.trim() ? { weightKg: Number(weightKg) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['burn-assessments', patientId] });
      setEditing(false); setRegions([]); setMechanism(''); setNotes(''); setParkland(null); setServerTbsa(null);
      toast.success('화상 평가가 저장되었습니다.');
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '저장 실패'),
  });

  const regionDef = (id: string) => BURN_REGIONS.find((r) => r.id === id);
  const addPicked = () => {
    if (!pickRegion || !pickDepth || pickExtent == null) return;
    const def = regionDef(pickRegion);
    if (!def) return;
    const base = isChild ? def.childPct : def.adultPct;
    const percentage = Math.round(base * pickExtent * 10) / 10;
    setRegions((prev) => [...prev.filter((r) => r.region !== pickRegion), { region: pickRegion, depth: pickDepth, percentage }]);
    setPickRegion(null); setPickDepth(null); setPickExtent(null);
  };

  if (histQ.isError) return <div className="p-4"><QueryErrorFallback error={histQ.error} onRetry={() => histQ.refetch()} /></div>;

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800"><T k="화상 평가 (Rule of Nines)" /></h3>
        {!editing && (
          <button onClick={() => setEditing(true)} className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-700">
            <T k="새 평가" />
          </button>
        )}
      </div>

      {editing && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={isChild} onChange={(e) => setIsChild(e.target.checked)} />
              소아 기준(체표 비율이 다릅니다)
            </label>
            {/* 🔴 TBSA 정본 = 서버 계산. 계산 중·실패를 값처럼 그리지 않는다 */}
            <span className="text-xs text-gray-600">
              TBSA(서버 계산):{' '}
              {tbsaMut.isPending ? <span className="text-gray-400"><T k="계산 중…" /></span>
                : tbsaMut.isError ? <span className="text-rose-600"><T k="계산 실패" /></span>
                : serverTbsa != null ? <b className="tabular-nums">{serverTbsa}%</b>
                : <span className="text-gray-400"><T k="부위를 선택하세요" /></span>}
            </span>
          </div>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <BurnsChart regions={regions} isChild={isChild} mode="edit"
                onRegionClick={(r) => { setPickRegion(r); setPickDepth(null); setPickExtent(null); }} />
            </div>
            <div className="space-y-3">
              {pickRegion && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                  <p className="text-xs font-medium text-gray-800">
                    {regionDef(pickRegion)?.label ?? pickRegion}
                    <span className="ml-1 text-[10px] text-gray-400">
                      기준 {isChild ? regionDef(pickRegion)?.childPct : regionDef(pickRegion)?.adultPct}%
                    </span>
                  </p>
                  {/* 🔴 깊이·범위는 명시 선택 — 초기 미선택(기본값이 기록되는 사고 방지) */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {DEPTHS.map((d) => (
                      <button key={d.v} onClick={() => setPickDepth(d.v)} aria-pressed={pickDepth === d.v}
                        className={`min-h-[44px] rounded-lg border px-2.5 text-[11px] ${pickDepth === d.v ? 'border-blue-400 bg-blue-100 text-blue-800' : 'border-gray-200 bg-white text-gray-600'}`}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {EXTENTS.map((x) => (
                      <button key={x.v} onClick={() => setPickExtent(x.v)} aria-pressed={pickExtent === x.v}
                        className={`min-h-[44px] rounded-lg border px-2.5 text-[11px] ${pickExtent === x.v ? 'border-blue-400 bg-blue-100 text-blue-800' : 'border-gray-200 bg-white text-gray-600'}`}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={addPicked} disabled={!pickDepth || pickExtent == null}
                      className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-xs font-medium text-white disabled:opacity-40"><T k="부위 추가" /></button>
                    <button onClick={() => setPickRegion(null)} className="min-h-[44px] rounded-lg px-3 text-xs text-gray-500 hover:bg-gray-100"><T k="취소" /></button>
                  </div>
                </div>
              )}

              {regions.length > 0 && (
                <ul className="divide-y divide-gray-50 rounded-lg border border-gray-100 text-xs">
                  {regions.map((r) => (
                    <li key={r.region} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="flex-1">{regionDef(r.region)?.label ?? r.region}</span>
                      <span className="text-gray-500">{DEPTHS.find((d) => d.v === r.depth)?.label}</span>
                      <span className="tabular-nums text-gray-700">{r.percentage}%</span>
                      <button onClick={() => setRegions((prev) => prev.filter((x) => x.region !== r.region))}
                        className="min-h-[44px] px-2 text-[11px] text-rose-500 hover:bg-rose-50 rounded"><T k="제거" /></button>
                    </li>
                  ))}
                </ul>
              )}

              <input value={mechanism} onChange={(e) => setMechanism(e.target.value)} placeholder={tAttr("손상 기전(화염·열탕·전기·화학 등)")}
                className="w-full rounded-lg border border-gray-200 p-2 text-xs" />
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={tAttr("비고")}
                className="w-full rounded-lg border border-gray-200 p-2 text-xs" />

              {/* Parkland — 체중은 미측정을 채우지 않는다(입력 없으면 서버가 활력징후 조회·출처 표시) */}
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-700">Parkland 수액소생</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} inputMode="decimal" placeholder={tAttr("체중 kg(비우면 활력징후 조회)")}
                    className="w-44 rounded-lg border border-gray-200 p-2 text-xs" />
                  <input value={hoursSinceBurn} onChange={(e) => setHoursSinceBurn(e.target.value)} inputMode="decimal" placeholder={tAttr("수상 후 경과 h")}
                    className="w-36 rounded-lg border border-gray-200 p-2 text-xs" />
                  <button onClick={() => parklandMut.mutate()} disabled={serverTbsa == null || serverTbsa <= 0 || parklandMut.isPending}
                    className="min-h-[44px] rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white disabled:opacity-40">
                    {parklandMut.isPending ? '계산 중…' : '수액 계산'}
                  </button>
                </div>
                {parkland && (
                  <div className="mt-2 text-xs text-gray-700">
                    24h 총 <b className="tabular-nums">{parkland.totalMl24h.toLocaleString('ko-KR')}mL</b>
                    {' · '}전반 8h <b className="tabular-nums">{parkland.first8hMl.toLocaleString('ko-KR')}mL</b>
                    {' · '}후반 16h <b className="tabular-nums">{parkland.next16hMl.toLocaleString('ko-KR')}mL</b>
                    <span className="ml-2 text-[10px] text-gray-400">
                      체중 {parkland.weightKg}kg({parkland.weightSource === 'PRE_VISIT_VITALS' ? '활력징후에서 조회' : '입력값'})
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => saveMut.mutate()} disabled={regions.length === 0 || saveMut.isPending}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-xs font-medium text-white disabled:opacity-40">
                  {saveMut.isPending ? '저장 중…' : '평가 저장'}
                </button>
                <button onClick={() => { setEditing(false); setRegions([]); setParkland(null); setServerTbsa(null); }}
                  className="min-h-[44px] rounded-lg px-3 text-xs text-gray-500 hover:bg-gray-100"><T k="닫기" /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {histQ.isLoading ? (
        <div className="p-6 text-xs text-gray-400"><T k="불러오는 중…" /></div>
      ) : history.length === 0 ? (
        <EmptyState title="화상 평가 기록이 없습니다" hint="'새 평가'로 Rule of Nines 평가를 기록합니다." />
      ) : (
        <div className="space-y-3">
          {history.map((a) => (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                <span className="text-gray-500"><KDate value={a.assessedAt} mode="datetime" /></span>
                <span className="font-semibold tabular-nums text-gray-900">TBSA {a.tbsa}%</span>
                {a.isChild && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">소아 기준</span>}
                {a.mechanism && <span className="text-gray-500">기전: {a.mechanism}</span>}
                {a.weightKg != null && <span className="text-gray-400">체중 {a.weightKg}kg</span>}
              </div>
              <div className="mt-2 max-w-[300px]">
                <BurnsChart regions={a.regions ?? []} isChild={!!a.isChild} mode="view" />
              </div>
              {a.notes && <p className="mt-1 text-xs text-gray-500">{a.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
