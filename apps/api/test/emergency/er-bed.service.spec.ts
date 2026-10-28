import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErBedService } from '../../src/modules/emergency/er-bed.service';

/** ER 베드 보드 P0 — 배정/이동/해제 tx·경합 409·상태 가드·유령 점유 판정 */

function makePrisma() {
  return {
    ward: { findMany: vi.fn().mockResolvedValue([{ id: 'ward-er' }]) },
    bed: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    emergencyVisit: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    emergencyReassessment: { findMany: vi.fn().mockResolvedValue([]) },
    patientContact: { groupBy: vi.fn().mockResolvedValue([]) },
    emergencyArrivalNote: { groupBy: vi.fn().mockResolvedValue([]) },
    emergencyBedAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

const ACTIVE_VISIT = { id: 'v1', patientId: 'p1', status: 'TRIAGED', triageLevel: 'LEVEL_3' };
const ER_BED = { id: 'b1', roomNumber: 'ACUTE', bedNumber: '1', status: 'AVAILABLE', ward: { type: 'EMERGENCY' } };

describe('ErBedService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ErBedService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ErBedService(prisma as never, undefined);
  });

  it('배정: 활성 방문+가용 ER 베드 → tx 3연산(이력·OCCUPIED·캐시)', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue(ACTIVE_VISIT);
    prisma.bed.findUnique.mockResolvedValue(ER_BED);
    const r = await svc.assign('v1', 'b1', 'u1');
    expect(r.assigned).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.emergencyBedAssignment.create).toHaveBeenCalledWith({ data: { visitId: 'v1', bedId: 'b1', assignedBy: 'u1' } });
  });

  it('배정: 일반 병동 베드는 404 — ER 스코프 밖', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue(ACTIVE_VISIT);
    prisma.bed.findUnique.mockResolvedValue({ ...ER_BED, ward: { type: 'GENERAL' } });
    await expect(svc.assign('v1', 'b1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('배정: 종료(COMPLETED) 방문 거부', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue({ ...ACTIVE_VISIT, status: 'COMPLETED' });
    prisma.bed.findUnique.mockResolvedValue(ER_BED);
    await expect(svc.assign('v1', 'b1', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('배정: 점유 베드 409', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue(ACTIVE_VISIT);
    prisma.bed.findUnique.mockResolvedValue({ ...ER_BED, status: 'OCCUPIED' });
    await expect(svc.assign('v1', 'b1', 'u1')).rejects.toThrow(ConflictException);
  });

  it('배정: 동시 경합(P2002 부분 유니크)은 409 로 번역 — check-then-act 가 아니라 인덱스가 최종 방어', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue(ACTIVE_VISIT);
    prisma.bed.findUnique.mockResolvedValue(ER_BED);
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(svc.assign('v1', 'b1', 'u1')).rejects.toThrow(ConflictException);
  });

  it('이동: 원 베드 CLEANING + 신규 OCCUPIED 원자화', async () => {
    prisma.emergencyBedAssignment.findFirst.mockResolvedValue({ id: 'a1', bedId: 'b1' });
    prisma.emergencyVisit.findUnique.mockResolvedValue({ patientId: 'p1' });
    prisma.bed.findUnique.mockResolvedValue({ ...ER_BED, id: 'b2' });
    const r = await svc.move('v1', 'b2', 'u1');
    expect(r.moved).toBe(true);
    expect(prisma.bed.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { status: 'CLEANING' } });
    expect(prisma.bed.update).toHaveBeenCalledWith({ where: { id: 'b2' }, data: { status: 'OCCUPIED' } });
  });

  it('이동: 미배정 방문은 400 안내(배정을 사용)', async () => {
    prisma.emergencyBedAssignment.findFirst.mockResolvedValue(null);
    await expect(svc.move('v1', 'b2', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('해제: 이력 봉인(releasedAt·사유)+베드 CLEANING+캐시 null', async () => {
    prisma.emergencyBedAssignment.findFirst.mockResolvedValue({ id: 'a1', bedId: 'b1' });
    prisma.emergencyVisit.findUnique.mockResolvedValue({ patientId: 'p1' });
    const r = await svc.release('v1', 'u1', 'MANUAL');
    expect(r.released).toBe(true);
    expect(prisma.emergencyVisit.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { bedId: null } });
  });

  it('상태 전환: 활성 배정이 있는 베드는 409(점유 중)', async () => {
    prisma.bed.findUnique.mockResolvedValue(ER_BED);
    prisma.emergencyBedAssignment.findFirst.mockResolvedValue({ id: 'a1' });
    await expect(svc.setBedStatus('b1', 'CLEANING')).rejects.toThrow(ConflictException);
  });

  it('보드: OCCUPIED 인데 활성 배정 없음 → ghost 판정(자동 훅 실패 잔재 노출)', async () => {
    prisma.bed.findMany.mockResolvedValue([
      { id: 'b1', roomNumber: 'GEN', bedNumber: '1', status: 'OCCUPIED' },
      { id: 'b2', roomNumber: 'GEN', bedNumber: '2', status: 'AVAILABLE' },
    ]);
    const board = await svc.getBoard();
    expect(board.beds.find((b) => b.id === 'b1')?.ghost).toBe(true);
    expect(board.beds.find((b) => b.id === 'b2')?.ghost).toBe(false);
  });

  it('🔴 보드: 신원미상(EMG-)만 도착 기록 수를 센다 — 센 0 은 0 · 세지 않은 환자는 null(0 으로 그리지 않는다)', async () => {
    prisma.emergencyVisit.findMany.mockResolvedValue([
      { id: 'v1', patientId: 'p1', status: 'TRIAGED', triageLevel: 'LEVEL_2', arrivalAt: new Date(), patient: { mrn: 'EMG-260929-AAAA' } },
      { id: 'v2', patientId: 'p2', status: 'TRIAGED', triageLevel: 'LEVEL_3', arrivalAt: new Date(), patient: { mrn: 'EMG-260929-BBBB' } },
      { id: 'v3', patientId: 'p3', status: 'TRIAGED', triageLevel: 'LEVEL_3', arrivalAt: new Date(), patient: { mrn: 'M-0001' } },
    ]);
    prisma.emergencyArrivalNote.groupBy.mockResolvedValue([{ patientId: 'p2', _count: 2 }]);
    const board = await svc.getBoard();
    const by = Object.fromEntries(board.unassigned.map((v: { patientId: string; arrivalNoteCount: number | null }) => [v.patientId, v.arrivalNoteCount]));
    expect(by).toEqual({ p1: 0, p2: 2, p3: null });
    expect(prisma.emergencyArrivalNote.groupBy.mock.calls[0][0].where).toEqual({ patientId: { in: ['p1', 'p2'] } });
  });

  it('releaseByVisit(P1 훅): 활성 배정 없으면 false 로 조용히 — 워크플로를 막지 않는다', async () => {
    prisma.emergencyBedAssignment.findFirst.mockResolvedValue(null);
    await expect(svc.releaseByVisit('v1', 'DISPOSITION')).resolves.toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('releaseByVisit(P1 훅): 배정 있으면 해제+CLEANING+캐시 null·실패해도 던지지 않는다', async () => {
    prisma.emergencyBedAssignment.findFirst.mockResolvedValue({ id: 'a1', bedId: 'b1' });
    await expect(svc.releaseByVisit('v1', 'AUTO_CLOSE')).resolves.toBe(true);
    expect(prisma.bed.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { status: 'CLEANING' } });
    prisma.emergencyBedAssignment.findFirst.mockRejectedValue(new Error('down'));
    await expect(svc.releaseByVisit('v1', 'AUTO_CLOSE')).resolves.toBe(false);
  });

  it('보드: visit.bedId 캐시가 아니라 활성 assignment 기준 — 캐시 불일치여도 assignment 가 이긴다', async () => {
    prisma.bed.findMany.mockResolvedValue([{ id: 'b1', roomNumber: 'GEN', bedNumber: '1', status: 'OCCUPIED' }]);
    prisma.emergencyVisit.findMany.mockResolvedValue([{ ...ACTIVE_VISIT, bedId: null, arrivalAt: new Date(), patient: {} }]);
    prisma.emergencyBedAssignment.findMany.mockResolvedValue([{ bedId: 'b1', visitId: 'v1', assignedAt: new Date() }]);
    const board = await svc.getBoard();
    expect(board.beds[0].visit?.id).toBe('v1');
    expect(board.unassigned).toHaveLength(0);
  });
});
