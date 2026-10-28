'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import type { ChartPanelProps } from './types';
import { safeDateStr } from './types';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface SoapNotes { S: string; O: string; A: string; P: string }

export default function DoctorChart({ session, summary, patientId, sessionId, notes, setNotes, isActive }: ChartPanelProps) {
  const tAttr = useTAttr();
  // SOAP 구조화 메모
  const parseSoap = (raw: string): SoapNotes => {
    try { const parsed = JSON.parse(raw); return { S: parsed.S || '', O: parsed.O || '', A: parsed.A || '', P: parsed.P || '' }; }
    catch { return { S: raw, O: '', A: '', P: '' }; }
  };
  const [soap, setSoap] = useState<SoapNotes>(parseSoap(notes));
  const updateSoap = (key: keyof SoapNotes, val: string) => {
    const next = { ...soap, [key]: val };
    setSoap(next);
    setNotes(JSON.stringify(next));
  };

  // 진단 코드 검색
  const [dxSearch, setDxSearch] = useState('');
  const [selectedDx, setSelectedDx] = useState<Array<{ id: string; code: string; nameKo: string }>>([]);
  const { data: dxData, isError: dxIsError, error: dxError, refetch: refetchDx } = useQuery({
    queryKey: ['dx-search', dxSearch],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; code: string; nameKo: string }> }>(`/api/v1/codes/diagnosis?q=${dxSearch}&limit=5`),
    enabled: dxSearch.length >= 2,
  });
  const dxRaw = dxData?.data;
  const dxList: Array<{ id: string; code: string; nameKo: string }> = Array.isArray(dxRaw) ? dxRaw : (dxRaw as { data?: Array<{ id: string; code: string; nameKo: string }> } | undefined)?.data ?? [];

  // 🔴 종전에는 고른 진단이 화면 state 에만 쌓이고 **어디에도 전송되지 않았다** — 진료가 끝나면 사라졌다.
  //    진단은 진료 기록(Encounter)에 붙는다. 기록은 세션 시작 시 만들어진다.
  const encounterId = session.encounterId ?? null;
  const saveDx = useMutation({
    mutationFn: () => apiClient.put(`/api/v1/encounters/${encounterId}`, {
      diagnoses: selectedDx.map((d, i) => ({ diagnosisCodeId: d.id, type: i === 0 ? 'PRIMARY' : 'SECONDARY' })),
    }),
    onSuccess: () => toast.success('진단이 진료 기록에 저장되었습니다.'),
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '진단 저장 실패'),
  });

  return (
    <>
      {/* 중앙: 진료 이력 */}
      <div className="w-64 shrink-0 border-r p-3 overflow-y-auto">
        <p className="text-[10px] font-bold text-gray-400 uppercase mb-2"><T k="최근 진료" /></p>
        {summary?.recentEncounters && summary.recentEncounters.length > 0 ? (
          <div className="space-y-2">
            {summary.recentEncounters.slice(0, 5).map((e, i) => (
              <div key={i} className="border-l-2 border-blue-200 pl-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">{safeDateStr(e.createdAt)}</span>
                  <span className="text-[10px] text-gray-600 font-medium">{e.doctor?.department ?? ''}</span>
                </div>
                {e.diagnoses && e.diagnoses.length > 0 && (
                  <p className="text-[10px] text-blue-600">{e.diagnoses.map(d => d.diagnosisCode?.nameKo).filter(Boolean).join(', ')}</p>
                )}
                {!e.diagnoses?.length && e.chiefComplaint && (
                  <p className="text-[10px] text-gray-500 truncate">{e.chiefComplaint}</p>
                )}
                {e.assessment && (
                  <p className="text-[9px] text-gray-400 truncate mt-0.5">{e.assessment}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-gray-400"><T k="진료 이력 없음" /></p>
        )}
      </div>

      {/* 우측: SOAP 메모 + 진단 + 처방 */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {/* SOAP 구조화 메모 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="진료 메모 (SOAP)" /></p>
          <div className="space-y-1.5">
            {([
              { key: 'S' as const, label: 'Subjective (주관적)', placeholder: '환자 호소 내용...' },
              { key: 'O' as const, label: 'Objective (객관적)', placeholder: '검사/관찰 소견...' },
              { key: 'A' as const, label: 'Assessment (평가)', placeholder: '진단/평가...' },
              { key: 'P' as const, label: 'Plan (계획)', placeholder: '치료 계획...' },
            ]).map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-[9px] font-bold text-gray-500"><T k={label} /></label>
                <textarea
                  value={soap[key]}
                  onChange={e => updateSoap(key, e.target.value)}
                  rows={2}
                  placeholder={tAttr(placeholder)}
                  className="w-full px-2 py-1.5 border rounded-lg text-xs resize-none mt-0.5"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 진단 코드 입력 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="진단 코드" /></p>
          {selectedDx.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {selectedDx.map((dx, i) => (
                <span key={i} className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  {dx.code} {dx.nameKo}
                  <button onClick={() => setSelectedDx(prev => prev.filter((_, j) => j !== i))} className="text-purple-400 hover:text-purple-700">&times;</button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <input value={dxSearch} onChange={e => setDxSearch(e.target.value)} placeholder={tAttr('진단 코드 검색 (예: J00, 감기)...')}
              className="w-full px-2 py-1.5 border rounded-lg text-xs" />
            {dxIsError && dxSearch.length >= 2 && (
              <QueryErrorFallback error={dxError} onRetry={() => refetchDx()} size="compact" className="mt-1" />
            )}
            {dxList.length > 0 && dxSearch.length >= 2 && (
              <div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-lg z-10 max-h-32 overflow-y-auto">
                {dxList.map(dx => (
                  <button key={dx.id} onClick={() => { setSelectedDx(prev => prev.some(p => p.id === dx.id) ? prev : [...prev, dx]); setDxSearch(''); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-purple-50 border-b border-gray-50">
                    <span className="font-medium text-purple-700">{dx.code}</span> {dx.nameKo}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedDx.length > 0 && (
          <button
            onClick={() => saveDx.mutate()}
            disabled={!encounterId || saveDx.isPending}
            className="mt-2 w-full py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-40">
            {saveDx.isPending ? '저장 중...' : `진단 ${selectedDx.length}건 저장`}
          </button>
        )}
        {!encounterId && selectedDx.length > 0 && (
          <p className="mt-1 text-[10px] text-amber-600"><T k="진료를 시작해야 기록에 저장할 수 있습니다." /></p>
        )}

        {/* 처방 입력 */}
        {isActive && <QuickPrescription encounterId={encounterId} />}
      </div>
    </>
  );
}

function QuickPrescription({ encounterId }: { encounterId: string | null }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [prescriptions, setPrescriptions] = useState<Array<{ id: string; name: string; dosage: string; frequency: string; duration: number }>>([]);

  const { data: searchData, isError: medIsError, error: medError, refetch: refetchMed } = useQuery({
    queryKey: ['med-search', search],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; nameKo: string; dosageForm?: string }> }>(`/api/v1/codes/medication?q=${search}&limit=5`),
    enabled: search.length >= 2,
  });

  // 🔴 종전에는 입력한 처방이 화면 state 에만 남고 **전송되지 않았다** — 환자는 약을 받지 못한다.
  //    처방은 정본 경로(`/encounters/:id/prescriptions`)로만 만든다 — 그 경로에 DUR 점검이 걸려 있다.
  const issue = useMutation({
    mutationFn: async () => {
      for (const rx of prescriptions) {
        await apiClient.post(`/api/v1/encounters/${encounterId}/prescriptions`, {
          type: 'MEDICATION',
          medicationCodeId: rx.id,
          dosage: rx.dosage,
          frequency: rx.frequency,
          duration: rx.duration,
        });
      }
    },
    onSuccess: () => {
      toast.success(`처방 ${prescriptions.length}건이 발행되었습니다.`);
      setPrescriptions([]);
      qc.invalidateQueries({ queryKey: ['telehealth-session'] });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '처방 발행 실패'),
  });
  const raw = searchData?.data;
  const meds: Array<{ id: string; nameKo: string; dosageForm?: string }> = Array.isArray(raw) ? raw : (raw as { data?: Array<{ id: string; nameKo: string; dosageForm?: string }> } | undefined)?.data ?? [];

  return (
    <div className="border-t pt-3">
      <h4 className="text-xs font-bold text-gray-400 uppercase mb-2"><T k="처방 입력" /></h4>
      <div className="relative">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tAttr('약물 검색...')}
          className="w-full px-2 py-1.5 border rounded-lg text-xs" />
        {medIsError && search.length >= 2 && (
          <QueryErrorFallback error={medError} onRetry={() => refetchMed()} size="compact" className="mt-1" />
        )}
        {meds.length > 0 && search.length >= 2 && (
          <div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-lg z-10 max-h-32 overflow-y-auto">
            {meds.map(m => (
              <button key={m.id} onClick={() => { setPrescriptions(prev => [...prev, { id: m.id, name: m.nameKo, dosage: '1정', frequency: '1일 3회', duration: 3 }]); setSearch(''); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 border-b border-gray-50">
                {m.nameKo} {m.dosageForm && <span className="text-gray-400">({m.dosageForm})</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {prescriptions.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {prescriptions.map((rx, i) => (
            <div key={i} className="flex items-center justify-between bg-blue-50 rounded-lg p-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">{rx.name}</p>
                <p className="text-[10px] text-gray-500">{rx.dosage} · {rx.frequency} · {rx.duration}<Unit><T k="일" /></Unit></p>
              </div>
              <button onClick={() => setPrescriptions(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs ml-2">&times;</button>
            </div>
          ))}
          <button
            onClick={() => issue.mutate()}
            disabled={!encounterId || issue.isPending}
            className="w-full py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40">
            {issue.isPending ? '발행 중...' : `처방 ${prescriptions.length}건 발행`}
          </button>
          {!encounterId && <p className="text-[10px] text-amber-600"><T k="진료를 시작해야 처방을 발행할 수 있습니다." /></p>}
        </div>
      )}
    </div>
  );
}
