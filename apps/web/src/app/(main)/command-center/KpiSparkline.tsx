'use client';
import { T, useTfAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';
import { seriesOf, polylines, type TrendResponse, type TrendSource } from './trend-view';

/**
 * 지표 칸 아래 작은 추세선(2026-10-02 · 상황판 디자인 F) — 서버 이력(5분 칸)만 그린다.
 *  · 점이 2개 미만이면 선을 그리지 않고 "추세 기록 중"이라고 말한다(기록 시작 전·직후)
 *  · 끊긴 칸(실패·누락)은 잇지 않는다 · 색은 판정하지 않는다(회색 선)
 *  · 이 역할에게 서버가 주지 않은 지표(섹션 권한 밖)는 아무것도 그리지 않는다
 */
export function KpiSparkline({ trend, src, failed }: { trend?: TrendResponse; src: TrendSource; failed?: boolean }) {
  const tf = useTfAttr();
  if (failed) return <span className="block text-[9.5px] text-amber-600" data-trend="failed"><T k="추세 조회 실패" /></span>;
  // 응답 모양이 다르면(계약 어긋남) 그리지 않는다 — 추세선 하나가 상황판 전체를 죽이지 않게
  if (!trend || !Array.isArray(trend.metrics) || !Array.isArray(trend.points)) return null;
  const keys = 'key' in src ? [src.key] : src.ratio;
  if (!keys.every((k) => trend.metrics.includes(k))) return null;
  const s = seriesOf(trend.points, src, trend.bucketMinutes);
  if (s.n < 2) {
    return (
      <span className="block text-[9.5px] text-slate-400" data-trend="recording">
        <T k="추세 기록 중" />{trend.recordingSince ? <> · {kdate(trend.recordingSince, 'time')}~</> : null}
      </span>
    );
  }
  const W = 120, H = 18;
  const from = new Date(trend.from).getTime(), to = new Date(trend.to).getTime();
  // 표시는 정수 그대로·소수(가동률 %)는 한 자리까지 — 로케일 숫자 표기(반올림 정본 가드 대상인 toFixed 를 쓰지 않는다)
  const fmt = (v: number | null) => (v == null ? '-' : v.toLocaleString('en-US', { maximumFractionDigits: 1 }));
  const title = tf('최근 {시간}시간 · 최소 {최소} · 최대 {최대} · 기록 {칸}칸(5분)', {
    시간: Math.round((to - from) / 3_600_000), 최소: fmt(s.min), 최대: fmt(s.max), 칸: s.n,
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-0.5 block h-[18px] w-full" role="img" aria-label={title} data-trend="line" data-trend-n={s.n}>
      <title>{title}</title>
      {polylines(s, from, to, W, H).map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke="#94a3b8" strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
