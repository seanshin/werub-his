import { PULSE_MIN_BASELINE, PULSE_Z_THRESHOLD, type PulseMetricDef } from './pulse-registry';

/**
 * 급변 판정 — **중앙값과 MAD** 로 잰다(정규분포를 가정하지 않는다).
 *
 * 🔴 이 파일의 유일한 임무는 **판정할 수 없을 때 판정하지 않는 것**이다.
 *    표본이 모자란 것, 변동이 아예 없는 것, 변화가 미미한 것은 전부 다른 사실이고
 *    셋 다 "이상"이 아니다. 하나라도 이상으로 세면 이 축이 거짓 경보 공장이 된다.
 */

/**
 * 🔴 `z` 는 **중앙값·MAD 규칙(`MAD_Z`)에서만** 나오는 값이다.
 *    `P95_X2` 규칙으로 판정한 지표에서는 `null` — 안 잰 것이지 0 이 아니다.
 *    (여기에 아무 숫자나 채우면 화면이 재지 않은 통계를 잰 척하게 된다.)
 */
export type PulseVerdict =
  /** 판정함 — 정상 */
  | { kind: 'NORMAL'; z: number | null; median: number; detail: string }
  /** 판정함 — 급변 */
  | { kind: 'ANOMALY'; z: number | null; median: number; detail: string }
  /** baseline 이 모자라 판정하지 않음 */
  | { kind: 'WARMING'; have: number; need: number; detail: string }
  /** 변동이 없어 이탈을 잴 수 없음 — 값이 붙박이라는 뜻이지 이상이 아니다 */
  | { kind: 'FLAT'; median: number; detail: string }
  /**
   * 🔴 **분모가 모자라 값 자체를 낼 수 없음** — `0` 도 `NORMAL` 도 아니다.
   *    비율 지표에서 표본이 없으면 답은 폴백이 아니라 '산출 불가'다.
   */
  | { kind: 'NOT_COMPUTABLE'; have: number; need: number; detail: string };

/**
 * 사유 문구용 소수 1자리 — 🔴 `toFixed` 를 쓰지 않는다.
 * 수치 표시 정본(shared NUMERIC_POLICIES)은 임상·재무 값의 것이고, 여기 z 값은 그 도메인이 아니다.
 * 그렇다고 `toFixed` 로 정본을 우회하는 자리를 만들면 구조 가드가 잡는다(실제로 잡혔다) —
 * 정수 연산으로 만든다.
 */
