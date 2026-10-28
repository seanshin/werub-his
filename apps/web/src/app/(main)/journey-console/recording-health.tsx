'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

interface EmitStats {
  since: string;
  saved: number;
  failed: number;
  duplicateSuppressed: number;
  missingEpisode: number;
  lastFailureAt: string | null;
}

/**
 * (여정 P2-5 · §5.7) 여정 기록 상태 — 운영자 전용. 접힘 기본이고 펼칠 때만 부른다.
 * 🔴 이 수는 **API 프로세스 시작 이후**의 것이다(재시작하면 0) — 누적이 아니라고 그 자리에서 말한다.
 *    상태–사건 불일치(진료 시작·퇴원인데 사건 없음)는 감시자 화면이 정본이다. 여기서 사건을 만들어 메우지 않는다.
 */
export function RecordingHealth() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['jc-recording-health'],
    queryFn: () => apiClient.get<{ data: EmitStats }>('/api/v1/journey-console/recording-health'),
    enabled: open,
  });
  const s = data?.data;
  const trouble = !!s && (s.failed > 0 || s.missingEpisode > 0);
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-700">
        <span><T k="여정 기록 상태" /> <span className="ml-1 text-[11px] font-normal text-gray-400"><T k="운영자용" /></span></span>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
          {isError ? (
            <QueryErrorFallback error={error} onRetry={() => refetch()} />
          ) : isLoading || !s ? (
            <div className="h-10 animate-pulse rounded bg-gray-100" />
          ) : (
            <div className="space-y-1.5">
              <p className="text-gray-400">
                <Tf k="API 프로세스 시작({시각}) 이후의 수입니다 — 재시작하면 0 부터 셉니다" params={{ 시각: kdate(new Date(s.since), 'datetimeShort') }} />
              </p>
              <ul className="grid grid-cols-2 gap-1 md:grid-cols-4">
                <li><T k="저장" /> <b className="tabular-nums">{s.saved}</b></li>
                <li className={s.failed > 0 ? 'text-rose-700' : ''}><T k="발행 실패" /> <b className="tabular-nums">{s.failed}</b></li>
                <li className={s.missingEpisode > 0 ? 'text-amber-700' : ''}><T k="방문 단위 누락" /> <b className="tabular-nums">{s.missingEpisode}</b></li>
                <li><T k="이중 발행 억제" /> <b className="tabular-nums">{s.duplicateSuppressed}</b></li>
              </ul>
              {trouble && (
                <p className="text-amber-700"><T k="여정 기록 누락이 있습니다 — 서버 로그와 감시자 화면에서 확인하세요" /></p>
              )}
              {s.lastFailureAt && (
                <p><T k="마지막 발행 실패" /> {kdate(new Date(s.lastFailureAt), 'datetimeShort')}</p>
              )}
              <p>
                <T k="상태와 기록의 불일치(진료 시작·퇴원인데 사건 없음)는 감시자 화면에서 봅니다" />{' '}
                <Link href="/admin/sentinel" className="text-blue-600 hover:underline"><T k="감시자 화면 열기" /></Link>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
