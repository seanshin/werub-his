import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ControlledSubstanceStockService } from '../../src/modules/controlled-substance/controlled-substance-stock.service';

describe('ControlledSubstanceStockService — 영속재고 수불부', () => {
  let service: ControlledSubstanceStockService;
  let mockPrisma: any;
  let config: any;
  let events: any;
  const D = (n: number) => new Prisma.Decimal(n);

  beforeEach(() => {
    mockPrisma = {
      controlledSubstanceStock: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      controlledSubstanceStockTxn: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'txn-1', ...data })),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.$queryRaw = vi.fn().mockResolvedValue([{ id: 's1' }]); // FOR UPDATE 행잠금
    config = { get: vi.fn().mockResolvedValue('BLOCK') };
    events = { emit: vi.fn() };
    service = new ControlledSubstanceStockService(mockPrisma, config, events);
  });

  describe('receive', () => {
    it('입고 시 잔량 증가·RECEIPT 거래', async () => {
      mockPrisma.controlledSubstanceStock.upsert.mockResolvedValue({ id: 's1', balance: D(10), drugName: '모르핀' });
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(10), drugName: '모르핀' });
      const res = await service.receive({ drugCode: 'M1', drugName: '모르핀', deaSchedule: 'II', unit: 'amp', quantity: 5 }, 'u1');
      expect(res.txn.type).toBe('RECEIPT');
      expect(res.txn.balanceAfter.toNumber()).toBe(15);
    });
  });

  describe('issue (재고 부족 차단)', () => {
    it('잔량 충분 시 불출·차감', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(10), drugName: '모르핀' });
      const res = await service.issue('s1', 3, 'u1');
      expect(res.txn.type).toBe('ISSUE');
      expect(res.txn.balanceAfter.toNumber()).toBe(7);
    });

    it('[BLOCK] 잔량 초과 불출 거부', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(2), drugName: '모르핀' });
      await expect(service.issue('s1', 5, 'u1')).rejects.toThrow(ConflictException);
    });

    it('[OFF] 게이트 OFF면 음수 허용', async () => {
      config.get.mockResolvedValue('OFF');
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(2), drugName: '모르핀' });
      const res = await service.issue('s1', 5, 'u1');
      expect(res.txn.balanceAfter.toNumber()).toBe(-3);
    });

    it('[FOR UPDATE] 이동 시 행잠금 쿼리 호출', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(10), drugName: '모르핀' });
      await service.issue('s1', 3, 'u1');
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('issueByDrug (조제 자동연동·force)', () => {
    it('재고 미등록이면 null(조제 비차단)', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue(null);
      const res = await service.issueByDrug('M1', 'PHARMACY', 3, 'u1', 'log-1');
      expect(res).toBeNull();
    });
    it('[P1] 재고 부족이어도 force로 반영(음수)·유용 경보(BLOCK 삼키지 않음)', async () => {
      config.get.mockResolvedValue('BLOCK');
      // findUnique: 1st = drugCode 조회, 2nd = move 내부(tx)
      mockPrisma.controlledSubstanceStock.findUnique
        .mockResolvedValueOnce({ id: 's1', balance: D(2), drugName: '모르핀', deaSchedule: 'II', location: 'PHARMACY' })
        .mockResolvedValue({ id: 's1', balance: D(2), drugName: '모르핀', deaSchedule: 'II', location: 'PHARMACY' });
      const res = await service.issueByDrug('M1', 'PHARMACY', 5, 'u1', 'log-1');
      expect(res!.txn.balanceAfter.toNumber()).toBe(-3);
      expect(events.emit).toHaveBeenCalledWith('controlled.discrepancy', expect.objectContaining({ stockId: 's1' }));
    });
  });

  describe('adjust (증인 필수)', () => {
    it('증인 없으면 거부', async () => {
      await expect(service.adjust('s1', -5, '사유', 'u1')).rejects.toThrow(BadRequestException);
    });
    it('증인=수행자면 거부', async () => {
      await expect(service.adjust('s1', -5, '사유', 'u1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('waste (증인 필수)', () => {
    it('증인 없으면 거부', async () => {
      await expect(service.waste('s1', 1, 'u1', {})).rejects.toThrow(BadRequestException);
    });
    it('증인=수행자면 거부', async () => {
      await expect(service.waste('s1', 1, 'u1', { witnessedBy: 'u1' })).rejects.toThrow(BadRequestException);
    });
    it('유효 증인 시 폐기·차감', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(5), drugName: '모르핀' });
      const res = await service.waste('s1', 2, 'u1', { witnessedBy: 'u2', reason: '파손' });
      expect(res.txn.type).toBe('WASTE');
      expect(res.txn.balanceAfter.toNumber()).toBe(3);
      expect(res.txn.witnessedBy).toBe('u2');
    });
  });

  describe('[W8] 조회 — 화면이 "누가·무엇을" 말할 수 있어야 한다', () => {
    const txn = { id: 't1', stockId: 's1', type: 'COUNT', quantity: D(-2), balanceBefore: D(10), balanceAfter: D(8), discrepancy: D(-2), performedBy: 'u1', witnessedBy: 'u2', occurredAt: new Date() };

    beforeEach(() => {
      mockPrisma.user = { findMany: vi.fn().mockResolvedValue([
        { id: 'u1', familyName: '김', givenName: '약사', role: 'PHARMACIST' },
        { id: 'u2', familyName: '이', givenName: '간호', role: 'NURSE' },
      ]) };
    });

    it('유용 의심 목록은 약품(stock)과 수행자·증인 성명을 함께 준다', async () => {
      mockPrisma.controlledSubstanceStockTxn.findMany.mockResolvedValue([{ ...txn, stock: { id: 's1', drugName: '모르핀', deaSchedule: 'II', location: 'PHARMACY', unit: 'amp' } }]);
      const rows = await service.getDiscrepancies();
      expect(mockPrisma.controlledSubstanceStockTxn.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { type: 'COUNT', discrepancy: { not: 0 } },
        include: expect.objectContaining({ stock: expect.anything() }),
      }));
      expect(rows[0].stock?.drugName).toBe('모르핀');
      expect(rows[0].performer).toMatchObject({ familyName: '김' });
      expect(rows[0].witness).toMatchObject({ familyName: '이' });
    });

    it('수불 이력도 수행자 성명을 채운다(증인 없으면 null — 지어내지 않는다)', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', drugName: '모르핀' });
      mockPrisma.controlledSubstanceStockTxn.findMany.mockResolvedValue([{ ...txn, type: 'ISSUE', witnessedBy: null }]);
      const { txns } = await service.getLedger('s1');
      expect(txns[0].performer).toMatchObject({ givenName: '약사' });
      expect(txns[0].witness).toBeNull();
    });
  });

  describe('count (실사 대사·유용 탐지)', () => {
    it('일치 시 불일치 이벤트 없음', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(10), drugName: '모르핀', deaSchedule: 'II', location: 'PHARMACY' });
      const res = await service.count('s1', 10, 'u1');
      expect(res.mismatch).toBe(false);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('불일치인데 증인 없으면 거부', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(10), drugName: '모르핀', deaSchedule: 'II', location: 'PHARMACY' });
      await expect(service.count('s1', 8, 'u1')).rejects.toThrow(BadRequestException);
    });

    it('불일치+증인 시 유용 경보·장부를 실사값으로 확정', async () => {
      mockPrisma.controlledSubstanceStock.findUnique.mockResolvedValue({ id: 's1', balance: D(10), drugName: '모르핀', deaSchedule: 'II', location: 'PHARMACY' });
      const res = await service.count('s1', 8, 'u1', { witnessedBy: 'u2' });
      expect(res.mismatch).toBe(true);
      expect(res.discrepancy).toBe(-2);
      expect(mockPrisma.controlledSubstanceStock.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ balance: expect.anything(), lastCountedAt: expect.any(Date) }),
      }));
      expect(events.emit).toHaveBeenCalledWith('controlled.discrepancy', expect.objectContaining({ stockId: 's1', discrepancy: '-2' }));
    });
  });
});
