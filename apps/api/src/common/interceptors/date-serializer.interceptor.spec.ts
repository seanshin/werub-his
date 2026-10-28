import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { of } from 'rxjs';
import { DateSerializerInterceptor } from './date-serializer.interceptor';

/**
 * React #31 회귀 방지 — 응답에 직렬화 불가 객체({s,e,d} 등)가 새지 않음을 보장.
 * 이 인터셉터가 과거 Decimal 프로토타입을 벗겨 {s,e,d}로 만들던 버그의 재발 가드.
 */
describe('DateSerializerInterceptor (직렬화 안전)', () => {
  const interceptor = new DateSerializerInterceptor();

  // private transform을 응답 파이프로 우회 호출
  const run = async (input: unknown): Promise<unknown> => {
    const ctx = {} as never;
    const handler = { handle: () => of(input) };
    return new Promise((resolve) => interceptor.intercept(ctx, handler).subscribe(resolve));
  };

  /** 응답 트리에 decimal.js 내부표현 {s,e,d} 객체가 남아있으면 true */
  const hasRawDecimal = (o: unknown): boolean => {
    if (o && typeof o === 'object') {
      if (!Array.isArray(o) && 's' in o && 'e' in o && 'd' in o) return true;
      return Object.values(o).some(hasRawDecimal);
    }
    return false;
  };

  it('Prisma Decimal 인스턴스 → number (문자열/객체 아님)', async () => {
    const out = (await run({ data: { fee: new Prisma.Decimal('1250.5') } })) as { data: { fee: unknown } };
    expect(out.data.fee).toBe(1250.5);
    expect(hasRawDecimal(out)).toBe(false);
  });

  it('프로토타입 소실된 plain Decimal {s,e,d} → number 재구성', async () => {
    const plain = { ...new Prisma.Decimal('88.5') }; // 프로토타입 소실
    const out = (await run({ data: { temperature: plain } })) as { data: { temperature: unknown } };
    expect(out.data.temperature).toBe(88.5);
    expect(hasRawDecimal(out)).toBe(false);
  });

  it('🔴 plain Decimal 재구성이 부동소수점 오차를 만들지 않는다(38.2 → 38.2, not 38.1999…)', async () => {
    // 종전 Number(digits)*Math.pow(10,…) 곱셈이 38.199999999999996 을 만들었다(체온·금액 오염).
    for (const v of ['38.2', '36.5', '7.2', '0.05', '1234567.89', '-12.3', '0.3', '250000', '0.268']) {
      const plain = { ...new Prisma.Decimal(v) };
      const out = (await run({ data: { x: plain } })) as { data: { x: unknown } };
      expect(out.data.x).toBe(Number(v));
    }
  });

  it('중첩/배열 안의 Decimal도 전부 변환', async () => {
    const out = await run({
      data: {
        vitals: [{ weight: new Prisma.Decimal('70.25') }, { weight: { ...new Prisma.Decimal('65.1') } }],
        nested: { amount: new Prisma.Decimal('99999.99') },
      },
    });
    expect(hasRawDecimal(out)).toBe(false);
  });

  it('Date → ISO 문자열', async () => {
    const out = (await run({ at: new Date('2026-06-10T00:00:00.000Z') })) as { at: unknown };
    expect(out.at).toBe('2026-06-10T00:00:00.000Z');
  });

  it('BigInt → number', async () => {
    const out = (await run({ n: BigInt(42) })) as { n: unknown };
    expect(out.n).toBe(42);
  });

  it('클래스 인스턴스(Buffer) 프로토타입 보존 — 재구성하지 않음', async () => {
    const buf = Buffer.from('hi');
    const out = (await run({ b: buf })) as { b: unknown };
    expect(Buffer.isBuffer(out.b)).toBe(true); // 프로토타입 유지(과거엔 {0,1,...}로 깨졌음)
  });

  it('일반 값/구조는 보존', async () => {
    const input = { data: { a: 1, b: 'x', c: true, d: null, e: [1, 2, 3], f: { g: 'h' } } };
    expect(await run(input)).toEqual(input);
  });
});
