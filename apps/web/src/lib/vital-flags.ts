'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  VITALS_THRESHOLDS, vitalItemFlags, worseVitalFlag,
  type VitalsThresholds, type VitalItemFlag, type VitalItemFlags, type VitalsFlagInput,
} from '@hospital-run/shared';

/**
 * 활력 이상 판정 — **미측정은 판정하지 않는다.**
 *
 * 🔴 2026-08-19 실측 결함: 화면 여러 곳이 미측정 활력을 **교과서 정상값으로 접어** 판정하고 있었다.
 *   · 진료   `(spo2 ?? 100) < 95` · `(temperature ?? 36.5) >= 37.5` · `(heartRate ?? 72) < 60`
 *   · PACU   `(spo2 ?? 100) < 95` · `(painScore ?? 0) >= 7`
 *   · 병동   `(systolicBp ?? 200) < 90` · `(spo2 ?? 100) < 94`
 *   결과: **활력을 하나도 재지 않은 환자가 "정상"으로 판정**되고 경고가 뜨지 않는다.
 *   같은 값에 폴백이 둘(`?? 0` 과 `?? 200`)이라는 것 자체가 임의값이라는 자백이다.
 *
 * 🔴 표시가 틀리면 사람이 알아챌 수 있지만 **조건이 틀리면 경고가 조용히 사라진다.**
 *   그래서 폴백이 아니라 **3상 판정**(이상/정상/미측정)으로 쓴다.
 *
 * 임계 자체는 서버가 정본이다(`vitals-evaluate.VITALS_THRESHOLDS` + config `clinical.vitals.thresholds`).
 * 🔴 화면에 임계 숫자를 새로 적지 말 것 — 위원회가 임계를 개정해도 하드코딩한 화면은 바뀌지 않는다.
 * 서버가 `isAbnormal` 을 주면 그것을 우선한다(`abnormalOf`).
 */

/** 미측정 = `null`. 이상 = `true`. 정상 = `false`. */
export type VitalFlag = boolean | null;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 측정된 경우에만 판정한다.
 * @example warnIf(vitals.spo2, (v) => v < 94)   // 미측정이면 null
 */
export function warnIf(value: unknown, test: (v: number) => boolean): VitalFlag {
  const n = num(value);
  return n === null ? null : test(n);
}

/** 여러 항목 중 하나라도 이상이면 이상. 전부 미측정이면 미측정. */
export function anyWarn(...flags: VitalFlag[]): VitalFlag {
  if (flags.some((f) => f === true)) return true;
  return flags.some((f) => f === false) ? false : null;
}

/**
 * 서버 판정 우선 — `isAbnormal` 이 있으면 그것을 쓴다(임계 정본은 서버다).
 * 없으면 화면이 넘긴 3상 판정으로 접는다.
 */
export function abnormalOf(serverFlag: boolean | null | undefined, fallback: VitalFlag): VitalFlag {
  if (typeof serverFlag === 'boolean') return serverFlag;
  return fallback;
}

/** 화면 표기 — 미측정을 `0`·`정상`으로 말하지 않는다 */
export const UNMEASURED_LABEL = '미측정';
export function flagTone(flag: VitalFlag, tone: { warn: string; ok: string; unknown: string }): string {
  return flag === true ? tone.warn : flag === false ? tone.ok : tone.unknown;
}

/* ── 임계 정본 소비(2026-10-01) ─────────────────────────────────────────────────
 * 🔴 화면마다 임계 숫자를 적고 있었다(진료 SBP≥140·입원 SpO2<94·플로시트 SBP>160·응급 HR>100·ICU HR>130·
 *    `VITAL_RANGES`). 숫자는 shared `VITALS_THRESHOLDS` 하나이고, 환자안전위 개정(`clinical.vitals.thresholds`)을
 *    병합한 값은 `GET /api/v1/vitals-thresholds` 가 준다. 화면은 그것으로 `vitalItemFlags` 를 부른다.
 */

export type { VitalItemFlag, VitalItemFlags };
export { worseVitalFlag };

export interface VitalsRuleState {
  thresholds: VitalsThresholds;
  /** CONFIGURED = 환자안전위 개정 반영 · DEFAULT = 코드 기본값 · null = 아직 모름(로딩)·확인 불가(실패) */
  source: 'CONFIGURED' | 'DEFAULT' | null;
  droppedKeys: string[];
  invertedKeys: string[];
  state: 'loading' | 'error' | 'ready';
}

/**
 * 적용 임계 — 로딩·실패면 코드 기본값으로 **판정은 계속**하고(경보가 사라지는 쪽보다 안전) 그 사실을 `state` 로 말한다.
 */
export function useVitalsThresholds(): VitalsRuleState {
  const q = useQuery({
    queryKey: ['vitals-thresholds'],
    queryFn: () => apiClient.get<{ data: { thresholds: VitalsThresholds; source: 'CONFIGURED' | 'DEFAULT'; droppedKeys?: string[]; invertedKeys?: string[] } }>('/api/v1/vitals-thresholds'),
    staleTime: 10 * 60 * 1000,
  });
  const d = q.data?.data;
  if (q.isError) return { thresholds: VITALS_THRESHOLDS, source: null, droppedKeys: [], invertedKeys: [], state: 'error' };
  if (!d) return { thresholds: VITALS_THRESHOLDS, source: null, droppedKeys: [], invertedKeys: [], state: 'loading' };
  return { thresholds: d.thresholds ?? VITALS_THRESHOLDS, source: d.source, droppedKeys: d.droppedKeys ?? [], invertedKeys: d.invertedKeys ?? [], state: 'ready' };
}

/** 측정치 → 항목별 판정(적용 임계로) */
export function flagsWith(rule: VitalsRuleState, m: VitalsFlagInput | null | undefined): VitalItemFlags | null {
  return m ? vitalItemFlags(m, rule.thresholds) : null;
}

/** 위급=빨강·주의=주황·정상/미측정=기본 — 화면마다 색을 다시 고르지 않게 */
export function vitalFlagText(f: VitalItemFlag | undefined, base = 'text-gray-900'): string {
  return f === 'CRITICAL' ? 'text-red-600 font-bold' : f === 'WARNING' ? 'text-amber-700 font-semibold' : base;
}
export function vitalFlagBg(f: VitalItemFlag | undefined, base = 'bg-gray-50'): string {
  return f === 'CRITICAL' ? 'bg-red-50' : f === 'WARNING' ? 'bg-amber-50' : base;
}
/** 하나라도 위급/주의인가(요약 배지용) — 전부 미측정이면 null */
export function anyAbnormal(flags: VitalItemFlags | null): boolean | null {
  if (!flags) return null;
  const vs = Object.values(flags);
  if (vs.some((f) => f === 'CRITICAL' || f === 'WARNING')) return true;
  return vs.some((f) => f === 'NORMAL') ? false : null;
}
