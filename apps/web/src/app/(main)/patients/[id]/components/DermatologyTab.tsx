'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import BodyMapDiagram from '@/components/specialty/BodyMapDiagram';
import type { Lesion as BodyMapLesion } from '@/components/specialty/BodyMapDiagram';
import BeforeAfterSlider from '@/components/specialty/BeforeAfterSlider';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const MORPHOLOGY_LABEL: Record<string, string> = { MACULE: '반점', PAPULE: '구진', NODULE: '결절', PLAQUE: '판', VESICLE: '소수포', BULLA: '대수포', PUSTULE: '농포', ULCER: '궤양', PATCH: '반' };
const TX_TYPE_LABEL: Record<string, string> = { TOPICAL: '외용', SYSTEMIC: '전신', PHOTOTHERAPY: '광선', LASER: '레이저', CRYOTHERAPY: '냉동', EXCISION: '절제', BIOPSY: '조직검사', INJECTION: '주사', CHEMICAL_PEEL: '화학박피', BOTOX: '보톡스', FILLER: '필러', IPL: 'IPL' };
const TX_TYPE_COLOR: Record<string, string> = { TOPICAL: 'bg-emerald-100 text-emerald-700', LASER: 'bg-violet-100 text-violet-700', CRYOTHERAPY: 'bg-blue-100 text-blue-700', EXCISION: 'bg-red-100 text-red-700', BIOPSY: 'bg-amber-100 text-amber-700', INJECTION: 'bg-indigo-100 text-indigo-700', BOTOX: 'bg-pink-100 text-pink-700', FILLER: 'bg-rose-100 text-rose-700' };

type DermSubTab = 'lesions' | 'treatments' | 'photos';

interface DermatologyTabProps {
  patientId: string;
}

