import { describe, it, expect } from 'vitest';
import { stayDays } from '@hospital-run/shared';

/**
 * 재원일수 정본 회귀 — BE 는 `floor`·`max(0)` 로 재원일을 계산하면 안 된다.
 *
 * 🔴 stayDays 정본 = `max(1, ceil(경과/1일))` — **입원료 청구와 같은 산식**(당일 입퇴원도 1일).
 *    - `floor` 는 하루 적게 나와(2.6일→2, ceil=3) 화면이 청구서와 어긋나고, 장기재원(14일+)
 *      판정에서 14일째를 13일로 집계해 **장기재원을 누락**한다(bed-board 실결함).
 *    - `max(0)` 은 당일 입원을 0일로 표기해 청구(1일)와 불일치.
 */

const D = (s: string) => new Date(s + 'T00:00:00Z');

describe('stayDays — 청구 산식 정본(floor·max0 아님)', () => {
  it('당일 입퇴원 = 1일(max(1) — 0 아님)', () => {
    expect(stayDays(D('2026-08-06'), D('2026-08-06'))).toBe(1);
  });

  it('🔴 경계: 2일 초과분은 올림(ceil — floor 아님)', () => {
    // 2일 + 15시간 → 3일(ceil). floor 였다면 2일로 하루 적게 나온다.
    expect(stayDays(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-03T15:00:00Z'))).toBe(3);
  });

  it('🔴 장기재원 경계: 14일째는 14로 집계된다(장기재원 누락 방지)', () => {
    expect(stayDays(D('2026-08-01'), D('2026-08-15'))).toBe(14);
    expect(stayDays(D('2026-08-01'), D('2026-08-15'))! >= 14).toBe(true);
  });

  it('퇴원 미지정 — 지금(now)까지 계산', () => {
    const now = new Date();
    const admit = new Date(now.getTime() - 3 * 86_400_000);
    expect(stayDays(admit)).toBeGreaterThanOrEqual(3);
  });

  it('무효 입원일 — null(0 으로 뭉개지 않는다)', () => {
    expect(stayDays(null)).toBeNull();
    expect(stayDays(undefined)).toBeNull();
  });
});
