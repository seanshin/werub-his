import { describe, it, expect, vi } from 'vitest';

/**
 * K1 (트랜잭션 6차) — 봉합한 자리의 **동작**을 본다(소스 문자열이 아니라).
 *
 * 🔴 앞 갈래들이 배운 것을 지킨다:
 *  · 목은 정본이 실제로 부르는 모양으로 준다 — `$transaction` 이 없는 목은 콜백을 **아예 실행하지 않아**
 *    가드가 공허하게 통과한다(I2·J1 이 그런 목을 6개 찾았다).
 *  · 추출 표식을 변수명 문자열로 두지 않는다 — 같은 이름을 쓰는 다른 블록이 대신 잡힌다(J1).
 *  · 건마다 **정상 경로 대조군**을 둔다 — 막기만 하고 끝내면 그것도 결함이다.
 *
 * 공통 목: `$transaction(cb)` 는 콜백을 tx 클라이언트로 실행한다. 트랜잭션이 걷히면(재주입)
 * `$transaction` 호출 자체가 사라지므로 이 테스트가 실패한다.
 */
function txMock(models: Record<string, unknown>) {
  const prisma: Record<string, unknown> = {
    ...models,
    $transaction: vi.fn().mockImplementation((cb: unknown) =>
      typeof cb === 'function' ? (cb as (c: unknown) => unknown)(prisma) : Promise.all(cb as unknown[]),
    ),
  };
  return { prisma };
}

describe('🔴 K1 — 진료 시작(Encounter 생성 + 큐 전이)은 한 트랜잭션이다', () => {
  const makeSvc = async (queueStatus = 'CALLED') => {
    const { WaitingQueueService } = await import('../../src/modules/waiting-queue/waiting-queue.service');
    const encounterCreate = vi.fn().mockResolvedValue({ id: 'enc-1' });
    const queueUpdate = vi.fn().mockResolvedValue({ id: 'q-1', departmentName: '내과', queueNumber: 1 });
    const { prisma } = txMock({
      waitingQueue: { findUnique: vi.fn().mockResolvedValue({ id: 'q-1', status: queueStatus, patientId: 'p-1', doctorId: 'd-1' }), update: queueUpdate },
      encounter: { create: encounterCreate },
    });
    const svc = new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
    return { svc, prisma, encounterCreate, queueUpdate };
  };

  it('🔴 Encounter 생성과 큐 전이가 한 트랜잭션에서 일어난다(한쪽만 커밋되면 고아 진료·재시도 시 중복 진료)', async () => {
    const { svc, prisma, encounterCreate, queueUpdate } = await makeSvc();
    await svc.startConsultation('q-1');
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(encounterCreate).toHaveBeenCalledTimes(1);
    expect(queueUpdate).toHaveBeenCalledTimes(1);
    expect(queueUpdate.mock.calls[0][0].data).toMatchObject({ status: 'IN_CONSULTATION', encounterId: 'enc-1' });
  });

  it('대조군 — 호출 상태가 아니면 아무것도 쓰지 않는다', async () => {
    const { svc, encounterCreate, queueUpdate } = await makeSvc('WAITING');
    await expect(svc.startConsultation('q-1')).rejects.toThrow();
    expect(encounterCreate).not.toHaveBeenCalled();
    expect(queueUpdate).not.toHaveBeenCalled();
  });
});

describe('🔴 K1 — 항암 사이클 완료와 코스 종결은 한 트랜잭션이다', () => {
  const makeSvc = async (remaining: number) => {
    const { ChemoService } = await import('../../src/modules/chemo/chemo.service');
    const cycleUpdate = vi.fn().mockResolvedValue({ id: 'cy-1', status: 'COMPLETED' });
    const courseUpdate = vi.fn().mockResolvedValue({ id: 'co-1' });
    const { prisma } = txMock({
      chemoCycle: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'cy-1', status: 'IN_PROGRESS', courseId: 'co-1',
          course: { id: 'co-1', registryId: null, startDate: new Date(), regimen: { code: 'R', name: '레지멘' } },
        }),
        update: cycleUpdate,
        count: vi.fn().mockResolvedValue(remaining),
      },
      chemoCourse: { update: courseUpdate },
      cancerTreatment: { create: vi.fn() },
    });
    const svc = new ChemoService(prisma as never, {} as never, {} as never, {} as never);
    return { svc, prisma, cycleUpdate, courseUpdate };
  };

  it('🔴 마지막 사이클이면 코스 종결까지 한 트랜잭션에서 끝낸다(코스가 ACTIVE 로 영구히 남지 않는다)', async () => {
    const { svc, prisma, cycleUpdate, courseUpdate } = await makeSvc(0);
    const r = await svc.completeCycle('cy-1');
    expect(r.courseCompleted).toBe(true);
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(cycleUpdate).toHaveBeenCalledTimes(1);
    expect(courseUpdate).toHaveBeenCalledTimes(1);
  });

  it('대조군 — 남은 사이클이 있으면 코스는 건드리지 않는다', async () => {
    const { svc, courseUpdate } = await makeSvc(2);
    const r = await svc.completeCycle('cy-1');
    expect(r.courseCompleted).toBe(false);
    expect(courseUpdate).not.toHaveBeenCalled();
  });
});

