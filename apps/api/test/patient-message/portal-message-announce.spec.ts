/**
 * 🔴 (2026-09-14) 포털 전송이 저장만 하고 아무에게도 알리지 않았다 — 발행 지점이 사라지면 실패한다.
 */
import { describe, expect, it, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';

const PID = '33333333-3333-4333-8333-333333333333';
const ME = '11111111-1111-4111-8111-111111111111';

function make() {
  const events = { emit: vi.fn() };
  const created = { id: 'pm1', patientId: PID, doctorId: ME, sender: 'PATIENT', content: 'x' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc: any = Object.create(PortalService.prototype);
  svc.prisma = {
    encounter: { findFirst: vi.fn().mockResolvedValue({ doctorId: ME }) },
    patientMessage: { create: vi.fn().mockResolvedValue(created), findUnique: vi.fn().mockResolvedValue(created) },
  };
  svc.events = events;
  svc.logger = { warn: vi.fn() };
  return { svc, events };
}

describe('포털 환자 메시지 → 직원 측 발행', () => {
  it('sendMessage 가 저장 후 patient.message_sent 를 발행한다', async () => {
    const { svc, events } = make();
    await svc.sendMessage(PID, 'x');
    expect(events.emit).toHaveBeenCalledWith('patient.message_sent', { patientId: PID, messageId: 'pm1', doctorId: ME });
  });

  it('replyToMessage 도 발행한다(환자 답장도 의사에게 도달해야 한다)', async () => {
    const { svc, events } = make();
    await svc.replyToMessage(PID, 'pm1', 'y');
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('대조군 — 발행 실패가 환자 전송을 실패로 만들지 않는다', async () => {
    const { svc, events } = make();
    events.emit.mockImplementation(() => { throw new Error('bus down'); });
    await expect(svc.sendMessage(PID, 'x')).resolves.toMatchObject({ id: 'pm1' });
    expect(svc.logger.warn).toHaveBeenCalled();
  });
});
