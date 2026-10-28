import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { MdtService, MDT_SUMMARY_PROMPT_VERSION } from '../../src/modules/mdt/mdt.service';

describe('MdtService', () => {
  let service: MdtService;
  let mockPrisma: any;
  let mockAi: any;
  let mockProposal: any;

  const mockConference = {
    id: 'conf-1',
    title: '폐암 MDT 컨퍼런스',
    conferenceType: 'TUMOR_BOARD',
    department: 'ONCOLOGY',
    scheduledAt: new Date('2026-05-15T14:00:00Z'),
    location: '3층 컨퍼런스룸',
    chairpersonId: 'user-1',
    status: 'SCHEDULED',
    notes: null,
    recordingUrl: null,
  };

  const mockCase = {
    id: 'case-1',
    conferenceId: 'conf-1',
    patientId: 'pat-1',
    presenterId: 'doc-1',
    primaryDiag: 'C34.1',
    tnmStage: 'T2N1M0',
    clinicalSummary: null,
    imagingSummary: null,
    pathologySummary: null,
    labSummary: null,
    proposedPlan: null,
    decision: null,
    decisionCategory: null,
    followUp: null,
    sortOrder: 0,
  };

  const mockAttendee = {
    id: 'att-1',
    conferenceId: 'conf-1',
    userId: 'doc-2',
    department: 'RADIOLOGY',
    role: 'REVIEWER',
    attended: false,
  };

  beforeEach(() => {
    mockPrisma = {
      mdtConference: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      mdtCase: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        aggregate: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      mdtAttendee: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      patientJourneyEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
      // 참석자·의장 이름 해석(resolveUserNames)이 쓰는 테이블
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    // 🔴 목은 정본의 실제 반환 모양을 쓴다 — MedicalAiService.reference 는 `{ answer, model_used, disclaimer }`
    //    형태의 객체(또는 문자열)를 주고, getDisclaimer() 는 문자열을 준다.
    mockAi = {
      reference: vi.fn().mockResolvedValue({ answer: 'AI summary of clinical case', model_used: 'weru-b' }),
      getDisclaimer: vi.fn().mockResolvedValue('본 정보는 참고용입니다'),
    };

    // 🔴 목은 정본의 실제 반환 모양 — AiProposalService.create() 는 생성된 제안 **행**을 돌려준다
    mockProposal = {
      create: vi.fn().mockResolvedValue({ id: 'prop-1', status: 'GENERATED' }),
      decide: vi.fn(),
    };

    service = new MdtService(mockPrisma, mockAi as any, mockProposal as any);
  });

  describe('findAll', () => {
    it('should return conferences with case and attendee counts', async () => {
      mockPrisma.mdtConference.findMany.mockResolvedValue([
        { ...mockConference, _count: { cases: 3, attendees: 5 } },
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0]._count.cases).toBe(3);
      expect(result[0]._count.attendees).toBe(5);
      expect(mockPrisma.mdtConference.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, orderBy: { scheduledAt: 'desc' } }),
      );
    });

    it('should filter by department and status', async () => {
      mockPrisma.mdtConference.findMany.mockResolvedValue([]);

      await service.findAll('ONCOLOGY', 'SCHEDULED');

      expect(mockPrisma.mdtConference.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { department: 'ONCOLOGY', status: 'SCHEDULED' },
        }),
      );
    });
  });

  describe('create', () => {
    it('should create conference with provided data', async () => {
      mockPrisma.mdtConference.create.mockResolvedValue(mockConference);

      const result = await service.create(
        {
          title: '폐암 MDT 컨퍼런스',
          conferenceType: 'TUMOR_BOARD',
          department: 'ONCOLOGY',
          scheduledAt: '2026-05-15T14:00:00Z',
          location: '3층 컨퍼런스룸',
        },
        'user-1',
      );

      expect(result.title).toBe('폐암 MDT 컨퍼런스');
      expect(mockPrisma.mdtConference.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chairpersonId: 'user-1',
          conferenceType: 'TUMOR_BOARD',
        }),
      });
    });
  });

  describe('findOne', () => {
    it('should return conference with cases and attendees', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        cases: [{ ...mockCase, patient: { id: 'pat-1', familyName: '이', givenName: '환자' } }],
        attendees: [mockAttendee],
      });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'doc-2', familyName: '박', givenName: '영상' },
        { id: 'user-1', familyName: '김', givenName: '의장' },
      ]);

      const result = await service.findOne('conf-1');

      expect(result.cases).toHaveLength(1);
      expect(result.attendees).toHaveLength(1);
      expect(result.title).toBe('폐암 MDT 컨퍼런스');
      // 🔴 종전엔 attendees 를 그대로 내려 화면에 UUID 가 찍혔다(W7 ④) — 서버가 이름을 해석해 준다
      expect(result.attendees[0].userName).toBe('박영상');
      expect(result.chairpersonName).toBe('김의장');
    });

    it('should return null userName (not the UUID) when the user cannot be resolved', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        cases: [],
        attendees: [mockAttendee],
      });
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.findOne('conf-1');

      expect(result.attendees[0].userName).toBeNull();
    });

    it('should throw NotFoundException when conference not found', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('start', () => {
    it('should change status from SCHEDULED to IN_PROGRESS', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        status: 'SCHEDULED',
        cases: [],
        attendees: [],
      });
      mockPrisma.mdtConference.update.mockResolvedValue({
        ...mockConference,
        status: 'IN_PROGRESS',
      });

      const result = await service.start('conf-1');

      expect(result.status).toBe('IN_PROGRESS');
      expect(mockPrisma.mdtConference.update).toHaveBeenCalledWith({
        where: { id: 'conf-1' },
        data: { status: 'IN_PROGRESS' },
      });
    });

    it('should throw BadRequestException if not SCHEDULED', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        status: 'COMPLETED',
        cases: [],
        attendees: [],
      });

      await expect(service.start('conf-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('complete', () => {
    it('should change status from IN_PROGRESS to COMPLETED', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        status: 'IN_PROGRESS',
        cases: [],
        attendees: [],
      });
      mockPrisma.mdtConference.update.mockResolvedValue({
        ...mockConference,
        status: 'COMPLETED',
      });

      const result = await service.complete('conf-1');

      expect(result.status).toBe('COMPLETED');
      expect(mockPrisma.mdtConference.update).toHaveBeenCalledWith({
        where: { id: 'conf-1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('should throw BadRequestException if not IN_PROGRESS', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        status: 'SCHEDULED',
        cases: [],
        attendees: [],
      });

      await expect(service.complete('conf-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('addCase', () => {
    it('should add patient case with auto-incremented sortOrder', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        cases: [],
        attendees: [],
      });
      mockPrisma.mdtCase.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
      mockPrisma.mdtCase.create.mockResolvedValue({
        ...mockCase,
        sortOrder: 3,
      });

      const result = await service.addCase('conf-1', {
        patientId: 'pat-1',
        presenterId: 'doc-1',
        primaryDiag: 'C34.1',
        tnmStage: 'T2N1M0',
      });

      expect(result.sortOrder).toBe(3);
      expect(mockPrisma.mdtCase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conferenceId: 'conf-1',
          patientId: 'pat-1',
          sortOrder: 3,
        }),
      });
    });

    /** 🔴 presenterId 는 NOT NULL 인데 화면 폼에 발표자 칸이 없어 케이스 추가가 늘 실패했다 */
    it('should fall back to the current user as presenter when none is given', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue(mockConference);
      mockPrisma.mdtCase.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      mockPrisma.mdtCase.create.mockResolvedValue({ ...mockCase, presenterId: 'me-1' });

      await service.addCase('conf-1', { patientId: 'pat-1', primaryDiag: 'C34.1' }, 'me-1');

      expect(mockPrisma.mdtCase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ presenterId: 'me-1' }),
      });
    });

    it('should reject a case without a patient', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue(mockConference);

      await expect(service.addCase('conf-1', { primaryDiag: 'C34.1' }, 'me-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.mdtCase.create).not.toHaveBeenCalled();
    });

    it('should start sortOrder at 0 when no existing cases', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        cases: [],
        attendees: [],
      });
      mockPrisma.mdtCase.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      mockPrisma.mdtCase.create.mockResolvedValue({ ...mockCase, sortOrder: 0 });

      await service.addCase('conf-1', {
        patientId: 'pat-1',
        presenterId: 'doc-1',
        primaryDiag: 'C34.1',
      });

      expect(mockPrisma.mdtCase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sortOrder: 0 }),
      });
    });
  });

  describe('updateCase', () => {
    it('should record decision on existing case', async () => {
      mockPrisma.mdtCase.findUnique.mockResolvedValue(mockCase);
      mockPrisma.mdtConference.findUnique.mockResolvedValue({ department: '종양내과', title: '폐암 MDT' });
      mockPrisma.mdtCase.update.mockResolvedValue({
        ...mockCase,
        decision: '항암 후 수술',
        decisionCategory: 'CHEMO',
      });

      const result = await service.updateCase('case-1', {
        decision: '항암 후 수술',
        decisionCategory: 'CHEMO',
      });

      expect(result.decision).toBe('항암 후 수술');
      expect(result.decisionCategory).toBe('CHEMO');
    });

    /**
     * 🔴 종전 스펙은 임의 문자열('CHEMO_THEN_SURGERY')이 그대로 저장되는 동작을 굳혀뒀다.
     *    서버에 enum 검증이 없어 화면이 프리필한 무엇이든 임상 결정으로 남았다(W7 ① · P15).
     */
    it('should reject a decisionCategory outside the canonical list', async () => {
      mockPrisma.mdtCase.findUnique.mockResolvedValue(mockCase);

      await expect(
        service.updateCase('case-1', { decision: '항암 후 수술', decisionCategory: 'CHEMO_THEN_SURGERY' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.mdtCase.update).not.toHaveBeenCalled();
    });

    it('should keep the category unset (null) when an empty value is sent — 미상은 미상으로', async () => {
      mockPrisma.mdtCase.findUnique.mockResolvedValue(mockCase);
      mockPrisma.mdtConference.findUnique.mockResolvedValue({ department: '종양내과', title: '폐암 MDT' });
      mockPrisma.mdtCase.update.mockResolvedValue({ ...mockCase, decision: '추적 관찰 후 재논의', decisionCategory: null });

      await service.updateCase('case-1', { decision: '추적 관찰 후 재논의', decisionCategory: '' });

      expect(mockPrisma.mdtCase.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: expect.objectContaining({ decisionCategory: null }),
      });
    });

    it('should never fill in a category the caller did not send', async () => {
      mockPrisma.mdtCase.findUnique.mockResolvedValue(mockCase);
      mockPrisma.mdtConference.findUnique.mockResolvedValue({ department: '종양내과', title: '폐암 MDT' });
      mockPrisma.mdtCase.update.mockResolvedValue({ ...mockCase, decision: '수술 시행' });

      await service.updateCase('case-1', { decision: '수술 시행' });

      const data = mockPrisma.mdtCase.update.mock.calls[0][0].data;
      expect('decisionCategory' in data).toBe(false);
    });

    it('should accept the explicit UNCLASSIFIED category', async () => {
      mockPrisma.mdtCase.findUnique.mockResolvedValue(mockCase);
      mockPrisma.mdtConference.findUnique.mockResolvedValue({ department: '종양내과', title: '폐암 MDT' });
      mockPrisma.mdtCase.update.mockResolvedValue({ ...mockCase, decision: '결론 보류', decisionCategory: 'UNCLASSIFIED' });

      const result = await service.updateCase('case-1', { decision: '결론 보류', decisionCategory: 'UNCLASSIFIED' });

      expect(result.decisionCategory).toBe('UNCLASSIFIED');
    });

    it('should throw NotFoundException if case not found', async () => {
      mockPrisma.mdtCase.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCase('nonexistent', { decision: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * 🔴 초안≠확정 — autoSummary 는 **저장하지 않는다**(P0-B · AI-AND-HIS §2.2 R2).
   *    종전엔 LLM 응답이 곧바로 `mdtCase.update({ clinicalSummary })` 로 임상 정본이 됐다.
   */
  describe('autoSummary (AI 초안 · 저장 안 함)', () => {
    beforeEach(() => {
      mockPrisma.mdtCase.findUnique.mockResolvedValue({ ...mockCase, patient: { id: 'pat-1' } });
    });

    it('초안을 응답으로만 돌려주고 clinicalSummary 를 쓰지 않는다', async () => {
      const r = await service.autoSummary('case-1');

      expect(r.source).toBe('AI');
      expect(r.draft).toBe('AI summary of clinical case');
      expect(r.reason).toBeNull();
      expect(r.model).toBe('weru-b');
      expect(r.caseId).toBe('case-1');
      expect(r.patientId).toBe('pat-1');
      // 🔴 이 한 줄이 이 기능의 전부다 — 어떤 쓰기도 일어나지 않는다
      expect(mockPrisma.mdtCase.update).not.toHaveBeenCalled();
    });

    it('AI 호출이 실패하면 UNAVAILABLE + 사유 (초안 없음 · 지어내지 않는다)', async () => {
      mockAi.reference.mockRejectedValueOnce(new Error('AI API error: 503'));

      const r = await service.autoSummary('case-1');

      expect(r.source).toBe('UNAVAILABLE');
      expect(r.draft).toBeNull();
      expect(r.reason).toContain('503');
      expect(mockPrisma.mdtCase.update).not.toHaveBeenCalled();
    });

    it('해석할 수 없는 응답을 요약으로 밀어넣지 않는다(종전 JSON.stringify 자리)', async () => {
      mockAi.reference.mockResolvedValueOnce({ unexpected: { shape: true } });

      const r = await service.autoSummary('case-1');

      expect(r.source).toBe('UNAVAILABLE');
      expect(r.draft).toBeNull();
      expect(r.reason).toContain('해석');
    });

    it('빈 응답은 빈 요약이 아니라 산출 불가다', async () => {
      mockAi.reference.mockResolvedValueOnce({ answer: '   ' });

      const r = await service.autoSummary('case-1');

      expect(r.source).toBe('UNAVAILABLE');
      expect(r.draft).toBeNull();
    });

    it('없는 케이스는 404', async () => {
      mockPrisma.mdtCase.findUnique.mockResolvedValueOnce(null);
      await expect(service.autoSummary('nope')).rejects.toThrow(NotFoundException);
    });

    /**
     * P1 — 제안 원장(AiProposal). 🔴 정본(`MdtCase`)에는 여전히 아무것도 쓰지 않는다.
     * 남는 것은 "AI 가 무엇을 냈는가"뿐이고, "사람이 그것을 어떻게 했는가"는 저장 화면이 보고한다.
     */
    it('🔴 초안이 나오면 제안 1건이 생기고 proposalId 를 함께 돌려준다', async () => {
      const r = await service.autoSummary('case-1', 'doc-1');

      expect(mockProposal.create).toHaveBeenCalledTimes(1);
      const arg = mockProposal.create.mock.calls[0][0];
      expect(arg.kind).toBe('MDT_SUMMARY');
      expect(arg.targetType).toBe('MdtCase');
      expect(arg.targetId).toBe('case-1');
      expect(arg.patientId).toBe('pat-1');
      expect(arg.content).toBe('AI summary of clinical case');
      expect(arg.source).toBe('AI');
      expect(arg.modelRef).toBe('weru-b');
      expect(arg.promptVersion).toBe(MDT_SUMMARY_PROMPT_VERSION);
      expect(arg.inputSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(arg.createdBy).toBe('doc-1');
      expect(r.proposalId).toBe('prop-1');
      // 이 기능의 전부 — 정본은 여전히 손대지 않는다
      expect(mockPrisma.mdtCase.update).not.toHaveBeenCalled();
    });

    it("🔴 modelRef 'unknown' 은 모델 이름이 아니다 → null", async () => {
      mockAi.reference.mockResolvedValueOnce({ answer: '요약', model_used: 'unknown' });

      const r = await service.autoSummary('case-1', 'doc-1');

      expect(mockProposal.create.mock.calls[0][0].modelRef).toBeNull();
      // 응답의 model 은 상류가 말한 그대로 남긴다(제안의 modelRef 와 다른 사실이다)
      expect(r.model).toBe('unknown');
    });

    it('🔴 산출 불가(UNAVAILABLE)면 제안을 만들지 않는다 — 빈 제안이 노출률 분모를 부풀린다', async () => {
      mockAi.reference.mockRejectedValueOnce(new Error('AI API error: 503'));

      const r = await service.autoSummary('case-1', 'doc-1');

      expect(r.source).toBe('UNAVAILABLE');
      expect(r.proposalId).toBeNull();
      expect(mockProposal.create).not.toHaveBeenCalled();
    });

    it('해석 불가·빈 응답도 제안을 만들지 않는다', async () => {
      mockAi.reference.mockResolvedValueOnce({ unexpected: true });
      expect((await service.autoSummary('case-1')).proposalId).toBeNull();

      mockAi.reference.mockResolvedValueOnce({ answer: '   ' });
      expect((await service.autoSummary('case-1')).proposalId).toBeNull();

      expect(mockProposal.create).not.toHaveBeenCalled();
    });

    it('제안 기록이 실패해도 초안은 그대로 나간다(proposalId 만 null)', async () => {
      mockProposal.create.mockRejectedValueOnce(new Error('ledger down'));

      const r = await service.autoSummary('case-1', 'doc-1');

      expect(r.source).toBe('AI');
      expect(r.draft).toBe('AI summary of clinical case');
      expect(r.proposalId).toBeNull();
    });

    it('호출자를 모르면 createdBy 는 null — 사람을 지어내지 않는다', async () => {
      await service.autoSummary('case-1');
      expect(mockProposal.create.mock.calls[0][0].createdBy).toBeNull();
    });
  });

  describe('addAttendee', () => {
    it('should add attendee to conference', async () => {
      mockPrisma.mdtConference.findUnique.mockResolvedValue({
        ...mockConference,
        cases: [],
        attendees: [],
      });
      mockPrisma.mdtAttendee.create.mockResolvedValue(mockAttendee);

      const result = await service.addAttendee('conf-1', {
        userId: 'doc-2',
        department: 'RADIOLOGY',
        role: 'REVIEWER',
      });

      expect(result.conferenceId).toBe('conf-1');
      expect(result.role).toBe('REVIEWER');
      expect(mockPrisma.mdtAttendee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conferenceId: 'conf-1',
          userId: 'doc-2',
          attended: false,
        }),
      });
    });
  });

  describe('getPatientHistory', () => {
    it('should return patient MDT history with conference info', async () => {
      mockPrisma.mdtCase.findMany.mockResolvedValue([
        {
          ...mockCase,
          conference: {
            id: 'conf-1',
            title: '폐암 MDT',
            conferenceType: 'TUMOR_BOARD',
            department: 'ONCOLOGY',
            scheduledAt: new Date('2026-05-15'),
            status: 'COMPLETED',
          },
        },
      ]);

      const result = await service.getPatientHistory('pat-1');

      expect(result).toHaveLength(1);
      expect(result[0].conference.title).toBe('폐암 MDT');
      expect(mockPrisma.mdtCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 'pat-1' } }),
      );
    });

    it('should return empty array for patient with no MDT history', async () => {
      mockPrisma.mdtCase.findMany.mockResolvedValue([]);

      const result = await service.getPatientHistory('pat-no-history');

      expect(result).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return statistics with status and decision breakdowns', async () => {
      // count 호출 순서: 전체 → 기한경과 미개최 → 완료·기록없음
      mockPrisma.mdtConference.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);
      mockPrisma.mdtConference.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _count: 5 },
        { status: 'SCHEDULED', _count: 3 },
        { status: 'IN_PROGRESS', _count: 2 },
      ]);
      mockPrisma.mdtCase.groupBy.mockResolvedValue([
        { decisionCategory: 'SURGERY', _count: 4 },
        { decisionCategory: 'CHEMOTHERAPY', _count: 3 },
        { decisionCategory: null, _count: 2 },
      ]);
      mockPrisma.mdtCase.count.mockResolvedValue(9);

      const result = await service.getStats();

      expect(result.totalConferences).toBe(10);
      expect(result.totalCases).toBe(9);
      expect(result.byStatus).toEqual({
        COMPLETED: 5,
        SCHEDULED: 3,
        IN_PROGRESS: 2,
      });
      expect(result.byDecisionCategory.SURGERY).toBe(4);
      // 분류를 기록하지 않은 케이스는 'UNRECORDED' — 'PENDING'(곧 정해질 것)도 'OBSERVATION'도 아니다
      expect(result.byDecisionCategory.UNRECORDED).toBe(2);
      expect(result.overdueScheduled).toBe(1);
      expect(result.completedWithoutRecord).toBe(2);
    });

    /**
     * 응답 형태 계약 — byStatus/byDecisionCategory 는 **객체 맵**이다.
     * 🔴 화면이 배열로 알고 `.map()` 을 불러 통계 탭이 통째 크래시했다(W7 ② · P11).
     */
    it('should return byStatus / byDecisionCategory as plain object maps (not arrays)', async () => {
      mockPrisma.mdtConference.count.mockResolvedValue(0);
      mockPrisma.mdtConference.groupBy.mockResolvedValue([{ status: 'SCHEDULED', _count: 2 }]);
      mockPrisma.mdtCase.groupBy.mockResolvedValue([]);
      mockPrisma.mdtCase.count.mockResolvedValue(0);

      const result = await service.getStats();

      expect(Array.isArray(result.byStatus)).toBe(false);
      expect(Array.isArray(result.byDecisionCategory)).toBe(false);
      expect(result.byStatus).toEqual({ SCHEDULED: 2 });
      expect(result.byDecisionCategory).toEqual({});
    });

    it('should filter stats by department', async () => {
      mockPrisma.mdtConference.count.mockResolvedValue(5);
      mockPrisma.mdtConference.groupBy.mockResolvedValue([]);
      mockPrisma.mdtCase.groupBy.mockResolvedValue([]);
      mockPrisma.mdtCase.count.mockResolvedValue(3);

      await service.getStats('ONCOLOGY');

      expect(mockPrisma.mdtConference.count).toHaveBeenCalledWith({
        where: { department: 'ONCOLOGY' },
      });
    });
  });
});
