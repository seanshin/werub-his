import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DateQueryPipe } from '../../src/common/pipes/date-query.pipe';

/**
 * 🔴 **날짜성 쿼리 파라미터가 못 읽는 값이면 400** (2026-08-31 · 발굴 33회차 실측).
 *
 * 잘못된 날짜를 넣고 경로변수 없는 GET **960종**을 전수 호출 → **56곳이 500**.
 * 🔴 정본 `dayRange` 를 고치는 것만으로는 66→59 밖에 안 줄었다 —
 *    모듈들이 정본을 안 거치고 `new Date(query.from)` 을 **직접** 쓴다(52곳).
 *    "정본을 만든 것 ≠ 소비처가 쓰는 것"(§규약 2) → 진입점에서 한 번 막는다.
 */
const pipe = new DateQueryPipe();
const q = (data: string, v: unknown) => pipe.transform(v, { type: 'query', data, metatype: String } as never);
const qobj = (o: Record<string, unknown>) => pipe.transform(o, { type: 'query', metatype: Object } as never);

describe('🔴 못 읽는 날짜는 400 으로 거부한다', () => {
  it('인자 하나로 받는 형태', () => {
    for (const k of ['date', 'from', 'to', 'startDate', 'weekStart']) {
      expect(() => q(k, 'NOTADATE'), `${k} 통과`).toThrow(BadRequestException);
      expect(() => q(k, '2026-13-45')).toThrow(BadRequestException);
    }
    expect(() => q('month', 'NOTADATE')).toThrow(BadRequestException);
    expect(() => q('month', '2026-13')).toThrow(BadRequestException);
    // 🔴 `year` 는 숫자라 형식이 다르다 — `Number('NOTADATE')=NaN` 이 `new Date(NaN,0,1)` 로 샜다
    for (const bad of ['NOTADATE', '20', '99999', '2026-08']) {
      expect(() => q('year', bad), `year=${bad} 통과`).toThrow(BadRequestException);
    }
    expect(q('year', '2026')).toBe('2026');
  });

  it('객체로 받는 형태도 본다', () => {
    expect(() => qobj({ from: 'NOTADATE' })).toThrow(BadRequestException);
    expect(() => qobj({ q: 'NOTADATE', limit: '10' }), '검색어를 날짜로 오인한다').not.toThrow();
  });
});

describe('🔴 통과시키는 것 — 대조군', () => {
  it('정상 날짜·연월', () => {
    expect(q('date', '2026-08-31')).toBe('2026-08-31');
    expect(q('from', '2026-08-31T10:00:00Z')).toBe('2026-08-31T10:00:00Z');
    expect(q('month', '2026-08')).toBe('2026-08');
    expect(q('period', '2026-08-01')).toBe('2026-08-01');
  });

  it('🔴 빈 값은 "안 준 것" — 호출부가 기본값을 정한다', () => {
    expect(() => q('date', '')).not.toThrow();
    expect(() => q('date', '   ')).not.toThrow();
  });

  it('🔴 날짜도 숫자도 아닌 키는 건드리지 않는다 — id·검색어·상태', () => {
    for (const k of ['id', 'q', 'search', 'status', 'patientId', 'sort', 'category']) {
      expect(() => q(k, 'NOTADATE'), `${k} 를 날짜로 봤다`).not.toThrow();
    }
  });

  it('🔴 페이지네이션 숫자 키 — 비정수·음수·거대값은 400(NaN→500·DoS 차단)', () => {
    // 정상 통과
    for (const k of ['limit', 'take', 'pageSize', 'perPage', 'page', 'offset', 'skip']) {
      expect(q(k, '50'), `${k} 정상 정수`).toBe('50');
    }
    expect(q('limit', '0')).toBe('0');           // 0 은 유효
    expect(q('limit', String(10000))).toBe('10000'); // 상한 경계
    // 거부: 비정수(abc → NaN → Prisma 500)
    expect(() => q('limit', 'abc'), 'limit=abc → take:NaN → 500').toThrow(BadRequestException);
    expect(() => q('limit', '3.5'), 'Number(3.5) → 소수 take → 500').toThrow(BadRequestException);
    expect(() => q('limit', '-5'), '음수 take').toThrow(BadRequestException);
    // 거부: 거대값(DoS)
    expect(() => q('limit', '99999999'), '9천만 행 DoS').toThrow(BadRequestException);
    expect(() => q('take', '10001'), '상한 초과').toThrow(BadRequestException);
    // page/offset 은 형식만(상한 없음 — 큰 skip 은 빈 결과)
    expect(q('page', '5000')).toBe('5000');
    expect(() => q('page', 'abc')).toThrow(BadRequestException);
  });

  it('🔴 body·param 은 건드리지 않는다(쿼리 전용)', () => {
    expect(() => pipe.transform({ date: 'NOTADATE' }, { type: 'body' } as never)).not.toThrow();
    expect(() => pipe.transform('NOTADATE', { type: 'param', data: 'date' } as never)).not.toThrow();
  });

  it('🔴 값을 바꾸지 않는다 — SanitizePipe 가 경고한 조용한 변형을 만들지 않는다', () => {
    const o = { date: '2026-08-31', note: '<b>x</b>' };
    expect(qobj(o)).toBe(o);
    expect((qobj(o) as typeof o).note).toBe('<b>x</b>');
  });
});

describe('🔴 전역으로 등록돼 있다 — 만들어만 두면 아무것도 안 막는다', () => {
  it('main.ts 가 ValidationPipe 보다 앞에 둔다', () => {
    const main = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');
    expect(main).toMatch(/new DateQueryPipe\(\)/);
    expect(main.indexOf('new DateQueryPipe()')).toBeLessThan(main.indexOf('new ValidationPipe('));
  });
});
