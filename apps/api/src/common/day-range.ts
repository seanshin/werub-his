import { BadRequestException } from '@nestjs/common';
/**
 * 날짜(date-only) → 하루 구간 정본 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 🔴 `new Date('2026-08-13')` 은 **TZ 설정과 무관하게 항상 UTC 자정**이다(ES 사양).
 *    pm2 가 `TZ=Asia/Seoul` 을 줘도 이 파싱만은 UTC 로 고정된다 — 그래서
 *    `gte: new Date(from), lte: new Date(to)` 로 같은 날짜를 넣으면 **폭이 0 인 구간**이
 *    되고, 화면은 "그날 아무 일도 없었다"고 말한다.
 *
 *    실측(감사 대시보드): `?dateFrom=2026-08-13&dateTo=2026-08-13` → **총 접근 0**.
 *    같은 날 KST 감사 로그는 **21건**이었다. 08-12 는 화면 0 / 실제 63건.
 *    감사 화면이 "그날 아무도 환자 기록을 열지 않았다"고 말하는 것은 규제 대응에서 위험하다.
 *
 *    또한 상한을 `lte: <날짜 자정>` 으로 두면 **그날 하루가 통째로 빠진다**.
 *    끝은 항상 **다음 날 자정 미만(`lt`)** 이어야 한다.
 */

