import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 응답 직렬화 안전 인터셉터 — Date→ISO, Decimal→number, BigInt→number, 그 외 객체는 프로토타입 보존.
 *
 * 배경(이 인터셉터가 유발했던 버그):
 *  - 과거에는 모든 object를 Object.entries로 재구성 → Prisma Decimal의 프로토타입(+toJSON)을 벗겨
 *    {s,e,d} plain 객체로 만들어 버림 → 프론트가 객체 렌더 → React error #31.
 * 원칙:
 *  - plain object(Object.prototype/null) 와 배열만 재귀한다.
 *  - 클래스 인스턴스(Buffer·커스텀 등)는 변형하지 않고 그대로 둔다(자체 toJSON 보존).
 *  - 알려진 특수 타입(Date·Decimal·BigInt)만 명시적으로 안전 변환한다.
 */
@Injectable()
export class DateSerializerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(data => this.transform(data)));
  }

  /** plain object 판별 — 클래스 인스턴스(프로토타입 보존 대상) 제외 */
  private isPlainObject(o: object): boolean {
    const proto = Object.getPrototypeOf(o);
    return proto === Object.prototype || proto === null;
  }

  /** decimal.js Decimal 인스턴스(toNumber 보유) */
  private isDecimalInstance(o: unknown): o is { toNumber: () => number } {
    return (
      typeof o === 'object' && o !== null &&
      typeof (o as { toNumber?: unknown }).toNumber === 'function' &&
      's' in o && 'e' in o && 'd' in o
    );
  }

  /** 프로토타입 소실된 plain Decimal {s,e,d}(toNumber 없음) — s∈{1,-1}, e:number, d:number[] */
  private isPlainDecimal(o: object): o is { s: number; e: number; d: number[] } {
    const d = o as { s?: unknown; e?: unknown; d?: unknown; toNumber?: unknown };
    return (
      typeof d.toNumber !== 'function' &&
      (d.s === 1 || d.s === -1) && typeof d.e === 'number' &&
      Array.isArray(d.d) && d.d.every((n) => typeof n === 'number')
    );
  }

  /**
   * plain {s,e,d}(decimal.js 내부표현) → number 재구성.
   * 🔴 종전엔 `Number(digits) * Math.pow(10, …)` 곱셈이라 부동소수점 오차가 났다
   *    (예: 382000000 × 1e-7 = 38.199999999999996 → 체온·금액·BMI 등 모든 Decimal 응답 오염).
   *    소수점을 문자열로 끼워 넣어 `Number("38.2")` 로 정확히 파싱한다(곱셈 회피).
   */
  private plainDecimalToNumber(o: { s: number; e: number; d: number[] }): number {
    let digits = '';
    for (let i = 0; i < o.d.length; i++) digits += i === 0 ? String(o.d[i]) : String(o.d[i]).padStart(7, '0');
    const sign = o.s < 0 ? '-' : '';
    const pointPos = o.e + 1; // 소수점 앞(정수부) 자릿수
    let numStr: string;
    if (pointPos <= 0) {
      numStr = `0.${'0'.repeat(-pointPos)}${digits}`;
    } else if (pointPos >= digits.length) {
      numStr = digits + '0'.repeat(pointPos - digits.length);
    } else {
      numStr = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
    }
    return Number(sign + numStr);
  }

  private transform(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    // 원시 특수 타입
    if (typeof obj === 'bigint') return Number(obj); // BigInt는 JSON.stringify 불가 → number

    // 알려진 특수 객체 → 안전 변환
    if (obj instanceof Date) return obj.toISOString();
    if (this.isDecimalInstance(obj)) return obj.toNumber();
    if (Array.isArray(obj)) return obj.map(item => this.transform(item));

    if (typeof obj === 'object') {
      // plain Decimal {s,e,d}(프로토타입 소실분) 방어
      if (this.isPlainDecimal(obj)) return this.plainDecimalToNumber(obj);
      // 클래스 인스턴스(Buffer·커스텀 등)는 프로토타입 보존 — 재구성 금지(과거 #31 원인)
      if (!this.isPlainObject(obj)) return obj;
      // plain object만 재귀
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.transform(value);
      }
      return result;
    }
    return obj;
  }
}
