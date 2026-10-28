import { PipeTransform, Injectable, ArgumentMetadata, HttpStatus } from '@nestjs/common';
import { serverMsg } from '@hospital-run/shared';
import { msgException } from '../msg-exception';

/**
 * 🔴 **날짜성 쿼리 파라미터가 못 읽는 값이면 그 자리에서 400** (2026-08-31 · 발굴 33회차).
 *
 * 실측: 잘못된 날짜(`NOTADATE`)를 넣고 경로변수 없는 GET **960종**을 전수 호출하니
 * **56곳이 500** 이었다. 사용자는 "서버 오류"만 보고 자기 입력 문제인 줄 모른다(§규약 7).
 *
 * 🔴 **정본(`dayRange`)을 고치는 것만으로는 안 됐다** — 재실측 66→59.
 *    모듈들이 정본을 안 거치고 `new Date(query.from)` 을 **직접** 쓰고 있었다(52곳).
 *    "정본을 만든 것 ≠ 소비처가 그것을 쓰는 것"(§규약 2). 52곳을 하나씩 고치면 또 샌다 —
 *    **전역 진입점에서 한 번** 막는다.
 *
 * 🔴 **값을 바꾸지 않는다.** 같은 디렉토리의 `SanitizePipe` 가 "전역으로 되살리면 조용한
 *    데이터 변형이 생긴다"고 경고하는 그 함정을 피한다 — 이 파이프는 **거부만** 하고
 *    통과시킨 값은 원본 그대로다.
 *
 * 대상은 **이름이 날짜를 뜻하는 키**와 **페이지네이션 숫자 키**로 한정한다.
 * `q=2026` 같은 검색어나 `id` 는 건드리지 않는다.
 *
 * 🔴 **숫자 페이지네이션 키도 같은 클래스였다** (2026-08-31 · 발굴). `@Query('limit')` → `Number(limit)`
 *    → 서비스 `take: limit` 이 **상한 없이** 흘러: `?limit=abc` → `NaN` → **Prisma 500**(날짜 500 과 동형),
 *    `?limit=99999999` → 9천만 행 조회 **DoS**, `Number('3.5')` → 소수 take → 500. 38개 컨트롤러가
 *    무상한 파싱 중이었다 — 전역 진입점에서 **비정수·음수·거대값을 400 으로** 막는다(값은 안 바꾼다).
 */
const DATE_KEY = /^(date|dateFrom|dateTo|from|to|start|end|startDate|endDate|weekStart|weekEnd|since|until|day)$/;
const MONTH_KEY = /^(month|yearMonth|period)$/;
/** 행 수를 정하는 키 — 정수 + 상한(DoS 차단) */
const LIMIT_KEY = /^(limit|take|pageSize|perPage|pageLimit)$/;
/** 위치를 정하는 키 — 정수만(상한 없음: 큰 skip 은 메모리가 아니라 빈 결과) */
const OFFSET_KEY = /^(page|offset|skip)$/;
/** 행 수 상한 — 이보다 크면 400(9천만 행 DoS 차단·정상 사용엔 넉넉) */
const LIMIT_MAX = 10000;
/**
 * 🔴 `year` 는 **숫자**라 형식이 다르다 — `Number('NOTADATE')=NaN` 이 `new Date(NaN, 0, 1)` 로 새어
 *    `billing.groupBy`·공휴일 조회에서 500 이 났다(2026-08-31 재실측 잔여 4곳).
 */
const YEAR_KEY = /^(year|fiscalYear|targetYear)$/;

/** `YYYY-MM-DD` 또는 ISO 시각 — 그 외는 못 읽는 값으로 본다 */
const DATE_OK = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;
const MONTH_OK = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class DateQueryPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'query') return value;

    // `@Query('date') d: string` — 인자 하나로 받는 형태
    if (typeof value === 'string' && metadata.data) {
      this.assert(metadata.data, value);
      return value;
    }
    // `@Query() q: SomeDto` — 객체로 받는 형태
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string') this.assert(k, v);
      }
    }
    return value;
  }

  private assert(key: string, raw: string) {
    const v = raw.trim();
    if (v === '') return;                       // 빈 값 = 안 준 것(호출부가 기본값을 정한다)
    if (DATE_KEY.test(key)) {
      if (!DATE_OK.test(v) || Number.isNaN(new Date(v).getTime())) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{파라미터} 는 YYYY-MM-DD 형식이어야 합니다 (받은 값: {값})', { 파라미터: key, 값: v.slice(0, 20) }));
      }
      return;
    }
    if (YEAR_KEY.test(key)) {
      const num = Number(v);
      if (!/^\d{4}$/.test(v) || !Number.isFinite(num) || num < 1900 || num > 2200) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{파라미터} 는 4자리 연도여야 합니다 (받은 값: {값})', { 파라미터: key, 값: v.slice(0, 20) }));
      }
      return;
    }
    if (MONTH_KEY.test(key)) {
      // `period` 는 `2026-08` 도 `2026-08-01~` 도 올 수 있어 둘 다 허용한다
      if (!MONTH_OK.test(v) && !DATE_OK.test(v)) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{파라미터} 는 YYYY-MM 형식이어야 합니다 (받은 값: {값})', { 파라미터: key, 값: v.slice(0, 20) }));
      }
      return;
    }
    if (LIMIT_KEY.test(key)) {
      // 비정수(`abc`·`3.5`)·음수는 take 에 그대로 흘러 500, 거대값은 DoS → 여기서 400
      if (!/^\d+$/.test(v)) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{파라미터} 는 0 이상의 정수여야 합니다 (받은 값: {값})', { 파라미터: key, 값: v.slice(0, 20) }));
      }
      if (Number(v) > LIMIT_MAX) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{파라미터} 는 {상한} 이하여야 합니다 (받은 값: {값})', { 파라미터: key, 상한: LIMIT_MAX, 값: v.slice(0, 20) }));
      }
      return;
    }
    if (OFFSET_KEY.test(key)) {
      if (!/^\d+$/.test(v)) {
        throw msgException(HttpStatus.BAD_REQUEST, serverMsg('{파라미터} 는 0 이상의 정수여야 합니다 (받은 값: {값})', { 파라미터: key, 값: v.slice(0, 20) }));
      }
    }
  }
}
