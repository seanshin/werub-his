'use client';

import { useState, useMemo } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import SkeletonDiagram from '@/components/specialty/SkeletonDiagram';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const SIDE_LABEL: Record<string, string> = { LEFT: '좌', RIGHT: '우', BILATERAL: '양측' };

/** ROM — JsonB 배열 [{movement, measured, normal}] → "굴곡 120°, 신전 10°" 요약. null 안전. */
function fmtRom(rom: unknown): string {
  if (rom == null) return '-';
  if (typeof rom === 'string') return rom || '-';
  if (Array.isArray(rom)) {
    const parts = rom
      .filter((r): r is Record<string, unknown> => r != null && typeof r === 'object')
      .map((r) => {
        const mv = r.movement != null ? String(r.movement) : '';
        const meas = r.measured != null ? `${r.measured}°` : '';
        return `${mv} ${meas}`.trim();
      })
      .filter(Boolean);
    return parts.length ? parts.join(', ') : '-';
  }
  return '-';
}

type OrthoSubTab = 'exams' | 'surgeries' | 'rehab';

export function OrthopedicsTab({ patientId }: { patientId: string }) {
  const [tab, setTab] = useState<OrthoSubTab>('exams');
  const [showDiagram, setShowDiagram] = useState(true);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['orthopedics-exams', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/orthopedics/exams/${patientId}`),
    enabled: !!patientId,
  });

  const { data: surgeryData, isError: surgeryIsError, error: surgeryError, refetch: refetchSurgery } = useQuery({
    queryKey: ['surgery-history', patientId],
    // 🔴 `/api/v1/surgeries` 는 서버에 없다(운영 404) — 다른 화면이 쓰는 정본은 `/surgery/schedule`
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/surgery/schedule', { patientId }),
    enabled: tab === 'surgeries' && !!patientId,
  });

  const { data: rehabData, isError: rehabIsError, error: rehabError, refetch: refetchRehab } = useQuery({
    queryKey: ['rehab-plans-ortho', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/rehab/plans`, { patientId }),
    enabled: tab === 'rehab' && !!patientId,
  });

  const items: Record<string, unknown>[] = (() => {
    const r = data?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const surgeries: Record<string, unknown>[] = (() => {
    const r = surgeryData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const rehabPlans: Record<string, unknown>[] = (() => {
    const r = rehabData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  // Pain trend from exams
  const painTrend = useMemo(() => {
    return items
      .filter(it => it.painVas != null && it.examinedAt)
      .sort((a, b) => new Date(a.examinedAt as string).getTime() - new Date(b.examinedAt as string).getTime())
      .map(it => ({ date: (it.examinedAt as string)?.slice(5, 10), vas: Number(it.painVas) }));
  }, [items]);

  const affectedSites = useMemo(() => [...new Set(items.map(it => (it.bodyPart as string) ?? '').filter(Boolean))], [items]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-gray-900">{items.length}</div>
          <div className="text-[10px] text-gray-500"><T k="검사 기록" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-blue-600">{affectedSites.length}</div>
          <div className="text-[10px] text-gray-500"><T k="이환 부위" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-amber-600">{painTrend.length > 0 ? painTrend[painTrend.length - 1].vas : '-'}</div>
          <div className="text-[10px] text-gray-500"><T k="최근 VAS" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-violet-600">{surgeryIsError ? <span className="text-sm text-red-600"><T k="조회 실패" /></span> : (surgeries.length || '-')}</div>
          <div className="text-[10px] text-gray-500"><T k="수술 이력" /></div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1.5">
        {([
          { k: 'exams' as const, l: '검사 기록', c: items.length },
          { k: 'surgeries' as const, l: '수술 이력', c: null },
          { k: 'rehab' as const, l: '재활 계획', c: null },
        ]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              tab === t.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}>{t.l}{t.c != null ? ` (${t.c})` : ''}</button>
        ))}
      </div>

      {/* Pain Trend */}
      {painTrend.length >= 2 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2"><T k="통증(VAS) 추이" /></h3>
          <div className="flex items-end gap-1 h-16">
            {painTrend.map((p, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div className={`w-full rounded-t-sm ${p.vas >= 7 ? 'bg-red-400' : p.vas >= 4 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  style={{ height: `${Math.max(4, (p.vas / 10) * 50)}px` }}
                  title={`VAS ${p.vas}`} />
                <span className="text-[8px] text-gray-400 mt-0.5">{p.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skeleton Diagram */}
      {tab === 'exams' && showDiagram && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900"><T k="골격 다이어그램" /></h3>
            <button onClick={() => setShowDiagram(false)} className="text-xs text-gray-400 hover:text-gray-600"><T k="숨기기" /></button>
          </div>
          <SkeletonDiagram selectedPart={null} onPartClick={() => {}} view="front" />
        </div>
      )}
      {tab === 'exams' && !showDiagram && (
        <button onClick={() => setShowDiagram(true)} className="text-xs text-blue-600 hover:underline"><T k="골격 다이어그램 보기" /></button>
      )}

      {/* Exam Records */}
      {tab === 'exams' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">측</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="ROM 요약" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="통증(VAS)" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
              </tr>
            </thead>
            <tbody>
              {isError ? <tr><td colSpan={6} className="py-6"><QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /></td></tr>
              : isLoading ? <LoadingRows cols={6} />
              : items.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="기록 없음" /></td></tr>
              : items.map((it) => (
                <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs font-bold text-gray-900">{(it.bodyPart as string) ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">
                      {SIDE_LABEL[it.side as string] ?? (it.side as string) ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{fmtRom(it.rom)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold ${Number(it.painVas) >= 7 ? 'text-red-600' : Number(it.painVas) >= 4 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {it.painVas != null ? `${it.painVas}/10` : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">{(it.diagnosis as string) ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{it.examinedAt ? kdate(it.examinedAt as string) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Surgery History */}
      {tab === 'surgeries' && (
        <div className="space-y-2">
          {surgeryIsError ? (
            <QueryErrorFallback error={surgeryError} onRetry={() => refetchSurgery()} size="compact" />
          ) : surgeries.length === 0 ? (
            <div className="py-12 text-center text-gray-400 bg-white rounded-2xl border"><T k="수술 기록 없음" /></div>
          ) : surgeries.map((s) => (
            <div key={s.id as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">{(s.procedureName as string) ?? (s.name as string) ?? '수술'}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                    s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>{s.status === 'COMPLETED' ? '완료' : String(s.status ?? '예정')}</span>
                </div>
                <span className="text-xs text-gray-400">
                  {s.scheduledDate ? kdate(s.scheduledDate as string) : s.createdAt ? kdate(s.createdAt as string) : ''}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {s.surgeon ? <div><span className="text-gray-400"><T k="집도의:" /> </span><span className="text-gray-700">{String(s.surgeon)}</span></div> : null}
                {s.anesthesiaType ? <div><span className="text-gray-400"><T k="마취:" /> </span><span className="text-gray-700">{String(s.anesthesiaType)}</span></div> : null}
                {s.duration ? <div><span className="text-gray-400"><T k="소요:" /> </span><span className="text-gray-700">{String(s.duration)}<Unit>분</Unit></span></div> : null}
              </div>
              {s.notes ? <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg p-2">{String(s.notes)}</p> : null}
            </div>
          ))}
        </div>
      )}

      {/* Rehab Plans */}
      {tab === 'rehab' && (
        <div className="space-y-2">
          {rehabIsError ? (
            <QueryErrorFallback error={rehabError} onRetry={() => refetchRehab()} size="compact" />
          ) : rehabPlans.length === 0 ? (
            <div className="py-12 text-center text-gray-400 bg-white rounded-2xl border"><T k="재활 계획 없음" /></div>
          ) : rehabPlans.map((p) => (
            <div key={p.id as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-gray-900">{(p.name as string) ?? '재활 계획'}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                  p.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : p.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                }`}>{p.status === 'ACTIVE' ? '진행 중' : p.status === 'COMPLETED' ? '완료' : String(p.status ?? '')}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                {p.diagnosis ? <div>진단: {String(p.diagnosis)}</div> : null}
                {p.goals ? <div>목표: {String(p.goals)}</div> : null}
                {p.startDate ? <div>시작: {kdate(new Date(p.startDate as string))}</div> : null}
                {p.totalSessions ? <div>총 세션: {String(p.totalSessions)}<Unit>회</Unit></div> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
