import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BotsService } from '../../src/modules/bots/bots.service';
import { NotFoundException } from '@nestjs/common';

describe('BotsService', () => {
  let service: BotsService;
  let mockPrisma: any;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockPrisma = {
      bot: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      botExecution: { create: vi.fn() },
    };
    service = new BotsService(mockPrisma);
    (service as any).logger = mockLogger;
  });

  describe('findAll', () => {
    it('should return all bots ordered by name', async () => {
      const mockBots = [
        { id: 'bot-1', name: 'Auto Diagnosis', status: 'ACTIVE' },
        { id: 'bot-2', name: 'Notification', status: 'ACTIVE' },
      ];

      mockPrisma.bot.findMany.mockResolvedValue(mockBots);

      const result = await service.findAll();

      expect(result).toEqual(mockBots);
      expect(mockPrisma.bot.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array if no bots', async () => {
      mockPrisma.bot.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it('should order bots alphabetically by name', async () => {
      const mockBots = [
        { id: 'bot-1', name: 'Alert Handler' },
        { id: 'bot-2', name: 'Diagnosis Helper' },
        { id: 'bot-3', name: 'Notification Service' },
      ];

      mockPrisma.bot.findMany.mockResolvedValue(mockBots);

      const result = await service.findAll();

      expect(result[0].name).toBe('Alert Handler');
      expect(result[2].name).toBe('Notification Service');
    });
  });

  describe('findById', () => {
    it('should return bot with recent executions', async () => {
      const mockBot = {
        id: 'bot-1',
        name: 'Auto Triage',
        status: 'ACTIVE',
        executions: [
          { id: 'exec-1', success: true, createdAt: new Date('2026-05-14') },
          { id: 'exec-2', success: true, createdAt: new Date('2026-05-13') },
        ],
      };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);

      const result = await service.findById('bot-1');

      expect(result.id).toBe('bot-1');
      expect(result.executions).toHaveLength(2);
      expect(mockPrisma.bot.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bot-1' },
          include: expect.objectContaining({
            executions: { orderBy: { createdAt: 'desc' }, take: 20 },
          }),
        }),
      );
    });

    it('should throw NotFoundException if bot not found', async () => {
      mockPrisma.bot.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should limit executions to last 20', async () => {
      mockPrisma.bot.findUnique.mockResolvedValue({ id: 'bot-1' });

      await service.findById('bot-1');

      expect(mockPrisma.bot.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            executions: expect.objectContaining({ take: 20 }),
          }),
        }),
      );
    });

    it('should order executions by creation date descending', async () => {
      mockPrisma.bot.findUnique.mockResolvedValue({
        id: 'bot-1',
        executions: [],
      });

      await service.findById('bot-1');

      expect(mockPrisma.bot.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            executions: { orderBy: { createdAt: 'desc' }, take: 20 },
          }),
        }),
      );
    });

    it('should return bot with trigger configuration', async () => {
      const mockBot = {
        id: 'bot-1',
        triggerType: 'RESOURCE_CREATED',
        triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
      };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);

      const result = await service.findById('bot-1');

      expect(result.triggerConfig.resourceType).toBe('APPOINTMENT');
    });
  });

  describe('create', () => {
    it('should create bot with trigger config and action', async () => {
      const data = {
        name: 'Auto Notification',
        description: 'Send notifications on appointment',
        triggerType: 'RESOURCE_CREATED',
        triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
        action: { type: 'SEND_EMAIL', template: 'appointment_created' },
        createdBy: 'user-1',
      };

      const mockCreatedBot = { id: 'bot-1', ...data };

      mockPrisma.bot.create.mockResolvedValue(mockCreatedBot);

      const result = await service.create(data);

      expect(result.id).toBe('bot-1');
      expect(result.name).toBe('Auto Notification');
      expect(mockPrisma.bot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Auto Notification',
            triggerType: 'RESOURCE_CREATED',
            createdBy: 'user-1',
          }),
        }),
      );
    });

    it('should handle optional description', async () => {
      const data = {
        name: 'Simple Bot',
        triggerType: 'TIMER',
        triggerConfig: { interval: 'DAILY' },
        action: { type: 'LOG' },
        createdBy: 'user-1',
      };

      mockPrisma.bot.create.mockResolvedValue({ id: 'bot-1', ...data });

      const result = await service.create(data);

      expect(result.name).toBe('Simple Bot');
    });

    it('should store complex trigger and action as JSON', async () => {
      const data = {
        name: 'Complex Bot',
        triggerType: 'SCHEDULED',
        triggerConfig: {
          cron: '0 9 * * MON-FRI',
          conditions: [{ field: 'status', operator: 'equals', value: 'PENDING' }],
        },
        action: {
          type: 'WORKFLOW',
          steps: [
            { action: 'NOTIFY', recipients: ['admin@hospital.example'] },
            { action: 'CREATE_TASK', assignee: 'chief-doctor' },
          ],
        },
        createdBy: 'user-1',
      };

      mockPrisma.bot.create.mockResolvedValue({ id: 'bot-1', ...data });

      const result = await service.create(data);

      expect(result.action.steps).toHaveLength(2);
    });
  });

  describe('toggle', () => {
    it('should toggle from ACTIVE to DISABLED', async () => {
      const mockBot = { id: 'bot-1', status: 'ACTIVE', name: 'Test Bot' };
      const mockUpdated = { ...mockBot, status: 'DISABLED' };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockUpdated);

      const result = await service.toggle('bot-1');

      expect(result.status).toBe('DISABLED');
      expect(mockPrisma.bot.update).toHaveBeenCalledWith({
        where: { id: 'bot-1' },
        data: { status: 'DISABLED' },
      });
    });

    it('should toggle from DISABLED to ACTIVE', async () => {
      const mockBot = { id: 'bot-1', status: 'DISABLED' };
      const mockUpdated = { ...mockBot, status: 'ACTIVE' };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockUpdated);

      const result = await service.toggle('bot-1');

      expect(result.status).toBe('ACTIVE');
    });

    it('should throw NotFoundException if bot not found', async () => {
      mockPrisma.bot.findUnique.mockResolvedValue(null);

      await expect(service.toggle('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should verify bot exists before updating', async () => {
      mockPrisma.bot.findUnique.mockResolvedValue({ id: 'bot-1', status: 'ACTIVE' });
      mockPrisma.bot.update.mockResolvedValue({ id: 'bot-1', status: 'DISABLED' });

      await service.toggle('bot-1');

      expect(mockPrisma.bot.findUnique).toHaveBeenCalledWith({ where: { id: 'bot-1' } });
    });
  });

  describe('execute', () => {
    // 🔴 종전 스펙은 "로그만 찍고 success:true" 를 계약으로 굳혀뒀다(W8·P16). 액션 엔진이
    //    없는 동안 실행 이력은 **수행되지 않았음**을 말해야 한다.
    it('액션 엔진이 없으면 성공으로 기록하지 않는다', async () => {
      const mockBot = {
        id: 'bot-1',
        name: 'Test Bot',
        status: 'ACTIVE',
        action: { type: 'LOG', message: 'Bot executed' },
      };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockBot);
      mockPrisma.botExecution.create.mockImplementation(async (args: any) => ({ id: 'exec-1', ...args.data }));

      const result = await service.execute('bot-1', { resourceId: 'res-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('ACTION_ENGINE_NOT_IMPLEMENTED');
      expect(result.output.executed).toBe(false);
      expect(mockPrisma.botExecution.create).toHaveBeenCalled();
    });

    it('should not execute disabled bot', async () => {
      const mockBot = { id: 'bot-1', status: 'DISABLED' };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);

      const result = await service.execute('bot-1');

      expect(result).toBeNull();
      expect(mockPrisma.botExecution.create).not.toHaveBeenCalled();
    });

    it('should handle bot not found', async () => {
      mockPrisma.bot.findUnique.mockResolvedValue(null);

      const result = await service.execute('non-existent');

      expect(result).toBeNull();
    });

    it('should record execution with input data', async () => {
      const mockBot = { id: 'bot-1', name: 'Test Bot', status: 'ACTIVE', action: {} };
      const mockExecution = { id: 'exec-1', success: true };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockBot);
      mockPrisma.botExecution.create.mockResolvedValue(mockExecution);

      const input = { resourceId: 'resource-123', data: { key: 'value' } };
      await service.execute('bot-1', input);

      expect(mockPrisma.botExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            input: input,
          }),
        }),
      );
    });

    it('should increment run count on execution', async () => {
      const mockBot = { id: 'bot-1', status: 'ACTIVE', action: {} };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockBot);
      mockPrisma.botExecution.create.mockResolvedValue({ id: 'exec-1' });

      await service.execute('bot-1');

      expect(mockPrisma.bot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runCount: { increment: 1 },
          }),
        }),
      );
    });

    it('should record execution with duration', async () => {
      const mockBot = { id: 'bot-1', status: 'ACTIVE', action: {} };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockBot);
      mockPrisma.botExecution.create.mockResolvedValue({ id: 'exec-1', duration: 15 });

      const result = await service.execute('bot-1');

      expect(mockPrisma.botExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            duration: expect.any(Number),
          }),
        }),
      );
    });

    it('수행되지 않았다는 사유를 실행 이력에 남긴다', async () => {
      const mockBot = { id: 'bot-1', name: 'Error Bot', status: 'ACTIVE', action: {} };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockBot);
      mockPrisma.botExecution.create.mockResolvedValue({ id: 'exec-1' });

      await service.execute('bot-1');

      expect(mockPrisma.botExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: false, error: 'ACTION_ENGINE_NOT_IMPLEMENTED' }),
        }),
      );
    });

    it('should use manual trigger if no resourceId provided', async () => {
      const mockBot = { id: 'bot-1', status: 'ACTIVE', action: {} };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockBot);
      mockPrisma.botExecution.create.mockResolvedValue({ id: 'exec-1' });

      await service.execute('bot-1');

      expect(mockPrisma.botExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            triggeredBy: 'manual',
          }),
        }),
      );
    });

    it('서버 로그도 "실행됨"이 아니라 "수행되지 않음"이라고 적는다', async () => {
      const mockBot = { id: 'bot-1', name: 'Logging Bot', status: 'ACTIVE', action: { type: 'LOG' } };

      mockPrisma.bot.findUnique.mockResolvedValue(mockBot);
      mockPrisma.bot.update.mockResolvedValue(mockBot);
      mockPrisma.botExecution.create.mockResolvedValue({ id: 'exec-1' });

      await service.execute('bot-1');

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('triggerByResource', () => {
    it('should find and execute matching bots', async () => {
      const matchingBots = [
        {
          id: 'bot-1',
          name: 'Appointment Handler',
          status: 'ACTIVE',
          triggerType: 'RESOURCE_CREATED',
          triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
          action: { type: 'NOTIFY' },
        },
      ];

      mockPrisma.bot.findMany.mockResolvedValue(matchingBots);
      mockPrisma.bot.findUnique
        .mockResolvedValueOnce(matchingBots[0]) // for execute
        .mockResolvedValueOnce(matchingBots[0]);
      mockPrisma.bot.update.mockResolvedValue(matchingBots[0]);
      mockPrisma.botExecution.create.mockResolvedValue({ id: 'exec-1' });

      const result = await service.triggerByResource('APPOINTMENT', 'CREATED', 'apt-1');

      expect(result.triggered).toBe(1);
    });

    it('should filter bots by resource type and event', async () => {
      const mockBots = [
        {
          id: 'bot-1',
          status: 'ACTIVE',
          triggerType: 'RESOURCE_CREATED',
          triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
          action: {},
        },
        {
          id: 'bot-2',
          status: 'ACTIVE',
          triggerType: 'RESOURCE_CREATED',
          triggerConfig: { resourceType: 'ENCOUNTER', event: 'CREATED' },
          action: {},
        },
      ];

      mockPrisma.bot.findMany.mockResolvedValue(mockBots);

      await service.triggerByResource('APPOINTMENT', 'CREATED', 'apt-1');

      // Should only find bot-1
      expect(mockPrisma.bot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        }),
      );
    });

    it('should pass resource information to execute', async () => {
      const mockBots = [
        {
          id: 'bot-1',
          status: 'ACTIVE',
          triggerType: 'RESOURCE_UPDATED',
          triggerConfig: { resourceType: 'PATIENT', event: 'UPDATED' },
          action: {},
        },
      ];

      mockPrisma.bot.findMany.mockResolvedValue(mockBots);
      mockPrisma.bot.findUnique.mockResolvedValue(mockBots[0]);
      mockPrisma.bot.update.mockResolvedValue(mockBots[0]);
      mockPrisma.botExecution.create.mockResolvedValue({ id: 'exec-1' });

      await service.triggerByResource('PATIENT', 'UPDATED', 'patient-123');

      expect(mockPrisma.botExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            input: {
              resourceType: 'PATIENT',
              event: 'UPDATED',
              resourceId: 'patient-123',
            },
          }),
        }),
      );
    });

    it('should return count of triggered bots', async () => {
      mockPrisma.bot.findMany.mockResolvedValue([]);

      const result = await service.triggerByResource('UNKNOWN', 'CREATED', 'res-1');

      expect(result.triggered).toBe(0);
    });

    it('should only execute active bots', async () => {
      // Service filters by status: 'ACTIVE' in database query, so DISABLED bots are not returned
      mockPrisma.bot.findMany.mockResolvedValue([]);

      const result = await service.triggerByResource('APPOINTMENT', 'CREATED', 'apt-1');

      expect(result.triggered).toBe(0);
      expect(mockPrisma.bot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        }),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors', async () => {
      mockPrisma.bot.findMany.mockRejectedValue(new Error('Database error'));

      await expect(service.findAll()).rejects.toThrow('Database error');
    });

    it('should throw NotFoundException with proper message', async () => {
      mockPrisma.bot.findUnique.mockResolvedValue(null);

      try {
        await service.findById('missing-id');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Bot not found');
      }
    });
  });

  describe('Workflow Automation', () => {
    it('should support complex multi-step actions', async () => {
      const data = {
        name: 'Complex Workflow',
        triggerType: 'RESOURCE_CREATED',
        triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
        action: {
          type: 'WORKFLOW',
          steps: [
            { type: 'NOTIFICATION', recipients: ['admin'] },
            { type: 'TASK_CREATION', assignee: 'doctor' },
            { type: 'LOG_RECORDING' },
          ],
        },
        createdBy: 'user-1',
      };

      mockPrisma.bot.create.mockResolvedValue({ id: 'bot-1', ...data });

      const result = await service.create(data);

      expect(result.action.steps).toHaveLength(3);
    });
  });
});
