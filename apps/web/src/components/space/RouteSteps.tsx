'use client';

/**
 * 길안내 단계 — 서버가 준 **구조화된 단계**(shared `RouteStep`)를 문장으로 조립한다(서버는 문장을 만들지 않는다).
 * 기획 spatial-flow-vision-3d P3. 대기표(공개)·도면 뷰어(직원)가 같이 쓴다.
 */
import type { RouteStep } from '@hospital-run/shared';
import { Tf } from '@/components/ui/i18n-text';

const VERTICAL_TEXT: Record<'ELEVATOR' | 'STAIR' | 'ESCALATOR', string> = {
  ELEVATOR: '엘리베이터로 {출발} → {도착}',
  STAIR: '계단으로 {출발} → {도착}',
  ESCALATOR: '에스컬레이터로 {출발} → {도착}',
};

export function RouteSteps({ steps }: { steps: RouteStep[] }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{i + 1}</span>
          <span className="text-gray-800">
            {s.kind === 'START' && <Tf k="{공간}에서 출발" params={{ 공간: s.space }} />}
            {s.kind === 'WALK' && (
              s.through.length
                ? <Tf k="{층} · {경유} 지나 약 {거리}m" params={{ 층: s.floor, 경유: s.through.slice(0, 3).join(' → '), 거리: s.distanceM }} />
                : <Tf k="{층} · 약 {거리}m 이동" params={{ 층: s.floor, 거리: s.distanceM }} />
            )}
            {s.kind === 'VERTICAL' && <Tf k={VERTICAL_TEXT[s.mode]} params={{ 출발: s.fromFloor, 도착: s.toFloor }} />}
            {s.kind === 'ARRIVE' && <Tf k="{층} {공간} 도착" params={{ 층: s.floor, 공간: s.space }} />}
          </span>
        </li>
      ))}
    </ol>
  );
}