describe('🔴 K1 — 당직 교대 요청과 결재선은 한 트랜잭션이다', () => {
  const makeSvc = async (eApproval: boolean) => {
    const { DutyScheduleService } = await import('../../src/modules/duty-schedule/duty-schedule.service');
    const swapCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sw-1', ...data }));
    const relayCreate = vi.fn().mockResolvedValue({ id: 'relay-1' });
    const { prisma } = txMock({
      user: { findMany: vi.fn().mockResolvedValue([]) },
      staff: { findUnique: vi.fn().mockResolvedValue({ id: 'staff-1' }) },
      dutySwapRequest: { create: swapCreate },
      eApprovalRelay: { create: relayCreate },
      notification: { create: vi.fn().mockResolvedValue({}) },
    });
    const cfg = { get: vi.fn().mockResolvedValue(eApproval ? 'true' : 'false') };
    const svc = new DutyScheduleService(prisma as never, cfg as never);
    return { svc, prisma, swapCreate, relayCreate };
  };

  it('🔴 결재 ON — 요청과 결재선이 한 트랜잭션에서 생긴다(아무에게도 안 가는 요청이 남지 않는다)', async () => {
    const { svc, prisma, swapCreate, relayCreate } = await makeSvc(true);
    await svc.requestSwap({ requesterId: 'u-1', targetId: 'u-2', originalDate: '2026-07-10', originalShift: 'DAY', swapDate: '2026-07-11', swapShift: 'NIGHT', reason: 't' });
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(swapCreate).toHaveBeenCalledTimes(1);
    expect(relayCreate).toHaveBeenCalledTimes(1);
  });

  it('대조군 — 결재 OFF 면 요청만 만들고 트랜잭션을 쓰지 않는다', async () => {
    const { svc, prisma, swapCreate, relayCreate } = await makeSvc(false);
    const r = await svc.requestSwap({ requesterId: 'u-1', targetId: 'u-2', originalDate: '2026-07-10', originalShift: 'DAY', swapDate: '2026-07-11', swapShift: 'NIGHT', reason: 't' });
    expect(r.message).toContain('등록');
    expect(swapCreate).toHaveBeenCalledTimes(1);
    expect(relayCreate).not.toHaveBeenCalled();
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe('🔴 K1 — 태블릿 서명 세션은 먼저 선점한다(한 토큰에 한 서명)', () => {
  const makeSvc = async (claimCount: number) => {
    const { ConsentService } = await import('../../src/modules/consent/consent.service');
    const updateMany = vi.fn().mockResolvedValue({ count: claimCount });
    const consentUpdate = vi.fn().mockResolvedValue({ id: 'c-1' });
    const prisma = {
      consentSignSession: {
        findUnique: vi.fn().mockResolvedValue({ token: 't-1', consentId: 'c-1', status: 'OPEN', signMode: 'TABLET', signerType: 'PATIENT', expiresAt: new Date(Date.now() + 60_000) }),
        updateMany,
        update: vi.fn(),
      },
      // 서명 대상 동의서 종류 조회(2026-10-02 초진 동의 묶음 분기) — 수술 동의서는 종전 경로
      consentForm: { update: consentUpdate, findUnique: vi.fn().mockResolvedValue({ type: 'SURGERY', patientId: 'p-1' }) },
    };
    const svc = new ConsentService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    // `sign` 은 이 테스트의 대상이 아니다 — 세션 선점 순서만 본다
    vi.spyOn(svc as never, 'sign' as never).mockResolvedValue({ status: 'SIGNED' } as never);
    return { svc, updateMany, consentUpdate };
  };

  it('🔴 선점이 서명 기록보다 **먼저** 일어난다(서명 뒤 세션이 OPEN 으로 남아 재제출되지 않는다)', async () => {
    const { svc, updateMany, consentUpdate } = await makeSvc(1);
    await svc.submitSignSession('t-1', { signatureImage: 'data:image/png;base64,AAAA', signedBy: '홍길동' } as never);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toMatchObject({ where: { token: 't-1', status: 'OPEN' } });
    // 순서: 선점(updateMany) → 동의서 쓰기
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(consentUpdate.mock.invocationCallOrder[0]);
  });

  it('🔴 이미 처리된 세션(선점 0건)이면 서명을 기록하지 않는다', async () => {
    const { svc, consentUpdate } = await makeSvc(0);
    await expect(
      svc.submitSignSession('t-1', { signatureImage: 'data:image/png;base64,AAAA', signedBy: '홍길동' } as never),
    ).rejects.toThrow();
    expect(consentUpdate).not.toHaveBeenCalled();
  });
});

describe('🔴 K1 — 포털 동의서 서명은 한 번의 쓰기다', () => {
  const makeSvc = async (consentType: string) => {
    const { PortalService } = await import('../../src/modules/portal/portal.service');
    const update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'c-1', ...data }));
    const prisma = {
      consentForm: { findUnique: vi.fn().mockResolvedValue({ id: 'c-1', patientId: 'p-1', status: 'PENDING', consentType, templateName: '수술', doctorId: null }), update },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '홍', givenName: '길동' }) },
      patientJourneyEvent: { create: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    };
    const svc = new PortalService(prisma as never, ...(Array(10).fill({}) as never[]));
    return { svc, update };
  };

  it('🔴 단독 서명 서식은 한 번의 update 로 완료된다(서명만 남고 PENDING 으로 굳지 않는다)', async () => {
    const { svc, update } = await makeSvc('TREATMENT');
    await svc.signConsent('p-1', 'c-1', 'sig');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'SIGNED', isValid: true });
  });

  it('대조군 — 다인 서명 서식은 완료로 올리지 않는다(환자 서명만 기록)', async () => {
    const { svc, update } = await makeSvc('SURGERY');
    await svc.signConsent('p-1', 'c-1', 'sig');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.status).toBeUndefined();
    expect(update.mock.calls[0][0].data).toHaveProperty('patientSignature');
  });
});
