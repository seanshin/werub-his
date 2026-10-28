'use client';

import { useState } from 'react';
import { genderText } from '@/components/ui/display';
import { ageOf } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { StationLayout } from './StationLayout';
import { DynamicStationForm } from './DynamicStationForm';
import { NextStationGuide } from './NextStationGuide';
import { T } from '@/components/ui/i18n-text';

interface StationPageProps {
  stationId: string;
}

export function StationPage({ stationId }: StationPageProps) {
  const queryClient = useQueryClient();
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);

  const { data: stationRes } = useQuery({
    queryKey: ['ck-ws-station', stationId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/ws/stations/${stationId}`),
  });
  const station = stationRes?.data;

  const { data: queueRes } = useQuery({
    queryKey: ['ck-ws-queue', stationId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/ws/stations/${stationId}/queue`),
    refetchInterval: 8000,
  });
  const queue = queueRes?.data?.queue ?? [];

  // 첫 번째 대기 환자 자동 선택
  const activeVisitId = selectedVisitId ?? queue[0]?.visitId ?? null;
  const activePatient = queue.find((q: any) => q.visitId === activeVisitId);

  const arrive = useMutation({
    mutationFn: (visitId: string) => apiClient.post(`/api/v1/checkup/ws/${visitId}/arrive`, { stationId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ck-ws-queue', stationId] }); toast.success('도착 처리'); },
  });

  const complete = useMutation({
    mutationFn: (body: { visitId: string; resultData: unknown; finding: string; testNames: string[] }) =>
      apiClient.patch(`/api/v1/checkup/ws/${body.visitId}/complete`, { stationId, resultData: body.resultData, finding: body.finding, testNames: body.testNames }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['ck-ws-queue', stationId] });
      queryClient.invalidateQueries({ queryKey: ['ck-ws-stats', stationId] });
      setSelectedVisitId(null);
      const d = res?.data;
      toast.success(`검사 완료 — ${d?.itemsUpdated ?? 0}항목 마감 (${d?.itemsPending ?? 0}항목 남음)`);
    },
  });

  const handleSubmit = (data: Record<string, unknown>, finding: string, testNames: string[]) => {
    if (!activeVisitId) return;
    // 🔴 시행한 검사만 마감한다 — 서버가 category 로 일괄 마감하면 안 한 검사가 '정상'이 된다
    complete.mutate({ visitId: activeVisitId, resultData: data, finding, testNames });
  };

  const age = (dob: string) => dob ? (ageOf(dob) ?? 0) : null;

  return (
    <StationLayout stationId={stationId}>
      {!activeVisitId ? (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-400">
          <div className="text-3xl mb-2">{station?.icon ?? '🏥'}</div>
          <p className="text-sm"><T k="좌측에서 환자를 선택하세요" /></p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 환자 정보 */}
          {activePatient && (
            <div className="bg-white border rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-bold text-sm">
                  {activePatient.patient?.familyName}
                </div>
                <div>
                  <div className="font-semibold text-gray-900">
                    {activePatient.patient?.familyName}{activePatient.patient?.givenName}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {genderText(activePatient.patient?.gender)}/{age(activePatient.patient?.dateOfBirth)}세 · {activePatient.patient?.mrn}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">{activePatient.program?.name}</div>
                </div>
              </div>
              {activePatient.stationStatus === 'WAITING' && (
                <button onClick={() => arrive.mutate(activeVisitId)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
                  <T k="도착 확인" />
                </button>
              )}
            </div>
          )}

          {/* 전용 입력 폼 */}
          <DynamicStationForm
            key={activeVisitId ?? 'none'}
            template={station?.template}
            onSubmit={handleSubmit}
            loading={complete.isPending}
            stationName={station?.name}
            pendingItems={activePatient?.items ?? []}
          />

          {/* 다음 스테이션 안내 */}
          <NextStationGuide visitId={activeVisitId} />
        </div>
      )}
    </StationLayout>
  );
}
