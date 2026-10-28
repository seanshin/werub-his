import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ResearchController } from '../../src/modules/research/research.controller';

describe('ResearchController', () => {
  let controller: ResearchController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn().mockResolvedValue([
        { id: 'study-1', studyNo: 'IRB-2026-001', title: '심부전 AI 진단 연구', irbStatus: 'APPROVED' },
      ]),
      findOne: vi.fn().mockResolvedValue({ id: 'study-1', subjects: [], documents: [], amendments: [] }),
      create: vi.fn().mockResolvedValue({ id: 'study-new', studyNo: 'IRB-2026-002' }),
      update: vi.fn().mockResolvedValue({ id: 'study-1', updated: true }),
      approve: vi.fn().mockResolvedValue({ id: 'study-1', irbStatus: 'APPROVED' }),
      addSubject: vi.fn().mockResolvedValue({ id: 'subj-1', subjectNo: 'SUBJ-0001', status: 'ENROLLED' }),
      withdrawSubject: vi.fn().mockResolvedValue({ id: 'subj-1', status: 'WITHDRAWN' }),
      addDocument: vi.fn().mockResolvedValue({ id: 'doc-1', docType: 'PROTOCOL' }),
      addAmendment: vi.fn().mockResolvedValue({ id: 'amd-1', amendmentNo: 1, status: 'SUBMITTED' }),
      getStats: vi.fn().mockResolvedValue({
        totalStudies: 28, activeStudies: 12, totalSubjects: 456,
        byType: [{ type: 'INTERVENTIONAL', count: 12 }], byStatus: [{ status: 'APPROVED', count: 12 }],
      }),
    };
    controller = new ResearchController(mockService);
  });

  describe('findAll', () => {
    it('should return research study list', async () => {
      const result = await controller.findAll(undefined, undefined);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].studyNo).toBe('IRB-2026-001');
    });
  });

  describe('create', () => {
    it('should create a new study', async () => {
      const body = { title: '신규 연구', studyType: 'RCT', department: '순환기내과' };
      const result = await controller.create(body, 'user-1');
      expect(result.data.studyNo).toBe('IRB-2026-002');
    });
  });

  describe('approve', () => {
    it('승인서 만료일을 body 로 받아 서비스에 넘긴다', async () => {
      await controller.approve('study-1', { irbExpiryDate: '2027-12-31' });
      expect(mockService.approve).toHaveBeenCalledWith('study-1', { irbExpiryDate: '2027-12-31' });
    });

    it('만료일 없이도 승인은 가능하다 (시스템이 날짜를 지어내지 않는다)', async () => {
      await controller.approve('study-1', undefined);
      expect(mockService.approve).toHaveBeenCalledWith('study-1', { irbExpiryDate: null });
    });
  });

  describe('addSubject', () => {
    it('should enroll a patient as subject', async () => {
      const body = { patientId: 'pat-1', armGroup: 'TREATMENT' };
      const result = await controller.addSubject('study-1', body, 'user-1');
      expect(result.data.status).toBe('ENROLLED');
    });
  });

  describe('withdrawSubject', () => {
    it('🔴 사유는 body 전체에서 읽는다 — 종전 @Body(\'reason\') 은 화면의 withdrawReason 을 흘렸다', async () => {
      await controller.withdrawSubject('subj-1', { reason: '이상반응' });
      expect(mockService.withdrawSubject).toHaveBeenCalledWith('subj-1', '이상반응');
    });

    it('구 키(withdrawReason)로 와도 유실되지 않는다', async () => {
      await controller.withdrawSubject('subj-1', { withdrawReason: '동의 철회' });
      expect(mockService.withdrawSubject).toHaveBeenCalledWith('subj-1', '동의 철회');
    });
  });

  describe('addAmendment', () => {
    it('should submit IRB amendment', async () => {
      const body = { reason: '선정기준 변경', changes: { ageCriteria: '18~70세' } };
      const result = await controller.addAmendment('study-1', body);
      expect(result.data.status).toBe('SUBMITTED');
    });

    it('🔴 studyId 없는 변경심의는 String(undefined) 로 흘려보내지 않는다', async () => {
      await expect(controller.submitIrbAmendment({ reason: '변경' })).rejects.toThrow(BadRequestException);
      expect(mockService.addAmendment).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return research statistics', async () => {
      const result = await controller.getStats();
      expect(result.data.totalStudies).toBe(28);
      expect(result.data.activeStudies).toBe(12);
      expect(Array.isArray(result.data.byType)).toBe(true);
    });
  });

  it('🔴 research 모듈의 CDM mock 핸들러 2종은 제거됐다 (정본=omop-cdm)', () => {
    expect((controller as unknown as Record<string, unknown>).convertCdm).toBeUndefined();
    expect((controller as unknown as Record<string, unknown>).getCdmTables).toBeUndefined();
  });
});