/** `YYYY-MM-DD` 인가 (그 외 형식은 시각이 포함된 ISO 로 보고 그대로 파싱한다) */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * date-only 문자열을 **서버 로컬(KST) 자정**으로 파싱한다.
 * 시각이 포함된 값이면 그대로 파싱한다(호출자가 이미 정확한 순간을 준 것).
 * 파싱 불가면 `null` — 🔴 Invalid Date 를 그대로 Prisma 로 넘기면 500 이 난다.
 */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (DATE_ONLY.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    // 🔴 (2026-09-14) `new Date(2026, 12, 40)` 은 NaN 이 아니라 2027-02-09 로 **넘어간다** — `2026-13-40` 이 400 이 아니라
    //    엉뚱한 날짜로 조회됐다(가용 슬롯·일 뷰 등 requireDateParam 소비처 전부). 달력에 실재하는 날짜만 받는다.
    if (Number.isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * 🔴 **필수 날짜 파라미터**를 파싱하고, 못 하면 **400** 으로 말한다.
 *
 *    `parseLocalDate` 는 이미 "Invalid Date 를 Prisma 로 넘기면 500 이 난다"고 적어 뒀는데
 *    세 EP 가 그것을 쓰지 않고 `new Date(param)` 을 그대로 넘겨 **운영에서 500** 이 났다
 *    (포털 원격진료 슬롯·검진 정원·예약 가용시간 — 2026-08-30 모바일 앱 실측).
 *    사용자는 "서버 오류"만 보고 **자기 입력 문제인 줄 모른다** — 날짜 파싱 실패는 400 이다(§규약 7).
 *
 * @param label 사용자에게 보일 항목 이름(예: '조회할 날짜')
 */
/**
 * 🔴 **선택** 날짜 파라미터를 **형식만** 검증한다(400) — 값 구성은 호출부 그대로.
 *
 * requireDateParam 은 parseLocalDate(=로컬/KST 자정)로 Date 를 만들어 반환하지만,
 * @db.Date(date-only) 필터는 **UTC 자정**(`new Date('YYYY-MM-DD')`·dateOnlyValue)으로 비교해야 한다.
 * 두 자정을 뒤섞으면 KST 오프셋으로 하루가 밀린다. 그래서 값을 바꾸지 않고,
 * "Invalid Date 가 Prisma 로 새어 500 이 나는 것"만 막는다(값 있을 때만 검사, 없으면 무시).
 */
export function assertDateParam(value: string | null | undefined, label: string): void {
  if (value == null || value === '') return;
  if (!parseLocalDate(value)) {
    const last = label.charCodeAt(label.length - 1);
    const josa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '을' : '를';
    throw new BadRequestException(`${label}${josa} YYYY-MM-DD 형식으로 지정해주세요`);
  }
}

export function requireDateParam(value: string | null | undefined, label: string): Date {
  const d = parseLocalDate(value);
  // 받침 여부로 조사를 고른다 — "날짜을(를)" 같은 표기는 사람이 읽는 문장이 아니다
  const last = label.charCodeAt(label.length - 1);
  const josa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '을' : '를';
  if (!d) throw new BadRequestException(`${label}${josa} YYYY-MM-DD 형식으로 지정해주세요`);
  return d;
}

/**
 * 조회 구간을 `{ gte, lt }` 로 만든다 — **끝나는 날을 포함**한다.
 *
 * - `from` 만: 그 날 자정부터 (상한 없음)
 * - `to` 만: 그 날이 끝날 때까지 (하한 없음)
 * - 둘 다 같은 날: 그 하루 전체 (종전에는 폭 0)
 */
export function dayRange(
  from?: string | null,
  to?: string | null,
): { gte?: Date; lt?: Date } | undefined {
  /**
   * 🔴 **"값이 없다"와 "못 읽었다"를 같은 `undefined` 로 말하면 안 된다**
   *    (2026-08-31 실측: 잘못된 날짜를 넣으면 **직원용 GET 56곳이 500**).
   *    종전에는 오타 날짜가 조용히 "필터 없음"이 되어 **전건 조회**가 되거나,
   *    호출부의 `range.gte!` 단언에서 `undefined` 가 새어 Prisma·`toISOString` 에서 터졌다.
   *    → 준 값이 있는데 못 읽으면 **그 자리에서 400** 으로 말한다.
   *      아예 안 준 것(둘 다 비었음)은 종전대로 `undefined`(필터 없음)다.
   */
  const given = (v?: string | null) => v != null && String(v).trim() !== '';
  if (given(from) && !parseLocalDate(from)) {
    throw new BadRequestException('조회 시작일을 YYYY-MM-DD 형식으로 지정해주세요');
  }
  if (given(to) && !parseLocalDate(to)) {
    throw new BadRequestException('조회 종료일을 YYYY-MM-DD 형식으로 지정해주세요');
  }
  const start = parseLocalDate(from);
  const endDay = parseLocalDate(to);
  if (!start && !endDay) return undefined;

  const range: { gte?: Date; lt?: Date } = {};
  if (start) range.gte = start;
  if (endDay) {
    // date-only 로 들어온 상한은 '그 날 끝까지' — 다음 날 자정 미만
    const exclusiveEnd = new Date(endDay);
    if (DATE_ONLY.test(String(to).trim())) exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    range.lt = exclusiveEnd;
  }
  return range;
}

/**
 * `YYYY-MM` 한 달 구간 — **로컬(KST) 기준** `{ start, end }`(end 는 배타).
 *
 * 🔴 여러 모듈이 각자 `month.split('-')` 로 풀고 있었고, 못 읽는 값이면
 *    `new Date(NaN)` 이 Prisma 로 들어가 **500** 이 났다(2026-08-31 실측 · 근무표 등).
 *    "안 준 것"은 호출부가 기본값을 정하고, **준 값이 틀렸으면 여기서 400** 으로 말한다.
 */
export function monthRangeLocal(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(String(month ?? '').trim())) {
    throw new BadRequestException('조회할 연월을 YYYY-MM 형식으로 지정해주세요');
  }
  const [y, m] = String(month).trim().split('-').map(Number);
  if (m < 1 || m > 12) throw new BadRequestException('조회할 연월의 월이 1~12 범위를 벗어났습니다');
  return { start: new Date(y, m - 1, 1, 0, 0, 0, 0), end: new Date(y, m, 1, 0, 0, 0, 0) };
}

/** 오늘 하루(서버 로컬=KST) */
export function todayRange(now: Date = new Date()): { gte: Date; lt: Date } {
  const gte = new Date(now);
  gte.setHours(0, 0, 0, 0);
  const lt = new Date(gte);
  lt.setDate(lt.getDate() + 1);
  return { gte, lt };
}

/** 로컬(KST) 달력 날짜 문자열 — `toISOString().slice(0,10)` 대용(그건 UTC 라 하루가 밀린다) */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 로컬(병원 시간대) 일시 문자열 `YYYY-MM-DD HH:mm[:ss]` — `toISOString().slice(0,16)` 대용.
 *
 * 🔴 그건 **UTC** 다 — KST 에서 9시간 이르게 읽힌다(2026-09-11 실측: 03:00 정기 백업이 go-live 에
 *    "2026-09-10 18:00" 으로 · 검체 라벨에 인쇄 시각이 9시간 전으로 · 환자에게 주는 문서 발급 시각도).
 *    시간대를 박지 않고 **프로세스 TZ**(pm2 `TZ=Asia/Seoul`)를 따른다 — 국가 축(UAE)에서 병원 현지 시각이 되도록.
 *    가드 `test/architecture/utc-time-slice-guard.spec.ts` 가 사람이 읽는 자리의 UTC 절단을 동결한다.
 */
export function localDateTimeKey(d: Date, opts: { seconds?: boolean } = {}): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = opts.seconds ? `:${String(d.getSeconds()).padStart(2, '0')}` : '';
  return `${localDateKey(d)} ${hh}:${mm}${ss}`;
}

