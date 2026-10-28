'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import PatientSelector from '@/components/ui/PatientSelector';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface PacsStudy {
  orthanc_id?: string;
  study_instance_uid: string;
  study_description?: string;
  patient_name?: string;
  patient_id?: string;
  study_date?: string;
  modalities?: string;
  modality?: string;
  series_count?: number;
}

interface PacsStudiesResponse {
  results: PacsStudy[];
  count: number;
}

interface AiModel {
  id?: string;
  model_id?: string;
}

interface AiModelsResponse {
  results: AiModel[];
}

interface AiInferenceResponse {
  data?: { job_id?: string; id?: string };
}

export function StudiesTab() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [patientId, setPatientId] = useState('');
  const [modality, setModality] = useState('');
  const [searchTrigger, setSearchTrigger] = useState(0);

  // 🔴 서버는 PACS 조회 실패를 503 으로 정직하게 말한다(2026-08-18) — 화면이 그걸 "검색 결과 없음"으로
  //    덮으면 그 정직함이 지워진다. 운영에서는 PACS 자격 미설정으로 401 이 나던 상태였다.
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['pacs-studies', patientId, modality, searchTrigger],
    queryFn: () => apiClient.get<{ data: PacsStudiesResponse }>('/api/v1/pacs/studies', {
      patientId: patientId || undefined,
      modality: modality || undefined,
    }),
    enabled: searchTrigger > 0,
  });

  const { data: aiModelsData } = useQuery({
    queryKey: ['pacs-ai-models'],
    queryFn: () => apiClient.get<{ data: AiModelsResponse }>('/api/v1/pacs/ai/models'),
  });

  const aiModels = aiModelsData?.data?.results ?? [];

  /**
   * 🔴 (2026-09-17 L3) AI 판독 실행은 서버가 `@Roles(DOCTOR, ADMIN)` + `PACS_AI_INFERENCE` 다 —
   *    판독 주체의 행위라 촬영·전송을 맡는 검사기사에게 열지 않는다. 그런데 nav(`/imaging`)는
   *    ADMIN·LAB_TECH·DOCTOR 이고 버튼은 그대로 그려 검사기사가 누를 때마다 403 이었다.
   */
  const canRunAi = useHasRole('DOCTOR');
  const aiInference = useMutation({
    mutationFn: (params: { study_instance_uid: string; model_id: string }) =>
      apiClient.post<AiInferenceResponse>('/api/v1/pacs/ai/inference', { ...params, priority: 'ROUTINE' }),
    onSuccess: (res) => {
      const jobId = res?.data?.job_id ?? res?.data?.id;
      // 🔴 `{출처}` 는 AI 표기라 번역하지 않고 넣는다(AI기본법 §31 · shared AI_ORIGIN_TEXT)
      toast.success(tfAttr('{출처} 분석 요청 완료', { 출처: AI_ORIGIN_TEXT }) + (jobId ? ` (Job: ${jobId})` : ''));
    },
    onError: () => toast.error(tfAttr('{출처} 분석 요청에 실패했습니다.', { 출처: AI_ORIGIN_TEXT })),
  });

  const studies = data?.data?.results ?? [];
  const totalCount = data?.data?.count ?? 0;

  const openOhif = async (studyUid: string) => {
    try {
      const res = await apiClient.get<{ data: { url: string } }>(`/api/v1/pacs/viewer/${encodeURIComponent(studyUid)}`);
      window.open(res.data.url, '_blank');
    } catch {
      toast.error(tAttr('뷰어 URL을 가져올 수 없습니다.'));
    }
  };

  const handleAiInference = (studyUid: string) => {
    if (aiModels.length === 0) {
      toast.error(tfAttr('사용 가능한 {출처} 모델이 없습니다.', { 출처: AI_ORIGIN_TEXT }));
      return;
    }
    aiInference.mutate({ study_instance_uid: studyUid, model_id: aiModels[0]?.id ?? aiModels[0]?.model_id ?? 'default' });
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1"><T k="환자 선택" /></label>
          <PatientSelector
            value={patientId}
            onChange={(id) => setPatientId(id)}
            context="lab"
            placeholder={tAttr('환자 검색 (이름, MRN)')}
          />
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium text-gray-500 mb-1">Modality</label>
          <select value={modality} onChange={(e) => setModality(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
            <option value="">{tAttr('전체')}</option>
            <option value="CR">CR</option><option value="DX">DX</option><option value="CT">CT</option>
            <option value="MR">MR</option><option value="US">US</option><option value="XA">XA</option>
          </select>
        </div>
        <button onClick={() => setSearchTrigger((n) => n + 1)} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"><T k="검색" /></button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {searchTrigger === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-sm text-gray-400"><T k="환자 ID 또는 Modality로 검색하세요." /></p>
          </div>
        ) : isLoading || isFetching ? (
          <div className="p-5 space-y-4">
            {[...Array(4)].map((_, i) => (<div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />))}
          </div>
        ) : isError ? (
          <div className="p-12 text-center">
            {/* 🔴 서버 사유는 서버가 조립한 문장이라 번역하지 않는다 — 없을 때의 원내 문구만 번역한다 */}
            <p className="text-sm text-red-600">{(error as { message?: string })?.message ?? tAttr('영상 목록을 불러오지 못했습니다.')}</p>
            <p className="text-xs text-gray-400 mt-1"><T k="검사가 없는 것이 아니라 조회에 실패했습니다." /></p>
            <button onClick={() => refetch()} className="mt-3 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"><T k="다시 시도" /></button>
          </div>
        ) : studies.length === 0 ? (
          <div className="p-12 text-center"><p className="text-sm text-gray-400"><T k="검색 결과가 없습니다." /></p></div>
        ) : (
          <>
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <Tf className="text-xs text-gray-500" k="총 {건수}" params={{ 건수: <>{totalCount}<Unit>건</Unit></> }} />
            </div>
            <div className="divide-y divide-gray-50">
              {studies.map((study: PacsStudy) => (
                <div key={study.orthanc_id || study.study_instance_uid} className="p-4 flex items-center justify-between hover:bg-blue-50/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                      <span className="text-xs font-bold text-blue-600">{(study.modalities ?? study.modality ?? 'IM').toString().slice(0, 2)}</span>
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-900">{study.study_description || 'No Description'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {study.patient_name} ({study.patient_id})
                        <span className="mx-1.5 text-gray-300">|</span>{study.study_date}
                        <span className="mx-1.5 text-gray-300">|</span>{study.series_count ?? 0} series
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] px-2 py-1 bg-gray-100 text-gray-500 rounded-lg font-mono">{study.modalities ?? '-'}</span>
                    {canRunAi && <button onClick={() => handleAiInference(study.study_instance_uid)} disabled={aiInference.isPending}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded-xl text-xs font-medium hover:bg-purple-700 transition-colors disabled:opacity-50" title={tfAttr('{출처} 자동 분석', { 출처: AI_ORIGIN_TEXT })}><Tf k="{출처} 분석" params={{ 출처: AI_ORIGIN_TEXT }} /></button>}
                    <button onClick={() => openOhif(study.study_instance_uid)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors"><T k="OHIF 뷰어" /></button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
