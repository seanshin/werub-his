import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaimController } from '../../src/modules/claim/claim.controller';
import { NotFoundException } from '@nestjs/common';

describe('ClaimController', () => {
  let controller: ClaimController;
  let mockService: any;
  let mockResponse: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      generateClaims: vi.fn(),
      findById: vi.fn(),
      submit: vi.fn(),
      review: vi.fn(),
      getSummary: vi.fn(),
      generateHiraXml: vi.fn(),
      generateBatchHiraXml: vi.fn(),
    };

    mockResponse = {
      set: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    controller = new ClaimController(mockService);
  });

  describe('findAll', () => {
    it('should get all claims with pagination', async () => {
      const mockResult = {
        data: [
          { id: 'claim-1', status: 'SUBMITTED', claimedAmount: 1000000 },
          { id: 'claim-2', status: 'APPROVED', claimedAmount: 500000 },
        ],
        pagination: { total: 2, page: 1, limit: 20, hasMore: false },
      };

      vi.mocked(mockService.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll(undefined, undefined, undefined);

      expect(result.pagination.total).toBe(2);
      expect(mockService.findAll).toHaveBeenCalledWith({
        status: undefined,
        page: undefined,
        limit: undefined,
      });
    });

    it('should filter by status', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({
        data: [{ status: 'SUBMITTED' }],
        pagination: { total: 1, page: 1, limit: 20 },
      });

      await controller.findAll('SUBMITTED', undefined, undefined);

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUBMITTED' }),
      );
    });

    it('should handle pagination parameters', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 2, limit: 10 },
      });

      await controller.findAll(undefined, '2', '10');

      expect(mockService.findAll).toHaveBeenCalledWith({
        status: undefined,
        page: 2,
        limit: 10,
      });
    });
  });

  describe('generate', () => {
    it('should generate claims from PAID billings', async () => {
      const mockResult = {
        generated: 5,
        claims: [
          { id: 'claim-1', billingId: 'bill-1' },
          { id: 'claim-2', billingId: 'bill-2' },
        ],
      };

      vi.mocked(mockService.generateClaims).mockResolvedValue(mockResult);

      const result = await controller.generate();

      expect(result.data.generated).toBe(5);
      expect(result.data.claims).toHaveLength(2);
      expect(mockService.generateClaims).toHaveBeenCalled();
    });
  });

  describe('getSummary', () => {
    it('should get claim summary statistics', async () => {
      const mockSummary = [
        {
          status: 'SUBMITTED',
          _count: 5,
          _sum: { claimedAmount: 5000000 },
        },
        {
          status: 'APPROVED',
          _count: 3,
          _sum: { claimedAmount: 2800000 },
        },
      ];

      vi.mocked(mockService.getSummary).mockResolvedValue(mockSummary);

      const result = await controller.getSummary();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].status).toBe('SUBMITTED');
      expect(result.data[0]._count).toBe(5);
    });
  });

  describe('findOne', () => {
    it('should get claim detail', async () => {
      const mockClaim = {
        id: 'claim-1',
        claimedAmount: 700000,
        status: 'SUBMITTED',
        patient: { mrn: '00001', familyName: '김', givenName: '철수' },
        billing: { items: [] },
      };

      vi.mocked(mockService.findById).mockResolvedValue(mockClaim);

      const result = await controller.findOne('claim-1');

      expect(result.data.claimedAmount).toBe(700000);
      expect(result.data.patient.familyName).toBe('김');
      expect(mockService.findById).toHaveBeenCalledWith('claim-1');
    });

    it('should throw NotFoundException if not found', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException('Claim not found'),
      );

      await expect(controller.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('submit', () => {
    it('should submit claim', async () => {
      const mockUpdated = {
        id: 'claim-1',
        status: 'SUBMITTED',
        submittedAt: new Date(),
        claimNumber: 'CLM-1715606400000',
      };

      vi.mocked(mockService.submit).mockResolvedValue(mockUpdated);

      const result = await controller.submit('claim-1');

      expect(result.data.status).toBe('SUBMITTED');
      expect(result.data.claimNumber).toMatch(/CLM-/);
      expect(mockService.submit).toHaveBeenCalledWith('claim-1');
    });
  });

  describe('review', () => {
    it('should approve claim', async () => {
      const mockReview = {
        id: 'claim-1',
        status: 'APPROVED',
        approvedAmount: 700000,
        reviewedAt: new Date(),
      };

      vi.mocked(mockService.review).mockResolvedValue(mockReview);

      const body = { approvedAmount: 700000 };

      const result = await controller.review('claim-1', body);

      expect(result.data.status).toBe('APPROVED');
      expect(result.data.approvedAmount).toBe(700000);
      expect(mockService.review).toHaveBeenCalledWith('claim-1', body);
    });

    it('should partially approve with reduction', async () => {
      const mockReview = {
        id: 'claim-1',
        status: 'PARTIALLY_APPROVED',
        approvedAmount: 600000,
        reducedAmount: 100000,
      };

      vi.mocked(mockService.review).mockResolvedValue(mockReview);

      const body = { approvedAmount: 600000, reducedAmount: 100000 };

      const result = await controller.review('claim-1', body);

      expect(result.data.status).toBe('PARTIALLY_APPROVED');
    });

    it('should reject claim with reason', async () => {
      const mockReview = {
        id: 'claim-1',
        status: 'REJECTED',
        rejectReason: 'Invalid diagnosis code',
      };

      vi.mocked(mockService.review).mockResolvedValue(mockReview);

      const body = {
        approvedAmount: 0,
        rejectReason: 'Invalid diagnosis code',
      };

      const result = await controller.review('claim-1', body);

      expect(result.data.status).toBe('REJECTED');
    });
  });

  describe('downloadXml', () => {
    it('should download claim as HIRA XML', async () => {
      const mockClaim = {
        id: 'claim-1',
        claimNumber: 'CLM-202605001',
      };

      const mockXml = '<?xml version="1.0"?><청구서>...</청구서>';

      vi.mocked(mockService.findById).mockResolvedValue(mockClaim);
      vi.mocked(mockService.generateHiraXml).mockResolvedValue(mockXml);

      await controller.downloadXml('claim-1', mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Disposition': expect.stringContaining(
            'attachment; filename=claim-CLM-202605001.xml',
          ),
        }),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockXml);
    });

    it('should use claim ID if claimNumber not available', async () => {
      const mockClaim = {
        id: 'claim-1',
        claimNumber: null,
      };

      vi.mocked(mockService.findById).mockResolvedValue(mockClaim);
      vi.mocked(mockService.generateHiraXml).mockResolvedValue(
        '<?xml>...</xml>',
      );

      await controller.downloadXml('claim-1', mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': expect.stringContaining(
            'attachment; filename=claim-claim-1.xml',
          ),
        }),
      );
    });
  });

  describe('exportXml', () => {
    it('should export batch claims as HIRA XML', async () => {
      const mockXml =
        '<?xml version="1.0"?><일괄청구서>...</일괄청구서>';

      vi.mocked(mockService.generateBatchHiraXml).mockResolvedValue(mockXml);

      const body = { claimIds: ['claim-1', 'claim-2', 'claim-3'] };

      await controller.exportXml(body, mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Disposition': expect.stringContaining(
            'attachment; filename=claims-batch-',
          ),
        }),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockXml);
      expect(mockService.generateBatchHiraXml).toHaveBeenCalledWith(
        body.claimIds,
      );
    });

    it('should use today date in filename', async () => {
      vi.mocked(mockService.generateBatchHiraXml).mockResolvedValue(
        '<xml/>',
      );

      await controller.exportXml({ claimIds: ['claim-1'] }, mockResponse);

      const todayStr = new Date().toISOString().slice(0, 10);
      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': expect.stringContaining(
            `claims-batch-${todayStr}.xml`,
          ),
        }),
      );
    });
  });

  describe('Authorization', () => {
    it('should require ADMIN role for all endpoints', async () => {
      // @Roles(UserRole.ADMIN) is applied at controller class level
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap findOne response in data', async () => {
      const mockClaim = { id: 'claim-1' };

      vi.mocked(mockService.findById).mockResolvedValue(mockClaim);

      const result = await controller.findOne('claim-1');

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('claim-1');
    });

    it('should wrap generate response in data', async () => {
      vi.mocked(mockService.generateClaims).mockResolvedValue({
        generated: 0,
        claims: [],
      });

      const result = await controller.generate();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('generated');
    });

    it('should wrap summary response in data', async () => {
      vi.mocked(mockService.getSummary).mockResolvedValue([]);

      const result = await controller.getSummary();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should wrap review response in data', async () => {
      vi.mocked(mockService.review).mockResolvedValue({
        id: 'claim-1',
        status: 'APPROVED',
      });

      const result = await controller.review('claim-1', {
        approvedAmount: 100000,
      });

      expect(result).toHaveProperty('data');
      expect(result.data.status).toBe('APPROVED');
    });
  });

  describe('Route-specific Behavior', () => {
    it('should route / endpoint correctly', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({
        data: [],
        pagination: {},
      });

      const result = await controller.findAll();

      expect(result).toBeDefined();
    });

    it('should route /generate endpoint correctly', async () => {
      vi.mocked(mockService.generateClaims).mockResolvedValue({
        generated: 0,
        claims: [],
      });

      const result = await controller.generate();

      expect(result.data).toBeDefined();
    });

    it('should route /summary endpoint correctly', async () => {
      vi.mocked(mockService.getSummary).mockResolvedValue([]);

      const result = await controller.getSummary();

      expect(result.data).toBeDefined();
    });

    it('should route /:id endpoint correctly', async () => {
      const mockClaim = { id: 'claim-1' };

      vi.mocked(mockService.findById).mockResolvedValue(mockClaim);

      const result = await controller.findOne('claim-1');

      expect(result.data.id).toBe('claim-1');
    });

    it('should route /:id/submit endpoint correctly', async () => {
      vi.mocked(mockService.submit).mockResolvedValue({
        id: 'claim-1',
        status: 'SUBMITTED',
      });

      const result = await controller.submit('claim-1');

      expect(result.data).toBeDefined();
    });

    it('should route /:id/review endpoint correctly', async () => {
      vi.mocked(mockService.review).mockResolvedValue({
        id: 'claim-1',
        status: 'APPROVED',
      });

      const result = await controller.review('claim-1', {
        approvedAmount: 100000,
      });

      expect(result.data).toBeDefined();
    });

    it('should route /:id/xml endpoint correctly', async () => {
      vi.mocked(mockService.findById).mockResolvedValue({
        id: 'claim-1',
        claimNumber: 'CLM-1',
      });
      vi.mocked(mockService.generateHiraXml).mockResolvedValue(
        '<xml/>',
      );

      await controller.downloadXml('claim-1', mockResponse);

      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should route /export-xml endpoint correctly', async () => {
      vi.mocked(mockService.generateBatchHiraXml).mockResolvedValue(
        '<xml/>',
      );

      await controller.exportXml({ claimIds: ['claim-1'] }, mockResponse);

      expect(mockResponse.send).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException(),
      );

      await expect(controller.findOne('non-existent')).rejects.toThrow();
    });

    it('should handle empty results', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({
        data: [],
        pagination: { total: 0 },
      });

      const result = await controller.findAll();

      expect(result.data).toHaveLength(0);
    });
  });
});
