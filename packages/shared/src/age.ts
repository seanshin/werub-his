import { roundBy } from './numeric-policy';

/**
 * 나이 계산 정본 — FE 표시·입력과 BE 판정이 같은 값을 쓴다.
 *
 * 🔴 화면마다 `getFullYear() - getFullYear()` 로 계산하던 것이 6곳 있었고, 그중 4곳은
 *    월·일 보정이 없어 **생일 전이면 한 살 많게** 나왔다(2026-08-03 실측). 만 나이는
 *    한국 의료의 공식 기준이고 소아 용량·검사 기준치·DUR 연령금기가 읽는 값이라
 *    화면마다 다른 나이가 뜨는 것 자체가 위험하다.
 */

/** 생년월일 상·하한 — 입력 검증과 표시 방어가 같은 기준을 쓴다 */
export const MAX_AGE_YEARS = 150;

export type BirthDateProblem = 'INVALID' | 'FUTURE' | 'TOO_OLD';

export function parseBirthDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 문제가 없으면 null — 있으면 사유. 입력 UI 와 서버 검증이 같은 판정을 쓴다. */
export function birthDateProblem(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): BirthDateProblem | null {
  const d = parseBirthDate(value);
  if (!d) return 'INVALID';
  // 당일 출생 허용 — 시각까지 비교하면 신생아 등록이 타임존 때문에 거부된다
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (d.getTime() > endOfToday.getTime()) return 'FUTURE';
  const floor = new Date(now.getFullYear() - MAX_AGE_YEARS, now.getMonth(), now.getDate());
  if (d.getTime() < floor.getTime()) return 'TOO_OLD';
  return null;
}

export const BIRTH_DATE_PROBLEM_TEXT: Record<BirthDateProblem, string> = {
  INVALID: '생년월일 형식이 올바르지 않습니다.',
  FUTURE: '생년월일은 오늘 이후일 수 없습니다.',
  TOO_OLD: `생년월일은 ${MAX_AGE_YEARS}년 이내여야 합니다.`,
};

