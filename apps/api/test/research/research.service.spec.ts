import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResearchService } from '../../src/modules/research/research.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ResearchService', () => {
  let service: ResearchService;
  let mockPrisma: any;

  const studyBase = {
    id: 'study-1',
    studyNo: 'IRB-2026-001',
    title: '임상시험 A',
    piUserId: 'user-1',
    department: '순환기내과',
    studyType: 'INTERVENTIONAL',
    irbStatus: 'SUBMITTED',
    phase: 'PHASE_3',
    sponsor: '제약사A',
    targetEnroll: 100,
    currentEnroll: 5,
    startDate: new Date('2026-01-15'),
    endDate: null,
    description: '심장질환 임상시험',
    protocol: {},
    irbApprovalDate: null,
    irbExpiryDate: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    mockPrisma = {
      researchStudy: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      researchSubject: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      researchDocument: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      irbAmendment: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
      },
      patient: {
        findUnique: vi.fn().mockResolvedValue({ id: 'pat-1' }),
      },
      // studyNo/subjectNo 채번 advisory lock(withAdvisoryLock) — tx 는 동일 목을 재사용
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
      ),
    };
    service = new ResearchService(mockPrisma);
  });

  /* ───────── Studies ───────── */

  describe('findAll', () => {
    it('등록 현황은 research_subjects 실계수를 정본으로 말한다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([studyBase]);
      mockPrisma.researchSubject.groupBy.mockResolvedValue([
        { studyId: 'study-1', status: 'ENROLLED', _count: { _all: 2 } },
        { studyId: 'study-1', status: 'WITHDRAWN', _count: { _all: 1 } },
      ]);

      const result = await service.findAll({});

      expect(result[0].subjectCount).toBe(3);
      expect(result[0].activeSubjectCount).toBe(2); // 철회 제외
      expect(result[0].storedEnroll).toBe(5);
    });

    it('🔴 저장 카운터(current_enroll)와 실계수가 다르면 불일치를 숨기지 않는다', async () => {
      // 실측 결함: research_subjects 0행인데 current_enroll 500 — 화면은 "500명 / 100% 달성"이라 말했다
      mockPrisma.researchStudy.findMany.mockResolvedValue([{ ...studyBase, currentEnroll: 500, targetEnroll: 500 }]);
      mockPrisma.researchSubject.groupBy.mockResolvedValue([]);

      const [s] = await service.findAll({});

      expect(s.subjectCount).toBe(0);
      expect(s.storedEnroll).toBe(500);
      expect(s.enrollMismatch).toBe(true);
    });

    it('🔴 책임연구자는 UUID 가 아니라 사람으로 내려간다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([studyBase]);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-1', familyName: '김', givenName: '연구', department: '순환기내과' },
      ]);

      const [s] = await service.findAll({});

      expect(s.pi).toEqual({ id: 'user-1', familyName: '김', givenName: '연구', department: '순환기내과' });
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['user-1'] } } }),
      );
    });

    it('모든 연구에 IRB 유효성 판정이 붙는다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([studyBase]);

      const [s] = await service.findAll({});

      expect(s.irbValidity.state).toBe('NOT_APPROVED');
    });

    it('should apply filters', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([]);

      await service.findAll({ department: '순환기내과', irbStatus: 'APPROVED' });

      expect(mockPrisma.researchStudy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { department: '순환기내과', irbStatus: 'APPROVED' },
        }),
      );
    });
  });

  describe('create', () => {
    it('should auto-generate studyNo as IRB-YYYY-NNN', async () => {
      mockPrisma.researchStudy.count.mockResolvedValue(2);
      mockPrisma.researchStudy.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'new-id', ...data }));

      const result = await service.create(
        { title: '새 연구', department: 'ONCOLOGY', studyType: 'OBSERVATIONAL' },
        'user-1',
      );

      const year = new Date().getFullYear();
      expect(result.studyNo).toBe(`IRB-${year}-003`);
      expect(result.title).toBe('새 연구');
      expect(result.piUserId).toBe('user-1');
    });

    it('should pad studyNo to 3 digits', async () => {
      mockPrisma.researchStudy.count.mockResolvedValue(0);
      mockPrisma.researchStudy.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'new-id', ...data }));

      const result = await service.create(
        { title: '첫번째 연구', department: 'ONCOLOGY', studyType: 'OBSERVATIONAL' },
        'user-1',
      );

      const year = new Date().getFullYear();
      expect(result.studyNo).toBe(`IRB-${year}-001`);
    });

    it('🔴 지정한 연구책임자를 버리지 않는다 (종전엔 무조건 등록자가 PI)', async () => {
      mockPrisma.researchStudy.count.mockResolvedValue(0);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'doc-9', role: 'DOCTOR', isActive: true });
      mockPrisma.researchStudy.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'new-id', ...data }));

      const result = await service.create(
        { title: '연구', department: '순환기내과', studyType: 'OBSERVATIONAL', piUserId: 'doc-9' },
        'user-1',
      );

      expect(result.piUserId).toBe('doc-9');
    });

    it('실존하지 않는 계정을 PI 로 앉히지 않는다', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ title: '연구', department: '내과', studyType: 'OBSERVATIONAL', piUserId: 'ghost' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return study with subjects, documents, amendments', async () => {
      const fullStudy = {
        ...studyBase,
        subjects: [{ id: 's1', status: 'ENROLLED', subjectNo: 'IRB-2026-001-S001', patient: { id: 'p1', familyName: '김', givenName: '환자', dateOfBirth: new Date() } }],
        documents: [{ id: 'd1', docType: 'PROTOCOL', fileName: 'protocol.pdf', uploadedBy: 'user-1' }],
        amendments: [{ id: 'a1', amendmentNo: 1, reason: '프로토콜 변경' }],
      };
      mockPrisma.researchStudy.findUnique.mockResolvedValue(fullStudy);

      const result = await service.findOne('study-1');

      expect(result.subjects).toHaveLength(1);
      expect(result.documents).toHaveLength(1);
      expect(result.amendments).toHaveLength(1);
      // 상세도 목록과 같은 등록 정본을 쓴다
      expect(result.subjectCount).toBe(1);
      expect(result.storedEnroll).toBe(5);
      expect(result.enrollMismatch).toBe(true);
      expect(result.irbValidity).toBeDefined();
    });

    it('should throw NotFoundException if study not found', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('approve', () => {
    it('should transition SUBMITTED to APPROVED', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue({ ...studyBase, irbStatus: 'SUBMITTED' });
      mockPrisma.researchStudy.update.mockResolvedValue({ ...studyBase, irbStatus: 'APPROVED' });

      const result = await service.approve('study-1');

      expect(result.irbStatus).toBe('APPROVED');
      expect(mockPrisma.researchStudy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ irbStatus: 'APPROVED' }),
        }),
      );
    });

    it('🔴 만료일을 지어내지 않는다 — 안 주면 비워둔 채 승인한다', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue({ ...studyBase, irbStatus: 'SUBMITTED' });
      mockPrisma.researchStudy.update.mockImplementation(({ data }: any) => Promise.resolve({ ...studyBase, ...data }));

      await service.approve('study-1');

      const passed = mockPrisma.researchStudy.update.mock.calls[0][0].data;
      expect(passed).not.toHaveProperty('irbExpiryDate');
    });

    it('승인서에 적힌 만료일을 받으면 저장한다', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue({ ...studyBase, irbStatus: 'UNDER_REVIEW' });
      mockPrisma.researchStudy.update.mockImplementation(({ data }: any) => Promise.resolve({ ...studyBase, ...data }));

      const result = await service.approve('study-1', { irbExpiryDate: '2027-12-31' });

      expect(result.irbExpiryDate).toBeInstanceOf(Date);
      expect((result.irbExpiryDate as Date).toISOString().slice(0, 10)).toBe('2027-12-31');
    });

    it('과거 만료일은 거부한다', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue({ ...studyBase, irbStatus: 'SUBMITTED' });

      await expect(service.approve('study-1', { irbExpiryDate: '2020-01-01' })).rejects.toThrow(BadRequestException);
    });

    it('should transition UNDER_REVIEW to APPROVED', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue({ ...studyBase, irbStatus: 'UNDER_REVIEW' });
      mockPrisma.researchStudy.update.mockResolvedValue({ ...studyBase, irbStatus: 'APPROVED' });

      const result = await service.approve('study-1');

      expect(result.irbStatus).toBe('APPROVED');
    });

    it('should throw BadRequestException if status is APPROVED already', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue({ ...studyBase, irbStatus: 'APPROVED' });

      await expect(service.approve('study-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if status is CLOSED', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue({ ...studyBase, irbStatus: 'CLOSED' });

      await expect(service.approve('study-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('close', () => {
    it('should set irbStatus to CLOSED and endDate', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.researchStudy.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...studyBase, ...data }),
      );

      const result = await service.close('study-1');

      expect(result.irbStatus).toBe('CLOSED');
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should throw if study not found', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(null);

      await expect(service.close('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  /* ───────── Subjects ───────── */

  describe('addSubject', () => {
    it('should create subject and increment currentEnroll', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.researchSubject.count.mockResolvedValue(5);
      mockPrisma.researchSubject.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'subj-new', ...data }),
      );
      mockPrisma.researchStudy.update.mockResolvedValue({});

      const result = await service.addSubject(
        'study-1',
        { patientId: 'pat-1', consentDate: '2026-05-01', armGroup: 'GroupA' },
        'user-1',
      );

      expect(result.subjectNo).toBe('IRB-2026-001-S006');
      expect(result.studyId).toBe('study-1');
      expect(mockPrisma.researchStudy.update).toHaveBeenCalledWith({
        where: { id: 'study-1' },
        data: { currentEnroll: { increment: 1 } },
      });
    });

    it('🔴 존재하지 않는 환자(MRN 문자열 등)는 조용한 500 대신 명확한 오류', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.patient.findUnique.mockResolvedValue(null);

      await expect(
        service.addSubject('study-1', { patientId: 'P000001', consentDate: '2026-05-01' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('withdrawSubject', () => {
    it('should set withdrawDate, status WITHDRAWN, and decrement currentEnroll', async () => {
      const subject = { id: 'subj-1', studyId: 'study-1', status: 'ENROLLED' };
      mockPrisma.researchSubject.findUnique.mockResolvedValue(subject);
      mockPrisma.researchSubject.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...subject, ...data }),
      );
      mockPrisma.researchStudy.update.mockResolvedValue({});

      const result = await service.withdrawSubject('subj-1', '부작용 발생');

      expect(result.status).toBe('WITHDRAWN');
      expect(result.withdrawDate).toBeInstanceOf(Date);
      expect(result.withdrawReason).toBe('부작용 발생');
      expect(mockPrisma.researchStudy.update).toHaveBeenCalledWith({
        where: { id: 'study-1' },
        data: { currentEnroll: { decrement: 1 } },
      });
    });

    it('🔴 사유 없는 중도탈락은 거부한다 (GCP 보고 대상 — NULL 저장 금지)', async () => {
      mockPrisma.researchSubject.findUnique.mockResolvedValue({ id: 'subj-1', studyId: 'study-1', status: 'ENROLLED' });

      await expect(service.withdrawSubject('subj-1', '')).rejects.toThrow(BadRequestException);
      await expect(service.withdrawSubject('subj-1', '   ')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.researchSubject.update).not.toHaveBeenCalled();
    });

    it('이미 철회된 대상자는 중복 처리하지 않는다(카운터 이중 감소 방지)', async () => {
      mockPrisma.researchSubject.findUnique.mockResolvedValue({ id: 'subj-1', studyId: 'study-1', status: 'WITHDRAWN' });

      await expect(service.withdrawSubject('subj-1', '사유')).rejects.toThrow(BadRequestException);
    });

    it('should throw if subject not found', async () => {
      mockPrisma.researchSubject.findUnique.mockResolvedValue(null);

      await expect(service.withdrawSubject('nonexistent', '사유')).rejects.toThrow(NotFoundException);
    });
  });

  /* ───────── Documents ───────── */

  describe('addDocument', () => {
    it('should create a document for the study', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.researchDocument.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'doc-1', ...data }),
      );

      const result = await service.addDocument(
        'study-1',
        { docType: 'PROTOCOL', version: '1.0', fileName: 'protocol.pdf', fileUrl: '/files/protocol.pdf' },
        'user-1',
      );

      expect(result.docType).toBe('PROTOCOL');
      expect(result.studyId).toBe('study-1');
      expect(result.uploadedBy).toBe('user-1');
    });

    it('🔴 필수 필드 누락은 무엇이 빠졌는지 말한다 (화면 {name,type} 계약 불일치의 잔여 방어)', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);

      await expect(
        service.addDocument('study-1', { name: '동의서 v1.0', type: 'ICF' }, 'user-1'),
      ).rejects.toThrow(/문서 유형|버전|파일명|파일 경로/);
      expect(mockPrisma.researchDocument.create).not.toHaveBeenCalled();
    });
  });

  describe('getDocuments', () => {
    it('업로더를 UUID 가 아니라 사람으로 내려보낸다', async () => {
      mockPrisma.researchDocument.findMany.mockResolvedValue([
        { id: 'd1', studyId: 'study-1', docType: 'ICF', fileName: 'icf.pdf', uploadedBy: 'user-1', uploadedAt: new Date('2026-05-02') },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-1', familyName: '이', givenName: '간호', department: null },
      ]);

      const result = await service.getDocuments('study-1');

      expect(result[0].uploader?.familyName).toBe('이');
      expect(mockPrisma.researchDocument.findMany).toHaveBeenCalledWith({
        where: { studyId: 'study-1' },
        orderBy: { uploadedAt: 'desc' },
      });
    });
  });

  /* ───────── Amendments ───────── */

  describe('addAmendment', () => {
    it('should create amendment with auto-incremented amendmentNo', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.irbAmendment.findFirst.mockResolvedValue({ amendmentNo: 3 });
      mockPrisma.irbAmendment.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'amend-new', ...data }),
      );

      const result = await service.addAmendment('study-1', { reason: '용량 변경', changes: { dose: '10mg→20mg' } });

      expect(result.amendmentNo).toBe(4);
      expect(result.reason).toBe('용량 변경');
    });

    it('should start at 1 if no previous amendments', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.irbAmendment.findFirst.mockResolvedValue(null);
      mockPrisma.irbAmendment.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'amend-1', ...data }),
      );

      const result = await service.addAmendment('study-1', { reason: '첫 변경' });

      expect(result.amendmentNo).toBe(1);
    });

    it('🔴 변경 사유 없이는 상신되지 않는다 (화면이 reason 미전송이던 자리)', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);

      await expect(
        service.addAmendment('study-1', { version: '2.0', description: '변경 내용' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateAmendment', () => {
    it('should approve an amendment', async () => {
      mockPrisma.irbAmendment.findUnique.mockResolvedValue({ id: 'amend-1', status: 'PENDING' });
      mockPrisma.irbAmendment.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'amend-1', ...data }),
      );

      const result = await service.updateAmendment('amend-1', { status: 'APPROVED', reviewNote: '승인됨' });

      expect(result.status).toBe('APPROVED');
      expect(result.reviewedAt).toBeInstanceOf(Date);
    });

    it('should reject an amendment', async () => {
      mockPrisma.irbAmendment.findUnique.mockResolvedValue({ id: 'amend-1', status: 'PENDING' });
      mockPrisma.irbAmendment.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'amend-1', ...data }),
      );

      const result = await service.updateAmendment('amend-1', { status: 'REJECTED' });

      expect(result.status).toBe('REJECTED');
    });

    it('should throw BadRequestException for invalid status', async () => {
      mockPrisma.irbAmendment.findUnique.mockResolvedValue({ id: 'amend-1' });

      await expect(
        service.updateAmendment('amend-1', { status: 'INVALID' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if amendment not found', async () => {
      mockPrisma.irbAmendment.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAmendment('nonexistent', { status: 'APPROVED' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /* ───────── IRB Reviews ───────── */

  describe('getIrbReviews', () => {
    it('🔴 승인 완료일을 "심의 예정일"로 둔갑시키지 않는다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([
        { ...studyBase, irbStatus: 'APPROVED', irbApprovalDate: new Date('2026-01-15'), irbExpiryDate: null },
      ]);

      const [r] = await service.getIrbReviews();

      // 종전: scheduledDate = irbApprovalDate ?? createdAt → 7개월 전 승인일이 '예정'으로 렌더됐다
      expect(r).not.toHaveProperty('scheduledDate');
      expect(r.approvalDate).toEqual(new Date('2026-01-15'));
      expect(r.submittedAt).toEqual(studyBase.createdAt);
      expect(r.irbStatus).toBe('APPROVED');
      expect(r.irbValidity.state).toBe('NO_EXPIRY_ON_RECORD');
    });

    it('결정이 나지 않은 심의에는 결과를 붙이지 않는다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([{ ...studyBase, irbStatus: 'UNDER_REVIEW' }]);

      const [r] = await service.getIrbReviews();

      expect(r.result).toBeNull();
    });
  });

  /* ───────── Data 추출 ───────── */

  describe('extractData', () => {
    it('🔴 전 대상자에 같은 가짜 검사값(WBC 6200·Hb 13.5·BP 120/80)을 붙이지 않는다', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.researchSubject.findMany.mockResolvedValue([
        { subjectNo: 'IRB-2026-001-S001', status: 'ENROLLED', armGroup: 'A', consentDate: new Date('2026-05-01'), withdrawDate: null },
      ]);

      const result = await service.extractData('study-1');

      expect(result.clinicalDataIncluded).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/WBC|6200|13\.5|120\/80/);
      expect(result.subjects[0].subjectNo).toBe('IRB-2026-001-S001');
    });
  });

  /* ───────── Stats / Charts ───────── */

  describe('getStats', () => {
    it('🔴 byType/byStatus 는 배열이다 (객체를 주면 화면이 .map() 에서 죽는다)', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([
        { id: 'a', studyType: 'INTERVENTIONAL', irbStatus: 'APPROVED', irbExpiryDate: null, targetEnroll: 100, currentEnroll: 0 },
        { id: 'b', studyType: 'OBSERVATIONAL', irbStatus: 'APPROVED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
        { id: 'c', studyType: 'INTERVENTIONAL', irbStatus: 'SUBMITTED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
      ]);

      const result = await service.getStats();

      expect(Array.isArray(result.byType)).toBe(true);
      expect(Array.isArray(result.byStatus)).toBe(true);
      expect(result.byType).toEqual([
        { type: 'INTERVENTIONAL', count: 2 },
        { type: 'OBSERVATIONAL', count: 1 },
      ]);
      expect(result.byStatus).toEqual([
        { status: 'APPROVED', count: 2 },
        { status: 'SUBMITTED', count: 1 },
      ]);
      expect(result.totalStudies).toBe(3);
      expect(result.activeStudies).toBe(2);
      expect(result.pendingReviews).toBe(1);
    });

    it('🔴 분모가 0 이면 비율은 0 이 아니라 null(산출 불가)', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([
        { id: 'a', studyType: 'OBSERVATIONAL', irbStatus: 'SUBMITTED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
      ]);

      const result = await service.getStats();

      expect(result.approvalRate).toBeNull();     // 결정된 심의 0건
      expect(result.enrollmentRate).toBeNull();   // 목표 등록 수 0
      expect(result.approvalBasis.decided).toBe(0);
    });

    it('승인률은 결정된 심의(승인+반려)를 분모로 한다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([
        { id: 'a', studyType: 'X', irbStatus: 'APPROVED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
        { id: 'b', studyType: 'X', irbStatus: 'APPROVED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
        { id: 'c', studyType: 'X', irbStatus: 'REJECTED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
        { id: 'd', studyType: 'X', irbStatus: 'SUBMITTED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
      ]);

      const result = await service.getStats();

      expect(result.approvalRate).toBeCloseTo((2 / 3) * 100, 6);
    });

    it('총 등록 대상자는 실계수이며 저장 카운터 합과의 불일치를 노출한다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([
        { id: 'a', studyType: 'X', irbStatus: 'APPROVED', irbExpiryDate: null, targetEnroll: 500, currentEnroll: 500 },
      ]);
      mockPrisma.researchSubject.findMany.mockResolvedValue([]);

      const result = await service.getStats();

      expect(result.totalSubjects).toBe(0);
      expect(result.storedEnrollTotal).toBe(500);
      expect(result.enrollMismatch).toBe(true);
      expect(result.enrollmentRate).toBe(0); // 목표는 있으나 등록 0 — 이건 진짜 0이다
    });

    it('IRB 만료 경보를 집계한다', async () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 10);
      const past = new Date();
      past.setDate(past.getDate() - 10);
      mockPrisma.researchStudy.findMany.mockResolvedValue([
        { id: 'a', studyType: 'X', irbStatus: 'APPROVED', irbExpiryDate: past, targetEnroll: null, currentEnroll: 0 },
        { id: 'b', studyType: 'X', irbStatus: 'APPROVED', irbExpiryDate: soon, targetEnroll: null, currentEnroll: 0 },
        { id: 'c', studyType: 'X', irbStatus: 'APPROVED', irbExpiryDate: null, targetEnroll: null, currentEnroll: 0 },
      ]);

      const result = await service.getStats();

      expect(result.irbExpiry).toEqual({ expired: 1, expiringSoon: 1, noExpiryOnRecord: 1 });
    });

    it('월별 등록은 표본이 없으면 빈 배열(폴백 곡선 금지)', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([]);
      mockPrisma.researchSubject.findMany.mockResolvedValue([]);

      const result = await service.getStats();

      expect(result.monthlyEnrollment).toEqual([]);
    });
  });

  describe('getEnrollmentChart', () => {
    it('should return monthly enrollment with cumulative counts', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(studyBase);
      mockPrisma.researchSubject.findMany.mockResolvedValue([
        { consentDate: new Date('2026-01-10') },
        { consentDate: new Date('2026-01-20') },
        { consentDate: new Date('2026-02-05') },
        { consentDate: new Date('2026-03-15') },
      ]);

      const result = await service.getEnrollmentChart('study-1');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ month: '2026-01', enrolled: 2, cumulative: 2 });
      expect(result[1]).toEqual({ month: '2026-02', enrolled: 1, cumulative: 3 });
      expect(result[2]).toEqual({ month: '2026-03', enrolled: 1, cumulative: 4 });
    });

    it('should throw if study not found', async () => {
      mockPrisma.researchStudy.findUnique.mockResolvedValue(null);

      await expect(service.getEnrollmentChart('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getIrbCalendar', () => {
    it('should return upcoming IRB reviews', async () => {
      const upcoming = [
        { id: 'study-1', studyNo: 'IRB-2026-001', title: '연구A', irbStatus: 'SUBMITTED', department: '순환기내과', createdAt: new Date('2026-05-01') },
        { id: 'study-2', studyNo: 'IRB-2026-002', title: '연구B', irbStatus: 'UNDER_REVIEW', department: '호흡기내과', createdAt: new Date('2026-05-05') },
      ];
      mockPrisma.researchStudy.findMany.mockResolvedValue(upcoming);

      const result = await service.getIrbCalendar();

      expect(result).toHaveLength(2);
      expect(result[0].studyId).toBe('study-1');
      expect(result[0].status).toBe('SUBMITTED');
      expect(result[1].status).toBe('UNDER_REVIEW');
    });

    it('🔴 개최 예정일은 시스템에 없다 — 만들어내지 않는다', async () => {
      mockPrisma.researchStudy.findMany.mockResolvedValue([
        { id: 'study-1', studyNo: 'IRB-2026-001', title: '연구A', irbStatus: 'SUBMITTED', department: '순환기내과', createdAt: new Date(Date.now() - 3 * 86_400_000) },
      ]);

      const [r] = await service.getIrbCalendar();

      expect(r.scheduledDate).toBeNull();
      expect(r.daysWaiting).toBe(3);
    });
  });

  /* ───────── 제거된 mock EP ───────── */

  it('🔴 research 모듈 안의 CDM mock 상수 2벌은 제거됐다 (정본=omop-cdm /api/v1/cdm)', () => {
    expect((service as unknown as Record<string, unknown>).convertCdm).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).getCdmTables).toBeUndefined();
  });
});
