'use client';

import { useQuery } from '@tanstack/react-query';
import { useDurationText } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { T, Tf } from '@/components/ui/i18n-text';

export function NextStationGuide({ visitId }: { visitId: string }) {
  const fmtDur = useDurationText();
  const { data: res } = useQuery({
    queryKey: ['ck-next-station', visitId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/ws/${visitId}/next-station`),
    enabled: !!visitId,
  });
  const next = res?.data;
  if (!next) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-lg">{next.icon ?? '➡️'}</span>
        <div>
          <span className="text-sm font-semibold text-blue-800"><T k="다음" />: {next.name}</span>
          {next.location && <span className="text-xs text-blue-500 ml-2">{next.location}</span>}
          {/* 이동 거리 = 마지막 완료 검사실에서 확정 도면 경로(m) — 시간으로 바꾸지 않는다(걸음 속도는 정하지 않았다) · 모르면 그리지 않는다 */}
          {next.distanceM != null && <span className="text-xs text-blue-500 ml-2"><Tf k="이동 약 {거리}m" params={{ 거리: next.distanceM }} /></span>}
        </div>
      </div>
      <div className="text-right text-xs text-blue-600">
        {next.waitingCount > 0 ? `대기 ${next.waitingCount}명 (약 ${fmtDur(next.estimatedWait)})` : <T k="대기 없음" />}
      </div>
    </div>
  );
}
