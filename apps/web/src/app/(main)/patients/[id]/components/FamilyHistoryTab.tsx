'use client';

import { Term } from '@/components/ui/term';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { safeFormat as format } from '@/lib/safe-date';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface FamilyHistoryEntry {
  encounterId: string;
  date: string;
  doctorName: string;
  department: string | null;
  familyHistory: string;
}

interface StructuredFH {
  id: string;
  relation: string;
  conditionName: string;
  onsetAge: number | null;
  isDeceased: boolean;
  note: string | null;
  diagnosisCode?: { code?: string; nameKo?: string; nameEn?: string | null } | null;
}

interface DxCode { id: string; code: string; nameKo: string; nameEn?: string | null }

const RELATION_LABEL: Record<string, string> = {
  FATHER: '부', MOTHER: '모', SIBLING: '형제/자매', GRANDFATHER: '조부', GRANDMOTHER: '조모', CHILD: '자녀', OTHER: '기타',
};
const RELATION_OPTIONS = Object.entries(RELATION_LABEL);

/**
 * 가족력 확인 탭 — 구조화 가족력(관계·KCD·발병연령·생존, G4-2) + 과거 진료 자유텍스트(G4-4) 병행.
 */
export function FamilyHistoryTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [relation, setRelation] = useState('FATHER');
  const [conditionName, setConditionName] = useState('');
  const [dx, setDx] = useState<DxCode | null>(null);
  const [dxQ, setDxQ] = useState('');
  const [onsetAge, setOnsetAge] = useState('');
  const [isDeceased, setIsDeceased] = useState(false);

  const structuredQ = useQuery({
    queryKey: ['patient-family-histories', patientId],
    queryFn: () => apiClient.get<{ data: StructuredFH[] }>(`/api/v1/patients/${patientId}/family-histories`),
    enabled: !!patientId,
  });
  const structured: StructuredFH[] = (() => { const r = structuredQ.data?.data; return Array.isArray(r) ? r : ((r as Record<string, unknown> | undefined)?.data as StructuredFH[]) ?? []; })();

  const textQ = useQuery({
    queryKey: ['patient-family-history', patientId],
    queryFn: () => apiClient.get<{ data: FamilyHistoryEntry[] }>(`/api/v1/patients/${patientId}/family-history`),
    enabled: !!patientId,
  });
  const entries: FamilyHistoryEntry[] = (() => { const r = textQ.data?.data; return Array.isArray(r) ? r : ((r as Record<string, unknown> | undefined)?.data as FamilyHistoryEntry[]) ?? []; })();

  const dxSearch = useQuery({
    queryKey: ['fh-dx', dxQ],
    queryFn: () => apiClient.get<{ data: DxCode[] }>(`/api/v1/codes/diagnosis?q=${encodeURIComponent(dxQ)}&codeSystem=KCD-8&limit=6`),
    enabled: dxQ.trim().length >= 1 && !dx,
  });
  const dxResults = dxSearch.data?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['patient-family-histories', patientId] });

  const createMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/patients/${patientId}/family-histories`, {
      relation,
      conditionName: conditionName.trim() || dx?.nameKo || '',
      diagnosisCodeId: dx?.id,
      onsetAge: onsetAge ? Number(onsetAge) : undefined,
      isDeceased,
    }),
    onSuccess: () => {
      toast.success('가족력을 추가했습니다');
      setShowAdd(false); setConditionName(''); setDx(null); setDxQ(''); setOnsetAge(''); setIsDeceased(false); setRelation('FATHER');
      invalidate();
    },
    onError: () => toast.error('추가 실패'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/patients/${patientId}/family-histories/${id}`),
    onSuccess: () => { toast.success('삭제했습니다'); invalidate(); },
    onError: () => toast.error('삭제 실패'),
  });

  const canSave = (conditionName.trim() || dx) && relation;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
      {/* 구조화 가족력 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900"><T k="가족력 (Family History)" /></h3>
          <button onClick={() => setShowAdd(v => !v)} className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100">
            {showAdd ? '취소' : '＋ 가족력 추가'}
          </button>
        </div>

        {showAdd && (
          <div className="border border-gray-200 rounded-xl p-3 mb-3 space-y-2 bg-gray-50/50">
            <div className="grid grid-cols-2 gap-2">
              <select value={relation} onChange={e => setRelation(e.target.value)} className="text-sm border rounded-lg px-2 py-1.5 bg-white">
                {RELATION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input value={onsetAge} onChange={e => setOnsetAge(e.target.value.replace(/\D/g, ''))} placeholder={tAttr("발병연령")} className="text-sm border rounded-lg px-2 py-1.5" />
            </div>
            {/* KCD 검색 or 자유입력 */}
            {dx ? (
              <div className="flex items-center gap-2 text-sm bg-white border rounded-lg px-2 py-1.5">
                <span className="font-mono text-blue-600">{dx.code}</span>
                <span className="flex-1 truncate"><Term nameKo={dx.nameKo} nameEn={dx.nameEn} /></span>
                <button onClick={() => { setDx(null); setDxQ(''); }} className="text-gray-400 hover:text-red-500">×</button>
              </div>
            ) : (
              <div className="relative">
                <input value={dxQ || conditionName} onChange={e => { setDxQ(e.target.value); setConditionName(e.target.value); }} placeholder={tAttr("질환명(KCD 검색 또는 직접 입력)")} className="w-full text-sm border rounded-lg px-2 py-1.5" />
                {/* 🔴 코드 검색 실패를 "검색 결과 없음"으로 말하지 않는다 */}
                {dxSearch.isError && dxQ.trim().length >= 1 && (
                  <QueryErrorFallback error={dxSearch.error} onRetry={dxSearch.refetch} size="compact" className="mt-1" />
                )}
                {!dxSearch.isError && dxResults.length > 0 && dxQ.trim().length >= 1 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-40 overflow-auto">
                    {dxResults.map(c => (
                      <button key={c.id} onClick={() => { setDx(c); setConditionName(c.nameKo); setDxQ(''); }} className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 flex gap-2">
                        <span className="font-mono text-blue-600">{c.code}</span><span className="truncate"><Term nameKo={c.nameKo} nameEn={c.nameEn} /></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={isDeceased} onChange={e => setIsDeceased(e.target.checked)} /> <T k="사망" />
              </label>
              <button disabled={!canSave || createMut.isPending} onClick={() => createMut.mutate()} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                <T k="저장" />
              </button>
            </div>
          </div>
        )}

        {structuredQ.isLoading ? (
          <div className="h-12 bg-gray-50 rounded-lg animate-pulse" />
        ) : structured.length === 0 ? (
          <EmptyState icon="📋" title="구조화 가족력이 없습니다." />
        ) : (
          <ul className="space-y-1.5">
            {structured.map(fh => (
              <li key={fh.id} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-medium whitespace-nowrap">{RELATION_LABEL[fh.relation] ?? fh.relation}</span>
                {fh.diagnosisCode?.code && <span className="font-mono text-xs text-gray-500">{fh.diagnosisCode.code}</span>}
                <span className="flex-1 truncate text-gray-800">{fh.conditionName}</span>
                {fh.onsetAge != null && <span className="text-[11px] text-gray-400">{fh.onsetAge}세 발병</span>}
                {fh.isDeceased && <span className="text-[10px] text-red-500"><T k="사망" /></span>}
                <button onClick={() => { if (confirm('삭제할까요?')) deleteMut.mutate(fh.id); }} className="text-gray-400 hover:text-red-500 text-sm leading-none">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 진료 기록 가족력(자유텍스트) */}
      <div className="border-t border-gray-100 pt-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-2"><T k="진료 기록 가족력" /> <span className="text-gray-400 font-normal">({entries.length})</span></h4>
        {textQ.isError ? (
          <QueryErrorFallback error={textQ.error} onRetry={textQ.refetch} />
        ) : entries.length === 0 ? (
          <EmptyState icon="📝" title="진료 기록의 가족력이 없습니다." />
        ) : (
          <ol className="relative border-l-2 border-gray-100 ml-2 space-y-3">
            {entries.map((e) => (
              <li key={e.encounterId} className="ml-4">
                <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-gray-300 border-2 border-white" />
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-gray-600">{format(new Date(e.date), 'yyyy-MM-dd')}</span>
                  {e.department && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{e.department}</span>}
                  <span className="text-[11px] text-gray-400">{e.doctorName}</span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg px-3 py-1.5">{e.familyHistory}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
