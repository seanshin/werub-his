import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { renderServerMessageKo, serverMsg, type ServerMessage } from '@hospital-run/shared';
import { msgException } from '../../src/common/msg-exception';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { DateQueryPipe } from '../../src/common/pipes/date-query.pipe';
import { DiagnosticTestService } from '../../src/modules/diagnostic-test/diagnostic-test.service';
import { OpeningService } from '../../src/modules/opening/opening.service';
import { SERVER_MESSAGE_SOURCES, sourceKeysOf, unregisteredKeys, assertWellFormed, composedLines } from './server-message-sources';

/**
 * 🔴 서버 표시 문장 `{ k, params }` 계약 — **예외 배치** (2026-09-15 I4).
 *
 * 예외 message 는 `\`단계가 올바르지 않습니다: ${x}\`` 처럼 값이 녹은 한국어 문장이라, 화면 언어를 바꿔도 한국어였고
 * `QueryErrorFallback` 의 `<T k={message}>` 는 키가 매번 달라 영영 번역되지 않았다(미등재 티만 붙는다).
 * 이제 `msgException(status, serverMsg(k, params))` 가 응답 본문에 `msg` 를 싣고, 전역 예외 필터가 `error.msg` 로 보존한다.
 *
 * 못박는 것:
 *   (a) `msgException` — 상태·Nest 기본 `error`(→ 필터 `code`)가 종전 `new XxxException(문자열)` 과 같고, `message` 는 msg 의 한국어 파생.
 *   (b) 🔴 필터가 `error.msg` 를 **보존**한다 · 종전 키(`code`·`message`·`details`)는 그대로(하위 호환 — 모바일·외부 호출자).
 *       대조군: msg 없는 예외는 응답 모양이 **글자 하나 안 바뀐다**(`msg` 키 자체가 없다) · 모양이 아닌 msg 는 싣지 않는다.
 *   (c) 옮긴 파일(opening·diagnostic-test·쿼리 파이프)의 소스 키가 en·ja·ar 에 있고, 예외 조립 템플릿이 남지 않았다.
 *   (d) 실제 던지는 예외 — `msg` 가 자리표시자↔params 일치로 실리고 `message` 는 종전과 **같은 한국어 문장**이다.
 */

function capture(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ headersSent: false, status }),
      getRequest: () => ({ headers: {}, method: 'GET', url: '/x' }),
    }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as { error: Record<string, unknown> } };
}

const SAMPLE = serverMsg('단계가 올바르지 않습니다: {단계}', { 단계: 'NOPE' });

describe('(a) msgException — 종전 예외와 같은 모양 + msg', () => {
  it('상태·error·message 가 종전 `new BadRequestException(문자열)` 과 같다', () => {
    const e = msgException(HttpStatus.BAD_REQUEST, SAMPLE);
    const legacy = new BadRequestException('단계가 올바르지 않습니다: NOPE');
    expect(e.getStatus()).toBe(400);
    expect(e.message).toBe(legacy.message);
    const { msg, ...rest } = e.getResponse() as Record<string, unknown>;
    expect(rest).toEqual(legacy.getResponse());
    expect(msg).toEqual(SAMPLE);
  });

  it('404 · extra 로 code·payload 를 함께 싣는다', () => {
    const e = msgException(HttpStatus.NOT_FOUND, serverMsg('자리를 찾을 수 없습니다: {자리}', { 자리: 'S1' }), { code: 'STATION_NOT_FOUND', stationId: 'S1' });
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toMatchObject({ code: 'STATION_NOT_FOUND', stationId: 'S1', message: '자리를 찾을 수 없습니다: S1', error: 'Not Found' });
  });
});

