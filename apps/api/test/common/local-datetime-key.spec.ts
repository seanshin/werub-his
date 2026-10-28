import { describe, it, expect, afterEach, vi } from 'vitest';
import { localDateTimeKey } from '../../src/common/day-range';

/**
 * 🔴 사람이 읽는 일시를 `toISOString().slice(0,16)` 으로 만들면 **UTC** 다 (2026-09-11 실측).
 *    03:00 KST 정기 백업이 go-live 에 "2026-09-10 18:00" 으로 · 검체 라벨 인쇄 시각이 9시간 전으로 ·
 *    환자에게 주는 문서 발급 시각도 9시간 전으로 찍혔다.
 *
 * 정본 `localDateTimeKey` 는 **프로세스 TZ** 를 따른다(pm2 `TZ=Asia/Seoul`) — 국가 축(UAE)에서도 병원 현지 시각.
 * 그래서 이 테스트는 TZ 를 직접 바꿔 본다(CI 가 UTC 여도 같은 결론이 나야 한다).
 */
const ORIG_TZ = process.env.TZ;
afterEach(() => {
  if (ORIG_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIG_TZ;
});

describe('localDateTimeKey — 병원 현지 시각', () => {
  const at = new Date('2026-09-10T18:00:04Z'); // = KST 2026-09-11 03:00:04 (정기 백업 시각)

  it('🔴 KST 프로세스에서 03:00 백업은 "09-11 03:00" 이다 — "09-10 18:00"(UTC 절단)이 아니다', () => {
    process.env.TZ = 'Asia/Seoul';
    expect(localDateTimeKey(at)).toBe('2026-09-11 03:00');
    expect(localDateTimeKey(at)).not.toBe(at.toISOString().slice(0, 16).replace('T', ' '));
  });

  it('초까지 — 문서 발급 시각', () => {
    process.env.TZ = 'Asia/Seoul';
    expect(localDateTimeKey(at, { seconds: true })).toBe('2026-09-11 03:00:04');
  });

  it('국가 축 — UAE(UTC+4) 프로세스면 그 나라 현지 시각(KST 를 박지 않는다)', () => {
    process.env.TZ = 'Asia/Dubai';
    expect(localDateTimeKey(at)).toBe('2026-09-10 22:00');
  });

  it('대조군 — UTC 프로세스면 UTC 와 같다(정본이 무엇을 따르는지 확인)', () => {
    process.env.TZ = 'UTC';
    expect(localDateTimeKey(at)).toBe('2026-09-10 18:00');
  });
});

// 🔴 (2026-09-14) CRM 대행 가용 슬롯의 09:00~17:00 고정 16칸 검사를 걷었다 — 그 고정 슬롯 자체가 시간표·휴진과 무관하게
//    지어낸 값이었다. 대행 조회는 이제 예약 정본 ScheduleService.getAvailability 를 부르고, 그 경유는
//    test/crm/crm-proxy-appointment-canon.spec.ts 가 지킨다(KST 경계는 정본 쪽 테스트 소관).
