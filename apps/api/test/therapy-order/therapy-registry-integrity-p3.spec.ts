import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TherapyOrderService } from '../../src/modules/therapy-order/therapy-order.service';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';
import { RehabService } from '../../src/modules/rehab/rehab.service';
import { GenerateRehabSessionsDto } from '../../src/modules/rehab/dto/rehab.dto';
import { TreatmentTemplateService } from '../../src/modules/treatment-template/treatment-template.service';
import { CancerRegistryService } from '../../src/modules/cancer-registry/cancer-registry.service';

/**
 * 치료·등록 무결성(2026-09-15 P3).
 *  ① 치료 세션 완료가 오더 상태를 보지 않았다 — 취소 오더도 완료·매번 청구 이벤트 · 이미 완료면 완료 사실을 덮어씀
 *  ② 재활 세션 자동 생성이 치료사 미지정이면 NOT NULL 컬럼에 null → 500
 *  ④ 치료일정 템플릿이 유형 밖·제목 없는 항목을 조용히 버림(수정은 전체 교체라 저장된 항목이 사라짐)
 *  ⑤ 암등록 확인(VERIFIED) 뒤 등록 내용을 고쳐도 확인 표시가 그대로 — KCCR 제출 대상에 미확인 내용이 섞임
 * 목(mock)은 정본의 실제 반환 모양(updateMany → { count })을 쓴다.
 */

// ── ① 치료 세션 완료 ────────────────────────────────────────────────────────
function therapyPrisma(status: string, updateManyCount = 1) {
  const prisma: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'NURSE', profession: null }) }, // 시행 직종 게이트(2026-09-29) — 간호사는 종전대로 시행
    therapyOrder: {
      findUnique: vi.fn().mockResolvedValue({ id: 'to-1', orderId: 'ord-1', order: { id: 'ord-1', status } }),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ id: 'ord-1', prescriptionId: 'rx-1', department: 'THERAPY' }),
    },
  };
  prisma.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

const completionRoutes = [
  {
    name: 'PATCH therapy-orders/:id/complete',
    run: (prisma: any, emit: any) => new TherapyOrderService(prisma, { emit } as never).complete('to-1', { resultData: { note: 'ok' } }, 'u-1'),
  },
  {
    name: 'PATCH workstation/therapy/:id/complete',
    run: (prisma: any, emit: any) => new WorkstationService(prisma, undefined, { emit } as never).completeTherapySession('to-1', { note: 'ok' }, 'u-1'),
  },
];