function oneDecimal(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const neg = x < 0;
  const t = Math.round(Math.abs(x) * 10);
  return `${neg ? '-' : ''}${Math.floor(t / 10)}.${t % 10}`;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 중앙값 절대편차 — 이상치에 끌려가지 않는 산포 */
export function mad(xs: number[], med: number): number {
  if (xs.length === 0) return 0;
  return median(xs.map((x) => Math.abs(x - med)));
}

/**
 * 선형보간 백분위(SQL `percentile_cont` 와 같은 정의) — 축 B 흐름 완결성이 쓰는 것과 같은 값을
 * 인메모리 baseline 에서도 얻기 위해. 🔴 두 축이 다른 정의를 쓰면 같은 말(p95)이 다른 뜻이 된다.
 */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((q, r) => q - r);
  if (a.length === 1) return a[0];
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/**
 * 표본(분모) 게이트 — 🔴 값을 낼 수 있는지부터 판정한다.
 *
 * `minSample` 이 없는 지표에는 아무 말도 하지 않는다(null). 있는데 분모가 모자라면
 * **`NOT_COMPUTABLE`** 이다 — 0 을 쌓지도, 정상이라 그리지도 않는다.
 */
export function judgeSample(
  def: PulseMetricDef,
  denominator: number,
): Extract<PulseVerdict, { kind: 'NOT_COMPUTABLE' }> | null {
  if (def.minSample == null || denominator >= def.minSample) return null;
  return {
    kind: 'NOT_COMPUTABLE',
    have: denominator,
    need: def.minSample,
    detail: `표본 ${denominator}/${def.minSample}건 — 산출 불가입니다(분모가 모자라 낸 비율은 사실이 아닙니다). 0 이라는 뜻이 아닙니다.`,
  };
}

/**
 * @param baseline 최근 창의 값들(현재 값 제외)
 * @param current  방금 잰 값
 */
export function judgePulse(def: PulseMetricDef, baseline: number[], current: number): PulseVerdict {
  if (baseline.length < PULSE_MIN_BASELINE) {
    return {
      kind: 'WARMING',
      have: baseline.length,
      need: PULSE_MIN_BASELINE,
      detail: `baseline 축적 중 ${baseline.length}/${PULSE_MIN_BASELINE}분 — 아직 급변을 판정하지 않습니다(표본 없이 임계를 만들지 않습니다).`,
    };
  }

  const med = median(baseline);
  const md = mad(baseline, med);
  const delta = current - med;

  /**
   * 🔴 **p95×2 규칙**(축 B 와 같은 규약) — 평상시 0 에 가까운 희소 축용.
   *    임계는 **자기 이력**에서만 나온다. 이력의 p95 가 0 이면 임계를 만들 수 없고,
   *    그때는 임계를 지어내는 대신 절대 하한(`minDelta`)만으로 판정한다
   *    (하한마저 없이 1건을 경보하면 이 축이 거짓 경보 공장이 된다).
   */
  if (def.thresholdRule === 'P95_X2') {
    const p95 = percentile(baseline, 0.95);
    const passesDelta = def.watchDrop ? -delta >= def.minDelta : delta >= def.minDelta;
    if (p95 == null || p95 <= 0) {
      if (passesDelta) {
        return {
          kind: 'ANOMALY', z: null, median: med,
          detail: `평상시 상위 5%(p95)가 0 이라 p95×2 임계를 만들 수 없어 절대 변화로 판정했습니다 — ${med} → ${current}(하한 ${def.minDelta}).`,
        };
      }
      return {
        kind: 'FLAT', median: med,
        detail: `평상시 상위 5%(p95)가 0 이라 p95×2 임계를 만들 수 없습니다(값 ${current} · 절대 하한 ${def.minDelta} 미만).`,
      };
    }
    const threshold = p95 * 2;
    const over = def.watchDrop ? current < p95 / 2 : current > threshold;
    if (over && passesDelta) {
      return {
        kind: 'ANOMALY', z: null, median: med,
        detail: `임계 ${oneDecimal(threshold)}(자기 이력 p95 ${oneDecimal(p95)} × 2 · 표본 ${baseline.length}분) 초과 — 값 ${current}, 평상시 중앙값 ${med}.`,
      };
    }
    return {
      kind: 'NORMAL', z: null, median: med,
      detail: `임계 ${oneDecimal(threshold)}(자기 이력 p95 ${oneDecimal(p95)} × 2) 이내입니다(값 ${current}, 평상시 중앙값 ${med}).`,
    };
  }

  if (md === 0) {
    // 🔴 변동이 0 이면 어떤 변화든 z 가 무한대가 된다. 그것을 이상이라 부르면
    //    "항상 2였다가 3이 된" 지표가 매번 경보를 만든다. 절대 하한만으로 판정한다.
    const big = def.watchDrop ? -delta >= def.minDelta : delta >= def.minDelta;
    if (big) {
      return {
        kind: 'ANOMALY', z: Infinity, median: med,
        detail: `평상시 ${med} 에서 ${current} 로 ${def.watchDrop ? '감소' : '증가'}(변동이 없던 지표라 절대 변화로 판정).`,
      };
    }
    return { kind: 'FLAT', median: med, detail: `평상시 ${med} 에서 변동이 없어 이탈을 잴 수 없습니다(값 ${current}).` };
  }

  // 0.6745 = 표준정규의 MAD → 표준편차 환산 계수의 역수
  const z = delta / (md / 0.6745);
  const zAbs = def.watchDrop ? -z : z;

  // 🔴 방향과 크기를 **둘 다** 봐야 한다. z 만 보면 1→3 같은 변화가 경보가 되고,
  //    minDelta 만 보면 평상시가 큰 지표에서 정상 변동이 경보가 된다.
  const passesDelta = def.watchDrop ? -delta >= def.minDelta : delta >= def.minDelta;
  if (zAbs >= PULSE_Z_THRESHOLD && passesDelta) {
    return {
      kind: 'ANOMALY', z, median: med,
      detail: `평상시 ${med}(중앙값) 대비 ${current} — ${def.watchDrop ? '감소' : '증가'} 폭 ${Math.abs(Math.round(delta))}, z=${oneDecimal(z)}.`,
    };
  }
  return {
    kind: 'NORMAL', z, median: med,
    detail: `평상시 ${med}(중앙값) 범위 안입니다(값 ${current}, z=${oneDecimal(z)}).`,
  };
}
