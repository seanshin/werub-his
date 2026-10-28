/**
 * 🔴 (2026-09-14) CRM 예약 대행이 prisma.appointment 를 직접 써서 예약 정본(휴진·세션·충돌 검증·여정)을 우회했고,
 * 가용 시간대는 시간표와 무관한 09:00~17:00 고정 슬롯을 지어냈다.
 * 지키는 것: ① 생성·변경·취소·가용 조회가 ScheduleService 정본을 부른다 ② 서비스 소스가 appointment 를 직접 쓰지 않는다
 *           ③ 본문이 class DTO(ValidationPipe 대상)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CrmService } from '../../src/modules/crm/crm.service';

function make() {
  const schedule = {
    create: vi.fn().mockResolvedValue({ id: 'a1' }),
    update: vi.fn().mockResolvedValue({ id: 'a1' }),
    changeStatus: vi.fn().mockResolvedValue({ id: 'a1', status: 'CANCELLED' }),
    getAvailability: vi.fn().mockResolvedValue({ slots: [] }),
  };
  const prisma = { appointment: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() } };
  const svc = new CrmService(prisma as any, {} as any, schedule as any);
  return { svc, schedule, prisma };
}

describe('CRM 예약 대행 — 예약 정본 경유', () => {
  it('① 네 경로가 ScheduleService 를 부르고 appointment 를 직접 쓰지 않는다', async () => {
    const { svc, schedule, prisma } = make();
    await svc.proxyCreateAppointment({ patientId: 'p', doctorId: 'd', scheduledAt: '2026-09-15T10:00:00+09:00' }, 'u');
    await svc.proxyRescheduleAppointment('a1', '2026-09-16T10:00:00+09:00', 'u');
    await svc.proxyCancelAppointment('a1', '환자 요청', 'u');
    await svc.proxyGetAvailableSlots('d', '2026-09-15');
    expect(schedule.create).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'p', doctorId: 'd', bookedVia: 'CRM' }), 'u');
    expect(schedule.update).toHaveBeenCalledWith('a1', { scheduledAt: '2026-09-16T10:00:00+09:00' }, 'u');
    expect(schedule.changeStatus).toHaveBeenCalledWith('a1', { status: 'CANCELLED', cancelReason: '환자 요청' }, 'u');
    expect(schedule.getAvailability).toHaveBeenCalledWith({ doctorId: 'd', date: '2026-09-15', duration: 30 });
    expect(prisma.appointment.create).not.toHaveBeenCalled();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('② 가용 조회는 잘못된 날짜를 400 으로', async () => {
    const { svc } = make();
    await expect(svc.proxyGetAvailableSlots('d', '2026-13-40')).rejects.toThrow();
  });

  it('③ 컨트롤러 대행 본문은 class DTO', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/modules/crm/crm.controller.ts'), 'utf8');
    expect(src).toMatch(/@Body\(\) body: CrmProxyCreateAppointmentDto/);
    expect(src).toMatch(/@Body\(\) body: CrmProxyRescheduleDto/);
    expect(src).toMatch(/@Body\(\) body: CrmProxyCancelDto/);
  });
});
