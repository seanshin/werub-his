import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BtgService } from '../../src/modules/audit-enhanced/btg.service';

describe('BtgService', () => {
  let service: BtgService;
  let mockPrisma: any;

  const mockAccess = {
    id: 'btg-1',
    userId: 'user-1',
    patientId: 'patient-1',
    reason: 'Emergency access required',
    resourceType: 'Patient',
    resourceId: 'patient-1',
    accessedAt: new Date('2026-05-14T10:00:00Z'),
    reviewedBy: null,
    reviewedAt: null,
    isApproved: null,
    user: { id: 'user-1', familyName: '김', givenName: '의사', role: 'DOCTOR' },
    patient: { id: 'patient-1', mrn: 'MRN001', familyName: '박', givenName: '환자' },
  };

  const mockLog = {
    id: 'log-1',
    userId: 'user-1',
    action: 'READ',
    resourceType: 'Patient',
    resourceId: 'patient-1',
    timestamp: new Date(),
    user: { id: 'user-1', familyName: '김', givenName: '의사', role: 'DOCTOR' },
  };

  beforeEach(() => {
    mockPrisma = {
      breakTheGlassAccess: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        findMany: vi.fn(),
        count: vi.fn(async () => 1),
      },
    };

    service = new BtgService(mockPrisma);
  });

  describe('createAccess', () => {
    it('should create BTG access record', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.create).mockResolvedValue(mockAccess);

      const result = await service.createAccess(
        { patientId: 'patient-1', reason: 'Emergency', resourceType: 'Patient' },
        'user-1'
      );

      expect(result.id).toBe('btg-1');
      expect(result.userId).toBe('user-1');
      expect(mockPrisma.breakTheGlassAccess.create).toHaveBeenCalled();
    });

    it('should include user and patient details', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.create).mockResolvedValue(mockAccess);

      const result = await service.createAccess(
        { patientId: 'patient-1', reason: 'Emergency', resourceType: 'Patient' },
        'user-1'
      );

      expect(result.user).toBeDefined();
      expect(result.patient).toBeDefined();
    });

    it('should set accessedAt to current date', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.create).mockResolvedValue(mockAccess);

      const result = await service.createAccess(
        { patientId: 'patient-1', reason: 'Emergency', resourceType: 'Patient' },
        'user-1'
      );

      expect(result.accessedAt).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('should return all BTG accesses', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.findMany).mockResolvedValue([mockAccess]);

      const result = await service.findAll({});

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should filter by userId', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.findMany).mockResolvedValue([mockAccess]);

      await service.findAll({ userId: 'user-1' });

      expect(mockPrisma.breakTheGlassAccess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        })
      );
    });

    it('should filter by date range', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.findMany).mockResolvedValue([mockAccess]);

      await service.findAll({
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
      });

      expect(mockPrisma.breakTheGlassAccess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accessedAt: expect.any(Object),
          }),
        })
      );
    });

    it('should order by accessedAt descending', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.findMany).mockResolvedValue([mockAccess]);

      await service.findAll({});

      expect(mockPrisma.breakTheGlassAccess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { accessedAt: 'desc' },
        })
      );
    });

    it('should limit results to 100', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.findMany).mockResolvedValue([mockAccess]);

      await service.findAll({});

      expect(mockPrisma.breakTheGlassAccess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        })
      );
    });
  });

  describe('review', () => {
    it('should review BTG access', async () => {
      const reviewed = { ...mockAccess, isApproved: true, reviewedBy: 'reviewer-1', reviewedAt: new Date() };
      vi.mocked(mockPrisma.breakTheGlassAccess.findUnique).mockResolvedValue(mockAccess);
      vi.mocked(mockPrisma.breakTheGlassAccess.update).mockResolvedValue(reviewed);

      const result = await service.review('btg-1', true, 'reviewer-1');

      expect(result.isApproved).toBe(true);
      expect(result.reviewedBy).toBe('reviewer-1');
    });

    it('should set reviewedAt timestamp', async () => {
      const reviewed = { ...mockAccess, isApproved: true, reviewedBy: 'reviewer-1', reviewedAt: new Date() };
      vi.mocked(mockPrisma.breakTheGlassAccess.findUnique).mockResolvedValue(mockAccess);
      vi.mocked(mockPrisma.breakTheGlassAccess.update).mockResolvedValue(reviewed);

      const result = await service.review('btg-1', true, 'reviewer-1');

      expect(result.reviewedAt).toBeDefined();
    });

    it('should throw NotFoundException if not found', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.findUnique).mockResolvedValue(null);

      await expect(service.review('nonexistent', true, 'reviewer-1')).rejects.toThrow(NotFoundException);
    });

    it('should allow approve or deny', async () => {
      vi.mocked(mockPrisma.breakTheGlassAccess.findUnique).mockResolvedValue(mockAccess);
      vi.mocked(mockPrisma.breakTheGlassAccess.update).mockResolvedValue({
        ...mockAccess,
        isApproved: false,
      });

      const result = await service.review('btg-1', false, 'reviewer-1');

      expect(result.isApproved).toBe(false);
    });
  });

  /**
   * 2026-10-02 — 환자 차트 '의무기록' 탭이 쓴다. 🔴 종전엔 50건에서 말없이 잘렸고 다른 직원의 IP·브라우저를 의사·간호사에게 돌려줬다.
   */
  describe('getPatientAccessHistory', () => {
    const log = { ...mockLog, ipAddress: '10.0.0.7', userAgent: 'Mozilla', changes: { secret: 1 } };

    it('🔴 환자 전체 자원(resourceType 고정 없음) · 최신순 · 전체 수와 쪽 나눔을 준다', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([log]);
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(137);
      const r = await service.getPatientAccessHistory('patient-1', { limit: 20, offset: 40 });
      const arg = vi.mocked(mockPrisma.auditLog.findMany).mock.calls[0][0];
      expect(arg.where).toEqual({ resourceId: 'patient-1' });
      expect(arg.orderBy).toEqual({ timestamp: 'desc' });
      expect(arg.take).toBe(20);
      expect(arg.skip).toBe(40);
      expect(r).toMatchObject({ total: 137, limit: 20, offset: 40 });
    });

    it('🔴 IP·브라우저는 관리자에게만 — 변경 내용(changes)은 누구에게도 싣지 않는다', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([log]);
      const doc = await service.getPatientAccessHistory('patient-1', { viewerRole: 'DOCTOR' });
      expect(doc.items[0]).not.toHaveProperty('ipAddress');
      expect(doc.items[0]).not.toHaveProperty('userAgent');
      expect(doc.networkVisible).toBe(false);
      const sel = vi.mocked(mockPrisma.auditLog.findMany).mock.calls[0][0].select;
      expect(sel).not.toHaveProperty('changes');
      // 대조군: 관리자는 본다
      const adm = await service.getPatientAccessHistory('patient-1', { viewerRole: 'ADMIN' });
      expect(adm.items[0]).toMatchObject({ ipAddress: '10.0.0.7', userAgent: 'Mozilla' });
    });

    it('한 쪽 상한 200 · 음수 offset 은 0', async () => {
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([]);
      const r = await service.getPatientAccessHistory('patient-1', { limit: 5000, offset: -3 });
      expect(r.limit).toBe(200);
      expect(r.offset).toBe(0);
    });
  });
});
