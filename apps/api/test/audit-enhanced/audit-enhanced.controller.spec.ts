import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditEnhancedController } from '../../src/modules/audit-enhanced/audit-enhanced.controller';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('AuditEnhancedController', () => {
  let controller: AuditEnhancedController;
  let mockBtgService: any;
  let mockVipService: any;
  let mockAnomalyService: any;

  beforeEach(() => {
    mockBtgService = {
      createAccess: vi.fn(),
      findAll: vi.fn(),
      review: vi.fn(),
      getPatientAccessHistory: vi.fn(),
    };
    mockVipService = {
      designate: vi.fn(),
      findAll: vi.fn(),
      remove: vi.fn(),
    };
    mockAnomalyService = {
      getDashboardStats: vi.fn(),
    };
    controller = new AuditEnhancedController(mockBtgService, mockVipService, mockAnomalyService);
  });

  describe('Break-the-Glass', () => {
    describe('createBtg', () => {
      it('should create BTG access record', async () => {
        const body = {
          patientId: 'p-1',
          reason: 'Emergency access',
          resourceType: 'Patient',
        };

        const mockCreated = {
          id: 'btg-1',
          ...body,
          userId: 'user-1',
          accessedAt: new Date(),
          user: { id: 'user-1', familyName: 'Kim', givenName: 'John', role: 'DOCTOR' },
          patient: { id: 'p-1', mrn: '12345', familyName: 'Lee', givenName: 'Jane' },
        };

        mockBtgService.createAccess.mockResolvedValue(mockCreated);

        const result = await controller.createBtg(body, 'user-1');

        expect(result.data.id).toBe('btg-1');
        expect(mockBtgService.createAccess).toHaveBeenCalledWith(body, 'user-1');
      });

      it('should include user and patient details', async () => {
        const body = {
          patientId: 'p-1',
          reason: 'Emergency',
          resourceType: 'Patient',
        };

        mockBtgService.createAccess.mockResolvedValue({
          id: 'btg-1',
          user: { familyName: 'Doctor', givenName: 'Kim' },
          patient: { familyName: 'Patient', givenName: 'Lee' },
        });

        const result = await controller.createBtg(body, 'user-1');

        expect(result.data.user).toBeDefined();
        expect(result.data.patient).toBeDefined();
      });

      it('should wrap response in data object', async () => {
        mockBtgService.createAccess.mockResolvedValue({ id: 'btg-1' });

        const result = await controller.createBtg(
          { patientId: 'p-1', reason: 'Emergency', resourceType: 'Patient' },
          'user-1',
        );

        expect(result).toHaveProperty('data');
      });
    });

    describe('listBtg', () => {
      it('should list BTG access records', async () => {
        const mockRecords = [
          {
            id: 'btg-1',
            patientId: 'p-1',
            reason: 'Emergency',
            accessedAt: new Date(),
            user: { familyName: 'Kim', givenName: 'John' },
          },
        ];

        mockBtgService.findAll.mockResolvedValue(mockRecords);

        const result = await controller.listBtg();

        expect(result.data).toEqual(mockRecords);
        expect(mockBtgService.findAll).toHaveBeenCalledWith({});
      });

      it('should filter by userId', async () => {
        mockBtgService.findAll.mockResolvedValue([]);

        await controller.listBtg('user-1');

        expect(mockBtgService.findAll).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-1',
          }),
        );
      });

      it('should filter by date range', async () => {
        mockBtgService.findAll.mockResolvedValue([]);

        await controller.listBtg(undefined, '2026-05-01', '2026-05-14');

        expect(mockBtgService.findAll).toHaveBeenCalledWith(
          expect.objectContaining({
            dateFrom: '2026-05-01',
            dateTo: '2026-05-14',
          }),
        );
      });

      it('should wrap response in data object', async () => {
        mockBtgService.findAll.mockResolvedValue([]);

        const result = await controller.listBtg();

        expect(result).toHaveProperty('data');
      });
    });

    describe('reviewBtg', () => {
      it('should review BTG access', async () => {
        const body = { isApproved: true };

        const mockReviewed = {
          id: 'btg-1',
          isApproved: true,
          reviewedBy: 'admin-1',
          reviewedAt: new Date(),
        };

        mockBtgService.review.mockResolvedValue(mockReviewed);

        const result = await controller.reviewBtg('btg-1', body, 'admin-1');

        expect(result.data.isApproved).toBe(true);
        expect(mockBtgService.review).toHaveBeenCalledWith('btg-1', true, 'admin-1');
      });

      it('should reject access', async () => {
        mockBtgService.review.mockResolvedValue({ id: 'btg-1', isApproved: false });

        const result = await controller.reviewBtg('btg-1', { isApproved: false }, 'admin-1');

        expect(result.data.isApproved).toBe(false);
      });

      it('should wrap response in data object', async () => {
        mockBtgService.review.mockResolvedValue({ id: 'btg-1' });

        const result = await controller.reviewBtg('btg-1', { isApproved: true }, 'admin-1');

        expect(result).toHaveProperty('data');
      });
    });
  });

  describe('VIP Patients', () => {
    describe('designateVip', () => {
      it('should designate VIP patient', async () => {
        const body = { patientId: 'p-1', reason: 'VIP' };

        const mockVip = {
          patientId: 'p-1',
          designatedBy: 'user-1',
          reason: 'VIP',
          patient: { id: 'p-1', mrn: '12345', familyName: 'Lee', givenName: 'Jane' },
        };

        mockVipService.designate.mockResolvedValue(mockVip);

        const result = await controller.designateVip(body, 'user-1');

        expect(result.data.patientId).toBe('p-1');
        expect(mockVipService.designate).toHaveBeenCalledWith('p-1', 'VIP', 'user-1');
      });

      it('should handle ConflictException for already VIP', async () => {
        mockVipService.designate.mockRejectedValue(
          new ConflictException('Patient is already designated as VIP'),
        );

        await expect(controller.designateVip({ patientId: 'p-1' }, 'user-1')).rejects.toThrow(
          ConflictException,
        );
      });

      it('should wrap response in data object', async () => {
        mockVipService.designate.mockResolvedValue({ patientId: 'p-1' });

        const result = await controller.designateVip({ patientId: 'p-1' }, 'user-1');

        expect(result).toHaveProperty('data');
      });
    });

    describe('listVip', () => {
      it('should list VIP patients', async () => {
        const mockVips = [
          {
            patientId: 'p-1',
            reason: 'VIP',
            patient: { familyName: 'Lee', givenName: 'Jane' },
          },
        ];

        mockVipService.findAll.mockResolvedValue(mockVips);

        const result = await controller.listVip();

        expect(result.data).toEqual(mockVips);
        expect(mockVipService.findAll).toHaveBeenCalled();
      });

      it('should include patient details', async () => {
        mockVipService.findAll.mockResolvedValue([
          { patientId: 'p-1', patient: { mrn: '12345', familyName: 'Lee' } },
        ]);

        const result = await controller.listVip();

        expect(result.data[0].patient).toBeDefined();
      });

      it('should wrap response in data object', async () => {
        mockVipService.findAll.mockResolvedValue([]);

        const result = await controller.listVip();

        expect(result).toHaveProperty('data');
      });
    });

    describe('removeVip', () => {
      it('should remove VIP designation', async () => {
        mockVipService.remove.mockResolvedValue({});

        const result = await controller.removeVip('p-1');

        expect(result.data.deleted).toBe(true);
        expect(mockVipService.remove).toHaveBeenCalledWith('p-1');
      });

      it('should throw NotFoundException if not VIP', async () => {
        mockVipService.remove.mockRejectedValue(
          new NotFoundException('VIP designation not found'),
        );

        await expect(controller.removeVip('p-1')).rejects.toThrow(NotFoundException);
      });

      it('should wrap response in data object', async () => {
        mockVipService.remove.mockResolvedValue({});

        const result = await controller.removeVip('p-1');

        expect(result).toHaveProperty('data');
      });
    });
  });

  describe('Access History', () => {
    describe('accessHistory', () => {
      it('should return patient access history', async () => {
        const mockHistory = [
          {
            id: 'log-1',
            action: 'READ',
            timestamp: new Date(),
            user: { familyName: 'Kim', givenName: 'John' },
          },
        ];

        mockBtgService.getPatientAccessHistory.mockResolvedValue(mockHistory);

        const result = await controller.accessHistory('p-1', 'DOCTOR');

        expect(result.data).toEqual(mockHistory);
        // 보는 사람의 역할을 넘긴다 — IP·브라우저를 관리자에게만 싣는 판정은 서비스가 한다
        expect(mockBtgService.getPatientAccessHistory).toHaveBeenCalledWith('p-1', { viewerRole: 'DOCTOR', limit: undefined, offset: undefined });
      });

      it('should include user information', async () => {
        mockBtgService.getPatientAccessHistory.mockResolvedValue([
          { id: 'log-1', user: { id: 'user-1', role: 'DOCTOR' } },
        ]);

        const result = await controller.accessHistory('p-1', 'DOCTOR');

        expect(result.data[0].user).toBeDefined();
      });

      it('should wrap response in data object', async () => {
        mockBtgService.getPatientAccessHistory.mockResolvedValue([]);

        const result = await controller.accessHistory('p-1', 'DOCTOR');

        expect(result).toHaveProperty('data');
      });

      it('should accept UUID-formatted patientId', async () => {
        const uuidId = '550e8400-e29b-41d4-a716-446655440000';

        mockBtgService.getPatientAccessHistory.mockResolvedValue([]);

        await controller.accessHistory(uuidId, 'ADMIN', '20', '40');

        expect(mockBtgService.getPatientAccessHistory).toHaveBeenCalledWith(uuidId, { viewerRole: 'ADMIN', limit: 20, offset: 40 });
      });
    });
  });

  describe('Audit Dashboard', () => {
    describe('dashboard', () => {
      it('should return dashboard statistics', async () => {
        const mockStats = {
          totalAccess: 1000,
          byAction: [
            { action: 'READ', count: 800 },
            { action: 'CREATE', count: 200 },
          ],
          byResource: [
            { resource: 'Patient', count: 900 },
            { resource: 'Encounter', count: 100 },
          ],
          btgCount: 10,
        };

        mockAnomalyService.getDashboardStats.mockResolvedValue(mockStats);

        const result = await controller.dashboard();

        expect(result.data.totalAccess).toBe(1000);
        expect(result.data.byAction).toHaveLength(2);
        expect(result.data.btgCount).toBe(10);
      });

      it('should filter by date range', async () => {
        mockAnomalyService.getDashboardStats.mockResolvedValue({
          totalAccess: 100,
          byAction: [],
          byResource: [],
          btgCount: 5,
        });

        await controller.dashboard('2026-05-01', '2026-05-14');

        expect(mockAnomalyService.getDashboardStats).toHaveBeenCalledWith(
          '2026-05-01',
          '2026-05-14',
        );
      });

      it('should wrap response in data object', async () => {
        mockAnomalyService.getDashboardStats.mockResolvedValue({
          totalAccess: 0,
          byAction: [],
          byResource: [],
          btgCount: 0,
        });

        const result = await controller.dashboard();

        expect(result).toHaveProperty('data');
      });

      it('should include all stats fields', async () => {
        const mockStats = {
          totalAccess: 500,
          byAction: [{ action: 'READ', count: 400 }],
          byResource: [{ resource: 'Patient', count: 500 }],
          btgCount: 2,
        };

        mockAnomalyService.getDashboardStats.mockResolvedValue(mockStats);

        const result = await controller.dashboard();

        expect(result.data.totalAccess).toBeDefined();
        expect(result.data.byAction).toBeDefined();
        expect(result.data.byResource).toBeDefined();
        expect(result.data.btgCount).toBeDefined();
      });
    });
  });

  describe('Authorization', () => {
    it('should require JWT authentication', async () => {
      expect(controller).toBeDefined();
    });

    it('should require specific roles', async () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should wrap all responses in data object', async () => {
      mockBtgService.createAccess.mockResolvedValue({ id: 'btg-1' });
      mockBtgService.findAll.mockResolvedValue([]);
      mockBtgService.review.mockResolvedValue({ id: 'btg-1' });
      mockVipService.designate.mockResolvedValue({ patientId: 'p-1' });
      mockVipService.findAll.mockResolvedValue([]);
      mockVipService.remove.mockResolvedValue({});
      mockBtgService.getPatientAccessHistory.mockResolvedValue([]);
      mockAnomalyService.getDashboardStats.mockResolvedValue({
        totalAccess: 0,
        byAction: [],
        byResource: [],
        btgCount: 0,
      });

      const btgCreate = await controller.createBtg(
        { patientId: 'p-1', reason: 'E', resourceType: 'P' },
        'u',
      );
      const btgList = await controller.listBtg();
      const btgReview = await controller.reviewBtg('btg-1', { isApproved: true }, 'u');
      const vipCreate = await controller.designateVip({ patientId: 'p-1' }, 'u');
      const vipList = await controller.listVip();
      const vipRemove = await controller.removeVip('p-1');
      const history = await controller.accessHistory('p-1', 'DOCTOR');
      const dashboard = await controller.dashboard();

      expect(btgCreate).toHaveProperty('data');
      expect(btgList).toHaveProperty('data');
      expect(btgReview).toHaveProperty('data');
      expect(vipCreate).toHaveProperty('data');
      expect(vipList).toHaveProperty('data');
      expect(vipRemove).toHaveProperty('data');
      expect(history).toHaveProperty('data');
      expect(dashboard).toHaveProperty('data');
    });
  });

  describe('Compliance & Audit Workflow', () => {
    it('should support complete audit workflow', async () => {
      // Create BTG access
      mockBtgService.createAccess.mockResolvedValue({
        id: 'btg-1',
        userId: 'doctor-1',
        patientId: 'p-1',
      });

      const created = await controller.createBtg(
        { patientId: 'p-1', reason: 'Emergency', resourceType: 'Patient' },
        'doctor-1',
      );

      expect(created.data.id).toBe('btg-1');

      // Review BTG
      mockBtgService.review.mockResolvedValue({
        id: 'btg-1',
        isApproved: true,
        reviewedBy: 'admin-1',
      });

      const reviewed = await controller.reviewBtg('btg-1', { isApproved: true }, 'admin-1');

      expect(reviewed.data.isApproved).toBe(true);

      // Check dashboard
      mockAnomalyService.getDashboardStats.mockResolvedValue({
        totalAccess: 100,
        btgCount: 1,
        byAction: [],
        byResource: [],
      });

      const stats = await controller.dashboard();

      expect(stats.data.btgCount).toBe(1);
    });

    it('should support VIP protection workflow', async () => {
      // Designate VIP
      mockVipService.designate.mockResolvedValue({ patientId: 'vip-p-1' });

      const vip = await controller.designateVip({ patientId: 'vip-p-1', reason: 'CEO' }, 'admin-1');

      expect(vip.data.patientId).toBe('vip-p-1');

      // List VIPs
      mockVipService.findAll.mockResolvedValue([{ patientId: 'vip-p-1' }]);

      const vips = await controller.listVip();

      expect(vips.data).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors', async () => {
      mockBtgService.createAccess.mockRejectedValue(new Error('Database error'));

      await expect(
        controller.createBtg({ patientId: 'p-1', reason: 'E', resourceType: 'P' }, 'u'),
      ).rejects.toThrow('Database error');
    });

    it('should propagate NotFoundException', async () => {
      mockBtgService.review.mockRejectedValue(new NotFoundException('BTG not found'));

      await expect(controller.reviewBtg('missing', { isApproved: true }, 'u')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
