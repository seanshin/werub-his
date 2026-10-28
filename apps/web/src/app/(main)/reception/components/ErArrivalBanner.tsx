'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { usePollInterval } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

/**
 * 응급 도착 배너(D10·통합 운영 시에만) — er.reception.separated=false 인 병원(일반 접수 데스크가
 * 응급 접수를 겸함)에서 응급 도착·미배정 재실을 접수 데스크에 알린다. 분리 운영(기본)이면 렌더 없음.
 * 데이터 정본은 동일 — 화면 흐름만 바뀐다.
 */
export function ErArrivalBanner() {
  const pollNormal = usePollInterval('normal');
  const cfgQ = useQuery({
    queryKey: ['cfg-er-reception-separated'],
    // 🔴 (2026-09-14) 종전 `.catch(() => null)` — 설정 조회 실패가 "분리 운영(기본)"으로 읽혀 **배너가 조용히 사라졌다.**
    //    통합 운영 병원이면 접수 데스크의 응급 도착 알림 채널이 죽은 것을 아무도 모른다. 미등록 키는 200·data null 이라 실패 ≠ 미설정.
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/config/er.reception.separated'),
    staleTime: 60_000,
  });
  const separated = (cfgQ.data as { data?: unknown } | null)?.data !== false; // 기본 true(분리)

  const boardQ = useQuery({
    queryKey: ['reception-er-arrivals'],
    queryFn: () => apiClient.get<{ data: { unassigned: unknown[] } }>('/api/v1/emergency/beds'),
    refetchInterval: pollNormal,
    enabled: !separated, // 통합 운영일 때만 조회(분리면 네트워크도 안 씀)
  });
  if (cfgQ.isError) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
        <p className="text-sm text-amber-800 font-medium flex-1">
          <T k="응급 접수 운영 방식 설정을 불러오지 못했습니다 — 통합 운영이라면 응급 도착 알림이 표시되지 않습니다." />
        </p>
        <button onClick={() => cfgQ.refetch()} className="text-xs font-bold text-amber-700 hover:underline whitespace-nowrap"><T k="재시도" /></button>
      </div>
    );
  }
  if (separated) return null;

  // 🔴 조회 실패를 "응급 도착 0명"으로 접지 않는다 — 경보 채널이 죽은 것을 조용히 넘기면
  //    접수 데스크는 재실 환자가 없다고 믿는다.
  if (boardQ.isError) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
        <p className="text-sm text-rose-700 font-medium flex-1">
          <T k="응급 도착 현황을 불러오지 못했습니다 — 재실 환자가 없다는 뜻이 아닙니다." />
        </p>
        <button onClick={() => boardQ.refetch()} className="text-xs font-bold text-rose-600 hover:underline whitespace-nowrap"><T k="재시도" /></button>
        <Link href="/emergency" className="text-xs font-bold text-rose-600 hover:underline whitespace-nowrap"><T k="응급실 보드" /> →</Link>
      </div>
    );
  }

  const unassigned = (boardQ.data as { data?: { unassigned?: unknown[] } } | null)?.data?.unassigned?.length ?? 0;
  if (unassigned === 0) return null;

  return (
    <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 flex-shrink-0">
      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse flex-shrink-0" />
      <p className="text-sm text-rose-700 font-medium flex-1">
        <T k="응급 도착 — 접수 후속이 필요한 재실 환자" /> {unassigned}<Unit>명</Unit> (<T k="통합 원무 운영" />)
      </p>
      <Link href="/emergency" className="text-xs font-bold text-rose-600 hover:underline whitespace-nowrap"><T k="응급실 보드" /> →</Link>
    </div>
  );
}