describe.each(completionRoutes)('① 치료 세션 완료 — $name', ({ run }) => {
  it('🔴 취소(CANCELLED) 오더는 완료되지 않는다 — 400 · 쓰기 0 · 청구 이벤트 0', async () => {
    const prisma = therapyPrisma('CANCELLED');
    const emit = vi.fn();
    await expect(run(prisma, emit)).rejects.toThrow(BadRequestException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.therapyOrder.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('🔴 이미 완료된 오더는 멱등 — 완료 시각·결과를 덮어쓰지 않고 청구 이벤트도 다시 내지 않는다', async () => {
    const prisma = therapyPrisma('COMPLETED');
    const emit = vi.fn();
    await expect(run(prisma, emit)).resolves.toEqual({ completed: true, alreadyCompleted: true });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.therapyOrder.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('대조군 — 시행 중(IN_PROGRESS) 오더는 조건부 갱신으로 완료되고 청구·여정 이벤트가 한 번씩 나간다', async () => {
    const prisma = therapyPrisma('IN_PROGRESS');
    const emit = vi.fn();
    await expect(run(prisma, emit)).resolves.toEqual({ completed: true, alreadyCompleted: false });
    expect(prisma.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ord-1', status: 'IN_PROGRESS' } }));
    expect(prisma.order.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED', completedById: 'u-1' });
    expect(emit.mock.calls.map((c: unknown[]) => c[0])).toEqual(['therapy.session.completed', 'order.completed']);
  });

  it('🔴 읽은 뒤 다른 처리로 상태가 바뀌면(조건부 갱신 0건) 409 · 결과를 쓰지 않고 이벤트도 없다', async () => {
    const prisma = therapyPrisma('IN_PROGRESS', 0);
    const emit = vi.fn();
    await expect(run(prisma, emit)).rejects.toThrow(ConflictException);
    expect(prisma.therapyOrder.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('① 치료 오더 시작 — 같은 결함(상태를 보지 않음)', () => {
  it('🔴 취소된 오더를 시행 중으로 되살리지 않는다 — 400', async () => {
    const prisma: any = {
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'NURSE', profession: null }) }, // 시행 직종 게이트(2026-09-29) — 간호사는 종전대로 시행
      therapyOrder: { findUnique: vi.fn().mockResolvedValue({ id: 'to-1', orderId: 'ord-1', order: { status: 'CANCELLED' } }) },
      order: { update: vi.fn() },
    };
    await expect(new TherapyOrderService(prisma, { emit: vi.fn() } as never).start('to-1', 'u-1')).rejects.toThrow(BadRequestException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('대조군 — 접수(RECEIVED) 오더는 시작된다', async () => {
    const prisma: any = {
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'NURSE', profession: null }) }, // 시행 직종 게이트(2026-09-29) — 간호사는 종전대로 시행
      therapyOrder: { findUnique: vi.fn().mockResolvedValue({ id: 'to-1', orderId: 'ord-1', order: { status: 'RECEIVED' } }) },
      order: { update: vi.fn().mockResolvedValue({}) },
    };
    await expect(new TherapyOrderService(prisma, { emit: vi.fn() } as never).start('to-1', 'u-1')).resolves.toEqual({ started: true });
    expect(prisma.order.update).toHaveBeenCalledTimes(1);
  });
});

// ── ② 재활 세션 자동 생성 ───────────────────────────────────────────────────
describe('② 재활 세션 자동 생성 — 치료사 없이 NOT NULL 컬럼에 null 을 넣지 않는다', () => {
  const plan = { id: 'rp-1', patientId: 'p-1', status: 'ACTIVE', frequency: '주3회', therapies: ['운동치료'] };

  it('🔴 치료사 미지정 → 400(REHAB_THERAPIST_REQUIRED) · 세션 생성 0', async () => {
    const prisma: any = { rehabPlan: { findUnique: vi.fn().mockResolvedValue(plan) }, rehabSession: { createMany: vi.fn() } };
    const svc = new RehabService(prisma);
    await expect(svc.generateSessions({ planId: 'rp-1', startDate: '2026-06-01', weeks: 1 } as never)).rejects.toThrow(BadRequestException);
    expect(prisma.rehabSession.createMany).not.toHaveBeenCalled();
  });

  it('🔴 DTO 도 치료사를 필수로 받는다(누락은 ValidationPipe 에서 400)', () => {
    const missing = validateSync(plainToInstance(GenerateRehabSessionsDto, { planId: '11111111-1111-4111-8111-111111111111', startDate: '2026-06-01', weeks: 1 }));
    expect(missing.map((e) => e.property)).toContain('therapistId');
    const ok = validateSync(plainToInstance(GenerateRehabSessionsDto, {
      planId: '11111111-1111-4111-8111-111111111111', startDate: '2026-06-01', weeks: 1, therapistId: '22222222-2222-4222-8222-222222222222',
    }));
    expect(ok).toEqual([]);
  });

  it('대조군 — 지정한 치료사로 모든 세션이 생성된다(null 없음)', async () => {
    const prisma: any = { rehabPlan: { findUnique: vi.fn().mockResolvedValue(plan) }, rehabSession: { createMany: vi.fn().mockResolvedValue({ count: 3 }) } };
    const svc = new RehabService(prisma);
    const r = await svc.generateSessions({ planId: 'rp-1', startDate: '2026-06-01', weeks: 1, therapistId: 'th-1' });
    expect(r.created).toBeGreaterThan(0);
    const rows = prisma.rehabSession.createMany.mock.calls[0][0].data as { therapistId: unknown }[];
    expect(rows.every((row) => row.therapistId === 'th-1')).toBe(true);
  });
});

// ── ④ 치료일정 템플릿 ───────────────────────────────────────────────────────
describe('④ 치료일정 템플릿 — 버린 항목을 원래 순번으로 말한다', () => {
  function tplPrisma() {
    const prisma: any = {
      treatmentScheduleTemplate: {
        create: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // 조건부 쓰기(2026-10-21 P2)
        findUnique: vi.fn().mockResolvedValue({ id: 'tpl-1', status: 'DRAFT', totalDays: 28, items: [], diagnoses: [] }),
      },
      treatmentTemplateItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma.$transaction = vi.fn((ops: unknown) => (typeof ops === 'function' ? (ops as (t: unknown) => unknown)(prisma) : Promise.all(ops as unknown[])));
    return prisma;
  }
  const items = [
    { dayOffset: 0, itemType: 'VISIT', title: '' },                          // #0 제목 없음
    { dayOffset: 1, itemType: 'SURGERY', title: '수술' },                     // #1 유형 밖
    { dayOffset: 2, itemType: 'LAB', title: 'x'.repeat(250) },               // #2 저장 · 제목 잘림
  ];

  it('🔴 생성 — 제목 없음·유형 밖 항목을 droppedItems 로 · 잘린 칸 경로는 원래 순번(items[2])', async () => {
    const prisma = tplPrisma();
    const r = await new TreatmentTemplateService(prisma).create({ name: 'T', items });
    expect(r.droppedItems).toEqual([
      { index: 0, reason: 'EMPTY_TITLE' },
      { index: 1, reason: 'INVALID_ITEM_TYPE', itemType: 'SURGERY' },
    ]);
    expect(r.truncatedFields.map((f) => f.field)).toEqual(['items[2].title']);
    expect(prisma.treatmentTemplateItem.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('🔴 수정(전체 교체) — 버린 항목을 응답에 싣는다', async () => {
    const prisma = tplPrisma();
    const r = await new TreatmentTemplateService(prisma).update('tpl-1', { items });
    expect(r.droppedItems.map((d) => d.index)).toEqual([0, 1]);
  });

  it('대조군 — 모두 유효하면 droppedItems 는 빈 목록', async () => {
    const prisma = tplPrisma();
    const r = await new TreatmentTemplateService(prisma).create({ name: 'T', items: [{ dayOffset: 0, itemType: 'VISIT', title: '재진' }] });
    expect(r.droppedItems).toEqual([]);
  });
});

// ── ⑤ 암등록 확인 뒤 수정 ────────────────────────────────────────────────────
describe('⑤ 암등록 — 확인(VERIFIED) 뒤 등록 내용이 바뀌면 확인을 해제한다', () => {
  function regPrisma(row: Record<string, unknown>, resetCount = 1) {
    const prisma: any = {
      cancerRegistry: {
        findUnique: vi.fn().mockResolvedValue(row),
        update: vi.fn().mockResolvedValue(row),
        updateMany: vi.fn().mockResolvedValue({ count: resetCount }),
      },
    };
    prisma.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    return prisma;
  }
  const verified = {
    id: 'cr-1', status: 'VERIFIED', verifiedAt: new Date('2026-09-01T01:00:00Z'), verifiedBy: 'u-9',
    primarySite: 'C50', ajccStage: 'II', vitalStatus: 'ALIVE', diagnosisDate: new Date('2026-06-01T00:00:00Z'),
    reportedToKccr: false, kccrTransmittedAt: null, kccrSubmissionId: null,
  };

  it('🔴 등록 내용(병기) 변경 → 확인 해제(REGISTERED·확인자/일시 비움) + verificationReset 에 바뀐 칸', async () => {
    const prisma = regPrisma(verified);
    const r: any = await new CancerRegistryService(prisma, {} as never).update('cr-1', { ajccStage: 'III' });
    expect(prisma.cancerRegistry.updateMany).toHaveBeenCalledWith({
      where: { id: 'cr-1', status: 'VERIFIED' },
      data: { status: 'REGISTERED', verifiedAt: null, verifiedBy: null },
    });
    expect(r.verificationReset).toMatchObject({ reason: 'MODIFIED_AFTER_VERIFICATION', changedFields: ['ajccStage'], previousVerifiedBy: 'u-9' });
  });

  it('대조군 — 추적관찰 칸(생존상태)만 바뀌면 확인을 풀지 않는다', async () => {
    const prisma = regPrisma(verified);
    const r: any = await new CancerRegistryService(prisma, {} as never).update('cr-1', { vitalStatus: 'DECEASED' });
    expect(prisma.cancerRegistry.updateMany).not.toHaveBeenCalled();
    expect(r.verificationReset).toBeNull();
  });

  it('대조군 — 같은 값을 다시 보낸 저장(진단일 같은 날짜)은 확인을 풀지 않는다', async () => {
    const prisma = regPrisma(verified);
    const r: any = await new CancerRegistryService(prisma, {} as never).update('cr-1', { primarySite: 'C50', diagnosisDate: '2026-06-01' });
    expect(prisma.cancerRegistry.updateMany).not.toHaveBeenCalled();
    expect(r.verificationReset).toBeNull();
  });

  it('확인 전(REGISTERED) 건은 조건부 해제가 0건 → verificationReset null', async () => {
    const prisma = regPrisma({ ...verified, status: 'REGISTERED', verifiedAt: null, verifiedBy: null }, 0);
    const r: any = await new CancerRegistryService(prisma, {} as never).update('cr-1', { ajccStage: 'III' });
    expect(r.verificationReset).toBeNull();
  });
});
