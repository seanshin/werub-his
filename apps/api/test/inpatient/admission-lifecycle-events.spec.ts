import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';
import { AdmissionService } from '../../src/modules/admission/admission.service';

/**
 * 입원·재원종료 도메인 이벤트 계약.
 *
 * 🔴 실측 결함(2026-08-18): 입원 생성 경로가 둘인데 `admission.created` 를 emit 하는 쪽은
 *    `AdmissionService.create` **하나뿐**이었다. `/inpatient/admit` 로 들어온 환자는
 *    입원 프로토콜 인스턴스가 생기지 않았고, 이 이벤트에 후속을 붙이면 환자 절반만 걸린다(P12).
 * 🔴 퇴원 도메인 이벤트는 **아예 없었다**(journey 만 emit) — 그래서 재평가 스케줄을 닫을 방법이
 *    화면의 수동 버튼뿐이었고, 매시간 Cron 이 퇴원 환자로 주치의를 계속 호출할 수 있었다.
 *
 * 재주입 시 실패: 어느 한쪽 emit 을 지우면 해당 케이스가 곧바로 깨진다.
 */
describe('입원 생명주기 이벤트 (admission.created / admission.closed)', () => {
  let prisma: any;
  let events: { emit: ReturnType<typeof vi.fn> };

  const admission = {
    id: 'adm-1', patientId: 'p-1', bedId: 'bed-1', status: 'ADMITTED',
    bed: { ward: { name: '3층 내과병동' } }, patient: { id: 'p-1' },
  };

  beforeEach(() => {
    events = { emit: vi.fn() };
    prisma = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      admission: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(admission),
        create: vi.fn().mockResolvedValue(admission),
        update: vi.fn().mockResolvedValue({ ...admission, status: 'DISCHARGED' }),
      },
      patient: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1' }) },
      bed: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ id: 'bed-1', status: 'AVAILABLE' }) },
      chargeOfCare: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      bedAssignment: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      // 🔴 2026-08-21: 퇴원 시 활성 식이 처방을 종료한다(퇴원 환자의 처방이 활성으로 남던 것)
      dietOrder: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      dischargeSummary: { findUnique: vi.fn().mockResolvedValue({ status: 'SIGNED' }) },
      encounter: { findMany: vi.fn().mockResolvedValue([]) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
      interimBilling: { findMany: vi.fn().mockResolvedValue([]) },
      order: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))),
    };
  });

  const inpatient = () =>
    new InpatientService(prisma, undefined, undefined, undefined, undefined, undefined, events as any);

  it('/inpatient/admit 도 admission.created 를 emit 한다 — 종전엔 이 경로만 빠져 있었다', async () => {
    await inpatient().admit({ patientId: 'p-1', bedId: 'bed-1', doctorId: 'd-1' });

    expect(events.emit).toHaveBeenCalledWith('admission.created', { admissionId: 'adm-1', patientId: 'p-1' });
  });

  it('/admissions 경로도 같은 이벤트를 emit 한다(두 경로가 같은 후속을 받는다)', async () => {
    const svc = new AdmissionService(prisma, events as any, undefined, undefined);
    await svc.create('p-1', 'bed-1', 'd-1', '2026-08-18');

    expect(events.emit).toHaveBeenCalledWith('admission.created', { admissionId: 'adm-1', patientId: 'p-1' });
  });

  it('퇴원이 admission.closed 를 emit 한다', async () => {
    await inpatient().discharge('adm-1', '요약');

    const call = events.emit.mock.calls.find((c) => c[0] === 'admission.closed');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ admissionId: 'adm-1', patientId: 'p-1', reason: 'DISCHARGE' });
  });

  it('전원(TRANSFER)도 재원 종료로 emit 된다 — 사유만 다르다', async () => {
    await inpatient().discharge('adm-1', '요약', 'TRANSFER');

    const call = events.emit.mock.calls.find((c) => c[0] === 'admission.closed');
    expect(call![1]).toMatchObject({ reason: 'TRANSFER' });
  });
});