export function DermatologyTab({ patientId }: DermatologyTabProps) {
  const [tab, setTab] = useState<DermSubTab>('lesions');

  const { data: lesionsData, isLoading: lesionsLoading, isError, error, refetch } = useQuery({
    queryKey: ['derm-lesions', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dermatology/lesions/${patientId}`),
    enabled: tab === 'lesions' && !!patientId,
  });

  const { data: treatmentsData, isLoading: treatmentsLoading, isError: treatmentsIsError, error: treatmentsError, refetch: refetchTreatments } = useQuery({
    queryKey: ['derm-treatments', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dermatology/treatments/${patientId}`),
    enabled: (tab === 'treatments' || tab === 'photos') && !!patientId,
  });

  const lesions: Record<string, unknown>[] = (() => { const r = lesionsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const treatments: Record<string, unknown>[] = (() => { const r = treatmentsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const [bodyMapView, setBodyMapView] = useState<'front' | 'back'>('front');

  const bodyMapLesions: BodyMapLesion[] = useMemo(() => {
    return lesions.map((l) => ({
      id: (l.id as string) ?? '',
      bodyRegion: (l.bodyRegion as string) ?? '',
      morphology: (l.morphology as string) ?? '',
      size: (l.size as string) ?? undefined,
    }));
  }, [lesions]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'lesions' as DermSubTab, label: '병변기록' },
          { key: 'treatments' as DermSubTab, label: '시술기록' },
          { key: 'photos' as DermSubTab, label: '사진비교' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 병변기록 */}
      {tab === 'lesions' && (
        <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex justify-center gap-2 mb-3">
            <button
              onClick={() => setBodyMapView('front')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${bodyMapView === 'front' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            ><T k="앞면" /></button>
            <button
              onClick={() => setBodyMapView('back')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${bodyMapView === 'back' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            ><T k="뒷면" /></button>
          </div>
          <BodyMapDiagram
            lesions={bodyMapLesions}
            onRegionClick={(region) => toast.info(`${region} 부위 선택`)}
            view={bodyMapView}
          />
        </div>

        {lesions.length > 0 && lesions.some(l => l.dermoscopy || l.pasiScore != null || l.scoradScore != null) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {lesions.filter(l => l.dermoscopy).slice(0, 2).map((l) => {
              const derm = l.dermoscopy as Record<string, unknown> | null;
              const abcde = (l.abcdeScore as number) ?? 0;
              const abcdeBreakdown = [
                { label: 'A', val: abcde >= 1 ? Math.min(Math.ceil(abcde / 2), 3) : 0 },
                { label: 'B', val: abcde >= 2 ? Math.min(Math.floor(abcde / 3) + 1, 3) : 0 },
                { label: 'C', val: abcde >= 3 ? Math.min(Math.floor(abcde / 2), 3) : 0 },
                { label: 'D', val: abcde >= 4 ? Math.min(abcde - 3, 3) : 0 },
                { label: 'E', val: abcde >= 6 ? Math.min(abcde - 5, 3) : 0 },
              ];
              return (
                <div key={l.id as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <h4 className="text-sm font-bold text-gray-900 mb-3">더모스코피 - {(l.location as string)}</h4>
                  {derm && (
                    <div className="space-y-2 text-xs text-gray-700 mb-3">
                      {derm.pattern != null ? <div><span className="text-gray-500"><T k="패턴:" /></span> {String(derm.pattern)}</div> : null}
                      {derm.colors != null ? <div><span className="text-gray-500"><T k="색상:" /></span> {Array.isArray(derm.colors) ? (derm.colors as string[]).join(', ') : String(derm.colors)}</div> : null}
                      {derm.structures != null ? <div><span className="text-gray-500"><T k="구조:" /></span> {Array.isArray(derm.structures) ? (derm.structures as string[]).join(', ') : String(derm.structures)}</div> : null}
                    </div>
                  )}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-2">ABCDE Score: <span className={`font-bold ${abcde >= 4 ? 'text-red-600' : 'text-emerald-600'}`}>{abcde}/8</span>
                      {abcde >= 4 && <span className="ml-2 text-red-600">-- 추적 관찰 권고</span>}
                    </div>
                    <div className="flex gap-3">
                      {abcdeBreakdown.map(item => (
                        <div key={item.label} className="flex items-center gap-1">
                          <span className="text-[10px] font-bold text-gray-600">{item.label}</span>
                          <div className="flex gap-0.5">
                            {[0, 1, 2].map(i => (
                              <div key={i} className={`w-3 h-3 rounded-sm ${i < item.val ? 'bg-gray-800' : 'bg-gray-200'}`} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}

            {lesions.some(l => l.pasiScore != null || l.scoradScore != null || l.gagsScore != null || l.breslowThickness != null) && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="질환 점수" /></h4>
                <div className="space-y-3">
                  {lesions.filter(l => l.pasiScore != null).slice(0, 1).map(l => {
                    const v = Number(l.pasiScore);
                    const sev = v <= 5 ? '경증' : v <= 10 ? '중등도' : '중증';
                    const col = v <= 5 ? 'text-emerald-600' : v <= 10 ? 'text-amber-600' : 'text-red-600';
                    return <div key={`pasi-${l.id}`} className="flex items-center justify-between text-xs"><span className="text-gray-600"><T k="PASI (건선)" /></span><span className={`font-bold ${col}`}>{v} ({sev})</span></div>;
                  })}
                  {lesions.filter(l => l.scoradScore != null).slice(0, 1).map(l => {
                    const v = Number(l.scoradScore);
                    const sev = v < 25 ? '경증' : v < 50 ? '중등도' : '중증';
                    const col = v < 25 ? 'text-emerald-600' : v < 50 ? 'text-amber-600' : 'text-red-600';
                    return <div key={`scorad-${l.id}`} className="flex items-center justify-between text-xs"><span className="text-gray-600"><T k="SCORAD (아토피)" /></span><span className={`font-bold ${col}`}>{v} ({sev})</span></div>;
                  })}
                  {lesions.filter(l => l.gagsScore != null).slice(0, 1).map(l => {
                    const v = Number(l.gagsScore);
                    const sev = v <= 18 ? '경증' : v <= 30 ? '중등도' : '중증';
                    const col = v <= 18 ? 'text-emerald-600' : v <= 30 ? 'text-amber-600' : 'text-red-600';
                    return <div key={`gags-${l.id}`} className="flex items-center justify-between text-xs"><span className="text-gray-600"><T k="GAGS (여드름)" /></span><span className={`font-bold ${col}`}>{v} ({sev})</span></div>;
                  })}
                  {lesions.filter(l => l.breslowThickness != null).slice(0, 1).map(l => (
                    <div key={`breslow-${l.id}`} className="text-xs space-y-1">
                      <div className="flex items-center justify-between"><span className="text-gray-600"><T k="Breslow 두께" /></span><span className="font-bold text-gray-900">{Number(l.breslowThickness).toFixed(2)} mm</span></div>
                      {l.clarkLevel != null && <div className="flex items-center justify-between"><span className="text-gray-600">Clark Level</span><span className="font-bold text-gray-900">{['I', 'II', 'III', 'IV', 'V'][Number(l.clarkLevel) - 1] ?? l.clarkLevel}</span></div>}
                      {l.tnmStage != null ? <div className="flex items-center justify-between"><span className="text-gray-600"><T k="TNM 병기" /></span><span className="font-bold text-gray-900">{String(l.tnmStage)}</span></div> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="위치" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="형태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="크기" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ABCDE</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="조직검사" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr></thead>
            <tbody>
              {lesionsLoading ? <LoadingRows cols={8} />
              : lesions.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="병변기록 없음" /></td></tr>
              : lesions.map((l) => {
                const score = (l.abcdeScore as number) ?? 0;
                return (
                  <tr key={l.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{(l.location as string)}</td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{(l.bodyRegion as string)}</span></td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 whitespace-nowrap">{MORPHOLOGY_LABEL[l.morphology as string] ?? (l.morphology as string)}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(l.size as string) ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${score >= 4 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{score}/8</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(l.diagnosis as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{l.biopsyTaken ? 'O' : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{l.recordedAt ? kdate(l.recordedAt as string) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* 시술기록 */}
      {tab === 'treatments' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시술명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부위" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="약물" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="합병증" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당의" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr></thead>
            <tbody>
              {treatmentsIsError ? <tr><td colSpan={7} className="px-4 py-3"><QueryErrorFallback error={treatmentsError} onRetry={refetchTreatments} size="compact" /></td></tr>
              : treatmentsLoading ? <LoadingRows cols={7} />
              : treatments.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="시술기록 없음" /></td></tr>
              : treatments.map((t) => {
                const doctor = t.treatedByUser as Record<string, unknown> | undefined;
                return (
                  <tr key={t.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TX_TYPE_COLOR[t.treatmentType as string] ?? 'bg-gray-100 text-gray-700'}`}>{TX_TYPE_LABEL[t.treatmentType as string] ?? (t.treatmentType as string)}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(t.procedure as string)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(t.area as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(t.medication as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[150px] truncate">{(t.complications as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(doctor?.familyName as string) ?? ''}{(doctor?.givenName as string) ?? ''}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{t.treatedAt ? kdate(t.treatedAt as string) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 사진비교 */}
      {tab === 'photos' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            {treatmentsIsError ? <QueryErrorFallback error={treatmentsError} onRetry={refetchTreatments} size="compact" />
            : treatmentsLoading ? <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>
            : treatments.filter(t => t.beforePhotoUrl || t.afterPhotoUrl).length === 0
              ? (
                <BeforeAfterSlider
                  beforeLabel="치료 전"
                  afterLabel="치료 후"
                />
              )
              : (
                <div className="space-y-6">
                  {treatments.filter(t => t.beforePhotoUrl || t.afterPhotoUrl).map((t) => (
                    <div key={t.id as string}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TX_TYPE_COLOR[t.treatmentType as string] ?? 'bg-gray-100'}`}>{TX_TYPE_LABEL[t.treatmentType as string] ?? (t.treatmentType as string)}</span>
                        <span className="text-xs text-gray-400">{t.treatedAt ? kdate(t.treatedAt as string) : ''}</span>
                      </div>
                      <BeforeAfterSlider
                        beforeUrl={(t.beforePhotoUrl as string) ?? undefined}
                        afterUrl={(t.afterPhotoUrl as string) ?? undefined}
                        beforeLabel="치료 전"
                        afterLabel="치료 후"
                      />
                      <p className="text-xs text-gray-700 mt-2 text-center">{(t.procedure as string)}</p>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
