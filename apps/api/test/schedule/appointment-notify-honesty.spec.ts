import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

/**
 * H2 (화면 실사용 점검 W8 잔여배치) — 예약 알림이 **켜지는 순간** 로그가 거짓말을 한다.
 *
 * 🔴 종전: `onAppointmentNotify()` 가 config `appointment.reminder.send=true` 이면
 *    `[예약알림·실발송(어댑터)]` 라고 적었는데 어댑터 호출은 `TODO(P3b+)` 로 비어 있었다.
 *    기본 OFF 라 지금은 조용하지만, 계약이 체결돼 설정을 켜는 사람이 가장 먼저 속는 형태다.
 *
 * 이 배치는 config 를 켜지 않는다 — "켜면 거짓말하는 구조"만 없앤다.
 */
describe('예약 알림 — 어댑터가 없으면 무엇을 설정하든 미발송이다', () => {
  let service: ScheduleService;
  let config: any;
  let logs: string[];
  let warns: string[];

  beforeEach(() => {
    config = { get: vi.fn() };
    service = new ScheduleService({} as any, config);
    logs = [];
    warns = [];
    vi.spyOn((service as any).logger, 'log').mockImplementation((m: string) => logs.push(String(m)));
    vi.spyOn((service as any).logger, 'warn').mockImplementation((m: string) => warns.push(String(m)));
  });

  it('설정 OFF — 미발송이라고 적는다', async () => {
    config.get.mockResolvedValue(false);

    await service.onAppointmentNotify({ appointmentId: 'a-1' });

    expect(logs.join('\n')).toMatch(/미발송/);
    expect(logs.join('\n')).not.toMatch(/실발송/);
  });

  it('🔴 설정 ON 인데도 어댑터가 없으면 "실발송" 이라고 적지 않는다', async () => {
    config.get.mockResolvedValue(true);

    await service.onAppointmentNotify({ appointmentId: 'a-1' });

    const all = [...logs, ...warns].join('\n');
    expect(all).not.toMatch(/실발송/);
    expect(all).toMatch(/미발송/);
  });

  it('🔴 설정만 켜고 어댑터가 없는 상태는 경고로 드러낸다 (켠 사람이 알아야 한다)', async () => {
    config.get.mockResolvedValue(true);

    await service.onAppointmentNotify({ appointmentId: 'a-1' });

    expect(warns.length).toBe(1);
    expect(warns[0]).toMatch(/appointment\.reminder\.send=true/);
    expect(warns[0]).toMatch(/아무것도 발송되지 않았습니다/);
  });

  it('config 서비스가 없어도(Optional) 미발송으로 조용히 처리된다', async () => {
    service = new ScheduleService({} as any);
    const l: string[] = [];
    vi.spyOn((service as any).logger, 'log').mockImplementation((m: string) => l.push(String(m)));

    await service.onAppointmentNotify({ appointmentId: 'a-1' });

    expect(l.join('\n')).toMatch(/미발송/);
  });
});
