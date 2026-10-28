import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CssdService } from '../../src/modules/cssd/cssd.service';
import { NotFoundException } from '@nestjs/common';

describe('CssdService', () => {
  let service: CssdService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      instrumentSet: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      sterilizationLog: { create: vi.fn(), findMany: vi.fn() },
    };
    // 이력 기록과 상태 갱신은 한 트랜잭션(F3) — 정본의 실제 호출 모양
    mockPrisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
    service = new CssdService(mockPrisma);
  });

  describe('getAllSets', () => {
    it('should return all instrument sets ordered by name', async () => {
      const mockSets = [
        { id: 'set-1', name: 'General Surgery Kit', status: 'STERILE' },
        { id: 'set-2', name: 'Orthopedic Kit', status: 'DIRTY' },
      ];

      mockPrisma.instrumentSet.findMany.mockResolvedValue(mockSets);

      const result = await service.getAllSets();

      expect(result).toEqual(mockSets);
      expect(mockPrisma.instrumentSet.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
      });
    });

    it('should filter sets by status', async () => {
      const mockSets = [{ id: 'set-1', status: 'STERILE' }];

      mockPrisma.instrumentSet.findMany.mockResolvedValue(mockSets);

      const result = await service.getAllSets('STERILE');

      expect(mockPrisma.instrumentSet.findMany).toHaveBeenCalledWith({
        where: { status: 'STERILE' },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty list if no sets', async () => {
      mockPrisma.instrumentSet.findMany.mockResolvedValue([]);

      const result = await service.getAllSets();

      expect(result).toEqual([]);
    });

    it('should order sets by name ascending', async () => {
      const mockSets = [
        { id: 'set-1', name: 'Cardio Kit' },
        { id: 'set-2', name: 'Ortho Kit' },
        { id: 'set-3', name: 'General Kit' },
      ];

      mockPrisma.instrumentSet.findMany.mockResolvedValue(mockSets);

      await service.getAllSets();

      expect(mockPrisma.instrumentSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });
  });

  describe('createSet', () => {
    it('should create instrument set with contents', async () => {
      const data = {
        name: 'General Surgery Kit',
        contents: {
          instruments: [
            { name: 'Scalpel', quantity: 2 },
            { name: 'Scissors', quantity: 3 },
          ],
        },
        location: 'OR-1',
      };

      const mockCreated = { id: 'set-1', ...data, status: 'DIRTY' };

      mockPrisma.instrumentSet.create.mockResolvedValue(mockCreated);

      const result = await service.createSet(data);

      expect(result.id).toBe('set-1');
      expect(result.contents.instruments).toHaveLength(2);
    });

    it('should handle optional location', async () => {
      const data = {
        name: 'Kit',
        contents: {},
      };

      mockPrisma.instrumentSet.create.mockResolvedValue({ id: 'set-1', ...data });

      const result = await service.createSet(data);

      expect(result.id).toBe('set-1');
    });

    it('should store complex JSON contents', async () => {
      const data = {
        name: 'Complex Kit',
        contents: {
          instruments: [
            { id: 'instr-1', name: 'Knife', type: 'Cutting', sterilizable: true },
          ],
          packaging: { type: 'Surgical Pack', material: 'SMS' },
        },
      };

      mockPrisma.instrumentSet.create.mockResolvedValue({ id: 'set-1', ...data });

      const result = await service.createSet(data);

      expect(result.contents.packaging.material).toBe('SMS');
    });
  });

  describe('updateStatus', () => {
    it('should update status and create log', async () => {
      const mockSet = { id: 'set-1', status: 'DIRTY', name: 'Kit' };
      const mockUpdated = { ...mockSet, status: 'WASHING' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue(mockUpdated);

      const result = await service.updateStatus('set-1', 'WASHING', 'user-1', 'Washing started');

      expect(result.status).toBe('WASHING');
      expect(mockPrisma.sterilizationLog.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if set not found', async () => {
      mockPrisma.instrumentSet.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus('non-existent', 'WASHING', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should set expiry when status is STERILE', async () => {
      const mockSet = { id: 'set-1', status: 'STERILIZING' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue({
        ...mockSet,
        status: 'STERILE',
        lastSterilizedAt: new Date(),
        expiresAt: new Date(),
      });

      const result = await service.updateStatus('set-1', 'STERILE', 'user-1');

      expect(mockPrisma.instrumentSet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'STERILE',
            lastSterilizedAt: expect.any(Date),
            expiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should set 30-day expiry for STERILE status', async () => {
      const mockSet = { id: 'set-1', status: 'STERILIZING' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });

      const beforeCall = new Date();
      const expectedExpiry = new Date();
      expectedExpiry.setDate(expectedExpiry.getDate() + 30);

      mockPrisma.instrumentSet.update.mockResolvedValue({
        ...mockSet,
        status: 'STERILE',
        expiresAt: expectedExpiry,
      });

      await service.updateStatus('set-1', 'STERILE', 'user-1');

      const callArgs = mockPrisma.instrumentSet.update.mock.calls[0][0];
      const expiryDate = callArgs.data.expiresAt;

      // Check expiry is approximately 30 days from now
      const daysDiff = Math.floor((expiryDate - beforeCall) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBeGreaterThanOrEqual(29);
      expect(daysDiff).toBeLessThanOrEqual(31);
    });

    it('should create sterilization log with userId', async () => {
      const mockSet = { id: 'set-1', status: 'DIRTY' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue(mockSet);

      await service.updateStatus('set-1', 'WASHING', 'user-123', 'Starting wash');

      expect(mockPrisma.sterilizationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            performedBy: 'user-123',
            notes: 'Starting wash',
          }),
        }),
      );
    });

    it('should map status to Korean action in log', async () => {
      const mockSet = { id: 'set-1', status: 'STERILIZING' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue(mockSet);

      await service.updateStatus('set-1', 'STERILE', 'user-1');

      expect(mockPrisma.sterilizationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: '멸균 완료',
          }),
        }),
      );
    });
  });

  describe('getLogs', () => {
    it('should return last 50 sterilization logs', async () => {
      const mockLogs = [
        { id: 'log-1', action: '반납', createdAt: new Date('2026-05-14') },
        { id: 'log-2', action: '세척', createdAt: new Date('2026-05-13') },
      ];

      mockPrisma.sterilizationLog.findMany.mockResolvedValue(mockLogs);

      const result = await service.getLogs('set-1');

      expect(result).toEqual(mockLogs);
      expect(mockPrisma.sterilizationLog.findMany).toHaveBeenCalledWith({
        where: { instrumentSetId: 'set-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('should order logs by creation date descending', async () => {
      mockPrisma.sterilizationLog.findMany.mockResolvedValue([]);

      await service.getLogs('set-1');

      expect(mockPrisma.sterilizationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should limit to 50 logs', async () => {
      mockPrisma.sterilizationLog.findMany.mockResolvedValue([]);

      await service.getLogs('set-1');

      expect(mockPrisma.sterilizationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );
    });

    it('should return empty list if no logs', async () => {
      mockPrisma.sterilizationLog.findMany.mockResolvedValue([]);

      const result = await service.getLogs('set-1');

      expect(result).toEqual([]);
    });
  });

  describe('getExpiringSoon', () => {
    it('should return STERILE sets expiring within 3 days', async () => {
      const mockSets = [
        {
          id: 'set-1',
          name: 'Kit-1',
          status: 'STERILE',
          expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      ];

      mockPrisma.instrumentSet.findMany.mockResolvedValue(mockSets);

      const result = await service.getExpiringSoon();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('STERILE');
    });

    it('should return empty list if no sets expiring soon', async () => {
      mockPrisma.instrumentSet.findMany.mockResolvedValue([]);

      const result = await service.getExpiringSoon();

      expect(result).toEqual([]);
    });

    it('should only return STERILE sets', async () => {
      mockPrisma.instrumentSet.findMany.mockResolvedValue([]);

      await service.getExpiringSoon();

      expect(mockPrisma.instrumentSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'STERILE',
          }),
        }),
      );
    });

    it('should check expiry within next 3 days', async () => {
      mockPrisma.instrumentSet.findMany.mockResolvedValue([]);

      const beforeCall = new Date();
      await service.getExpiringSoon();
      const afterCall = new Date();

      const callArgs = mockPrisma.instrumentSet.findMany.mock.calls[0][0];
      const threeDaysFromCall = new Date((beforeCall.getTime() + afterCall.getTime()) / 2);
      threeDaysFromCall.setDate(threeDaysFromCall.getDate() + 3);

      // Verify call included lte condition for expiry
      expect(callArgs.where.expiresAt).toHaveProperty('lte');
    });
  });

  describe('Status Transitions', () => {
    it('should support DIRTY → WASHING transition', async () => {
      const mockSet = { id: 'set-1', status: 'DIRTY' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue({ ...mockSet, status: 'WASHING' });

      const result = await service.updateStatus('set-1', 'WASHING', 'user-1');

      expect(result.status).toBe('WASHING');
    });

    it('should support WASHING → STERILIZING transition', async () => {
      const mockSet = { id: 'set-1', status: 'WASHING' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue({ ...mockSet, status: 'STERILIZING' });

      const result = await service.updateStatus('set-1', 'STERILIZING', 'user-1');

      expect(result.status).toBe('STERILIZING');
    });

    it('should support STERILIZING → STERILE transition', async () => {
      const mockSet = { id: 'set-1', status: 'STERILIZING' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue({ ...mockSet, status: 'STERILE' });

      const result = await service.updateStatus('set-1', 'STERILE', 'user-1');

      expect(result.status).toBe('STERILE');
    });

    it('should support STERILE → IN_USE transition', async () => {
      const mockSet = { id: 'set-1', status: 'STERILE' };

      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue({ ...mockSet, status: 'IN_USE' });

      const result = await service.updateStatus('set-1', 'IN_USE', 'user-1');

      expect(result.status).toBe('IN_USE');
    });
  });

  describe('Error Handling', () => {
    it('should throw NotFoundException with message', async () => {
      mockPrisma.instrumentSet.findUnique.mockResolvedValue(null);

      try {
        await service.updateStatus('missing', 'WASHING', 'user-1');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Instrument set not found');
      }
    });
  });

  describe('CSSD Workflow', () => {
    it('should support complete sterilization workflow', async () => {
      const setId = 'set-1';

      // Create set
      const createData = { name: 'OR Kit', contents: { items: [] } };
      mockPrisma.instrumentSet.create.mockResolvedValue({ id: setId, ...createData, status: 'DIRTY' });

      const created = await service.createSet(createData);
      expect(created.id).toBe(setId);

      // Update status through workflow
      const mockSet = { id: setId, status: 'DIRTY' };
      mockPrisma.instrumentSet.findUnique.mockResolvedValue(mockSet);
      mockPrisma.sterilizationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.instrumentSet.update.mockResolvedValue({ ...mockSet, status: 'WASHING' });

      const washed = await service.updateStatus(setId, 'WASHING', 'user-1');
      expect(washed.status).toBe('WASHING');

      // Get logs
      const mockLogs = [{ id: 'log-1', action: '세척' }];
      mockPrisma.sterilizationLog.findMany.mockResolvedValue(mockLogs);

      const logs = await service.getLogs(setId);
      expect(logs).toHaveLength(1);
    });
  });
});
