import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { BedTransferService } from '../../src/modules/bed-transfer/bed-transfer.service';

/**
 * 병동 간 전동 요청 → 수락 — 2026-09-30.
 *  · 요청: 사유 필수 · 재원 중만 · 같은 병동이면 400(즉시 이동으로) · 병상은 그 병동 것 · 열린 요청 하나(부분 유니크 → 409)
 *  · 수락: 받는 병동 병상 · 같은 트랜잭션에서 조건부 전이 + 전실 정본 · 이미 닫혔으면 409(이동 없음)
 *  · 거절 사유 필수 · 취소는 요청자·관리자 · 입원 종료 → 열린 요청 저절로 닫힘(판정자 없음)
 */
function mk(o: { admission?: unknown; req?: unknown; doneCount?: number; bedWard?: string; createErr?: unknown } = {}) {
  const writes: string[] = [];
  const req = { id: 't1', admissionId: 'a1', patientId: 'p1', fromBedId: 'b1', targetWardId: 'w2', targetBedId: null, status: 'REQUESTED', requestedById: 'n1', ...(o.req as object ?? {}) };
  const prisma: Record<string, any> = {
    admission: {
      findUnique: vi.fn(async () => (o.admission === undefined ? { id: 'a1', patientId: 'p1', bedId: 'b1', status: 'ADMITTED', bed: { wardId: 'w1' } } : o.admission)),
      update: vi.fn(async () => { writes.push('admission'); return { bedId: 'b9', bed: { ward: { name: '7병동' } } }; }),
    },
    ward: { findUnique: vi.fn(async () => ({ id: 'w2', isActive: true })) },
    bed: {
      findUnique: vi.fn(async () => ({ wardId: o.bedWard ?? 'w2' })),
      findMany: vi.fn(async () => [{ id: 'b1', wardId: 'w1' }, { id: 'b9', wardId: o.bedWard ?? 'w2' }]),
      updateMany: vi.fn(async (a: { where: { status?: string } }) => { writes.push(a.where.status === 'AVAILABLE' ? 'bedClaim' : 'bedRelease'); return { count: 1 }; }),
    },
    bedAssignment: { updateMany: vi.fn(async () => { writes.push('assignClose'); }), create: vi.fn(async () => { writes.push('assignNew'); }) },
    nursePatientAssignment: { updateMany: vi.fn(async () => { writes.push('nurseRelease'); return { count: 1 }; }) },
    bedTransferRequest: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { if (o.createErr) throw o.createErr; return { id: 't1', ...data }; }),
      findUnique: vi.fn(async () => req),
      // DB 처럼 — 이미 닫힌 요청이면 조건부(status: REQUESTED) 쓰기만 0건
      updateMany: vi.fn(async (a: { where: Record<string, unknown> }) => { writes.push('request'); return { count: a.where.status === 'REQUESTED' ? (o.doneCount ?? 1) : 1 }; }),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const notify = vi.fn(async () => undefined);
  return { svc: new BedTransferService(prisma as never, undefined, { notify } as never), prisma, writes, notify };
}
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;
const dto = (over: Record<string, unknown> = {}) => ({ admissionId: 'a1', targetWardId: 'w2', reason: ' 내과 전과 ', ...over }) as never;

