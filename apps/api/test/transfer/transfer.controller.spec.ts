import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransferController } from '../../src/modules/transfer/transfer.controller';

describe('TransferController', () => {
  let controller: TransferController;
  let mockService: any;

  const mockTransfer = {
    id: 'transfer-uuid',
    patientId: 'patient-uuid',
    fromOrgId: 'org-self',
    toOrgId: 'org-partner',
    transferType: 'OUTGOING_REFERRAL',
    status: 'REQUESTED',
    urgency: 'URGENT',
    reason: '상급병원 전문 진료 필요',
    requestedBy: 'doctor-uuid',
    requestedAt: new Date(),
    patient: { familyName: '김', givenName: '환자', mrn: 'MRN-001' },
    fromOrg: { name: '우리병원', code: 'WERUBYHOSP' },
    toOrg: { name: '가상대병원', code: '11100001' },
  };

  beforeEach(() => {
    mockService = {
      create: vi.fn().mockResolvedValue(mockTransfer),
      findAll: vi.fn().mockResolvedValue([mockTransfer]),
      findOne: vi.fn().mockResolvedValue(mockTransfer),
      getIncoming: vi.fn().mockResolvedValue([{ ...mockTransfer, transferType: 'INCOMING_REFERRAL' }]),
      accept: vi.fn().mockResolvedValue({ ...mockTransfer, status: 'ACCEPTED' }),
      reject: vi.fn().mockResolvedValue({ ...mockTransfer, status: 'REJECTED' }),
      complete: vi.fn().mockResolvedValue({ ...mockTransfer, status: 'COMPLETED' }),
      getBundle: vi.fn().mockResolvedValue({ resourceType: 'Bundle', type: 'document', entry: [] }),
      sendBundle: vi.fn().mockResolvedValue({ sent: true }),
    };
    controller = new TransferController(mockService);
  });

  describe('createTransfer', () => {
    it('전원 요청 생성', async () => {
      const dto = { patientId: 'p1', toOrgId: 'o1', urgency: 'URGENT', reason: '이유', transferType: 'OUTGOING_REFERRAL' };
      const result = await controller.createTransfer(dto, 'doctor-uuid');
      expect(result.data).toEqual(mockTransfer);
      expect(mockService.create).toHaveBeenCalledWith(dto, 'doctor-uuid');
    });
  });

  describe('findAll', () => {
    it('전체 전원 목록 조회', async () => {
      const result = await controller.findAll();
      expect(result.data).toHaveLength(1);
    });

    it('상태 필터링', async () => {
      await controller.findAll('REQUESTED');
      expect(mockService.findAll).toHaveBeenCalledWith('REQUESTED');
    });
  });

  describe('getIncoming', () => {
    it('수신 전원 목록 조회', async () => {
      const result = await controller.getIncoming();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].transferType).toBe('INCOMING_REFERRAL');
    });
  });

  describe('findOne', () => {
    it('전원 상세 조회', async () => {
      const result = await controller.findOne('transfer-uuid');
      expect(result.data.id).toBe('transfer-uuid');
    });
  });

  describe('accept', () => {
    it('전원 수락', async () => {
      const result = await controller.accept('transfer-uuid', 'doctor-uuid');
      expect(result.data.status).toBe('ACCEPTED');
    });
  });

  describe('reject', () => {
    it('전원 거절', async () => {
      const result = await controller.reject('transfer-uuid', { reason: '수용 불가' });
      expect(result.data.status).toBe('REJECTED');
    });
  });

  describe('complete', () => {
    it('전원 완료', async () => {
      const result = await controller.complete('transfer-uuid');
      expect(result.data.status).toBe('COMPLETED');
    });
  });

  describe('getBundle', () => {
    it('FHIR Bundle 조회', async () => {
      const result = await controller.getBundle('transfer-uuid');
      expect(result.data.resourceType).toBe('Bundle');
    });
  });

  describe('sendBundle', () => {
    it('FHIR Bundle 전송', async () => {
      const result = await controller.sendBundle('transfer-uuid');
      expect(result.data.sent).toBe(true);
    });
  });
});
