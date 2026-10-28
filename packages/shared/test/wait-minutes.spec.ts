import { describe, it, expect } from 'vitest';
import { waitMinutesSince } from '../src/age';

/**
 * 🔴 대기 경과 정본 — 화면 실사용 점검 W6(2026-08-14).
 *
 * 원무 보드가 `createdAt` 으로 대기시간을 계산했는데 대기열 196건 중 **99건의 createdAt 이
 * 미래**라 평균 대기가 **-36분**이었다(실측). 실제 도착(`checkedInAt`) 기준으로는 10분.
 * 음수를 '방금'으로 굴리거나 0 으로 깎으면 **아직 오지 않은 환자가 대기 중**으로 보인다.
 */
describe('waitMinutesSince', () => {
  const now = new Date('2026-08-14T10:00:00Z');

  it('경과한 시간은 분으로 센다', () => {
    expect(waitMinutesSince(new Date('2026-08-14T09:30:00Z'), now)).toBe(30);
  });

  it('🔴 미래 시각은 음수도 0 도 아닌 null — 아직 대기가 시작되지 않았다', () => {
    expect(waitMinutesSince(new Date('2026-08-14T10:36:00Z'), now)).toBeNull();
  });

  it('모르는 시각은 null', () => {
    expect(waitMinutesSince(null, now)).toBeNull();
    expect(waitMinutesSince(undefined, now)).toBeNull();
    expect(waitMinutesSince('not-a-date', now)).toBeNull();
  });

  it('ISO 문자열도 받는다', () => {
    expect(waitMinutesSince('2026-08-14T09:00:00Z', now)).toBe(60);
  });

  it('같은 시각은 0 — 진짜 0 은 null 이 아니다', () => {
    expect(waitMinutesSince(now, now)).toBe(0);
  });
});
