import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HieController } from '../../src/modules/hie/hie.controller';

describe('HieController', () => {
  let controller: HieController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      sendPatientSummary: vi.fn(),
      receiveExternalRecord: vi.fn(),
      getExchangeLog: vi.fn(),
      getExchangeDetail: vi.fn(),
      getStats: vi.fn(),
    };
    controller = new HieController(mockService);
  });

  describe('send', () => {
    it('should send patient summary to target organization', async () => {
      const body = { targetOrgId: 'org-456', documentType: 'TRSF' };
      const mockResult = { exchangeId: 'ex-1', status: 'SENT', documentType: 'TRSF' };
      mockService.sendPatientSummary.mockResolvedValue(mockResult);

      const result = await controller.send('p-1', body);

      expect(result.data.status).toBe('SENT');
      expect(mockService.sendPatientSummary).toHaveBeenCalledWith('p-1', body);
    });

    it('should wrap response in data object', async () => {
      mockService.sendPatientSummary.mockResolvedValue({ status: 'SENT' });

      const result = await controller.send('p-1', { targetOrgId: 'org-456', documentType: 'TRSF' });

      expect(result).toHaveProperty('data');
    });

    it('should pass the full body (targetOrgId + documentType + format) to the service', async () => {
      mockService.sendPatientSummary.mockResolvedValue({ status: 'SENT' });
      const body = { targetOrgId: 'org-456', documentType: 'DSCH', format: 'FHIR_R4' as const };

      await controller.send('p-123', body);

      expect(mockService.sendPatientSummary).toHaveBeenCalledWith('p-123', body);
    });

    it('should send to different target organizations', async () => {
      mockService.sendPatientSummary.mockResolvedValue({ status: 'SENT' });

      await controller.send('p-1', { targetOrgId: 'org-A', documentType: 'TRSF' });
      await controller.send('p-1', { targetOrgId: 'org-B', documentType: 'TRSF' });

      expect(mockService.sendPatientSummary).toHaveBeenNthCalledWith(1, 'p-1', { targetOrgId: 'org-A', documentType: 'TRSF' });
      expect(mockService.sendPatientSummary).toHaveBeenNthCalledWith(2, 'p-1', { targetOrgId: 'org-B', documentType: 'TRSF' });
    });

    it('should accept UUID format for patientId', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      mockService.sendPatientSummary.mockResolvedValue({ status: 'SENT' });

      await controller.send(uuidId, { targetOrgId: 'org-456', documentType: 'TRSF' });

      expect(mockService.sendPatientSummary).toHaveBeenCalledWith(uuidId, { targetOrgId: 'org-456', documentType: 'TRSF' });
    });
  });

  describe('receive', () => {
    it('should receive external FHIR record', async () => {
      const dto = { fhirBundle: { resourceType: 'Bundle', type: 'document' } };
      const mockResult = { exchangeId: 'ex-2', status: 'RECEIVED' };
      mockService.receiveExternalRecord.mockResolvedValue(mockResult);

      const result = await controller.receive(dto);

      expect(result.data.status).toBe('RECEIVED');
      expect(mockService.receiveExternalRecord).toHaveBeenCalledWith(dto);
    });

    it('should wrap response in data object', async () => {
      mockService.receiveExternalRecord.mockResolvedValue({ status: 'RECEIVED' });

      const result = await controller.receive({ fhirBundle: { type: 'document' } });

      expect(result).toHaveProperty('data');
    });

    it('should accept a CDA document payload', async () => {
      const dto = { cdaDocument: '<ClinicalDocument/>', sourceOrgId: 'org-123' };
      mockService.receiveExternalRecord.mockResolvedValue({ status: 'RECEIVED' });

      const result = await controller.receive(dto);

      expect(result.data.status).toBe('RECEIVED');
      expect(mockService.receiveExternalRecord).toHaveBeenCalledWith(dto);
    });
  });

  describe('getLog', () => {
    it('should get exchange log with parsed pagination', async () => {
      const mockResult = { logs: [], total: 0, page: 1, limit: 20 };
      mockService.getExchangeLog.mockResolvedValue(mockResult);

      const result = await controller.getLog();

      expect(result.data.logs).toBeDefined();
      expect(mockService.getExchangeLog).toHaveBeenCalledWith(undefined, undefined, 1, 20);
    });

    it('should wrap response in data object', async () => {
      mockService.getExchangeLog.mockResolvedValue({ logs: [] });

      const result = await controller.getLog();

      expect(result).toHaveProperty('data');
    });

    it('should pass filters and parse page/limit to integers', async () => {
      mockService.getExchangeLog.mockResolvedValue({ logs: [] });

      await controller.getLog('p-1', 'SEND', '3', '50');

      expect(mockService.getExchangeLog).toHaveBeenCalledWith('p-1', 'SEND', 3, 50);
    });

    it('should default page to 1 and limit to 20 when omitted', async () => {
      mockService.getExchangeLog.mockResolvedValue({ logs: [] });

      await controller.getLog('p-1');

      expect(mockService.getExchangeLog).toHaveBeenCalledWith('p-1', undefined, 1, 20);
    });
  });

  describe('getDetail', () => {
    it('should return an exchange detail wrapped in data', async () => {
      mockService.getExchangeDetail.mockResolvedValue({ id: 'ex-1' });

      const result = await controller.getDetail('ex-1');

      expect(result.data.id).toBe('ex-1');
      expect(mockService.getExchangeDetail).toHaveBeenCalledWith('ex-1');
    });
  });

  describe('getStats', () => {
    it('should return exchange statistics wrapped in data', async () => {
      const stats = { total: 10, recentMonth: 3, byDirection: {}, byDocType: {}, byStatus: {} };
      mockService.getStats.mockResolvedValue(stats);

      const result = await controller.getStats();

      expect(result.data).toEqual(stats);
      expect(mockService.getStats).toHaveBeenCalled();
    });
  });

  describe('Authorization', () => {
    it('should be defined (guards/roles applied via decorators)', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      mockService.sendPatientSummary.mockRejectedValue(new Error('Service error'));

      await expect(
        controller.send('p-1', { targetOrgId: 'org-456', documentType: 'TRSF' }),
      ).rejects.toThrow('Service error');
    });
  });
});
