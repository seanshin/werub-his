'use client';

/**
 * 길안내 층별 도면 — 경로가 지나는 층만, 경로 주변으로 확대해 그린다.
 * 대기표 길안내(`/guide/[id]` · 공개)·포털 예약 길안내(B1)가 같이 쓴다(종전엔 대기표 화면 안에만 있었다).
 * 🔴 통제 구역은 공개 응답에서 빠져 온다(2026-10-12) — 빈 자리를 "없는 공간"으로 읽지 않게 몇 곳을 뺐는지 말한다.
 */
import { FloorPlanSvg, type GeoFloor } from './FloorPlanSvg';
import { Tf } from '@/components/ui/i18n-text';

export type RouteFloor = GeoFloor & { restrictedHidden?: number };

export function RouteFloorPlans({ segments, floors, notice, targetSpaceNodeId }: {
  segments: { floor: string; points: [number, number][] }[];
  floors: RouteFloor[];
  notice?: string | null;
  targetSpaceNodeId?: string;
}) {
  return (
    <>
      {segments.map((sg) => {
        const f = floors.find((x) => x.key === sg.floor);
        if (!f || sg.points.length === 0) return null;
        // 경로 주변만 확대(여유 6m · 층 외곽 안으로)
        const xs = sg.points.map((p) => p[0]), ys = sg.points.map((p) => p[1]);
        const fx = Math.max(0, Math.min(...xs) - 6), fy = Math.max(0, Math.min(...ys) - 6);
        const focus = { x: fx, y: fy, w: Math.min(f.footprint.w, Math.max(...xs) + 6) - fx, h: Math.min(f.footprint.h, Math.max(...ys) + 6) - fy };
        return (
          <div key={sg.floor} className="rounded-2xl border p-1" data-route-floor={sg.floor}>
            <p className="px-2 pt-1 text-[11px] font-semibold text-gray-600">{f.title}</p>
            {(f.restrictedHidden ?? 0) > 0 && (
              <p className="px-2 text-[10px] text-gray-400" data-guide-restricted-hidden={f.restrictedHidden}>
                <Tf k="관계자 외 출입 구역 {수}곳은 표시하지 않습니다" params={{ 수: f.restrictedHidden ?? 0 }} />
              </p>
            )}
            <FloorPlanSvg floor={f} notice={notice} route={sg.points} focus={focus} highlight={targetSpaceNodeId ? new Set([targetSpaceNodeId]) : undefined} />
          </div>
        );
      })}
    </>
  );
}
