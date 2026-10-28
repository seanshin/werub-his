'use client';

// ChartBoard — 큰 화면 보기 본체: 반응형 멀티패널 그리드(설계 §4).
// 안전 sticky 존(식별·알러지·플래그·위험카드)은 page.tsx가 그리드 위에 상시 노출(P-1/P-2).
// 본 컴포넌트는 그리드만 담당.

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePatientTabStore } from '@/stores/patient-tab-store';
import { getDefaultPreset, type BoardPanelKey } from './board-constants';
import { PANEL_REGISTRY, type BoardCtx } from './panel-registry';
import { BoardPanel } from './BoardPanel';
import { BoardMasonry, useBoardColumnCount } from './BoardMasonry';

export function ChartBoard({ ctx }: { ctx: BoardCtx }) {
  const boardRound = usePatientTabStore((s) => s.boardRound);
  const boardLayout = usePatientTabStore((s) => s.boardLayout);
  const setBoardLayout = usePatientTabStore((s) => s.setBoardLayout);
  const boardPinned = usePatientTabStore((s) => s.boardPinned);
  const setBoardPinned = usePatientTabStore((s) => s.setBoardPinned);

  // 서버 저장 레이아웃 로드(로밍 단말 동기화) — 세션 1회·있으면 서버 우선
  const { data: serverLayout } = useQuery({
    queryKey: ['board-layout-server'],
    queryFn: () => apiClient.get<{ data: { panels: string[] | null; pinned?: string[] } }>('/api/v1/chart-templates/my-settings/board-layout').catch(() => ({ data: { panels: null, pinned: [] } })),
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    const panels = serverLayout?.data?.panels;
    if (panels && panels.length && JSON.stringify(panels) !== JSON.stringify(boardLayout)) {
      setBoardLayout(panels); // 로컬 캐시 갱신(서버 우선)
    }
    const pinned = serverLayout?.data?.pinned;
    if (pinned && JSON.stringify(pinned) !== JSON.stringify(boardPinned)) {
      setBoardPinned(pinned); // 핀도 로밍 동기화(서버 우선)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverLayout]);

  // 핀 토글 — 로컬 즉시 반영 + 서버 저장(panels 생략 = 기존 순서 보존, BE 부분 저장 규약)
  const togglePin = (key: BoardPanelKey) => {
    const next = boardPinned.includes(key) ? boardPinned.filter((k) => k !== key) : [...boardPinned, key];
    setBoardPinned(next);
    apiClient.put('/api/v1/chart-templates/my-settings/board-layout', { panels: boardLayout, pinned: next }).catch(() => {
      /* 저장 실패 시 로컬은 유지(다음 저장에서 재시도) — 조용히 */
    });
  };

  // 사용자 커스텀 레이아웃 우선, 없으면 역할 기본 프리셋. 유효 키만(stale 방어).
  const basePanels = (boardLayout ?? getDefaultPreset(ctx.userRole)).filter(
    (k): k is BoardPanelKey => k in PANEL_REGISTRY,
  );
  // 핀 고정 패널을 앞으로(그룹 내 상대 순서는 기존 순서 유지) — 마소너리가 순서대로 컬럼 상단부터 채움
  const pinnedSet = new Set(boardPinned);
  const panels = [...basePanels.filter((k) => pinnedSet.has(k)), ...basePanels.filter((k) => !pinnedSet.has(k))];

  const columnCount = useBoardColumnCount();

  return (
    // 회진(round) 시 board scope 폰트 확대(§5.1·원거리 판독). 기본은 comfortable(P-4).
    // 배치는 마소너리(최단 컬럼) — 긴 패널 옆 짧은/접힌 패널 아래 구멍이 생기던 grid 행 배치 대체.
    <BoardMasonry
      className={boardRound ? 'chart-board-round' : ''}
      columnCount={columnCount}
      items={panels.map((key) => ({
        key,
        node: (
          <BoardPanel title={PANEL_REGISTRY[key].label} pinned={pinnedSet.has(key)} onTogglePin={() => togglePin(key)}>
            {PANEL_REGISTRY[key].render(ctx)}
          </BoardPanel>
        ),
      }))}
    />
  );
}
