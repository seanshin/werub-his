/**
 * 🔴 대기자 자동안내 정직성 가드 — 2026-08-20.
 *
 * 종전 `offerWaitlistOnOpening` 은 `notifiedAt: new Date()` 를 찍었다. 그러나
 *   · 수신자 `onAppointmentNotify` 는 있지만 `APPOINTMENT_NOTIFY_ADAPTER.implemented === false`
 *     라 **로그만 남기고 반환한다** — 발송 경로가 존재하지 않는다
 *   · `appointmentWaitlist.notifiedAt` 을 읽는 화면도 없다
 * → 환자는 아무 통보도 받지 못하는데 원장은 "이 시각에 안내했다"고 말했다(P16).
 *
 * 🔴 조사 함정: 수신자가 **발행과 같은 파일 안**에 있어 `grep -v <발행파일>` 로 세면
 *    "수신자 0"으로 오독한다(1차 조사가 그렇게 틀렸다). 결론은 같았지만 근거가 달랐다.
 *
 * 재주입: `notifiedAt: null` 을 `new Date()` 로 되돌리면 이 파일이 실패한다.
 * 🔴 `APPOINTMENT_NOTIFY_ADAPTER` 가 구현되는 날에는 이 가드를 **지우는 게 아니라**
 *    "발송에 성공했을 때만 채운다"로 바꿔야 한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

describe('대기자 슬롯 개방 안내 — 통보하지 않았으면 시각을 남기지 않는다', () => {
  it('🔴 OFFERED 로 바꾸되 notifiedAt 은 null · 직접 연락이 필요하다고 경고한다', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma: any = {
      appointmentWaitlist: {
        findFirst: vi.fn().mockResolvedValue({ id: 'w1', patientId: 'p1' }),
        update,
      },
    };
    const svc = new ScheduleService(prisma, ...(Array(12).fill({}) as never[]));
    (svc as unknown as { events: { emit: () => void } }).events = { emit: vi.fn() };
    const warn = vi.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);

    await (svc as unknown as { offerWaitlistOnOpening: (d: string, n: string) => Promise<void> }).offerWaitlistOnOpening('doc-1', '내과');

    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('OFFERED');
    expect(data.notifiedAt).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/통보 채널이 없습니다/);
  });
});
