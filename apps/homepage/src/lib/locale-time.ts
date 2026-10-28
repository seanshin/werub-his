/* eslint-disable */
// 🔴 이 파일은 `packages/shared/src/locale-time.ts` 의 **기계 대조 사본**이다.
//    `apps/homepage` 는 격리 빌드(자체 npm install)라 workspace 패키지를 참조할 수 없어 사본을 둔다.
//    정본은 shared 이며, 두 파일이 갈라지면 `apps/web/test/ui/ko-day-period.spec.ts` 가 실패한다.
//    **여기를 직접 고치지 말 것** — shared 를 고친 뒤 머리말 아래 본문을 그대로 복사한다.
/**
 * 🔴 (2026-09-13 실측) Linux 공식 Node 22 바이너리(운영 서버 v22.22.1 · CI `node:22-bookworm`)는
 * ICU 78.2·CLDR 48.0 인데도 `ko-KR` 12시간제 오전/오후를 **`AM`/`PM`** 으로 낸다(macOS 는 같은 ICU 버전에서 `오전`/`오후`).
 * 서버가 만드는 한국어 문구(예약 알림·AI 도구 결과·서버 렌더)에 `PM 03:30` 이 나가던 자리다.
 * ko 로케일에 한해 `dayPeriod` 조각만 한국어 어휘로 되돌린다 — 다른 조각(순서·자릿수)은 ICU 그대로, ko 밖은 손대지 않는다.
 * `toLocaleTimeString`/`toLocaleString` 을 대신할 때 옵션 기본값은 네이티브와 같게 채운다(macOS 에서 글자 단위 동일 확인).
 */
const KO_DAY_PERIOD: Record<string, string> = { AM: '오전', PM: '오후', am: '오전', pm: '오후' };

export function formatDateTimeLocale(d: Date, localeTag: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const fmt = new Intl.DateTimeFormat(localeTag, opts);
  if (!localeTag.startsWith('ko')) return fmt.format(d);
  return fmt.formatToParts(d).map((p) => (p.type === 'dayPeriod' ? KO_DAY_PERIOD[p.value] ?? p.value : p.value)).join('');
}

const TIME_FIELDS = ['hour', 'minute', 'second', 'dayPeriod', 'timeStyle', 'fractionalSecondDigits'] as const;
const DATE_FIELDS = ['weekday', 'era', 'year', 'month', 'day', 'dateStyle'] as const;
const has = (o: Intl.DateTimeFormatOptions, keys: readonly string[]) => keys.some((k) => (o as Record<string, unknown>)[k] !== undefined);

/** `d.toLocaleTimeString(tag, opts)` 대체 — 시각 필드가 없으면 시·분·초 */
export function localeTimeText(d: Date, localeTag: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return formatDateTimeLocale(d, localeTag, has(opts, TIME_FIELDS) ? opts : { ...opts, hour: 'numeric', minute: 'numeric', second: 'numeric' });
}

/** `d.toLocaleString(tag, opts)` 대체 — 날짜·시각 필드가 모두 없으면 연·월·일·시·분·초 */
export function localeDateTimeText(d: Date, localeTag: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return formatDateTimeLocale(d, localeTag, has(opts, TIME_FIELDS) || has(opts, DATE_FIELDS)
    ? opts
    : { ...opts, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
}