/**
 * `@db.Date`(달력 날짜) 컬럼에 넣고 비교할 순간 — 화면 실사용 점검 W8(2026-08-14).
 *
 * 🔴 `dayRange`/`todayRange` 는 **timestamptz** 컬럼용이다(로컬 자정~다음 자정 범위).
 *    `@db.Date` 는 다르다 — Prisma 가 넘긴 Date 의 **UTC 날짜 부분만** 쓴다.
 *    그래서 `new Date(y, m, d)`(KST 자정 = 전날 15:00Z)를 넘기면 **정확히 하루 앞 날짜**로 비교된다.
 *
 *    휴진(`clinic_closures.date`)이 이 함정에 빠져 있었다:
 *      저장 = `new Date('2026-08-14')`(UTC 자정) → DB 2026-08-14  ✅
 *      조회 = `new Date(y, m, d)`(KST 자정)      → DB 2026-08-13  ❌
 *    → 오늘 등록한 휴진이 오늘 진료에 **절대 반영되지 않았다.**
 *
 * 사람이 말하는 '오늘'은 KST 달력 날짜(`localDateKey`)이고, 비교값은 그 날짜의 **UTC 자정**이다.
 * 🔴 저장·조회 **양쪽**을 이 함수에 통과시킬 것 — 한쪽만 고치면 반대 방향으로 어긋난다.
 */
export function dateOnlyValue(value: string | Date | null | undefined): Date | null {
  const parsed = value instanceof Date ? value : parseLocalDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return new Date(`${localDateKey(parsed)}T00:00:00.000Z`);
}

/** 오늘(KST 달력)에 해당하는 `@db.Date` 비교값 */
export function todayDateOnly(now: Date = new Date()): Date {
  return new Date(`${localDateKey(now)}T00:00:00.000Z`);
}

/**
 * 개월 더하기/빼기 — 🔴 **말일에서 굴러가지 않는다.**
 *
 * 실측(2026-08-29): `d.setMonth(d.getMonth() + n)` 이 저장소 **9곳**에서 쓰이고 있었고,
 * 그중 기한·만료를 계산하는 자리가 넷이었다. JS 의 `setMonth` 는 그 달에 없는 날짜를
 * **다음 달로 굴린다** — `2026-01-31` 에 1개월을 더하면 `2026-02-31` → **`2026-03-03`**.
 *
 * 🔴 실제로 만들어진 결함들:
 *  · **분납 청구가 2월을 건너뛰고 3월에 두 번** 잡혔다(1회차 3/03 · 2회차 3/31)
 *  · QI 시드가 **2월을 잃고 3월을 두 번** 만들어 `@@unique` 위반 → 매달 말일에 `db seed` 사망
 *
 * 🔴 **정본은 원래 있었다** — `psychiatry.service.ts` 안에 같은 이름의 private 함수로
 *    정확히 이 계산이 구현돼 있었다. 한 모듈에 갇혀 있어서 나머지가 각자 틀렸다.
 *    (이 저장소의 반복 패턴: *"정본을 만든 것 ≠ 소비처가 그것을 쓰는 것"*)
 *
 * 🔴 **말일은 말일로 클램프한다**(1/31 + 1개월 = 2/28). 다음 달로 넘기지 않는다 —
 *    "한 달 뒤"가 두 달 뒤 초가 되면 만료일·납부기일이 실제보다 늦어진다.
 *    🔴 이 관례가 계약·법령상 맞는지는 **사람이 확인할 사항**이다(여기서는 굴러가지
 *    않는 것까지만 보장한다).
 */
export function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  const day = d.getDate();
  // 🔴 1일로 내린 뒤 달을 옮긴다 — 그래야 옮기는 도중에 굴러갈 자리가 없다
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** `addMonths` 의 뺄셈 형태 — 읽는 쪽에서 부호를 헷갈리지 않게 이름으로 밝힌다 */
export function subMonths(base: Date, months: number): Date {
  return addMonths(base, -months);
}