/** 달력 날짜 기준 일수 차 — 시각·타임존 오프셋에 흔들리지 않는다 */
function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/** 만 나이(년). 유효하지 않으면 null — **0 이나 -1 로 뭉개지 않는다**(모르는 값과 0세는 다르다) */
export function ageOf(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  const d = parseBirthDate(value);
  if (!d || birthDateProblem(d, now)) return null;
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

/** 개월 수(영·유아 표기용) */
export function ageInMonths(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  const d = parseBirthDate(value);
  if (!d || birthDateProblem(d, now)) return null;
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * 화면 표기 — 소아는 년만으로는 임상 판단이 안 된다.
 *   0~1개월 미만 → '15일' · 24개월 미만 → '8개월' / '1세 3개월' · 그 외 → '42세'
 */
export function formatAge(
  value: string | Date | null | undefined,
  opts: { unknown?: string; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const unknown = opts.unknown ?? '나이 미상';
  const d = parseBirthDate(value);
  if (!d || birthDateProblem(d, now)) return unknown;

  const months = ageInMonths(d, now) ?? 0;
  if (months < 1) {
    // 🔴 밀리초 차이로 세면 안 된다: `'2026-07-25'` 같은 date-only 는 **UTC 자정**으로 파싱돼
    //    KST 에서는 오전 9시가 되고, 신생아 일수가 하루 적게 나온다. 달력 날짜로 센다.
    return `${dayDiff(d, now)}일`;
  }
  if (months < 24) {
    const y = Math.floor(months / 12);
    const m = months % 12;
    return y > 0 ? `${y}세 ${m}개월` : `${m}개월`;
  }
  return `${ageOf(d, now)}세`;
}

/** 콤보박스 선택지 — 년은 오늘 기준 150년, 월/일은 선택한 년·월에 맞춰 일수를 좁힌다 */
export function birthYearOptions(now: Date = new Date()): number[] {
  const y = now.getFullYear();
  return Array.from({ length: MAX_AGE_YEARS + 1 }, (_, i) => y - i);
}

export function daysInMonth(year: number, month1to12: number): number {
  if (!year || !month1to12) return 31;
  return new Date(year, month1to12, 0).getDate();
}

/**
 * 재원일수 정본 — **입원료 청구(billing.createInpatientStayBilling)와 같은 산식**.
 * `max(1, ceil(경과 / 1일))` — 당일 입퇴원도 1일. 퇴원 전이면 지금까지.
 *
 * 🔴 화면마다 산식이 달랐다(date-fns floor·ceil·BE floor 혼재): 청구서는 3일인데 화면은
 *    2일로 보이면 환자 문의가 생긴다. 표시가 재무와 다른 걸 "개선"이라 부를 수 없다 —
 *    산식을 바꾸려면 청구와 함께 바꿔야 한다.
 */
export function stayDays(admitDate: string | Date | null | undefined, endDate?: string | Date | null): number | null {
  const start = parseBirthDate(admitDate); // 날짜 파서 재사용(이름과 달리 범용)
  if (!start) return null;
  const end = (endDate ? parseBirthDate(endDate) : null) ?? new Date();
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

/**
 * 기간 재원일수 요약 정본 — 퇴원한 입원들의 재원일수(개별 = `stayDays`)·평균·표본·제외 수(2026-10-01 여정 P1 잔여).
 *
 * 🔴 같은 "평균 재원일수"가 다섯 곳(여정 지표·의료질·운영 통계·흐름 분석·경영 KPI)에서 **각자 소수 일**로 계산됐다 —
 *    환자 화면의 재원일수는 정본 `stayDays`(max(1,ceil) · 입원료 청구 기준)인데 평균만 다른 계산이라,
 *    당일 퇴원 1건이 상세에선 1일·평균에선 0.3일로 갈렸다(P12). 개별 값은 정본으로, 평균은 그 값들의 평균이다.
 * 🔴 퇴원이 입원보다 이르면(시드 품질 결함 등) `stayDays` 는 1로 감싼다 — 평균에 1일로 섞으면 사실이 아니므로 **빼고 센다**.
 *    날짜가 없는 행도 빼고 센다. 표본 0 이면 평균은 `null`(0 일이 아니다).
 */
export interface StayDaysSummary {
  /** 평균에 들어간 입원 수 */
  n: number;
  /** 평균 재원일수(정책 `stayDaysMean`) · 표본 0 이면 null */
  meanDays: number | null;
  /** 개별 재원일수(정본 stayDays) — 백분위·분포용, 입력 순서 */
  values: number[];
  excluded: { missingDates: number; dischargeBeforeAdmit: number };
}

export function summarizeStayDays(
  rows: ReadonlyArray<{ admitDate: string | Date | null | undefined; dischargeDate: string | Date | null | undefined }>,
): StayDaysSummary {
  const values: number[] = [];
  const excluded = { missingDates: 0, dischargeBeforeAdmit: 0 };
  for (const r of rows) {
    const a = r.admitDate ? parseBirthDate(r.admitDate) : null;
    const d = r.dischargeDate ? parseBirthDate(r.dischargeDate) : null;
    if (!a || !d) { excluded.missingDates++; continue; }
    if (d.getTime() < a.getTime()) { excluded.dischargeBeforeAdmit++; continue; }
    values.push(stayDays(a, d)!);
  }
  const meanDays = values.length ? roundBy(values.reduce((s, v) => s + v, 0) / values.length, 'stayDaysMean') : null;
  return { n: values.length, meanDays, values, excluded };
}

/**
 * 대기 경과분 정본 — 시작 시각부터 지금까지의 분. **아직 시작하지 않았으면 `null`**.
 *
 * 🔴 2026-08-14(W6): 원무 보드가 대기시간을 `createdAt` 으로 계산했는데 대기열 196건 중
 *    **99건의 createdAt 이 미래**라 평균 대기가 **-36분**이었다. 음수를 '방금'으로 굴리는
 *    것도(P1-ⓓ), 0 으로 깎는 것도 거짓이다 — **아직 대기가 시작되지 않았다**는 게 사실이다.
 *    다른 세 화면(외래 대기열·접수 큐·내 대기 위젯)은 이미 `checkedInAt` 기준이었다(P12).
 */
export function waitMinutesSince(
  start: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!start) return null;
  const t = start instanceof Date ? start : new Date(start);
  if (Number.isNaN(t.getTime())) return null;
  const mins = Math.floor((now.getTime() - t.getTime()) / 60_000);
  return mins < 0 ? null : mins;
}

/** YYYY-MM-DD ↔ {year, month, day} 상호 변환 (입력 컴포넌트가 두 표현을 동기화한다) */
export function splitBirthDate(iso: string): { year: string; month: string; day: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? { year: m[1], month: m[2], day: m[3] } : { year: '', month: '', day: '' };
}

export function joinBirthDate(year: string, month: string, day: string): string {
  if (!year || !month || !day) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
