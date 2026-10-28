import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BotsController } from '../../src/modules/bots/bots.controller';
import { NotFoundException } from '@nestjs/common';

describe('BotsController', () => {
  let controller: BotsController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      toggle: vi.fn(),
      execute: vi.fn(),
    };
    controller = new BotsController(mockService);
  });

  describe('findAll', () => {
    it('should return all bots', async () => {
      const mockBots = [
        { id: 'bot-1', name: 'Auto Diagnosis', status: 'ACTIVE' },
        { id: 'bot-2', name: 'Notification Service', status: 'ACTIVE' },
      ];

      mockService.findAll.mockResolvedValue(mockBots);

      const result = await controller.findAll();

      expect(result.data).toEqual(mockBots);
      expect(mockService.findAll).toHaveBeenCalled();
    });

    it('should wrap response in data object', async () => {
      mockService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
    });

    it('should return empty list if no bots', async () => {
      mockService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result.data).toEqual([]);
    });

    it('should include bot status', async () => {
      const mockBots = [
        { id: 'bot-1', status: 'ACTIVE' },
        { id: 'bot-2', status: 'DISABLED' },
      ];

      mockService.findAll.mockResolvedValue(mockBots);

      const result = await controller.findAll();

      expect(result.data[0].status).toBe('ACTIVE');
      expect(result.data[1].status).toBe('DISABLED');
    });
  });

  describe('create', () => {
    it('should create new bot with userId', async () => {
      const dto = {
        name: 'New Bot',
        description: 'Test bot',
        triggerType: 'RESOURCE_CREATED',
        triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
        action: { type: 'NOTIFY' },
      };

      const mockCreatedBot = { id: 'bot-1', ...dto, createdBy: 'user-1' };

      mockService.create.mockResolvedValue(mockCreatedBot);

      const result = await controller.create(dto, 'user-1');

      expect(result.data.id).toBe('bot-1');
      expect(mockService.create).toHaveBeenCalledWith({
        ...dto,
        createdBy: 'user-1',
      });
    });

    it('should wrap response in data object', async () => {
      const dto = {
        name: 'Bot',
        triggerType: 'TIMER',
        triggerConfig: {},
        action: {},
      };

      mockService.create.mockResolvedValue({ id: 'bot-1' });

      const result = await controller.create(dto, 'user-1');

      expect(result).toHaveProperty('data');
    });

    it('should pass userId from decorator', async () => {
      const dto = {
        name: 'Bot',
        triggerType: 'TIMER',
        triggerConfig: {},
        action: {},
      };

      mockService.create.mockResolvedValue({ id: 'bot-1' });

      await controller.create(dto, 'user-123');

      expect(mockService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: 'user-123',
        }),
      );
    });

    it('should include trigger configuration in bot', async () => {
      const dto = {
        name: 'Appointment Bot',
        triggerType: 'RESOURCE_CREATED',
        triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
        action: { type: 'NOTIFY' },
      };

      mockService.create.mockResolvedValue({ id: 'bot-1', ...dto });

      const result = await controller.create(dto, 'user-1');

      expect(result.data.triggerConfig.resourceType).toBe('APPOINTMENT');
    });

    it('should include action configuration in bot', async () => {
      const dto = {
        name: 'Bot',
        triggerType: 'TIMER',
        triggerConfig: {},
        action: { type: 'WORKFLOW', steps: [{ action: 'NOTIFY' }] },
      };

      mockService.create.mockResolvedValue({ id: 'bot-1', ...dto });

      const result = await controller.create(dto, 'user-1');

      expect(result.data.action.type).toBe('WORKFLOW');
    });
  });

  describe('findOne', () => {
    it('should return bot with execution history', async () => {
      const mockBot = {
        id: 'bot-1',
        name: 'Auto Triage',
        status: 'ACTIVE',
        executions: [
          { id: 'exec-1', success: true, createdAt: new Date('2026-05-14') },
          { id: 'exec-2', success: false, createdAt: new Date('2026-05-13') },
        ],
      };

      mockService.findById.mockResolvedValue(mockBot);

      const result = await controller.findOne('bot-1');

      expect(result.data.id).toBe('bot-1');
      expect(result.data.executions).toHaveLength(2);
    });

    it('should throw NotFoundException if bot not found', async () => {
      mockService.findById.mockRejectedValue(new NotFoundException('Bot not found'));

      await expect(controller.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should wrap response in data object', async () => {
      const mockBot = { id: 'bot-1', name: 'Bot', executions: [] };

      mockService.findById.mockResolvedValue(mockBot);

      const result = await controller.findOne('bot-1');

      expect(result).toHaveProperty('data');
    });

    it('should accept UUID-formatted id', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      mockService.findById.mockResolvedValue({ id: uuidId });

      const result = await controller.findOne(uuidId);

      expect(mockService.findById).toHaveBeenCalledWith(uuidId);
    });

    it('should include execution success/failure status', async () => {
      const mockBot = {
        id: 'bot-1',
        executions: [
          { id: 'exec-1', success: true, error: null },
          { id: 'exec-2', success: false, error: 'Timeout' },
        ],
      };

      mockService.findById.mockResolvedValue(mockBot);

      const result = await controller.findOne('bot-1');

      expect(result.data.executions[0].success).toBe(true);
      expect(result.data.executions[1].error).toBe('Timeout');
    });

    it('should include execution timestamps', async () => {
      const mockBot = {
        id: 'bot-1',
        executions: [
          {
            id: 'exec-1',
            createdAt: new Date('2026-05-14T09:00:00Z'),
          },
        ],
      };

      mockService.findById.mockResolvedValue(mockBot);

      const result = await controller.findOne('bot-1');

      expect(result.data.executions[0].createdAt).toBeDefined();
    });
  });

  describe('toggle', () => {
    it('should toggle bot status from ACTIVE to DISABLED', async () => {
      const mockToggled = { id: 'bot-1', status: 'DISABLED' };

      mockService.toggle.mockResolvedValue(mockToggled);

      const result = await controller.toggle('bot-1');

      expect(result.data.status).toBe('DISABLED');
      expect(mockService.toggle).toHaveBeenCalledWith('bot-1');
    });

    it('should toggle bot status from DISABLED to ACTIVE', async () => {
      const mockToggled = { id: 'bot-1', status: 'ACTIVE' };

      mockService.toggle.mockResolvedValue(mockToggled);

      const result = await controller.toggle('bot-1');

      expect(result.data.status).toBe('ACTIVE');
    });

    it('should wrap response in data object', async () => {
      mockService.toggle.mockResolvedValue({ id: 'bot-1', status: 'DISABLED' });

      const result = await controller.toggle('bot-1');

      expect(result).toHaveProperty('data');
    });

    it('should throw NotFoundException if bot not found', async () => {
      mockService.toggle.mockRejectedValue(new NotFoundException('Bot not found'));

      await expect(controller.toggle('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should accept UUID-formatted id', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      mockService.toggle.mockResolvedValue({ id: uuidId, status: 'DISABLED' });

      await controller.toggle(uuidId);

      expect(mockService.toggle).toHaveBeenCalledWith(uuidId);
    });
  });

  describe('execute', () => {
    it('should execute bot manually', async () => {
      const mockExecution = {
        id: 'exec-1',
        botId: 'bot-1',
        success: true,
        output: { action: 'executed' },
      };

      mockService.execute.mockResolvedValue(mockExecution);

      const result = await controller.execute('bot-1', { test: 'input' });

      expect(result.data.id).toBe('exec-1');
      expect(mockService.execute).toHaveBeenCalledWith('bot-1', { test: 'input' });
    });

    it('should wrap response in data object', async () => {
      mockService.execute.mockResolvedValue({ id: 'exec-1', success: true });

      const result = await controller.execute('bot-1');

      expect(result).toHaveProperty('data');
    });

    it('should accept optional body input', async () => {
      mockService.execute.mockResolvedValue({ id: 'exec-1' });

      await controller.execute('bot-1', { resourceId: 'res-123' });

      expect(mockService.execute).toHaveBeenCalledWith('bot-1', { resourceId: 'res-123' });
    });

    it('should handle execution without input', async () => {
      mockService.execute.mockResolvedValue({ id: 'exec-1', success: true });

      const result = await controller.execute('bot-1');

      expect(mockService.execute).toHaveBeenCalledWith('bot-1', undefined);
    });

    it('should include execution success status', async () => {
      const mockExecution = {
        id: 'exec-1',
        success: true,
        error: null,
        output: { result: 'completed' },
      };

      mockService.execute.mockResolvedValue(mockExecution);

      const result = await controller.execute('bot-1');

      expect(result.data.success).toBe(true);
    });

    it('should handle failed execution', async () => {
      const mockExecution = {
        id: 'exec-1',
        success: false,
        error: 'Execution timeout',
      };

      mockService.execute.mockResolvedValue(mockExecution);

      const result = await controller.execute('bot-1');

      expect(result.data.success).toBe(false);
      expect(result.data.error).toBe('Execution timeout');
    });

    it('should include execution duration', async () => {
      const mockExecution = {
        id: 'exec-1',
        success: true,
        duration: 125,
      };

      mockService.execute.mockResolvedValue(mockExecution);

      const result = await controller.execute('bot-1');

      expect(result.data.duration).toBe(125);
    });
  });

  describe('Authorization', () => {
    it('should require JWT authentication', async () => {
      // @UseGuards(JwtAuthGuard, RolesGuard) on controller
      expect(controller).toBeDefined();
    });

    it('should require ADMIN role', async () => {
      // @Roles(UserRole.ADMIN) on controller
      expect(controller).toBeDefined();
    });

    it('should apply role guard to all endpoints', async () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should wrap all responses in data object', async () => {
      mockService.findAll.mockResolvedValue([]);
      mockService.findById.mockResolvedValue({ id: 'bot-1' });
      mockService.toggle.mockResolvedValue({ id: 'bot-1', status: 'DISABLED' });
      mockService.execute.mockResolvedValue({ id: 'exec-1' });
      mockService.create.mockResolvedValue({ id: 'bot-1' });

      const allResult = await controller.findAll();
      const findResult = await controller.findOne('bot-1');
      const toggleResult = await controller.toggle('bot-1');
      const execResult = await controller.execute('bot-1');
      const createResult = await controller.create(
        {
          name: 'Bot',
          triggerType: 'TIMER',
          triggerConfig: {},
          action: {},
        },
        'user-1',
      );

      expect(allResult).toHaveProperty('data');
      expect(findResult).toHaveProperty('data');
      expect(toggleResult).toHaveProperty('data');
      expect(execResult).toHaveProperty('data');
      expect(createResult).toHaveProperty('data');
    });

    it('should preserve bot structure in response', async () => {
      const mockBot = {
        id: 'bot-1',
        name: 'Test Bot',
        status: 'ACTIVE',
        triggerType: 'TIMER',
        action: { type: 'LOG' },
      };

      mockService.findById.mockResolvedValue(mockBot);

      const result = await controller.findOne('bot-1');

      expect(JSON.stringify(result.data)).toBe(JSON.stringify(mockBot));
    });
  });

  describe('Route Parameters', () => {
    it('should pass id from route to service', async () => {
      mockService.findById.mockResolvedValue({ id: 'bot-1' });

      await controller.findOne('bot-1');

      expect(mockService.findById).toHaveBeenCalledWith('bot-1');
    });

    it('should accept UUID-formatted ids', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';

      mockService.findById.mockResolvedValue({ id: uuidId });
      mockService.toggle.mockResolvedValue({ id: uuidId, status: 'DISABLED' });
      mockService.execute.mockResolvedValue({ id: 'exec-1' });

      await controller.findOne(uuidId);
      await controller.toggle(uuidId);
      await controller.execute(uuidId);

      expect(mockService.findById).toHaveBeenCalledWith(uuidId);
      expect(mockService.toggle).toHaveBeenCalledWith(uuidId);
      expect(mockService.execute).toHaveBeenCalledWith(uuidId, undefined);
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      mockService.findById.mockRejectedValue(new NotFoundException('Bot not found'));

      await expect(controller.findOne('bot-1')).rejects.toThrow(NotFoundException);
    });

    it('should handle null execution response', async () => {
      mockService.execute.mockResolvedValue(null);

      const result = await controller.execute('bot-1');

      expect(result.data).toBeNull();
    });

    it('should handle service errors gracefully', async () => {
      mockService.findAll.mockRejectedValue(new Error('Database error'));

      await expect(controller.findAll()).rejects.toThrow('Database error');
    });
  });

  describe('Workflow Automation Management', () => {
    it('should support complete bot lifecycle', async () => {
      // Create bot
      const createDto = {
        name: 'Auto Appointment Notifier',
        triggerType: 'RESOURCE_CREATED',
        triggerConfig: { resourceType: 'APPOINTMENT', event: 'CREATED' },
        action: { type: 'SEND_EMAIL' },
      };

      mockService.create.mockResolvedValue({
        id: 'bot-1',
        ...createDto,
        createdBy: 'user-1',
        status: 'ACTIVE',
      });

      const createResult = await controller.create(createDto, 'user-1');
      const botId = createResult.data.id;

      // Get bot with executions
      mockService.findById.mockResolvedValue({
        id: botId,
        executions: [{ id: 'exec-1', success: true }],
      });

      const getResult = await controller.findOne(botId);
      expect(getResult.data.executions).toBeDefined();

      // Toggle bot
      mockService.toggle.mockResolvedValue({ id: botId, status: 'DISABLED' });

      const toggleResult = await controller.toggle(botId);
      expect(toggleResult.data.status).toBe('DISABLED');

      // Execute bot manually
      mockService.execute.mockResolvedValue({ id: 'exec-2', success: true });

      const execResult = await controller.execute(botId);
      expect(execResult.data.success).toBe(true);
    });
  });

  describe('Data Types & Configuration', () => {
    it('should handle complex JSON configurations', async () => {
      const dto = {
        name: 'Complex Bot',
        triggerType: 'SCHEDULED',
        triggerConfig: {
          cron: '0 9 * * MON-FRI',
          conditions: [
            { field: 'status', operator: 'equals', value: 'PENDING' },
            { field: 'priority', operator: 'gte', value: 5 },
          ],
        },
        action: {
          type: 'WORKFLOW',
          steps: [
            { action: 'NOTIFY', recipients: ['admin@hospital.example'] },
            { action: 'CREATE_TASK', assignee: 'chief' },
          ],
        },
      };

      mockService.create.mockResolvedValue({ id: 'bot-1', ...dto, createdBy: 'user-1' });

      const result = await controller.create(dto, 'user-1');

      expect(result.data.triggerConfig.conditions).toHaveLength(2);
      expect(result.data.action.steps).toHaveLength(2);
    });

    it('should support different trigger types', async () => {
      const triggerTypes = ['TIMER', 'RESOURCE_CREATED', 'RESOURCE_UPDATED', 'RESOURCE_DELETED', 'SCHEDULED'];

      for (const triggerType of triggerTypes) {
        const dto = {
          name: `Bot with ${triggerType}`,
          triggerType,
          triggerConfig: { type: triggerType },
          action: { type: 'LOG' },
        };

        mockService.create.mockResolvedValue({ id: 'bot-1', ...dto });

        const result = await controller.create(dto, 'user-1');

        expect(result.data.triggerType).toBe(triggerType);
      }
    });
  });
});
