/**
 * CSSD 기구 개체 수명 판정 정본(순수 함수) — 서비스·화면이 같은 판정을 쓴다.
 *
 * 🔴 멸균 횟수는 **저장하지 않고 파생**한다: 개체↔패키지(`SterilePackageUnit`) 중 패키지가 멸균 합격
 *    (`SterilePackage.sterilizedAt` 존재)한 건만 센다. 실패 로드는 `releaseLoad` 가 `sterilizedAt` 을 찍지 않고
 *    PACKAGED 로 되돌리므로 세지 않는다 — 그래서 이 수는 "멸균 **합격** 사이클 수"이지 "노출된 사이클 수"가 아니다(화면이 그렇게 말한다).
 * 🔴 한도는 입력값이다(개체 > 품목 > 미설정). 미설정이면 경보가 없다 — 한도를 지어내지 않는다.
 * 🔴 한도 도달·초과는 **막지 않는다**(규칙 "막으면 방치된다") — 경고와 기록만.
 */
export type UnitLifeState = 'NO_LIMIT' | 'WITHIN' | 'LIMIT_REACHED';
export type UnitLimitSource = 'UNIT' | 'ITEM' | null;

export interface UnitPackageRow {
  sterilizedAt: Date | string | null;
  usedAt: Date | string | null;
}

export interface UnitUsage {
  /** 멸균 합격 사이클 수(파생) */
  sterilizedCycles: number;
  /** 연결된 패키지 수(합격 여부 무관 — 미합격·진행 중 포함) */
  linkedPackages: number;
  /** 최초 사용일(패키지 출고·사용 시각 중 가장 이른 것) — 사용 기록 없으면 null */
  firstUsedAt: string | null;
  /** 최초 멸균 합격일 — 없으면 null */
  firstSterilizedAt: string | null;
}

export interface UnitLife extends UnitUsage {
  limit: number | null;
  limitSource: UnitLimitSource;
  /** 한도까지 남은 합격 사이클 — 한도 미설정이면 null(0 이 아니다) */
  remaining: number | null;
  state: UnitLifeState;
}

const iso = (v: Date | string | null): string | null => (v == null ? null : new Date(v).toISOString());
const earliest = (vals: (string | null)[]): string | null =>
  vals.filter((v): v is string => v != null).sort()[0] ?? null;

export function aggregateUnitUsage(rows: readonly UnitPackageRow[]): UnitUsage {
  return {
    sterilizedCycles: rows.filter((r) => r.sterilizedAt != null).length,
    linkedPackages: rows.length,
    firstUsedAt: earliest(rows.map((r) => iso(r.usedAt))),
    firstSterilizedAt: earliest(rows.map((r) => iso(r.sterilizedAt))),
  };
}

/** 유효한 한도는 1 이상의 정수만 — 0·음수·소수·NaN 은 입력 단계(DTO)에서 400 이고, 여기서도 한도로 쓰지 않는다 */
export function isValidCycleLimit(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

export function evaluateUnitLife(usage: UnitUsage, unitMax: number | null | undefined, itemMax: number | null | undefined): UnitLife {
  const limitSource: UnitLimitSource = isValidCycleLimit(unitMax) ? 'UNIT' : isValidCycleLimit(itemMax) ? 'ITEM' : null;
  const limit = limitSource === 'UNIT' ? (unitMax as number) : limitSource === 'ITEM' ? (itemMax as number) : null;
  if (limit == null) return { ...usage, limit: null, limitSource: null, remaining: null, state: 'NO_LIMIT' };
  const remaining = limit - usage.sterilizedCycles;
  return { ...usage, limit, limitSource, remaining, state: remaining <= 0 ? 'LIMIT_REACHED' : 'WITHIN' };
}
