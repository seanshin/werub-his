'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import type { ChartPanelProps } from './types';
import { T, useTAttr } from '@/components/ui/i18n-text';

export default function PharmacistChart({ session, summary, patientId, sessionId, notes, setNotes }: ChartPanelProps) {
  const tAttr = useTAttr();
  const [reviewOpinion, setReviewOpinion] = useState('');
  const [altSearch, setAltSearch] = useState('');

  // DUR 체크
  // catch로 삼키면 실패가 'DUR 경고 없음'(초록)으로 보임 — isError로 '점검 불가' 구분(2026-07-07 검토)
  const { data: durData, isError: durCheckFailed } = useQuery({
    queryKey: ['dur-check', patientId],
    queryFn: () => apiClient.post<{ data: Record<string, unknown> }>('/api/v1/cdss/check', { patientId }),
    enabled: !!patientId,
    retry: false,
  });
  const durRaw = durData?.data;
  const dur = (durRaw as { data?: Record<string, unknown> } | undefined)?.data ?? durRaw;
  const durAlerts = (dur as Record<string, unknown>)?.alerts as Array<{ type?: string; message?: string; severity?: string }> | undefined;

  // 대체 약물 검색
  const { data: altData, isError: altIsError, error: altError, refetch: refetchAlt } = useQuery({
    queryKey: ['alt-med', altSearch],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; nameKo: string; ingredient?: string }> }>(`/api/v1/codes/medication?q=${altSearch}&limit=5`),
    enabled: altSearch.length >= 2,
  });
  const altRaw = altData?.data;
  const altMeds: Array<{ id: string; nameKo: string; ingredient?: string }> = Array.isArray(altRaw) ? altRaw : (altRaw as { data?: Array<{ id: string; nameKo: string; ingredient?: string }> } | undefined)?.data ?? [];

  // 검토 의견 제출
  const reviewMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/telehealth/sessions/${sessionId}/pharmacy-review`, { review: reviewOpinion }),
    onSuccess: () => toast.success('처방 검토 의견이 전달되었습니다.'),
    onError: () => toast.error('의견 전달 실패'),
  });

  return (
    <>
      {/* 중앙: 처방 검토 + DUR */}
      <div className="w-72 shrink-0 border-r p-3 overflow-y-auto space-y-3">
        {/* 활성 처방 — summary.activeMedications(서버 정본). 종전엔 서버가 이 필드를 주지 않아
            의사가 처방을 발행해도 항상 "아직 처방 없음"이었다(P11). */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="활성 처방" /></p>
          {summary?.activeMedications && summary.activeMedications.length > 0 ? (
            <div className="space-y-1">
              {summary.activeMedications.map((m, i) => (
                <div key={i} className="bg-blue-50 rounded-lg p-2">
                  <p className="text-[10px] font-medium text-gray-800">{m.nameKo}</p>
                  <p className="text-[9px] text-gray-500">{m.dosage} · {m.frequency}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-400"><T k="활성 처방 없음" /></p>
          )}
        </div>

        {/* DUR / 약물 상호작용 경고 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="DUR / 상호작용" /></p>
          {durCheckFailed ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
              <p className="text-[10px] text-gray-500"><T k="DUR 점검 불가 — 응답을 받지 못했습니다. 수동 확인 필요" /></p>
            </div>
          ) : durAlerts && durAlerts.length > 0 ? (
            <div className="space-y-1">
              {durAlerts.map((a, i) => (
                <div key={i} className={`rounded-lg p-2 text-[10px] ${a.severity === 'HIGH' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                  <p className="font-bold"><T k={a.severity === 'HIGH' ? '⚠️ 위험' : '⚡ 주의'} /> {a.type}</p>
                  <p className="text-[9px] mt-0.5">{a.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-2">
              <p className="text-[10px] text-green-600"><T k="DUR 경고 없음" /></p>
            </div>
          )}
        </div>

        {/* 용량 적정성 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="용량 적정성" /></p>
          <div className="bg-gray-50 rounded-lg p-2 text-[9px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="체중 기준" /></span>
              <span className="text-gray-400"><T k="-- (데이터 없음)" /></span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="신기능 (eGFR)" /></span>
              <span className="text-gray-400"><T k="-- (데이터 없음)" /></span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="간기능" /></span>
              <span className="text-gray-400"><T k="-- (데이터 없음)" /></span>
            </div>
          </div>
        </div>
      </div>

      {/* 우측: 복약지도 + 검토 의견 + 대체 약물 */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {/* 복약지도 메모 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="복약지도 메모" /></p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={4}
            placeholder={tAttr('복약 지도 내용을 기록하세요... (복용 시간, 주의사항, 부작용 등)')}
            className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
          />
        </div>

        {/* 처방 검토 의견 (의사에게 전달) */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="처방 검토 의견" /></p>
          <textarea
            value={reviewOpinion}
            onChange={e => setReviewOpinion(e.target.value)}
            rows={3}
            placeholder={tAttr('처방 변경 건의, 용량 조절 의견 등 (의사에게 전달됩니다)')}
            className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm resize-none bg-amber-50/50"
          />
          <button onClick={() => reviewMut.mutate()} disabled={reviewMut.isPending || !reviewOpinion.trim()}
            className="mt-1.5 w-full py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 disabled:opacity-50">
            <T k={reviewMut.isPending ? '전달 중...' : '의사에게 검토 의견 전달'} />
          </button>
        </div>

        {/* 대체 약물 검색 */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="대체 약물 검색" /></p>
          <input value={altSearch} onChange={e => setAltSearch(e.target.value)} placeholder={tAttr('동일 성분 대체 약물 검색...')}
            className="w-full px-2 py-1.5 border rounded-lg text-xs" />
          {altIsError && altSearch.length >= 2 && (
            <QueryErrorFallback error={altError} onRetry={() => refetchAlt()} size="compact" className="mt-1" />
          )}
          {!altIsError && altMeds.length > 0 && altSearch.length >= 2 && (
            <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
              {altMeds.map(m => (
                <div key={m.id} className="bg-gray-50 rounded p-1.5 text-[10px]">
                  <p className="font-medium text-gray-700">{m.nameKo}</p>
                  {m.ingredient && <p className="text-[9px] text-gray-400">{m.ingredient}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
