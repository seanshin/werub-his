import { describe, it, expect, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

/**
 * 자동 노쇼 계약 — 2026-08-13 (화면 점검 W3).
 *
 * 🔴 주석은 처음부터 *"예정+유예 경과·**미접수** → NO_SHOW"* 라고 밝히고 있었는데
 *    **구현에 '미접수' 조건이 없었다.** 접수·진료를 마친 환자까지 "안 왔다"로 기록됐다.
 *    운영 실측: 전체 예약 397건 중 **NO_SHOW 385건 · COMPLETED 0건**(노쇼율 99.5%).
 *    환자 이력과 통계가 함께 거짓이 된다.
 */

function svc(candidates: Array<{ id: string; patientId: string }>, checkedInIds: string[] = []) {
  const update = vi.fn().mockResolvedValue({});
  const apptFindMany = vi.fn().mockResolvedValue(candidates);
  const prisma = {
    appointment: { findMany: apptFindMany, update },
    waitingQueue: {
      findMany: vi.fn().mockResolvedValue(checkedInIds.map((id) => ({ appointmentId: id }))),
    },
  };
  const config = { get: vi.fn().mockImplementation((k: string) => {
    if (k === 'appointment.autoNoShow') return Promise.resolve(true);
    if (k === 'appointment.autoNoShow.graceMinutes') return Promise.resolve(30);
    if (k === 'appointment.autoNoShow.lookbackHours') return Promise.resolve(24);
    return Promise.resolve(undefined);
  }) };
  return { s: new ScheduleService(prisma as never, config as never), update, apptFindMany };
}

describe('자동 노쇼 스윕', () => {
  it('🔴 접수 기록이 있으면 노쇼로 만들지 않는다 — 온 환자를 안 왔다고 하면 안 된다', async () => {
    const { s, update } = svc(
      [{ id: 'a1', patientId: 'p1' }, { id: 'a2', patientId: 'p2' }],
      ['a1'], // a1 은 접수했다
    );
    await s.autoNoShowSweep();

    const noShowIds = update.mock.calls.map((c) => c[0].where.id);
    expect(noShowIds, '접수한 예약이 노쇼가 됐다').not.toContain('a1');
    expect(noShowIds).toContain('a2');
  });

  it('🔴 진료 기록이 있는 예약은 애초에 후보에서 제외한다', async () => {
    const { s, apptFindMany } = svc([]);
    await s.autoNoShowSweep();
    expect(apptFindMany.mock.calls[0][0].where.encounter, '진료 기록 조건이 없다').toEqual({ is: null });
  });

  it('아무도 접수하지 않았으면 전부 노쇼(기존 동작 유지)', async () => {
    const { s, update } = svc([{ id: 'a1', patientId: 'p1' }]);
    await s.autoNoShowSweep();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
