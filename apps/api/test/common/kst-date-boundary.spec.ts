import { describe, it, expect } from 'vitest';

/**
 * 2026-07 날짜/타임존 전수 회귀 — KST 날짜 경계 계약.
 *
 * 🔴 함정: `new Date('2026-01-01')`(date-only)은 **UTC 자정**으로 파싱된다(= KST 09:00).
 *    이를 KST 날짜 경계로 쓰면 그 날 오전 0~9시(KST) 데이터가 경계 밖으로 밀려 누락된다.
 *    (연말정산 의료비·CRM 슬롯·CSSD 재고 리포트에서 발생했던 실버그.)
 * 봉합: 날짜 경계는 `${date}T00:00:00+09:00` 로 KST 오프셋을 명시한다(서버 TZ 비의존).
 */
describe('KST 날짜 경계', () => {
  it('🔴 date-only 는 UTC 자정으로 파싱된다(함정 재현)', () => {
    // 이 동작을 이해하고 있어야 봉합의 이유가 명확하다
    expect(new Date('2026-01-01').toISOString()).toBe('2026-01-01T00:00:00.000Z'); // = KST 09:00
  });

  it('+09:00 명시 경계는 KST 자정을 UTC 로 정확히 표현', () => {
    // KST 2026-01-01 00:00 = UTC 2025-12-31 15:00
    expect(new Date('2026-01-01T00:00:00+09:00').toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });

  it('1/1 오전(KST) 결제가 연 경계 안에 포함된다 — 연말정산 누락 방지', () => {
    const year = 2026;
    const start = new Date(`${year}-01-01T00:00:00+09:00`);
    const end = new Date(`${year + 1}-01-01T00:00:00+09:00`);

    // 2026-01-01 03:00 KST 결제 (UTC 2025-12-31 18:00) — start 이상, end 미만이어야 한다
    const paidAt = new Date('2026-01-01T03:00:00+09:00');
    expect(paidAt >= start && paidAt < end).toBe(true);

    // date-only 경계였다면 이 건이 누락됐다(대조)
    const badStart = new Date(`${year}-01-01`); // UTC 자정 = KST 09:00
    expect(paidAt >= badStart).toBe(false); // 🔴 03:00 KST < 09:00 KST → 누락됐을 것
  });

  it('하루 경계 [00:00, 23:59:59] KST 가 같은 날에 머문다 — CRM 슬롯·CSSD from/to', () => {
    const date = '2026-07-28';
    const start = new Date(`${date}T00:00:00+09:00`);
    const end = new Date(`${date}T23:59:59+09:00`);
    // KST 로 같은 날 07-28
    const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
    expect(fmt(start)).toBe('2026-07-28');
    expect(fmt(end)).toBe('2026-07-28');
  });
});