describe('요청', () => {
  it('원 병상·받는 병동·사유(다듬음)·요청자를 남긴다', async () => {
    const { svc, prisma } = mk();
    await svc.create(dto(), 'n1');
    expect(prisma.bedTransferRequest.create.mock.calls[0][0].data).toMatchObject({ admissionId: 'a1', patientId: 'p1', fromBedId: 'b1', targetWardId: 'w2', reason: '내과 전과', requestedById: 'n1', targetBedId: null });
  });
  it('사유 없음 400 · 같은 병동 400 · 병상이 다른 병동 400 · 재원 아님 409 · 열린 요청 중복 409', async () => {
    await expect(mk().svc.create(dto({ reason: ' ' }), 'n1')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_REASON_REQUIRED');
    await expect(mk().svc.create(dto({ targetWardId: 'w1' }), 'n1')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_SAME_WARD');
    await expect(mk({ bedWard: 'w3' }).svc.create(dto({ targetBedId: '11111111-1111-4111-8111-111111111111' }), 'n1')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_BED_WARD_MISMATCH');
    await expect(mk({ admission: { id: 'a1', status: 'DISCHARGED', bed: { wardId: 'w1' } } }).svc.create(dto(), 'n1')).rejects.toSatisfy((e) => code(e) === 'ADMISSION_NOT_ACTIVE');
    const dup = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    await expect(mk({ createErr: dup }).svc.create(dto(), 'n1')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_ALREADY_OPEN');
  });
});

describe('수락', () => {
  it('조건부 전이 + 전실 정본을 같은 트랜잭션에서 · 요청자에게 알림', async () => {
    const { svc, prisma, writes, notify } = mk();
    const r = await svc.accept('t1', 'b9', 'n2', '7-2 로');
    expect(writes).toEqual(['request', 'bedClaim', 'bedRelease', 'assignClose', 'assignNew', 'nurseRelease', 'admission']);
    expect(prisma.bedTransferRequest.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 't1', status: 'REQUESTED' }, data: { status: 'ACCEPTED', decidedById: 'n2', acceptedBedId: 'b9' } });
    expect(prisma.bedAssignment.create.mock.calls[0][0].data).toMatchObject({ reason: 'TRANSFER_REQUEST', bedId: 'b9' });
    expect(notify).toHaveBeenCalledWith('n1', expect.objectContaining({ type: 'BED_TRANSFER_DECIDED', refId: 't1' }));
    expect(r.requesterNotice).toEqual({ attempted: true, sent: true, reason: null });
  });
  it('🔴 동시에 닫혔으면 409 — 병상 이동은 일어나지 않는다(트랜잭션 안 조건부 전이가 먼저)', async () => {
    const { svc, writes } = mk({ doneCount: 0 });
    await expect(svc.accept('t1', 'b9', 'n2')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_NOT_OPEN');
    expect(writes).toEqual(['request']);
  });
  it('받는 병동 병상이 아니면 400 · 입원이 끝났으면 409 · 이미 처리된 요청 409', async () => {
    await expect(mk({ bedWard: 'w9' }).svc.accept('t1', 'b9', 'n2')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_BED_WARD_MISMATCH');
    await expect(mk({ admission: { id: 'a1', status: 'DISCHARGED', bedId: 'b1' } }).svc.accept('t1', 'b9', 'n2')).rejects.toSatisfy((e) => code(e) === 'ADMISSION_NOT_ACTIVE');
    await expect(mk({ req: { status: 'REJECTED' } }).svc.accept('t1', 'b9', 'n2')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_NOT_OPEN');
  });
});

describe('거절·취소·입원 종료', () => {
  it('거절 사유 필수 · 취소는 요청자·관리자만', async () => {
    const a = mk();
    await expect(a.svc.reject('t1', 'n2', ' ')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_REJECT_REASON_REQUIRED');
    expect(a.prisma.bedTransferRequest.updateMany).not.toHaveBeenCalled();
    await mk().svc.reject('t1', 'n2', '격리실 없음');
    await expect(mk().svc.cancel('t1', 'n9', 'NURSE')).rejects.toSatisfy((e) => code(e) === 'BED_TRANSFER_CANCEL_NOT_ALLOWED');
    await expect(mk().svc.cancel('t1', 'n9', 'ADMIN')).resolves.toBeTruthy();
    await expect(mk().svc.cancel('t1', 'n1', 'NURSE')).resolves.toBeTruthy();
  });
  it('입원이 끝나면 열린 요청만 닫는다 — 판정자 없이(사람이 거절한 것이 아니다)', async () => {
    const { svc, prisma } = mk();
    await svc.onAdmissionClosed({ admissionId: 'a1' });
    const arg = prisma.bedTransferRequest.updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(arg.where).toEqual({ admissionId: 'a1', status: 'REQUESTED' });
    expect(arg.data).toMatchObject({ status: 'CANCELLED', decisionNote: 'ADMISSION_CLOSED' });
    expect(arg.data).not.toHaveProperty('decidedById');
  });
});