describe('(b) 전역 예외 필터 — error.msg 보존 · 종전 키 불변', () => {
  it('🔴 msg 가 error.msg 로 나간다 · message 는 한국어 · code/details 는 종전 문자열 예외와 같다', () => {
    const { status, body } = capture(msgException(HttpStatus.BAD_REQUEST, SAMPLE));
    const legacy = capture(new BadRequestException('단계가 올바르지 않습니다: NOPE')).body;
    expect(status).toBe(400);
    expect(body.error.msg).toEqual(SAMPLE);
    const { msg: _m, ...rest } = body.error;
    expect(rest).toEqual(legacy.error);
  });

  it('구조화 payload 와 함께 — code 보존 · msg 는 details 로 새지 않는다', () => {
    const { body } = capture(msgException(HttpStatus.NOT_FOUND, SAMPLE, { code: 'X_CODE', extraInfo: 1 }));
    expect(body.error.code).toBe('X_CODE');
    expect(body.error.msg).toEqual(SAMPLE);
    expect(body.error.details).toEqual({ extraInfo: 1 });
  });

  it('대조군 — msg 없는 예외는 응답에 msg 키 자체가 없다(모양 불변)', () => {
    const { body } = capture(new BadRequestException('항목 이름이 필요합니다'));
    expect('msg' in body.error).toBe(false);
    expect(body.error).toEqual({ code: 'Bad Request', message: '항목 이름이 필요합니다', details: '항목 이름이 필요합니다' });
  });

  it('대조군 — 모양이 아닌 msg(문자열)는 싣지 않는다(지어내지 않는다)', () => {
    const { body } = capture(new HttpException({ message: 'x', msg: 'not-a-message' }, 400));
    expect('msg' in body.error).toBe(false);
  });
});

const FILES = {
  opening: SERVER_MESSAGE_SOURCES.opening,
  diagnosticTest: SERVER_MESSAGE_SOURCES.exceptionDiagnosticTest,
  queryPipe: SERVER_MESSAGE_SOURCES.exceptionQueryPipe,
};

