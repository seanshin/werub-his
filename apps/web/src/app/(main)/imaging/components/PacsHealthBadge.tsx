'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

export function PacsHealthBadge() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pacs-health'],
    queryFn: () => apiClient.get<{ data: { status: string } }>('/api/v1/pacs/health'),
    refetchInterval: pollMs('normal'),
  });

  const health = data?.data;
  /**
   * 🔴 **로딩 중·조회 실패를 빨간 'PACS OFF' 로 단정하지 않는다**(2026-09-02).
   *    종전엔 2상태뿐이라 `data === undefined`(최초 로딩·실패·응답 형상 불일치)가 전부 OFF 였다 —
   *    마운트할 때마다 빨간 OFF 가 스쳤고, **상시 깜빡이는 경보는 진짜 PACS 다운을 무시하게 만든다.**
   *    모르는 것과 아직 안 온 것과 꺼진 것은 서로 다른 사실이다.
   */
  const state: 'checking' | 'up' | 'down' | 'unknown' =
    isLoading ? 'checking'
    : isError ? 'unknown'
    : health?.status === 'ok' || health?.status === 'healthy' ? 'up'
    : health?.status ? 'down'
    : 'unknown';
  const TONE = {
    checking: { box: 'bg-gray-50 text-gray-500', dot: 'bg-gray-300', label: '확인 중' },
    up: { box: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', label: 'ON' },
    down: { box: 'bg-red-50 text-red-600', dot: 'bg-red-500', label: 'OFF' },
    unknown: { box: 'bg-amber-50 text-amber-700', dot: 'bg-amber-400', label: '상태 확인 불가' },
  }[state];
  // `ON`/`OFF` 는 번역 대상이 아니라 그대로 지나간다(`<T>` 가 한글 없는 키에 티를 달지 않는다)
  const tAttr = useTAttr();

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium ${TONE.box}`}
      title={`PACS ${tAttr(TONE.label)}`}
      aria-label={`PACS ${tAttr(TONE.label)}`}
    >
      <span className={`w-2 h-2 rounded-full ${TONE.dot}`} />
      PACS <T k={TONE.label} />
    </span>
  );
}
