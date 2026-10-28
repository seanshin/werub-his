import { describe, it, expect } from 'vitest';
import { parseGs1, isValidGtin, toGtin14, gtinCheckDigit, parseGs1Date, gs1Summary, GS1_FNC1 } from './gs1';

/**
 * 🔴 의료기기·의약품 바코드 정본(2026-08-26).
 *    실측: `medication_codes.barcode` 22,306건이 저장돼 있는데 **파싱하는 코드가 0**이었다.
 */
describe('GTIN 체크디지트', () => {
  it('알려진 GTIN-13 을 검증한다', () => {
    // 체크디지트를 규칙으로 계산해 붙인 값이므로 자체 정합적이다
    const body = '880680600001';
    const gtin = body + gtinCheckDigit(body);
    expect(gtin).toHaveLength(13);
    expect(isValidGtin(gtin)).toBe(true);
  });

  it('🔴 한 자리가 틀리면 유효하다고 말하지 않는다', () => {
    const body = '880680600001';
    const good = body + gtinCheckDigit(body);
    const bad = good.slice(0, -1) + ((Number(good.slice(-1)) + 1) % 10);
    expect(isValidGtin(bad)).toBe(false);
  });

  it('GTIN-14 로 정규화해도 값은 바뀌지 않는다 — 자리만 맞춘다', () => {
    const g13 = '8806806000014';
    expect(toGtin14(g13)).toBe('08806806000014');
    expect(toGtin14(g13)!.endsWith(g13)).toBe(true);
    expect(toGtin14('짧다')).toBeNull();
  });
});

describe('GS1 날짜', () => {
  it('🔴 DD=00 은 월말 표기다 — 날짜를 지어내지 않는다', () => {
    const d = parseGs1Date('260800')!;
    expect(d.year).toBe(2026);
    expect(d.month).toBe(8);
    expect(d.day).toBeNull();
    expect(d.dayUnknown).toBe(true);
  });

  it('세기 규칙(YY>=51 → 19YY)을 못박는다 — 바꾸면 유효기간이 통째로 어긋난다', () => {
    expect(parseGs1Date('260815')!.year).toBe(2026);
    expect(parseGs1Date('510815')!.year).toBe(1951);
    expect(parseGs1Date('991231')!.year).toBe(1999);
  });

  it('월이 범위를 벗어나면 날짜로 읽지 않는다', () => {
    expect(parseGs1Date('261315')).toBeNull();
    expect(parseGs1Date('2608')).toBeNull();
  });

  it('대조군 — 정상 날짜는 일자까지 읽는다(무조건 미상이 아니다)', () => {
    const d = parseGs1Date('260815')!;
    expect(d.day).toBe(15);
    expect(d.dayUnknown).toBe(false);
  });
});

describe('GS1-128 파싱', () => {
  // 🔴 체크디지트를 손으로 적지 않는다 — 규칙으로 만든다(손으로 적으면 테스트가 자체 모순이 된다)
  const gtin14 = '0880680600001' + gtinCheckDigit('0880680600001');

  it('괄호 표기를 읽는다', () => {
    const p = parseGs1(`(01)${gtin14}(17)260800(10)LOT123(21)SN9`);
    expect(p.format).toBe('GS1_128');
    expect(p.gtin).toBe(gtin14);
    expect(p.lot).toBe('LOT123');
    expect(p.serial).toBe('SN9');
    expect(p.expiry!.dayUnknown).toBe(true);
  });

  it('FNC1 구분자 표기를 읽는다 — 가변 AI 가 다음 AI 를 삼키지 않는다', () => {
    const p = parseGs1(`01${gtin14}10LOT-A${GS1_FNC1}21SER-B${GS1_FNC1}17261231`);
    expect(p.lot).toBe('LOT-A');
    expect(p.serial).toBe('SER-B');
    expect(p.expiry!.day).toBe(31);
  });

  it('숫자만 오면 GTIN 단독으로 본다', () => {
    const g13 = gtin14.slice(1); // 같은 값의 13자리 표기
    const p = parseGs1(g13);
    expect(p.format).toBe('GTIN');
    expect(p.gtin).toBe(gtin14);
    expect(p.gtinValid).toBe(true);
  });

  it('🔴 해석하지 못한 조각을 버리지 않는다 — 버리면 스캔한 정보가 조용히 사라진다', () => {
    const p = parseGs1(`01${gtin14}99UNKNOWNSTUFF`);
    expect(p.gtin).toBe(gtin14);
    expect(p.unparsed.length).toBeGreaterThan(0);
    expect(p.unparsed.join('')).toContain('UNKNOWN');
  });

  it('🔴 체크디지트가 틀린 GTIN 을 "유효"라고 말하지 않는다', () => {
    const bad = gtin14.slice(0, -1) + ((Number(gtin14.slice(-1)) + 1) % 10);
    const p = parseGs1(`(01)${bad}`);
    expect(p.gtin).toBe(bad);
    expect(p.gtinValid).toBe(false);
    expect(gs1Summary(p)).toMatch(/체크디지트 불일치/);
  });

  it('읽지 못한 바코드를 빈 결과로 성공시키지 않는다', () => {
    const p = parseGs1('그냥 글자');
    expect(p.format).toBe('UNKNOWN');
    expect(p.unparsed).toEqual(['그냥 글자']);
    expect(gs1Summary(p)).toBe('읽지 못한 바코드');
  });

  it('대조군 — 정상 바코드는 요약이 내용을 담는다(무조건 실패가 아니다)', () => {
    const p = parseGs1(`(01)${gtin14}(10)L1`);
    expect(gs1Summary(p)).toMatch(/GTIN/);
    expect(gs1Summary(p)).not.toMatch(/체크디지트 불일치/);
  });
});
