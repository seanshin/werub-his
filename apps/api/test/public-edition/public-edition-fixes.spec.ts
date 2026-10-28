/**
 * 공개판 — 공개판에서 고친 자리를 지킨다.
 *
 * 이식 게이트 위반 기록 · 마약류 반납 · 조제 취소 / 품목 / 완료자 · 재활 세션 상태 · 관제 모집단 ·
 * 임상 경로 발행본 · 법정 하한. 고친 쪽(막는 것)과 그대로 둔 쪽(정상 흐름)을 함께 본다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TransplantService } from '../../src/modules/transplant/transplant.service';
import { ControlledSubstanceService } from '../../src/modules/controlled-substance/controlled-substance.service';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import { RehabService } from '../../src/modules/rehab/rehab.service';
import { SafetyGateService } from '../../src/modules/safety-gate/safety-gate.service';
import { ClinicalPathwayService } from '../../src/modules/clinical-pathway/clinical-pathway.service';
import { RetentionService } from '../../src/modules/retention/retention.service';

describe('이식 게이트 — 경고 · 차단 모두 위반 원장에 남긴다', () => {
  const mk = (mode: string) => {
    const prisma: any = {
      transplantDonor: { findUnique: vi.fn(async () => ({ id: 'd1', organType: 'KIDNEY', status: 'PENDING', bloodType: 'A' })), updateMany: vi.fn(async () => ({ count: 1 })) },
      patientBloodTyping: { findUnique: vi.fn(async () => ({ abo: 'A' })) },
      transplantCrossmatch: { findFirst: vi.fn(async () => null) },
      transplantRecord: { create: vi.fn(async ({ data }: any) => ({ id: 'r1', ...data })) },
      transplantWaitlist: { update: vi.fn() },
      gateViolationLog: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    const svc = new TransplantService(prisma, { get: vi.fn(async () => mode) } as any);
    return { prisma, svc };
  };
  const body = { recipientId: 'p1', donorId: 'd1', organType: 'KIDNEY', transplantDate: '2026-10-28' } as any;

  it('BLOCK — 막으면서 원장에 남긴다', async () => {
    const { prisma, svc } = mk('BLOCK');
    await expect(svc.createTransplant(body)).rejects.toThrow(BadRequestException);
    expect(prisma.gateViolationLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.gateViolationLog.create.mock.calls[0][0].data).toMatchObject({ gateKey: 'transplant.compatEnforce', severity: 'BLOCK', refId: 'd1' });
  });

  it('WARN — 통과해도 원장에 남긴다(응답에만 싣지 않는다)', async () => {
    const { prisma, svc } = mk('WARN');
    prisma.transplantDonor.updateMany.mockResolvedValue({ count: 1 });
    await svc.createTransplant(body);
    expect(prisma.gateViolationLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.gateViolationLog.create.mock.calls[0][0].data.severity).toBe('WARN');
  });
});

describe('마약류 반납 — 수행자를 남기고 원자적으로 전이한다', () => {
  const mk = () => {
    const prisma: any = {
      controlledSubstanceLog: {
        findUnique: vi.fn(async () => ({ id: 'c1', status: 'DISPENSED', notes: null })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    prisma.controlledSubstanceLog.findUnique.mockResolvedValueOnce({ id: 'c1', status: 'DISPENSED', notes: null });
    return { prisma, svc: new ControlledSubstanceService(prisma) };
  };

  it('수행자가 없으면 거부', async () => {
    const { svc } = mk();
    await expect(svc.returnDrug('c1')).rejects.toThrow(BadRequestException);
  });

  it('현재 상태에서만 전이하고 수행자를 메모에 남긴다', async () => {
    const { prisma, svc } = mk();
    await svc.returnDrug('c1', 'u-1');
    const arg = prisma.controlledSubstanceLog.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'c1', status: 'DISPENSED' });
    expect(arg.data.status).toBe('RETURNED');
    expect(arg.data.notes).toContain('u-1');
  });

  it('동시에 다른 전이가 먼저 끝났으면 충돌', async () => {
    const { prisma, svc } = mk();
    prisma.controlledSubstanceLog.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.returnDrug('c1', 'u-1')).rejects.toThrow(ConflictException);
  });
});

describe('조제 — 취소 상태 · 약품 대조', () => {
  const mk = (status: string) => {
    const prisma: any = {
      dispensing: {
        findUnique: vi.fn(async () => ({
          id: 'x1', status, orderId: 'o1', notes: '', items: [],
          order: { prescription: { id: 'rx1', quantity: 10, medicationCodeId: 'med-A' } },
        })),
        update: vi.fn(async ({ data }: any) => ({ id: 'x1', ...data })),
      },
      order: { update: vi.fn() },
      dispensingItem: { deleteMany: vi.fn() },
      genericSubstitution: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    const svc = new PharmacyService(prisma, { emit: vi.fn() } as any, {} as any, { get: vi.fn() } as any);
    return { prisma, svc };
  };

  it('교부(ISSUED)된 조제는 취소하지 않는다 — 오더가 접수로 돌아가지 않는다', async () => {
    const { prisma, svc } = mk('ISSUED');
    await expect(svc.cancelDispensing('x1', '사유')).rejects.toThrow(ConflictException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('이미 취소된 조제도 다시 취소하지 않는다', async () => {
    const { svc } = mk('CANCELLED');
    await expect(svc.cancelDispensing('x1', '사유')).rejects.toThrow(ConflictException);
  });

  it('대기(PENDING) 조제는 그대로 취소된다', async () => {
    const { prisma, svc } = mk('PENDING');
    await svc.cancelDispensing('x1', '사유');
    expect(prisma.order.update).toHaveBeenCalled();
  });

  it('처방 약품이 아닌 품목은 거부', async () => {
    const { svc } = mk('PENDING');
    await expect(svc.updateDispensingItems('x1', [{ medicationCodeId: 'med-B', prescribedQty: 10, dispensedQty: 10 }]))
      .rejects.toThrow(BadRequestException);
  });

  it('승인된 대체조제 약품은 허용', async () => {
    const { prisma, svc } = mk('PENDING');
    prisma.genericSubstitution.findMany.mockResolvedValue([{ substituteMedicationCodeId: 'med-B' }]);
    await svc.updateDispensingItems('x1', [{ medicationCodeId: 'med-B', prescribedQty: 10, dispensedQty: 10 }]);
    expect(prisma.dispensing.update).toHaveBeenCalled();
  });
});

describe('재활 세션 — 상태 전이', () => {
  const mk = (status: string) => {
    const prisma: any = {
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'NURSE', profession: null }) },
      rehabSession: { findUnique: vi.fn(async () => ({ id: 's1', status, therapyType: 'PT', startTime: null })), update: vi.fn(async ({ data }: any) => data) },
      procedureCode: { findFirst: vi.fn(async () => null) },
    };
    return { prisma, svc: new RehabService(prisma) };
  };

  it('완료된 세션은 다시 시작하지 않는다(시작 시각을 덮지 않는다)', async () => {
    const { prisma, svc } = mk('COMPLETED');
    await expect(svc.startSession('s1')).rejects.toThrow(BadRequestException);
    expect(prisma.rehabSession.update).not.toHaveBeenCalled();
  });

  it('완료된 세션은 다시 완료하지 않는다(수가가 다시 붙지 않는다)', async () => {
    const { svc } = mk('COMPLETED');
    await expect(svc.completeSession('s1', {})).rejects.toThrow(BadRequestException);
  });

  it('예정 세션을 시작 없이 바로 완료하는 흐름은 그대로', async () => {
    const { prisma, svc } = mk('SCHEDULED');
    await svc.completeSession('s1', { duration: 20 });
    expect(prisma.rehabSession.update.mock.calls[0][0].data.status).toBe('COMPLETED');
  });
});

describe('관제 모집단 — 판정 기록이 있는 행만 센다', () => {
  it('재활: 게이트가 꺼져 판정하지 않은 세션은 모집단이 아니다', async () => {
    const prisma: any = {
      rehabSession: { findMany: vi.fn(async () => [
        { id: 'a', startTime: new Date(), safetyChecks: null },
        { id: 'b', startTime: new Date(), safetyChecks: { checks: [] } },
      ]) },
    };
    const svc: any = new SafetyGateService(prisma);
    const d30 = new Date(Date.now() - 30 * 864e5), d7 = new Date(Date.now() - 7 * 864e5);
    const r = await svc.fromRehabChecks(d7, d30);
    expect(r.evaluated30d).toBe(1);
    expect(r.violations30d).toBe(0);
  });
});

describe('임상 경로 — 발행본은 그 자리에서 고치지 않는다 · 기준 코드', () => {
  const mk = (pathway: any, extra: any = {}) => {
    const prisma: any = {
      clinicalPathway: {
        findUnique: vi.fn(async () => pathway),
        update: vi.fn(async ({ data }: any) => ({ ...pathway, ...data })),
        aggregate: vi.fn(async () => ({ _max: { version: 2 } })),
        create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      },
      pathwayMilestone: { findUnique: vi.fn(async () => ({ id: 'm1', pathwayId: pathway.id, detail: null })), update: vi.fn(), delete: vi.fn(), create: vi.fn(), createMany: vi.fn() },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
      ...extra,
    };
    const governance: any = { evaluate: vi.fn(async (q: any) => ({ q })), assertOrWarn: vi.fn() };
    return { prisma, governance, svc: new ClinicalPathwayService(prisma, governance) };
  };

  it('ACTIVE 경로 수정 · 마일스톤 수정 · 삭제는 거부', async () => {
    const { svc } = mk({ id: 'p1', code: 'AMI', status: 'ACTIVE' });
    await expect(svc.update('p1', { name: 'x' })).rejects.toThrow(BadRequestException);
    await expect(svc.updateMilestone('m1', { title: 'x' })).rejects.toThrow(BadRequestException);
    await expect(svc.deleteMilestone('m1')).rejects.toThrow(BadRequestException);
  });

  it('DRAFT 경로는 그대로 고친다', async () => {
    const { prisma, svc } = mk({ id: 'p1', code: 'AMI', status: 'DRAFT' });
    await svc.update('p1', { name: 'x' });
    expect(prisma.clinicalPathway.update).toHaveBeenCalled();
  });

  it('폐기는 기준 코드로 거버넌스(RETIRE) 판정을 거친다', async () => {
    const { governance, svc } = mk({ id: 'p1', code: 'AMI_v2', status: 'ACTIVE' });
    await svc.retire('p1', { decisionNo: 'D-1' });
    expect(governance.evaluate).toHaveBeenCalledWith(expect.objectContaining({ code: 'AMI', action: 'RETIRE', decisionNo: 'D-1' }));
  });

  it('복제본을 다시 복제해도 기준 코드에 번호가 이어진다', async () => {
    const { prisma, svc } = mk({ id: 'p1', code: 'AMI_v2', status: 'ACTIVE', milestones: [] });
    await svc.clone('p1', 'u-1');
    expect(prisma.clinicalPathway.create.mock.calls[0][0].data.code).toBe('AMI_v3');
  });
});

describe('보유 정책 — 법정 하한은 낮추지 않는다', () => {
  const mk = (cur: number) => {
    const prisma: any = { retentionPolicy: { findUnique: vi.fn(async () => ({ legalMinDays: cur })), upsert: vi.fn(async ({ update }: any) => update) } };
    return { prisma, svc: new RetentionService(prisma, {} as any, {} as any, {} as any, {} as any) };
  };

  it('낮추면 거부', async () => {
    const { svc } = mk(3650);
    await expect(svc.upsertPolicy({ resourceType: 'EMR', retentionDays: 4000, legalMinDays: 365 })).rejects.toThrow(BadRequestException);
  });

  it('올리거나 그대로 두면 저장', async () => {
    const { prisma, svc } = mk(3650);
    await svc.upsertPolicy({ resourceType: 'EMR', retentionDays: 4000, legalMinDays: 3650 });
    await svc.upsertPolicy({ resourceType: 'EMR', retentionDays: 4000 });
    expect(prisma.retentionPolicy.upsert).toHaveBeenCalledTimes(2);
  });
});