describe('(c) 옮긴 파일 — 키 등재 · 예외 조립 템플릿 0', () => {
  it('대조군 — 추출기가 예외 키를 읽는다', () => {
    expect(sourceKeysOf(FILES.opening).has('선행 항목이 없습니다: {항목}')).toBe(true);
    expect(sourceKeysOf(FILES.diagnosticTest).size).toBe(9);
    expect(sourceKeysOf(FILES.queryPipe).size).toBe(5);
  });

  it('🔴 한글이 든 키는 en·ja·ar 모두 등재', () => {
    expect(unregisteredKeys([...sourceKeysOf(FILES.opening), ...sourceKeysOf(FILES.diagnosticTest), ...sourceKeysOf(FILES.queryPipe)])).toEqual([]);
  });

  it('🔴 세 파일에 예외 조립 템플릿 0 · 연결(+) 우회 0', () => {
    for (const f of [...FILES.opening, ...FILES.diagnosticTest, ...FILES.queryPipe]) {
      const { composed, concat } = composedLines(f);
      expect(composed.filter((l) => /Exception\(/.test(l) || /^\s*`[^`]*`,?\s*$/.test(l)), f).toEqual([]);
      expect(concat, f).toEqual([]);
    }
  });

  it('잔여 조립 줄 정확 일치 — diagnostic-test 1(델타체크 사유 · 결과에 저장되는 문장) · 쿼리 파이프 0', () => {
    expect(composedLines(FILES.diagnosticTest[0]).composed.length).toBe(1);
    expect(composedLines(FILES.diagnosticTest[0]).composed[0]).toContain('이전 대비 급변');
    expect(composedLines(FILES.queryPipe[0]).composed.length).toBe(0);
  });
});

function thrown(fn: () => unknown): HttpException {
  try { fn(); } catch (e) { return e as HttpException; }
  throw new Error('예외가 나지 않았다');
}
async function thrownAsync(fn: () => Promise<unknown>): Promise<HttpException> {
  try { await fn(); } catch (e) { return e as HttpException; }
  throw new Error('예외가 나지 않았다');
}
const msgOf = (e: HttpException) => (e.getResponse() as { msg?: ServerMessage }).msg;

describe('(d) 실제 던지는 예외 — msg 가 실리고 message 는 종전 한국어 문장', () => {
  it('쿼리 파이프 — 날짜·연도·월·정수·상한 5형', () => {
    const pipe = new DateQueryPipe();
    const cases: [string, string, string][] = [
      ['from', 'NOTADATE', 'from 는 YYYY-MM-DD 형식이어야 합니다 (받은 값: NOTADATE)'],
      ['year', '26', 'year 는 4자리 연도여야 합니다 (받은 값: 26)'],
      ['month', '2026-13', 'month 는 YYYY-MM 형식이어야 합니다 (받은 값: 2026-13)'],
      ['page', '-1', 'page 는 0 이상의 정수여야 합니다 (받은 값: -1)'],
      ['limit', '99999999', 'limit 는 10000 이하여야 합니다 (받은 값: 99999999)'],
    ];
    for (const [key, v, legacy] of cases) {
      const e = thrown(() => pipe.transform(v, { type: 'query', data: key }));
      expect(e.getStatus()).toBe(400);
      expect(e.message, `종전 문장과 달라졌다: ${key}`).toBe(legacy);
      const m = msgOf(e);
      expect(m, key).toBeTruthy();
      assertWellFormed(m!);
      expect(renderServerMessageKo(m!)).toBe(legacy);
    }
  });

  it('대조군 — 정상 값은 통과(예외 없음)', () => {
    expect(new DateQueryPipe().transform('2026-09-15', { type: 'query', data: 'from' })).toBe('2026-09-15');
  });

  it('기초검사 검사값 — 숫자·범위·선택지·단일 값', () => {
    const svc = Object.create(DiagnosticTestService.prototype) as { normalizeMeasurements: (t: string, i: Record<string, unknown>) => unknown };
    const cases: [Record<string, unknown>, string][] = [
      [{ ptaRight: 'abc' }, 'PTA 우측: 숫자를 입력해 주세요'],
      [{ ptaRight: -50 }, 'PTA 우측: -10 미만은 입력할 수 없습니다'],
      [{ ptaRight: 500 }, 'PTA 우측: 120 초과는 입력할 수 없습니다'],
      [{ hearingTypeRight: '모름' }, '난청 유형 우측: 선택지에 없는 값입니다'],
      [{ ptaRight: { a: 1 } }, '측정값은 단일 값이어야 합니다: ptaRight'],
    ];
    for (const [input, legacy] of cases) {
      const e = thrown(() => svc.normalizeMeasurements('AUDIOMETRY', input));
      expect(e.getStatus()).toBe(400);
      expect(e.message).toBe(legacy);
      const m = msgOf(e);
      expect(m, legacy).toBeTruthy();
      assertWellFormed(m!);
      expect(renderServerMessageKo(m!)).toBe(legacy);
    }
    // 대조군 — 정상 값은 숫자로 저장된다(예외 없음)
    expect(svc.normalizeMeasurements('AUDIOMETRY', { ptaRight: '25' })).toEqual({ ptaRight: 25 });
  });

  it('opening 기관 항목 검증 — 단계·국가·주기', async () => {
    const svc = Object.create(OpeningService.prototype) as { validateCustom: (i: Record<string, unknown>) => Promise<unknown> };
    const base = { title: '항목', owner: '원무팀' };
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, phase: 'NOPE' }, '단계가 올바르지 않습니다: NOPE'],
    ];
    for (const [input, legacy] of cases) {
      const e = await thrownAsync(() => svc.validateCustom(input));
      expect(e.getStatus()).toBe(400);
      expect(e.message).toBe(legacy);
      const m = msgOf(e);
      expect(m).toBeTruthy();
      assertWellFormed(m!);
    }
    // 대조군 — 정적 문장 예외(자리 값 없음)는 이번 배치 대상이 아니라 msg 없이 종전 그대로
    const plain = await thrownAsync(() => svc.validateCustom({ owner: '원무팀' }));
    expect(plain.message).toBe('항목 이름이 필요합니다');
    expect(msgOf(plain)).toBeUndefined();
  });
});
