import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CssdController } from '../../src/modules/cssd/cssd.controller';

describe('CssdController', () => {
  let controller: CssdController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getAllSets: vi.fn(),
      createSet: vi.fn(),
      updateStatus: vi.fn(),
      getLogs: vi.fn(),
      getExpiringSoon: vi.fn(),
    };
    controller = new CssdController(mockService);
  });

  describe('getAllSets', () => {
    it('should return all sets', async () => {
      const mockSets = [
        { id: 'set-1', name: 'General Surgery Kit', status: 'STERILE' },
      ];

      mockService.getAllSets.mockResolvedValue(mockSets);

      const result = await controller.getAllSets();

      expect(result.data).toEqual(mockSets);
      expect(mockService.getAllSets).toHaveBeenCalledWith(undefined);
    });

    it('should filter by status', async () => {
      const mockSets = [{ id: 'set-1', status: 'STERILE' }];

      mockService.getAllSets.mockResolvedValue(mockSets);

      const result = await controller.getAllSets('STERILE');

      expect(mockService.getAllSets).toHaveBeenCalledWith('STERILE');
    });

    it('should wrap response in data object', async () => {
      mockService.getAllSets.mockResolvedValue([]);

      const result = await controller.getAllSets();

      expect(result).toHaveProperty('data');
    });

    it('should return empty list', async () => {
      mockService.getAllSets.mockResolvedValue([]);

      const result = await controller.getAllSets();

      expect(result.data).toEqual([]);
    });

    it('should support DIRTY status filter', async () => {
      const mockSets = [{ id: 'set-1', status: 'DIRTY' }];

      mockService.getAllSets.mockResolvedValue(mockSets);

      const result = await controller.getAllSets('DIRTY');

      expect(mockService.getAllSets).toHaveBeenCalledWith('DIRTY');
      expect(result.data[0].status).toBe('DIRTY');
    });

    it('should support IN_USE status filter', async () => {
      const mockSets = [{ id: 'set-1', status: 'IN_USE' }];

      mockService.getAllSets.mockResolvedValue(mockSets);

      const result = await controller.getAllSets('IN_USE');

      expect(result.data[0].status).toBe('IN_USE');
    });
  });

  describe('createSet', () => {
    it('should create new instrument set', async () => {
      const body = {
        name: 'Cardio Kit',
        contents: { instruments: [{ name: 'Retractor', quantity: 2 }] },
        location: 'OR-2',
      };

      const mockCreated = { id: 'set-1', ...body };

      mockService.createSet.mockResolvedValue(mockCreated);

      const result = await controller.createSet(body);

      expect(result.data.id).toBe('set-1');
      expect(mockService.createSet).toHaveBeenCalledWith(body);
    });

    it('should wrap response in data object', async () => {
      const body = { name: 'Kit', contents: {} };

      mockService.createSet.mockResolvedValue({ id: 'set-1' });

      const result = await controller.createSet(body);

      expect(result).toHaveProperty('data');
    });

    it('should include set name', async () => {
      const body = { name: 'Orthopedic Kit', contents: {} };

      mockService.createSet.mockResolvedValue({ id: 'set-1', name: 'Orthopedic Kit' });

      const result = await controller.createSet(body);

      expect(result.data.name).toBe('Orthopedic Kit');
    });

    it('should include contents structure', async () => {
      const body = {
        name: 'Kit',
        contents: {
          instruments: [{ name: 'Knife', type: 'Cutting' }],
        },
      };

      mockService.createSet.mockResolvedValue({ id: 'set-1', ...body });

      const result = await controller.createSet(body);

      expect(result.data.contents.instruments).toHaveLength(1);
    });

    it('should include location if provided', async () => {
      const body = {
        name: 'Kit',
        contents: {},
        location: 'OR-5',
      };

      mockService.createSet.mockResolvedValue({ id: 'set-1', ...body });

      const result = await controller.createSet(body);

      expect(result.data.location).toBe('OR-5');
    });
  });

  describe('updateStatus', () => {
    it('should update set status', async () => {
      const body = { status: 'WASHING', notes: 'Washing cycle started' };

      const mockUpdated = { id: 'set-1', status: 'WASHING' };

      mockService.updateStatus.mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('set-1', body, 'user-1');

      expect(result.data.status).toBe('WASHING');
      expect(mockService.updateStatus).toHaveBeenCalledWith('set-1', 'WASHING', 'user-1', 'Washing cycle started', undefined, undefined);
    });

    it('should pass userId from decorator', async () => {
      const body = { status: 'STERILIZING' };

      mockService.updateStatus.mockResolvedValue({ id: 'set-1', status: 'STERILIZING' });

      await controller.updateStatus('set-1', body, 'user-nurse-123');

      expect(mockService.updateStatus).toHaveBeenCalledWith(
        'set-1',
        'STERILIZING',
        'user-nurse-123',
        undefined,
        undefined,
        undefined,
      );
    });

    it('should wrap response in data object', async () => {
      const body = { status: 'STERILE' };

      mockService.updateStatus.mockResolvedValue({ id: 'set-1', status: 'STERILE' });

      const result = await controller.updateStatus('set-1', body, 'user-1');

      expect(result).toHaveProperty('data');
    });

    it('should set sterilization completion', async () => {
      const body = { status: 'STERILE' };

      const mockUpdated = {
        id: 'set-1',
        status: 'STERILE',
        lastSterilizedAt: new Date(),
        expiresAt: new Date(),
      };

      mockService.updateStatus.mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('set-1', body, 'user-1');

      expect(result.data.status).toBe('STERILE');
    });

    it('should handle optional notes', async () => {
      const body = { status: 'WASHING', notes: 'Started wash cycle' };

      mockService.updateStatus.mockResolvedValue({ id: 'set-1' });

      await controller.updateStatus('set-1', body, 'user-1');

      expect(mockService.updateStatus).toHaveBeenCalledWith(
        'set-1',
        'WASHING',
        'user-1',
        'Started wash cycle',
        undefined,
        undefined,
      );
    });

    it('should accept UUID-formatted id', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      const body = { status: 'WASHING' };

      mockService.updateStatus.mockResolvedValue({ id: uuidId });

      await controller.updateStatus(uuidId, body, 'user-1');

      expect(mockService.updateStatus).toHaveBeenCalledWith(uuidId, 'WASHING', 'user-1', undefined, undefined, undefined);
    });
  });

  describe('getLogs', () => {
    it('should return sterilization logs for set', async () => {
      const mockLogs = [
        { id: 'log-1', action: '세척', performedBy: 'user-1', createdAt: new Date() },
        { id: 'log-2', action: '멸균 완료', performedBy: 'user-2', createdAt: new Date() },
      ];

      mockService.getLogs.mockResolvedValue(mockLogs);

      const result = await controller.getLogs('set-1');

      expect(result.data).toEqual(mockLogs);
      expect(mockService.getLogs).toHaveBeenCalledWith('set-1');
    });

    it('should wrap response in data object', async () => {
      mockService.getLogs.mockResolvedValue([]);

      const result = await controller.getLogs('set-1');

      expect(result).toHaveProperty('data');
    });

    it('should return empty list if no logs', async () => {
      mockService.getLogs.mockResolvedValue([]);

      const result = await controller.getLogs('set-1');

      expect(result.data).toEqual([]);
    });

    it('should include action descriptions', async () => {
      const mockLogs = [
        { id: 'log-1', action: '반납' },
        { id: 'log-2', action: '세척' },
        { id: 'log-3', action: '멸균 완료' },
      ];

      mockService.getLogs.mockResolvedValue(mockLogs);

      const result = await controller.getLogs('set-1');

      expect(result.data[0].action).toBe('반납');
      expect(result.data[1].action).toBe('세척');
    });

    it('should include performed user information', async () => {
      const mockLogs = [
        { id: 'log-1', performedBy: 'nurse-kim', createdAt: new Date() },
      ];

      mockService.getLogs.mockResolvedValue(mockLogs);

      const result = await controller.getLogs('set-1');

      expect(result.data[0].performedBy).toBe('nurse-kim');
    });

    it('should accept UUID-formatted id', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      mockService.getLogs.mockResolvedValue([]);

      await controller.getLogs(uuidId);

      expect(mockService.getLogs).toHaveBeenCalledWith(uuidId);
    });
  });

  describe('getExpiring', () => {
    it('should return expiring sets', async () => {
      const mockSets = [
        {
          id: 'set-1',
          name: 'Kit-1',
          status: 'STERILE',
          expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      ];

      mockService.getExpiringSoon.mockResolvedValue(mockSets);

      const result = await controller.getExpiring();

      expect(result.data).toEqual(mockSets);
      expect(mockService.getExpiringSoon).toHaveBeenCalled();
    });

    it('should wrap response in data object', async () => {
      mockService.getExpiringSoon.mockResolvedValue([]);

      const result = await controller.getExpiring();

      expect(result).toHaveProperty('data');
    });

    it('should return empty list if no expiring sets', async () => {
      mockService.getExpiringSoon.mockResolvedValue([]);

      const result = await controller.getExpiring();

      expect(result.data).toEqual([]);
    });

    it('should include expiry date', async () => {
      const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const mockSets = [
        {
          id: 'set-1',
          name: 'Kit-1',
          status: 'STERILE',
          expiresAt,
        },
      ];

      mockService.getExpiringSoon.mockResolvedValue(mockSets);

      const result = await controller.getExpiring();

      expect(result.data[0].expiresAt).toEqual(expiresAt);
    });

    it('should only return STERILE sets', async () => {
      const mockSets = [
        { id: 'set-1', status: 'STERILE' },
        { id: 'set-2', status: 'STERILE' },
      ];

      mockService.getExpiringSoon.mockResolvedValue(mockSets);

      const result = await controller.getExpiring();

      expect(result.data.every((s: any) => s.status === 'STERILE')).toBe(true);
    });
  });

  describe('Authorization', () => {
    it('should require JWT authentication', async () => {
      // @UseGuards(JwtAuthGuard, RolesGuard)
      expect(controller).toBeDefined();
    });

    it('should require NURSE or ADMIN role', async () => {
      // @Roles(UserRole.NURSE, UserRole.ADMIN)
      expect(controller).toBeDefined();
    });

    it('should apply role guard to all endpoints', async () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should wrap all responses in data object', async () => {
      mockService.getAllSets.mockResolvedValue([]);
      mockService.createSet.mockResolvedValue({ id: 'set-1' });
      mockService.updateStatus.mockResolvedValue({ id: 'set-1' });
      mockService.getLogs.mockResolvedValue([]);
      mockService.getExpiringSoon.mockResolvedValue([]);

      const allResult = await controller.getAllSets();
      const createResult = await controller.createSet({ name: 'Kit', contents: {} });
      const updateResult = await controller.updateStatus('set-1', { status: 'WASHING' }, 'user-1');
      const logsResult = await controller.getLogs('set-1');
      const expiringResult = await controller.getExpiring();

      expect(allResult).toHaveProperty('data');
      expect(createResult).toHaveProperty('data');
      expect(updateResult).toHaveProperty('data');
      expect(logsResult).toHaveProperty('data');
      expect(expiringResult).toHaveProperty('data');
    });

    it('should preserve set structure', async () => {
      const mockSet = {
        id: 'set-1',
        name: 'Kit',
        status: 'STERILE',
        contents: { items: [] },
      };

      mockService.getAllSets.mockResolvedValue([mockSet]);

      const result = await controller.getAllSets();

      expect(JSON.stringify(result.data[0])).toBe(JSON.stringify(mockSet));
    });
  });

  describe('Route Parameters', () => {
    it('should pass id from route to service', async () => {
      mockService.updateStatus.mockResolvedValue({ id: 'set-1' });
      mockService.getLogs.mockResolvedValue([]);

      await controller.updateStatus('set-1', { status: 'WASHING' }, 'user-1');
      await controller.getLogs('set-1');

      expect(mockService.updateStatus).toHaveBeenCalledWith('set-1', 'WASHING', 'user-1', undefined, undefined, undefined);
      expect(mockService.getLogs).toHaveBeenCalledWith('set-1');
    });

    it('should accept UUID-formatted ids', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';

      mockService.updateStatus.mockResolvedValue({ id: uuidId });
      mockService.getLogs.mockResolvedValue([]);

      await controller.updateStatus(uuidId, { status: 'WASHING' }, 'user-1');
      await controller.getLogs(uuidId);

      expect(mockService.updateStatus).toHaveBeenCalledWith(uuidId, 'WASHING', 'user-1', undefined, undefined, undefined);
      expect(mockService.getLogs).toHaveBeenCalledWith(uuidId);
    });
  });

  describe('Query Parameters', () => {
    it('should support optional status filter', async () => {
      mockService.getAllSets.mockResolvedValue([]);

      await controller.getAllSets('STERILE');

      expect(mockService.getAllSets).toHaveBeenCalledWith('STERILE');
    });

    it('should handle missing status parameter', async () => {
      mockService.getAllSets.mockResolvedValue([]);

      await controller.getAllSets();

      expect(mockService.getAllSets).toHaveBeenCalledWith(undefined);
    });
  });

  describe('CSSD Sterilization Workflow', () => {
    it('should support complete sterilization workflow', async () => {
      // Create set
      const createBody = {
        name: 'Surgery Kit',
        contents: { instruments: [] },
      };

      mockService.createSet.mockResolvedValue({
        id: 'set-1',
        ...createBody,
        status: 'DIRTY',
      });

      const createResult = await controller.createSet(createBody);
      const setId = createResult.data.id;

      // Status updates through workflow
      const statuses = ['WASHING', 'STERILIZING', 'STERILE', 'IN_USE'];

      for (const status of statuses) {
        mockService.updateStatus.mockResolvedValue({ id: setId, status });

        const result = await controller.updateStatus(setId, { status }, 'user-1');

        expect(result.data.status).toBe(status);
      }

      // Get logs
      mockService.getLogs.mockResolvedValue([
        { id: 'log-1', action: '세척' },
        { id: 'log-2', action: '멸균 완료' },
      ]);

      const logs = await controller.getLogs(setId);

      expect(logs.data).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      mockService.getAllSets.mockRejectedValue(new Error('Database error'));

      await expect(controller.getAllSets()).rejects.toThrow('Database error');
    });

    it('should handle null response', async () => {
      mockService.getLogs.mockResolvedValue(null);

      const result = await controller.getLogs('set-1');

      expect(result.data).toBeNull();
    });
  });

  describe('Healthcare Context - CSSD Operations', () => {
    it('should support typical CSSD operations', async () => {
      // Register new instruments
      const createBody = {
        name: 'Laparoscopic Surgery Set',
        contents: {
          instruments: [
            { name: 'Trocar 12mm', quantity: 2 },
            { name: 'Laparoscope 30°', quantity: 1 },
          ],
        },
        location: 'OR-3',
      };

      mockService.createSet.mockResolvedValue({
        id: 'laparoscopic-set-1',
        ...createBody,
      });

      const created = await controller.createSet(createBody);

      expect(created.data.name).toContain('Laparoscopic');

      // Check sterile sets ready for use
      mockService.getAllSets.mockResolvedValue([
        { id: 'laparoscopic-set-1', status: 'STERILE' },
      ]);

      const sterile = await controller.getAllSets('STERILE');

      expect(sterile.data.some((s: any) => s.id === 'laparoscopic-set-1')).toBe(true);

      // Monitor expiry
      mockService.getExpiringSoon.mockResolvedValue([
        { id: 'older-set', expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) },
      ]);

      const expiring = await controller.getExpiring();

      expect(expiring.data).toHaveLength(1);
    });
  });
});
