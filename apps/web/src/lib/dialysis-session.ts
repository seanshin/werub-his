/**
 * 투석 세션 카드 표시(2026-10-07).
 *  · 종전 카드는 서버가 주지 않는 `machineName`·`elapsedMinutes` 를 읽어 기계는 늘 '-'·경과 막대는 한 번도 그려지지 않았다
 *    → 기계는 `machine.name`, 경과는 실제 시작 시각(`startTime`)에서 잰다
 *  · BFR·UF 목표는 서버 select 에 없어 늘 '-'·'미설정'이었다(서버 select 보강)
 *  · 건체중 초과(투석 전 체중 − 건체중)는 둘 다 기록됐을 때만 — 하나라도 없으면 null
 */
import { roundBy } from '@hospital-run/shared';

const toNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function dialysisElapsedMinutes(startTime: unknown, now: Date = new Date()): number | null {
  if (typeof startTime !== 'string' && !(startTime instanceof Date)) return null;
  const t = new Date(startTime).getTime();
  if (!Number.isFinite(t)) return null;
  const m = Math.floor((now.getTime() - t) / 60000);
  return m >= 0 ? m : null;
}

export function excessOverDryWeight(preWeight: unknown, dryWeight: unknown): number | null {
  const pre = toNum(preWeight);
  const dry = toNum(dryWeight);
  if (pre == null || dry == null) return null;
  return roundBy(pre - dry, 'weight');
}

export function dialysisMachineName(s: Record<string, unknown>): string | null {
  const m = s.machine as { name?: unknown } | null | undefined;
  return typeof m?.name === 'string' && m.name ? m.name : null;
}
