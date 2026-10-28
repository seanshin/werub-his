/**
 * 2026-10-09
 *  · 🔴 익명 보고(보고자 null)를 전담인력에게도 404 로 막던 조회 — 전담인력은 열고, 비전담은 여전히 본인 것만
 *  · KOPS 직접 보고 기록 — 사람이 적은 번호·시각 · 한 번(조건부) · 사고 이전·미래 시각 거부 · 상태는 MANUAL_REPORTED(송신 implemented:false 유지)
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { kopsReportStatusOf, KOPS_REPORT_STATUS } from '@hospital-run/shared';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';

const svcWith = (row: unknown, updateCount = 1) => {
  const prisma = { safetyIncident: { findUnique: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: updateCount })) } };
  return { svc: new PatientSafetyService(prisma as never, { emit: vi.fn() } as never), prisma };
};
const anon = { id: 'n1', reporterId: null, type: 'FALL', occurredAt: new Date('2026-10-01T00:00:00Z'), kopsManualRef: null, kopsManualAt: null };

describe('익명 보고 조회', () => {
  it('🔴 전담인력은 익명 사고를 연다', async () => {
    const r = await svcWith(anon).svc.getIncidentById('n1', { userId: 'u1', canReviewAll: true });
    expect(r).toMatchObject({ id: 'n1', externalReport: KOPS_REPORT_STATUS });
  });
  it('대조군 — 비전담은 익명 사고도 남의 사고도 404', async () => {
    await expect(svcWith(anon).svc.getIncidentById('n1', { userId: 'u1', canReviewAll: false })).rejects.toThrow(NotFoundException);
    await expect(svcWith({ ...anon, reporterId: 'u2' }).svc.getIncidentById('n1', { userId: 'u1', canReviewAll: false })).rejects.toThrow(NotFoundException);
  });
});

describe('KOPS 직접 보고 기록', () => {
  it('🔴 번호 없음·사고 이전·미래 시각은 거부', async () => {
    const { svc } = svcWith(anon);
    await expect(svc.recordKopsManual('n1', { ref: '', reportedAt: '2026-10-02T00:00:00Z' }, 'u1')).rejects.toThrow(BadRequestException);
    await expect(svc.recordKopsManual('n1', { ref: 'K-2026-001', reportedAt: '2026-09-30T00:00:00Z' }, 'u1')).rejects.toThrow(BadRequestException);
    await expect(svc.recordKopsManual('n1', { ref: 'K-2026-001', reportedAt: new Date(Date.now() + 3_600_000).toISOString() }, 'u1')).rejects.toThrow(BadRequestException);
  });
  it('🔴 한 번만(조건부) — 이미 있으면 409', async () => {
    const { svc, prisma } = svcWith(anon, 0);
    await expect(svc.recordKopsManual('n1', { ref: 'K-2026-001', reportedAt: '2026-10-02T00:00:00Z' }, 'u1')).rejects.toThrow(ConflictException);
    expect((prisma.safetyIncident.updateMany.mock.calls as unknown as Array<[{ where: unknown }]>)[0][0].where).toEqual({ id: 'n1', kopsManualRef: null });
  });
  it('🔴 상태는 MANUAL_REPORTED · 송신은 여전히 미구현(implemented:false)', () => {
    const st = kopsReportStatusOf({ kopsManualRef: 'K-2026-001', kopsManualAt: '2026-10-02T00:00:00Z' });
    expect(st).toMatchObject({ status: 'MANUAL_REPORTED', implemented: false, ref: 'K-2026-001' });
    expect(kopsReportStatusOf({})).toBe(KOPS_REPORT_STATUS);
  });
});
